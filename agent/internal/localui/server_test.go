package localui

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gnext/agent/internal/agent"
	"gnext/agent/internal/cloud"
)

type fakeHost struct {
	cloud     *cloud.Client
	server    string // the cloud's address; https://gnext.test when empty
	appOrigin string
	agent     *agent.Agent
	enrols    []string
	enrolOK   bool
}

func (h *fakeHost) State() State {
	server := h.server
	if server == "" {
		server = "https://gnext.test"
	}
	origin := h.appOrigin
	if origin == "" {
		origin = server
	}
	return State{Enrolled: h.cloud != nil, Server: server, AppOrigin: origin, Cloud: h.cloud, Agent: h.agent}
}

func (h *fakeHost) Enrol(_ context.Context, server, code string) error {
	h.enrols = append(h.enrols, server+" "+code)
	if !h.enrolOK {
		return &cloud.Problem{Status: 400, Code: "ENROLMENT_CODE_INVALID", Detail: "bad code"}
	}
	return nil
}

// fakeCloud answers the agent/local routes and records what it was sent.
func fakeCloud(t *testing.T, seen *[]string) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*seen = append(*seen, r.Method+" "+r.URL.Path+" key="+r.Header.Get("Authorization")+" session="+r.Header.Get("X-Gnext-User-Session"))
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/api/v1/agent/local/login":
			var in struct{ Username, Password string }
			_ = json.NewDecoder(r.Body).Decode(&in)
			if in.Password != "right" {
				w.WriteHeader(401)
				io.WriteString(w, `{"status":401,"code":"INVALID_CREDENTIALS","detail":"Invalid username or password."}`)
				return
			}
			io.WriteString(w, `{"session_token":"sess-1","user":{"id":"u","username":"m","display_name":"Manager","role":"MANAGER"}}`)
		case r.Header.Get("X-Gnext-User-Session") != "sess-1":
			w.WriteHeader(401)
			io.WriteString(w, `{"status":401,"code":"UNAUTHENTICATED","detail":"Sign in"}`)
		default:
			io.WriteString(w, `{"id":"p1","code":"KIT1"}`)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func newServer(h Host) *Server {
	return &Server{Host: h, Version: "2.1.0", Log: slog.New(slog.NewTextHandler(io.Discard, nil)), LogFile: "missing.log", ProxyRetry: testRetry}
}

func newTestServer(h Host) http.Handler { return newServer(h).Handler(DefaultAddr) }

// call makes a request to the loopback listener, as the settings page does.
func call(h http.Handler, method, path, body string, header map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Host = DefaultAddr
	req.Header.Set("X-Gnext-Local", "1")
	for k, v := range header {
		if v == "" {
			req.Header.Del(k)
		} else {
			req.Header.Set(k, v)
		}
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestLocalOnlyRefusesForeignHostsAndCrossSiteWrites(t *testing.T) {
	h := newTestServer(&fakeHost{})

	for _, path := range []string{"/", "/agent/api/status", "/agent/", "/api/v1/health", "/app/pos"} {
		req := httptest.NewRequest("GET", path, nil)
		req.Host = "evil.example:47800"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != 403 {
			t.Fatalf("foreign host on %s: %d", path, rec.Code)
		}
	}
	if rec := call(h, "GET", "/agent/api/status", "", nil); rec.Code != 200 {
		t.Fatalf("status: %d", rec.Code)
	}
	if rec := call(h, "POST", "/agent/api/logout", "", map[string]string{"X-Gnext-Local": ""}); rec.Code != 403 {
		t.Fatalf("write without header: %d", rec.Code)
	}
	if rec := call(h, "POST", "/agent/api/logout", "", map[string]string{"Origin": "http://evil.example"}); rec.Code != 403 {
		t.Fatalf("write from another origin: %d", rec.Code)
	}
	if rec := call(h, "POST", "/agent/api/logout", "", map[string]string{"Origin": "http://127.0.0.1:47800"}); rec.Code != 200 {
		t.Fatalf("write from the page's own origin: %d", rec.Code)
	}
}

// The settings page moved from / to /agent/, with its API under /agent/api/ (§19.5).
func TestSettingsPageIsUnderAgent(t *testing.T) {
	h := newTestServer(&fakeHost{})

	rec := call(h, "GET", "/agent/", "", nil)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "عامل شعبه") {
		t.Fatalf("page: %d", rec.Code)
	}
	for k, want := range map[string]string{
		"X-Frame-Options": "DENY", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
	} {
		if got := rec.Header().Get(k); got != want {
			t.Errorf("%s = %q, want %q", k, got, want)
		}
	}
	if csp := rec.Header().Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'self'") {
		t.Errorf("CSP = %q", csp)
	}
	if rec := call(h, "GET", "/agent", "", nil); rec.Code/100 != 3 || rec.Header().Get("Location") != "/agent/" {
		t.Fatalf("/agent: %d %q", rec.Code, rec.Header().Get("Location"))
	}
	rec = call(h, "GET", "/agent/app.js", "", nil)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), "/agent/api/status") || strings.Contains(rec.Body.String(), "'/api/") {
		t.Fatalf("app.js: %d (must call /agent/api/..., never /api/...)", rec.Code)
	}
	if rec := call(h, "GET", "/agent/api/nothing", "", nil); rec.Code != 404 {
		t.Fatalf("unknown settings route: %d", rec.Code)
	}
	// The page's script and style are relative, so they resolve under /agent/.
	rec = call(h, "GET", "/agent/", "", nil)
	for _, ref := range []string{`href="app.css"`, `src="app.js"`} {
		if !strings.Contains(rec.Body.String(), ref) {
			t.Errorf("settings page does not reference %s relatively", ref)
		}
	}
}

