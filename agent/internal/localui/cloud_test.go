package localui

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"gnext/agent/internal/cloud"
	"gnext/agent/internal/till"
)

// tillCloud is the cloud as the till online (§16) sees it: PIN sign-in, and a few routes that say
// what the agent sent them.
type tillCloud struct {
	mu      sync.Mutex
	logins  int
	logouts []string
	refuse  string // a code pin-login answers with, instead of a session
}

func (c *tillCloud) server(t *testing.T) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.mu.Lock()
		defer c.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/agent/local/pin-login":
			c.logins++
			var in struct{ UserID, PIN string }
			_ = json.NewDecoder(r.Body).Decode(&struct {
				UserID *string `json:"user_id"`
				PIN    *string `json:"pin"`
			}{&in.UserID, &in.PIN})
			if c.refuse != "" {
				w.WriteHeader(403)
				io.WriteString(w, `{"status":403,"code":"`+c.refuse+`","detail":"no"}`)
				return
			}
			if r.Header.Get("Authorization") != "Bearer gak_k" || in.PIN != "1111" {
				w.WriteHeader(401)
				io.WriteString(w, `{"status":401,"code":"PIN_WRONG","detail":"The PIN is wrong."}`)
				return
			}
			io.WriteString(w, `{"session_token":"cs-1","csrf_token":"csrf-1","user":{"id":"sara","role":"CASHIER"},"tenant":{"id":"t1","baseCurrency":"IRR"}}`)
		case "/api/v1/agent/local/logout":
			c.logouts = append(c.logouts, r.Header.Get("X-Gnext-User-Session"))
			io.WriteString(w, `{"ok":true}`)
		case "/api/v1/down":
			w.WriteHeader(503)
		case "/api/v1/expired":
			w.WriteHeader(401)
			io.WriteString(w, `{"status":401,"code":"UNAUTHENTICATED"}`)
		default:
			http.SetCookie(w, &http.Cookie{Name: "gnext_session", Value: "leak"})
			_, cookieErr := r.Cookie(tillCookie)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"method": r.Method, "uri": r.URL.RequestURI(),
				"auth": r.Header.Get("Authorization"), "csrf": r.Header.Get("X-CSRF-Token"),
				"terminal": r.Header.Get("X-Terminal-Id"), "local": r.Header.Get("X-Gnext-Local"),
				"cookie": cookieErr == nil, "lang": r.Header.Get("Accept-Language"),
			})
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func (c *tillCloud) loggedOut() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.logouts...)
}

// onlineTill is testTill with a session to the cloud that has lasted long enough to trust.
func onlineTill(t *testing.T, up *bool) *till.Till {
	tt := testTill(t)
	started := time.Now().Add(-time.Minute)
	tt.Connected = func() bool { return *up }
	tt.ConnectedSince = func() *time.Time {
		if !*up {
			return nil
		}
		return &started
	}
	return tt
}

func signIn(t *testing.T, h http.Handler) (session map[string]string, body string) {
	t.Helper()
	rec := call(h, "POST", "/api/till/login", `{"user_id":"sara","pin":"1111"}`, nil)
	if rec.Code != 200 {
		t.Fatalf("sign-in: %d %s", rec.Code, rec.Body)
	}
	var out struct{ Token string }
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	if !strings.Contains(rec.Header().Get("Set-Cookie"), tillCookie+"="+out.Token) || !strings.Contains(rec.Header().Get("Set-Cookie"), "HttpOnly") {
		t.Fatalf("till cookie: %q", rec.Header().Get("Set-Cookie"))
	}
	return map[string]string{tillSessionHeader: out.Token}, rec.Body.String()
}

