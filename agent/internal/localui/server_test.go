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

	"gnext/agent/internal/cloud"
)

type fakeHost struct {
	cloud   *cloud.Client
	enrols  []string
	enrolOK bool
}

func (h *fakeHost) State() State {
	return State{Enrolled: h.cloud != nil, Server: "https://gnext.test", Cloud: h.cloud}
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

func newTestServer(h Host) http.Handler {
	s := &Server{Host: h, Version: "1.0.0", Log: slog.New(slog.NewTextHandler(io.Discard, nil)), LogFile: "missing.log"}
	return s.Handler(DefaultAddr)
}

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

	req := httptest.NewRequest("GET", "/api/status", nil)
	req.Host = "evil.example:47800"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 403 {
		t.Fatalf("foreign host: %d", rec.Code)
	}
	if rec := call(h, "GET", "/api/status", "", nil); rec.Code != 200 {
		t.Fatalf("status: %d", rec.Code)
	}
	if rec := call(h, "POST", "/api/logout", "", map[string]string{"X-Gnext-Local": ""}); rec.Code != 403 {
		t.Fatalf("write without header: %d", rec.Code)
	}
	if rec := call(h, "POST", "/api/logout", "", map[string]string{"Origin": "http://evil.example"}); rec.Code != 403 {
		t.Fatalf("write from another origin: %d", rec.Code)
	}
	if rec := call(h, "GET", "/", "", nil); rec.Code != 200 || !strings.Contains(rec.Body.String(), "عامل شعبه") {
		t.Fatalf("page: %d", rec.Code)
	}
}

func TestDeviceChangesNeedASignedInManager(t *testing.T) {
	var seen []string
	srv := fakeCloud(t, &seen)
	host := &fakeHost{cloud: &cloud.Client{Server: srv.URL, Key: "gak_k", Version: "1.0.0"}}
	h := newTestServer(host)

	if rec := call(h, "POST", "/api/printers", `{"name":"x"}`, nil); rec.Code != 401 {
		t.Fatalf("before sign-in: %d", rec.Code)
	}
	if rec := call(h, "POST", "/api/login", `{"username":"m","password":"wrong"}`, nil); rec.Code != 401 {
		t.Fatalf("wrong password: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "POST", "/api/login", `{"username":"m","password":"right"}`, nil); rec.Code != 200 {
		t.Fatalf("sign-in: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "GET", "/api/session", "", nil); !strings.Contains(rec.Body.String(), "Manager") {
		t.Fatalf("session: %s", rec.Body)
	}
	rec := call(h, "PATCH", "/api/printers/p1", `{"name":"Grill"}`, nil)
	if rec.Code != 200 {
		t.Fatalf("patch: %d %s", rec.Code, rec.Body)
	}
	last := seen[len(seen)-1]
	if last != "PATCH /api/v1/agent/local/printers/p1 key=Bearer gak_k session=sess-1" {
		t.Fatalf("cloud saw %q", last)
	}
	if rec := call(h, "DELETE", "/api/terminals/t1", "", nil); rec.Code != 200 {
		t.Fatalf("delete: %d", rec.Code)
	}
	if rec := call(h, "POST", "/api/logout", "", nil); rec.Code != 200 {
		t.Fatalf("logout: %d", rec.Code)
	}
	if rec := call(h, "DELETE", "/api/terminals/t1", "", nil); rec.Code != 401 {
		t.Fatalf("after logout: %d", rec.Code)
	}
}

func TestEnrolPassesTheCloudsAnswerOn(t *testing.T) {
	host := &fakeHost{}
	h := newTestServer(host)
	if rec := call(h, "POST", "/api/enrol", `{"server":"ftp://x","code":"AB"}`, nil); rec.Code != 400 {
		t.Fatalf("bad server: %d", rec.Code)
	}
	rec := call(h, "POST", "/api/enrol", `{"server":"https://gnext.test/","code":"ABCD-EFGH"}`, nil)
	if rec.Code != 400 || !strings.Contains(rec.Body.String(), "ENROLMENT_CODE_INVALID") {
		t.Fatalf("refused code: %d %s", rec.Code, rec.Body)
	}
	host.enrolOK = true
	if rec := call(h, "POST", "/api/enrol", `{"server":"https://gnext.test","code":"ABCD-EFGH"}`, nil); rec.Code != 200 {
		t.Fatalf("enrol: %d %s", rec.Code, rec.Body)
	}
	if host.enrols[0] != "https://gnext.test ABCD-EFGH" {
		t.Fatalf("host got %v", host.enrols)
	}
}