func TestDeviceChangesNeedASignedInManager(t *testing.T) {
	var seen []string
	srv := fakeCloud(t, &seen)
	host := &fakeHost{cloud: &cloud.Client{Server: srv.URL, Key: "gak_k", Version: "1.0.0"}}
	h := newTestServer(host)

	if rec := call(h, "POST", "/agent/api/printers", `{"name":"x"}`, nil); rec.Code != 401 {
		t.Fatalf("before sign-in: %d", rec.Code)
	}
	if rec := call(h, "POST", "/agent/api/login", `{"username":"m","password":"wrong"}`, nil); rec.Code != 401 {
		t.Fatalf("wrong password: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "POST", "/agent/api/login", `{"username":"m","password":"right"}`, nil); rec.Code != 200 {
		t.Fatalf("sign-in: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "GET", "/agent/api/session", "", nil); !strings.Contains(rec.Body.String(), "Manager") {
		t.Fatalf("session: %s", rec.Body)
	}
	rec := call(h, "PATCH", "/agent/api/printers/p1", `{"name":"Grill"}`, nil)
	if rec.Code != 200 {
		t.Fatalf("patch: %d %s", rec.Code, rec.Body)
	}
	last := seen[len(seen)-1]
	if last != "PATCH /api/v1/agent/local/printers/p1 key=Bearer gak_k session=sess-1" {
		t.Fatalf("cloud saw %q", last)
	}
	if rec := call(h, "DELETE", "/agent/api/terminals/t1", "", nil); rec.Code != 200 {
		t.Fatalf("delete: %d", rec.Code)
	}
	if rec := call(h, "POST", "/agent/api/logout", "", nil); rec.Code != 200 {
		t.Fatalf("logout: %d", rec.Code)
	}
	if rec := call(h, "DELETE", "/agent/api/terminals/t1", "", nil); rec.Code != 401 {
		t.Fatalf("after logout: %d", rec.Code)
	}
}

func TestEnrolPassesTheCloudsAnswerOn(t *testing.T) {
	host := &fakeHost{}
	h := newTestServer(host)
	if rec := call(h, "POST", "/agent/api/enrol", `{"server":"ftp://x","code":"AB"}`, nil); rec.Code != 400 {
		t.Fatalf("bad server: %d", rec.Code)
	}
	rec := call(h, "POST", "/agent/api/enrol", `{"server":"https://gnext.test/","code":"ABCD-EFGH"}`, nil)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "ENROLMENT_CODE_INVALID") {
		t.Fatalf("refused code: %d %s", rec.Code, rec.Body)
	}
	host.enrolOK = true
	if rec := call(h, "POST", "/agent/api/enrol", `{"server":"https://gnext.test","code":"ABCD-EFGH"}`, nil); rec.Code != 200 {
		t.Fatalf("enrol: %d %s", rec.Code, rec.Body)
	}
	if host.enrols[0] != "https://gnext.test ABCD-EFGH" {
		t.Fatalf("host got %v", host.enrols)
	}
}

// The agent no longer has a till, pairing or its own login (§19.2): those routes are gone. The
// old settings API paths under /api/ are now the cloud's, and the proxy passes them on.
func TestTheOfflineTillRoutesAreGone(t *testing.T) {
	h := newTestServer(&fakeHost{})
	for _, path := range []string{"/agent/till/", "/agent/api/till/state", "/agent/api/pairings"} {
		if rec := call(h, "GET", path, "", nil); rec.Code != 404 {
			t.Errorf("GET %s = %d, want 404", path, rec.Code)
		}
	}
	for _, path := range []string{"/agent/api/till/cloud-login", "/agent/api/pairing-codes"} {
		if rec := call(h, "POST", path, `{}`, nil); rec.Code != 404 && rec.Code != 405 {
			t.Errorf("POST %s = %d, want 404 or 405", path, rec.Code)
		}
	}
}

func TestRefreshNeedsTheManagersSession(t *testing.T) {
	var seen []string
	srv := fakeCloud(t, &seen)
	host := &fakeHost{cloud: &cloud.Client{Server: srv.URL, Key: "gak_k", Version: "1.0.0"}}
	h := newTestServer(host)

	if rec := call(h, "GET", "/agent/api/app/refresh", "", nil); rec.Code != 401 {
		t.Fatalf("without a session: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "POST", "/agent/api/login", `{"username":"m","password":"right"}`, nil); rec.Code != 200 {
		t.Fatalf("sign-in: %d", rec.Code)
	}
	// Signed in, but this server has no app cache (App is nil): a clear answer, not a crash.
	if rec := call(h, "GET", "/agent/api/app/refresh", "", nil); rec.Code != 409 || !strings.Contains(rec.Body.String(), "APP_CACHE_OFF") {
		t.Fatalf("with a session and no cache: %d %s", rec.Code, rec.Body)
	}
}