func TestTheTillSignsInToTheCloudAndSendsItsCallsWithTheCashiersSession(t *testing.T) {
	up := true
	fc := &tillCloud{}
	srv := fc.server(t)
	h := newTestServer(&fakeHost{till: onlineTill(t, &up), cloud: &cloud.Client{Server: srv.URL, Key: "gak_k"}})
	if rec := call(h, "POST", "/api/till/binding", `{"terminal_id":"till-1","user_id":"amir","pin":"9999"}`, nil); rec.Code != 200 {
		t.Fatalf("binding: %d %s", rec.Code, rec.Body)
	}

	session, body := signIn(t, h)
	if !strings.Contains(body, `"cloud_session":{"tenant":{"id":"t1","baseCurrency":"IRR"},"user":{"id":"sara","role":"CASHIER"}}`) || strings.Contains(body, "cs-1") {
		t.Fatalf("sign-in answer: %s", body)
	}
	state := call(h, "GET", "/api/till/state", "", session).Body.String()
	if !strings.Contains(state, `"reachable":true`) || !strings.Contains(state, `"mode":"ONLINE"`) || !strings.Contains(state, `"user":{"id":"sara","role":"CASHIER"}`) {
		t.Fatalf("state: %s", state)
	}

	// The cloud gets the cashier's session, its CSRF token and the bound till, and nothing the page
	// set for itself; the page gets the cloud's answer without its cookies.
	rec := call(h, "POST", "/api/v1/orders?branchId=b1", `{"items":[]}`, map[string]string{
		tillSessionHeader: session[tillSessionHeader], "Authorization": "Bearer page", "Content-Type": "application/json",
		"Accept-Language": "fa", "Cookie": tillCookie + "=" + session[tillSessionHeader],
	})
	var seen map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &seen)
	want := map[string]any{"method": "POST", "uri": "/api/v1/orders?branchId=b1", "auth": "Bearer cs-1", "csrf": "csrf-1", "terminal": "till-1", "local": "", "cookie": false, "lang": "fa"}
	for k, v := range want {
		if seen[k] != v {
			t.Fatalf("cloud saw %s = %v, want %v (%s)", k, seen[k], v, rec.Body)
		}
	}
	if rec.Header().Get("Set-Cookie") != "" {
		t.Fatalf("the cloud's cookie reached the page: %q", rec.Header().Get("Set-Cookie"))
	}

	// The cookie alone is enough, for an EventSource.
	if rec := call(h, "GET", "/api/v1/live/stream?topics=orders", "", map[string]string{"Cookie": tillCookie + "=" + session[tillSessionHeader]}); rec.Code != 200 {
		t.Fatalf("by cookie: %d %s", rec.Code, rec.Body)
	}
	for _, path := range []string{"/api/v1/agent/local/logout", "/api/v1/auth/login"} {
		if rec := call(h, "POST", path, "{}", session); rec.Code != 403 || !strings.Contains(rec.Body.String(), "NOT_PROXIED") {
			t.Fatalf("%s: %d %s", path, rec.Code, rec.Body)
		}
	}
	if rec := call(h, "GET", "/api/v1/auth/me", "", session); rec.Code != 200 {
		t.Fatalf("auth/me: %d", rec.Code)
	}
	if rec := call(h, "GET", "/api/v1/orders", "", nil); rec.Code != 401 {
		t.Fatalf("without the till session: %d", rec.Code)
	}

	call(h, "POST", "/api/till/logout", "", session)
	if rec := call(h, "GET", "/api/v1/orders", "", session); rec.Code != 401 {
		t.Fatalf("after sign-out: %d", rec.Code)
	}
	waitFor(t, func() bool { return len(fc.loggedOut()) == 1 && fc.loggedOut()[0] == "cs-1" })
}

func TestACloudThatStopsAnsweringSwitchesTheTillOffline(t *testing.T) {
	up := true
	fc := &tillCloud{}
	srv := fc.server(t)
	h := newTestServer(&fakeHost{till: onlineTill(t, &up), cloud: &cloud.Client{Server: srv.URL, Key: "gak_k"}})
	session, _ := signIn(t, h)

	if rec := call(h, "GET", "/api/v1/down", "", session); rec.Code != 502 || !strings.Contains(rec.Body.String(), "CLOUD_UNREACHABLE") {
		t.Fatalf("503 behind the proxy: %d %s", rec.Code, rec.Body)
	}
	if st := call(h, "GET", "/api/till/state", "", session).Body.String(); !strings.Contains(st, `"mode":"OFFLINE"`) || !strings.Contains(st, `"reachable":false`) {
		t.Fatalf("after a failure: %s", st)
	}
	// The next answer brings it back.
	call(h, "GET", "/api/v1/orders", "", session)
	if st := call(h, "GET", "/api/till/state", "", session).Body.String(); !strings.Contains(st, `"mode":"ONLINE"`) {
		t.Fatalf("after an answer: %s", st)
	}

	// The cloud ended the session: the cashier stays signed in at the till, and types the PIN again.
	if rec := call(h, "GET", "/api/v1/expired", "", session); rec.Code != 401 || !strings.Contains(rec.Body.String(), "CLOUD_SIGN_IN_REQUIRED") {
		t.Fatalf("expired: %d %s", rec.Code, rec.Body)
	}
	if st := call(h, "GET", "/api/till/state", "", session).Body.String(); !strings.Contains(st, `"session":null`) || !strings.Contains(st, `"user":{"id":"sara"`) {
		t.Fatalf("after the cloud ended the session: %s", st)
	}
	if rec := call(h, "POST", "/api/till/cloud-login", `{"pin":"0000"}`, session); rec.Code != 401 {
		t.Fatalf("wrong PIN again: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "POST", "/api/till/cloud-login", `{"pin":"1111"}`, session); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"cloud_session":{`) {
		t.Fatalf("PIN again: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "GET", "/api/v1/orders", "", session); rec.Code != 200 {
		t.Fatalf("after the PIN: %d", rec.Code)
	}
}

func TestOfflineTheCashierSignsInOnTheAgentAlone(t *testing.T) {
	up := false
	fc := &tillCloud{}
	srv := fc.server(t)
	h := newTestServer(&fakeHost{till: onlineTill(t, &up), cloud: &cloud.Client{Server: srv.URL, Key: "gak_k"}})
	session, body := signIn(t, h)
	if !strings.Contains(body, `"cloud_session":null`) || fc.logins != 0 {
		t.Fatalf("offline sign-in asked the cloud: %s (%d)", body, fc.logins)
	}
	if rec := call(h, "POST", "/api/till/cloud-login", `{"pin":"1111"}`, session); rec.Code != 502 {
		t.Fatalf("cloud-login offline: %d %s", rec.Code, rec.Body)
	}
}

func TestTheCloudHasTheLastWordOnWhoSignsIn(t *testing.T) {
	up := true
	fc := &tillCloud{refuse: "FORBIDDEN_ROLE"}
	srv := fc.server(t)
	h := newTestServer(&fakeHost{till: onlineTill(t, &up), cloud: &cloud.Client{Server: srv.URL, Key: "gak_k"}})
	rec := call(h, "POST", "/api/till/login", `{"user_id":"sara","pin":"1111"}`, nil)
	if rec.Code != 403 || !strings.Contains(rec.Body.String(), "FORBIDDEN_ROLE") {
		t.Fatalf("stale staff list: %d %s", rec.Code, rec.Body)
	}
	if st := call(h, "GET", "/api/till/state", "", nil).Body.String(); !strings.Contains(st, `"user":null`) {
		t.Fatalf("still signed in: %s", st)
	}

	// An older cloud without PIN sign-in: the cashier works on the agent, as offline.
	fc.refuse = "CAPABILITY_REQUIRED"
	if _, body := signIn(t, h); !strings.Contains(body, `"cloud_session":null`) {
		t.Fatalf("older cloud: %s", body)
	}
}

func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	for i := 0; i < 100; i++ {
		if ok() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("timed out")
}
