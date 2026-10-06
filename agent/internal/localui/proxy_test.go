package localui

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"strings"
	"sync"
	"testing"
	"time"
)

// upstream is a cloud that records what the proxy sent and answers as the test says.
type upstream struct {
	srv *httptest.Server

	mu   sync.Mutex
	last *http.Request
	body []byte
	hits int
}

func newUpstream(t *testing.T, h http.HandlerFunc) *upstream {
	u := &upstream{}
	u.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		u.mu.Lock()
		u.last, u.body = r.Clone(context.Background()), b
		u.hits++
		u.mu.Unlock()
		h(w, r)
	}))
	t.Cleanup(u.srv.Close)
	return u
}

func (u *upstream) seen() (*http.Request, []byte) {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.last, u.body
}

func (u *upstream) count() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.hits
}

// testRetry is the retry window of the tests: the same shape as the real one (§19.10), a hundred
// times shorter.
var testRetry = Retry{Every: 20 * time.Millisecond, Window: 100 * time.Millisecond, Grace: 50 * time.Millisecond}

func newProxy(server string) *Proxy {
	return &Proxy{Up: &Upstream{}, Server: func() string { return server }, Version: "2.1.0", Retry: testRetry}
}

func doReq(p http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	p.ServeHTTP(rec, req)
	return rec
}

func problemOf(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var p map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatalf("not a problem body: %v\n%s", err, rec.Body)
	}
	return p
}

func TestProxyPassesHeadersAndBodiesBothWays(t *testing.T) {
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Custom-Out", "yes")
		w.Header().Set("Keep-Alive", "timeout=5")
		w.Header().Set("Connection", "X-Drop-Me")
		w.Header().Set("X-Drop-Me", "x")
		w.Header().Set("Etag", `"v1"`)
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	p := newProxy(up.srv.URL)

	req := httptest.NewRequest("POST", "/api/v1/orders?branch=b1&q=%D8%B3", strings.NewReader(`{"a":1}`))
	req.RemoteAddr = "192.168.1.55:50123"
	req.Host = "127.0.0.1:47800"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer sess-token")
	req.Header.Set("Cookie", "gnext_session=abc; other=1")
	req.Header.Set("X-Csrf-Token", "csrf")
	req.Header.Set("X-Terminal-Id", "t-1")
	req.Header.Set("X-Correlation-Id", "cid-1")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows) Chrome/130")
	req.Header.Set("X-Forwarded-For", "10.0.0.9")
	req.Header.Set("Origin", "http://127.0.0.1:47800")
	req.Header.Set("Accept-Encoding", "gzip")
	req.Header.Set("Connection", "X-Hop-Only")
	req.Header.Set("X-Hop-Only", "x")
	req.Header.Set("Keep-Alive", "timeout=3")
	req.Header.Set("Proxy-Authorization", "Basic xyz")
	req.Header.Set("Te", "trailers")
	req.Header.Set("Upgrade", "websocket")
	rec := doReq(p, req)

	if rec.Code != 201 || rec.Body.String() != `{"ok":true}` {
		t.Fatalf("answer: %d %s", rec.Code, rec.Body)
	}
	if rec.Header().Get("X-Custom-Out") != "yes" || rec.Header().Get("Etag") != `"v1"` || rec.Header().Get("Content-Type") != "application/json" {
		t.Errorf("response headers = %v", rec.Header())
	}
	for _, h := range []string{"Keep-Alive", "Connection", "X-Drop-Me"} {
		if v := rec.Header().Get(h); v != "" {
			t.Errorf("hop-by-hop response header %s = %q was passed on", h, v)
		}
	}

	got, body := up.seen()
	if string(body) != `{"a":1}` || got.Method != "POST" || got.URL.RequestURI() != "/api/v1/orders?branch=b1&q=%D8%B3" {
		t.Fatalf("upstream saw %s %s %q", got.Method, got.URL.RequestURI(), body)
	}
	for h, want := range map[string]string{
		"Authorization": "Bearer sess-token", "Cookie": "gnext_session=abc; other=1", "X-Csrf-Token": "csrf",
		"X-Terminal-Id": "t-1", "X-Correlation-Id": "cid-1", "Origin": "http://127.0.0.1:47800",
		"Content-Type": "application/json", "Accept-Encoding": "gzip",
		"X-Forwarded-For":   "10.0.0.9, 192.168.1.55",
		"X-Forwarded-Proto": "http",
		"User-Agent":        "Mozilla/5.0 (Windows) Chrome/130 gnext-agent/2.1.0",
	} {
		if v := got.Header.Get(h); v != want {
			t.Errorf("upstream header %s = %q, want %q", h, v, want)
		}
	}
	for _, h := range []string{"X-Hop-Only", "Proxy-Authorization", "Te", "Upgrade"} {
		if v := got.Header.Get(h); v != "" {
			t.Errorf("hop-by-hop request header %s = %q was passed on", h, v)
		}
	}
	if got.Header.Get("Keep-Alive") != "" {
		t.Errorf("Keep-Alive was passed on")
	}
	// The cloud sees its own host name, not the register's.
	if want := strings.TrimPrefix(up.srv.URL, "http://"); got.Host != want {
		t.Errorf("Host = %q, want %q", got.Host, want)
	}
}

func TestProxyAddsForwardingHeadersWhenThePageSentNone(t *testing.T) {
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {})
	req := httptest.NewRequest("GET", "/api/v1/health", nil)
	req.RemoteAddr = "127.0.0.1:60000"
	req.Header.Del("User-Agent")
	doReq(newProxy(up.srv.URL), req)
	got, _ := up.seen()
	if got.Header.Get("X-Forwarded-For") != "127.0.0.1" || got.Header.Get("X-Forwarded-Proto") != "http" ||
		got.Header.Get("User-Agent") != "gnext-agent/2.1.0" {
		t.Fatalf("headers = %v", got.Header)
	}
}

func TestProxyRelaysEveryMethodStatusAndRedirectUntouched(t *testing.T) {
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/redirect":
			w.Header().Set("Location", "https://gnext.top/elsewhere")
			w.WriteHeader(http.StatusFound)
		case "/api/v1/gone":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			io.WriteString(w, `{"code":"NOT_FOUND"}`)
		case "/api/v1/empty":
			w.WriteHeader(http.StatusNoContent)
		case "/api/v1/maintenance":
			// The application's own 503, as JSON: the page must get it as it is.
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			io.WriteString(w, `{"code":"MAINTENANCE"}`)
		}
	})
	p := newProxy(up.srv.URL)
	for _, m := range []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"} {
		rec := doReq(p, httptest.NewRequest(m, "/api/v1/redirect", nil))
		if rec.Code != 302 || rec.Header().Get("Location") != "https://gnext.top/elsewhere" {
			t.Errorf("%s redirect: %d %q (a redirect is not followed)", m, rec.Code, rec.Header().Get("Location"))
		}
		if got, _ := up.seen(); got.Method != m {
			t.Errorf("upstream saw method %s, want %s", got.Method, m)
		}
	}
	if rec := doReq(p, httptest.NewRequest("GET", "/api/v1/gone", nil)); rec.Code != 404 || rec.Body.String() != `{"code":"NOT_FOUND"}` {
		t.Errorf("404: %d %s", rec.Code, rec.Body)
	}
	if rec := doReq(p, httptest.NewRequest("DELETE", "/api/v1/empty", nil)); rec.Code != 204 || rec.Body.Len() != 0 {
		t.Errorf("204: %d", rec.Code)
	}
	if rec := doReq(p, httptest.NewRequest("GET", "/api/v1/maintenance", nil)); rec.Code != 503 || rec.Body.String() != `{"code":"MAINTENANCE"}` {
		t.Errorf("the application's own 503 was replaced: %d %s", rec.Code, rec.Body)
	}
	if rec := doReq(p, httptest.NewRequest("HEAD", "/api/v1/gone", nil)); rec.Code != 404 || rec.Body.Len() != 0 {
		t.Errorf("HEAD: %d %d bytes", rec.Code, rec.Body.Len())
	}
}

func TestProxyPassesCookiesAndStripsDomainAndSecureFromSetCookie(t *testing.T) {
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Add("Set-Cookie", "gnext_session=abc123; Max-Age=604800; Domain=gnext.top; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; Secure; SameSite=Lax")
		h.Add("Set-Cookie", "plain=1; path=/; secure; domain=.gnext.top")
		h.Add("Set-Cookie", "kept=v; Path=/api; HttpOnly")
	})
	req := httptest.NewRequest("GET", "/api/v1/auth/me", nil)
	req.Header.Set("Cookie", "gnext_session=old")
	rec := doReq(newProxy(up.srv.URL), req)

	if got, _ := up.seen(); got.Header.Get("Cookie") != "gnext_session=old" {
		t.Fatalf("Cookie not passed on: %q", got.Header.Get("Cookie"))
	}
	want := []string{
		"gnext_session=abc123; Max-Age=604800; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT; HttpOnly; SameSite=Lax",
		"plain=1; path=/",
		"kept=v; Path=/api; HttpOnly",
	}
	got := rec.Header().Values("Set-Cookie")
	if len(got) != len(want) {
		t.Fatalf("Set-Cookie = %q", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("Set-Cookie[%d] = %q, want %q", i, got[i], want[i])
		}
	}
	// What a browser makes of it: the cookie is host-only, not Secure.
	for _, c := range rec.Result().Cookies() {
		if c.Domain != "" || c.Secure {
			t.Errorf("cookie %s still has Domain=%q Secure=%v", c.Name, c.Domain, c.Secure)
		}
	}
}

func TestProxyAnswers502CloudUnreachableForADeadUpstreamOnAnyMethod(t *testing.T) {
	dead := httptest.NewServer(http.NotFoundHandler())
	url := dead.URL
	dead.Close()
	p := newProxy(url)

	for _, m := range []string{"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"} {
		req := httptest.NewRequest(m, "/api/v1/orders?x=1", strings.NewReader(`{}`))
		req.Header.Set("X-Correlation-Id", "cid-77")
		rec := doReq(p, req)
		if rec.Code != 502 {
			t.Errorf("%s: %d, want 502", m, rec.Code)
			continue
		}
		if m == "HEAD" {
			continue
		}
		pr := problemOf(t, rec)
		if pr["code"] != "CLOUD_UNREACHABLE" || pr["status"] != float64(502) || pr["title"] != "Cloud unreachable" ||
			pr["instance"] != "/api/v1/orders?x=1" || pr["correlationId"] != "cid-77" || pr["detail"] == "" || pr["type"] == "" {
			t.Errorf("%s: problem = %v", m, pr)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
			t.Errorf("problem Content-Type = %q", ct)
		}
	}
}

// A cloud that takes the request and never answers: a write may have happened (504), a read is
// simply unreachable (502).
func TestProxyAnswers504ForAWriteTheCloudNeverAnsweredAnd502ForARead(t *testing.T) {
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done() // never answers
	})
	p := newProxy(up.srv.URL)
	p.Timeout = 150 * time.Millisecond

	for _, m := range []string{"POST", "PUT", "PATCH", "DELETE"} {
		start := time.Now()
		rec := doReq(p, httptest.NewRequest(m, "/api/v1/orders/1/submit", strings.NewReader(`{"a":1}`)))
		if rec.Code != 504 || problemOf(t, rec)["code"] != "CLOUD_NO_ANSWER" {
			t.Errorf("%s: %d %s, want 504 CLOUD_NO_ANSWER", m, rec.Code, rec.Body)
		}
		if d := time.Since(start); d < 100*time.Millisecond || d > 3*time.Second {
			t.Errorf("%s answered after %v, want about the 150 ms timeout", m, d)
		}
	}
	for _, m := range []string{"GET", "HEAD"} {
		rec := doReq(p, httptest.NewRequest(m, "/api/v1/orders", nil))
		if rec.Code != 502 {
			t.Errorf("%s: %d, want 502", m, rec.Code)
		}
		if m == "GET" && problemOf(t, rec)["code"] != "CLOUD_UNREACHABLE" {
			t.Errorf("GET: %s, want CLOUD_UNREACHABLE", rec.Body)
		}
	}
	if up.count() != 6 {
		t.Errorf("the cloud saw %d requests, want 6 (a write is never repeated; a read whose first attempt used the whole window is not either)", up.count())
	}
}

// A connection dropped after the request went out is also "written, not answered".
func TestProxyTreatsADropAfterTheRequestWasWrittenAsNoAnswer(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				// Read the whole request, then hang up without a word.
				br := bufio.NewReader(c)
				req, err := http.ReadRequest(br)
				if err == nil {
					_, _ = io.Copy(io.Discard, req.Body)
				}
				c.Close()
			}()
		}
	}()
	p := newProxy("http://" + ln.Addr().String())

	rec := doReq(p, httptest.NewRequest("POST", "/api/v1/payments", strings.NewReader(`{"amount":"1"}`)))
	if rec.Code != 504 || problemOf(t, rec)["code"] != "CLOUD_NO_ANSWER" {
		t.Errorf("POST: %d %s", rec.Code, rec.Body)
	}
	rec = doReq(p, httptest.NewRequest("GET", "/api/v1/payments", nil))
	if rec.Code != 502 || problemOf(t, rec)["code"] != "CLOUD_UNREACHABLE" {
		t.Errorf("GET: %d %s", rec.Code, rec.Body)
	}
}

// The cloud's gateway (nginx, the CDN) answering for an application that is not there.
func TestProxyMapsTheGatewaysOwnFailuresButNotTheApplicationsJSON(t *testing.T) {
	status := 502
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("json") != "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			io.WriteString(w, `{"code":"FROM_THE_APP"}`)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(status)
		io.WriteString(w, "<html><title>"+http.StatusText(status)+"</title></html>")
	})
	p := newProxy(up.srv.URL)

	type row struct {
		status      int
		method      string
		code        string
		wantStatus  int
		description string
	}
	for _, r := range []row{
		{502, "GET", "CLOUD_UNREACHABLE", 502, "gateway 502 on a read"},
		{502, "POST", "CLOUD_UNREACHABLE", 502, "gateway 502 on a write: not sent"},
		{503, "POST", "CLOUD_UNREACHABLE", 502, "gateway 503 on a write: not sent"},
		{503, "GET", "CLOUD_UNREACHABLE", 502, "gateway 503 on a read"},
		{504, "POST", "CLOUD_NO_ANSWER", 504, "gateway 504 on a write: it may have happened"},
		{504, "GET", "CLOUD_UNREACHABLE", 502, "gateway 504 on a read"},
	} {
		status = r.status
		rec := doReq(p, httptest.NewRequest(r.method, "/api/v1/orders", strings.NewReader(`{}`)))
		if rec.Code != r.wantStatus || problemOf(t, rec)["code"] != r.code {
			t.Errorf("%s: %d %s, want %d %s", r.description, rec.Code, rec.Body, r.wantStatus, r.code)
		}
	}
	// The application's own JSON answer, whatever its status, is passed on.
	for _, s := range []int{502, 503, 504} {
		status = s
		rec := doReq(p, httptest.NewRequest("POST", "/api/v1/orders?json=1", strings.NewReader(`{}`)))
		if rec.Code != s || rec.Body.String() != `{"code":"FROM_THE_APP"}` {
			t.Errorf("application %d as JSON: %d %s", s, rec.Code, rec.Body)
		}
	}
}

func TestClassifyAndAnswerTable(t *testing.T) {
	if !blockedPath("/api/v1/%zz") {
		t.Error("a path that cannot be decoded was not refused")
	}
	if classify(false) != NotSent || classify(true) != NoAnswer {
		t.Fatal("classify")
	}
	for _, c := range []struct {
		status  int
		ctype   string
		kind    FailureKind
		gateway bool
	}{
		{502, "text/html", NotSent, true}, {503, "text/html; charset=utf-8", NotSent, true}, {504, "text/html", NoAnswer, true},
		{502, "", NotSent, true}, {504, "text/plain", NoAnswer, true},
		{502, "application/json", 0, false}, {503, "application/json; charset=utf-8", 0, false},
		{504, "application/problem+json", 0, false},
		{500, "text/html", 0, false}, {404, "text/html", 0, false}, {200, "text/html", 0, false},
	} {
		kind, ok := gatewayKind(c.status, c.ctype)
		if ok != c.gateway || kind != c.kind {
			t.Errorf("gatewayKind(%d, %q) = %v %v, want %v %v", c.status, c.ctype, kind, ok, c.kind, c.gateway)
		}
	}
	// §19.10: only a write that was written and not answered is 504.
	for _, c := range []struct {
		read, noAnswer bool
		status         int
		code           string
	}{
		{true, false, 502, "CLOUD_UNREACHABLE"}, {true, true, 502, "CLOUD_UNREACHABLE"},
		{false, false, 502, "CLOUD_UNREACHABLE"}, {false, true, 504, "CLOUD_NO_ANSWER"},
	} {
		if a := answerFor(c.read, c.noAnswer); a.Status != c.status || a.Code != c.code {
			t.Errorf("answerFor(read=%v, noAnswer=%v) = %d %s", c.read, c.noAnswer, a.Status, a.Code)
		}
	}
}

// A transport that fails before and after the request is written, to test Attempt's classification
// without a network.
type stubTransport struct {
	err   error
	wrote bool
}

func (s stubTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if s.wrote {
		// Report a completed write the way net/http's transport does.
		if trace := httpTraceOf(req); trace != nil {
			trace()
		}
	}
	return nil, s.err
}

func TestAttemptClassifiesByHowFarTheRequestGot(t *testing.T) {
	boom := errors.New("boom")
	for _, c := range []struct {
		name  string
		stub  stubTransport
		kind  FailureKind
		isErr error
	}{
		{"failed before the request was written", stubTransport{err: boom}, NotSent, boom},
		{"failed after the request was written", stubTransport{err: boom, wrote: true}, NoAnswer, boom},
	} {
		u := &Upstream{Transport: c.stub}
		req, _ := http.NewRequest("POST", "http://cloud.invalid/api/v1/x", nil)
		resp, f := u.Attempt(context.Background(), req, time.Second)
		if resp != nil || f == nil || f.Kind != c.kind || !errors.Is(f.Err, c.isErr) {
			t.Errorf("%s: %v %v", c.name, resp, f)
		}
	}
	// The time running out before anything was written is "not sent"; after it, "no answer".
	slow := &Upstream{Transport: blockingTransport{}}
	req, _ := http.NewRequest("GET", "http://cloud.invalid/x", nil)
	_, f := slow.Attempt(context.Background(), req, 50*time.Millisecond)
	if f == nil || f.Kind != NotSent || !errors.Is(f.Err, errTimeout) {
		t.Errorf("timeout before writing: %v", f)
	}
	slow = &Upstream{Transport: blockingTransport{wrote: true}}
	_, f = slow.Attempt(context.Background(), req, 50*time.Millisecond)
	if f == nil || f.Kind != NoAnswer || !errors.Is(f.Err, errTimeout) {
		t.Errorf("timeout after writing: %v", f)
	}
	// A client that goes away is its own error, not the cloud's timeout.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, f = slow.Attempt(ctx, req, time.Minute)
	if f == nil || errors.Is(f.Err, errTimeout) || ctx.Err() == nil {
		t.Errorf("cancelled: %v", f)
	}
}

type blockingTransport struct{ wrote bool }

func (b blockingTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if b.wrote {
		if trace := httpTraceOf(req); trace != nil {
			trace()
		}
	}
	<-req.Context().Done()
	return nil, req.Context().Err()
}

func TestProxyRefusesTheAgentsOwnCloudRoutes(t *testing.T) {
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {})
	p := newProxy(up.srv.URL)
	blocked := []string{
		"/api/v1/agent/enrol", "/api/v1/agent/ws", "/api/v1/agent/local/login", "/api/v1/agent",
		"/api/v1/agent-releases", "/api/v1/agent-releases/latest", "/api/v1/agent-releases/1.2.3/download",
		"/api/v1/AGENT/local/login", "/api/v1/Agent-Releases/x",
		"/api/v1/%61gent/local/login", "/api/v1/agent%2Flocal/login", "/api/v1/%41gent-releases/x",
		"/api/v1/x/../agent/me", "/api/v1/./agent/me", "/api/v1//agent/me", "/api/v1/agent/../agent/me",
		"/api/v1/agent/me?x=1",
	}
	for _, path := range blocked {
		for _, m := range []string{"GET", "POST"} {
			rec := doReq(p, httptest.NewRequest(m, path, strings.NewReader("{}")))
			if rec.Code != 403 {
				t.Errorf("%s %s = %d, want 403", m, path, rec.Code)
			}
		}
	}
	if up.count() != 0 {
		t.Fatalf("a blocked route reached the cloud (%d requests)", up.count())
	}
	pr := problemOf(t, doReq(p, httptest.NewRequest("GET", "/api/v1/agent/me", nil)))
	if pr["code"] != "AGENT_ROUTE_BLOCKED" || pr["status"] != float64(403) {
		t.Errorf("problem = %v", pr)
	}
	for _, path := range []string{"/api/v1/agents", "/api/v1/agent-gateway", "/api/v1/orders/agent", "/api/v1/x/agent/y", "/uploads/agent/a.png", "/api/v1/agentx"} {
		if rec := doReq(p, httptest.NewRequest("GET", path, nil)); rec.Code != 200 {
			t.Errorf("GET %s = %d, want it passed on", path, rec.Code)
		}
	}
}

func TestBlockedRoutesAreRefusedOnBothListeners(t *testing.T) {
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {})
	s := newServer(&fakeHost{server: up.srv.URL})
	for name, h := range map[string]http.Handler{"loopback": s.Handler(DefaultAddr), "LAN": s.LANHandler()} {
		for _, path := range []string{"/api/v1/agent/me", "/api/v1/agent-releases/latest"} {
			req := httptest.NewRequest("GET", path, nil)
			req.Host = DefaultAddr
			if rec := doReq(h, req); rec.Code != 403 {
				t.Errorf("%s GET %s = %d, want 403", name, path, rec.Code)
			}
		}
	}
	if up.count() != 0 {
		t.Fatal("a blocked route reached the cloud")
	}
}

func TestProxyLimitsRequestBodiesTo16MB(t *testing.T) {
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {})
	p := newProxy(up.srv.URL)

	// Declared too large: refused without bothering the cloud.
	req := httptest.NewRequest("POST", "/api/v1/media/upload", strings.NewReader("x"))
	req.ContentLength = 17 << 20
	rec := doReq(p, req)
	if rec.Code != 413 || problemOf(t, rec)["code"] != "PAYLOAD_TOO_LARGE" || up.count() != 0 {
		t.Fatalf("declared 17 MB: %d %s (cloud saw %d)", rec.Code, rec.Body, up.count())
	}

	// Not declared (chunked) and too large: cut off while it streams.
	req = httptest.NewRequest("POST", "/api/v1/media/upload", io.LimitReader(zeros{}, 17<<20))
	req.ContentLength = -1
	rec = doReq(p, req)
	if rec.Code != 413 || problemOf(t, rec)["code"] != "PAYLOAD_TOO_LARGE" {
		t.Fatalf("streamed 17 MB: %d %s", rec.Code, rec.Body)
	}

	// Exactly 16 MB goes through, in full.
	req = httptest.NewRequest("POST", "/api/v1/media/upload", bytes.NewReader(make([]byte, 16<<20)))
	rec = doReq(p, req)
	if _, body := up.seen(); rec.Code != 200 || len(body) != 16<<20 {
		t.Fatalf("16 MB: %d, the cloud got %d bytes", rec.Code, len(body))
	}
}

type zeros struct{}

func (zeros) Read(p []byte) (int, error) { clear(p); return len(p), nil }

func TestProxyWithNoServerConfigured(t *testing.T) {
	p := newProxy("")
	rec := doReq(p, httptest.NewRequest("GET", "/api/v1/health", nil))
	if rec.Code != 503 || problemOf(t, rec)["code"] != "AGENT_NOT_CONFIGURED" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

// The cloud's Server-Sent Events reach the page one event at a time, with no time limit.
func TestProxyFlushesEventStreamsEventByEventWithNoTimeLimit(t *testing.T) {
	release := make(chan struct{})
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.WriteHeader(200)
		io.WriteString(w, "event: hello\ndata: 1\n\n")
		w.(http.Flusher).Flush()
		select { // the second event only after the test has read the first
		case <-release:
		case <-r.Context().Done():
			return
		}
		time.Sleep(250 * time.Millisecond) // longer than the proxy's (shortened) timeout
		io.WriteString(w, "event: tick\ndata: 2\n\n")
		w.(http.Flusher).Flush()
	})
	p := newProxy(up.srv.URL)
	p.Timeout = 100 * time.Millisecond
	front := httptest.NewServer(p)
	defer front.Close()

	resp, err := http.Get(front.URL + "/api/v1/live/stream?branch=b1")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 || resp.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("%d %s", resp.StatusCode, resp.Header.Get("Content-Type"))
	}
	lines := make(chan string, 10)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
		close(lines)
	}()
	read := func(want string) {
		t.Helper()
		select {
		case l := <-lines:
			if l != want {
				t.Fatalf("line %q, want %q", l, want)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("timed out waiting for %q: the event was not flushed", want)
		}
	}
	// The first event arrives while the cloud's handler is still running and the stream open.
	read("event: hello")
	read("data: 1")
	close(release)
	read("") // end of the first event
	read("event: tick")
	read("data: 2")
}

// The time limit is for the cloud to answer; once it has, a long body streams on.
func TestProxyTimeLimitIsForTheAnswerNotForALongBody(t *testing.T) {
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, "first,")
		w.(http.Flusher).Flush()
		time.Sleep(200 * time.Millisecond)
		io.WriteString(w, "second")
	})
	p := newProxy(up.srv.URL)
	p.Timeout = 80 * time.Millisecond
	front := httptest.NewServer(p)
	defer front.Close()
	resp, err := http.Get(front.URL + "/api/v1/export")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if string(b) != "first,second" {
		t.Fatalf("body = %q", b)
	}
}

func TestProxyEndsThePagesRequestWhenTheCloudBreaksOffMidAnswer(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				br := bufio.NewReader(c)
				_, _ = http.ReadRequest(br)
				// Promises 100 bytes, sends 5, hangs up.
				io.WriteString(c, "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 100\r\n\r\nhello")
				c.Close()
			}()
		}
	}()
	front := httptest.NewServer(newProxy("http://" + ln.Addr().String()))
	defer front.Close()
	resp, err := http.Get(front.URL + "/api/v1/x")
	if err != nil {
		return // the page's request failed outright: also a failure, as wanted
	}
	defer resp.Body.Close()
	if _, err := io.ReadAll(resp.Body); err == nil {
		t.Fatal("the page saw a clean, complete-looking answer to a cut-off one")
	}
}

// httpTraceOf returns a function that reports, as net/http's transport does, that the whole request
// was written; nil when the request carries no trace.
func httpTraceOf(req *http.Request) func() {
	tr := httptrace.ContextClientTrace(req.Context())
	if tr == nil || tr.WroteRequest == nil {
		return nil
	}
	return func() { tr.WroteRequest(httptrace.WroteRequestInfo{}) }
}

// ---------------------------------------------------------------------------------------------
// Retries (§19.10, S5)

// gatewayDown answers as nginx does with the application stopped.
func gatewayDown(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html")
	w.WriteHeader(http.StatusBadGateway)
	io.WriteString(w, "<html><title>502 Bad Gateway</title></html>")
}

func TestRetryDefaultsAndTheTimeOfAnAttempt(t *testing.T) {
	d := Retry{}.withDefaults()
	if d.Every != 2*time.Second || d.Window != 20*time.Second || d.Grace != 10*time.Second {
		t.Fatalf("defaults = %+v, want 2 s, 20 s, 10 s", d)
	}
	// min(30 s, time left + 10 s): the first attempt has all of 30 s, a later one what is left of
	// the window plus 10 s, and the last one possible (at 20 s) 10 s.
	for _, c := range []struct{ elapsed, want time.Duration }{
		{0, 30 * time.Second},
		{2 * time.Second, 28 * time.Second},
		{18 * time.Second, 12 * time.Second},
		{20 * time.Second, 10 * time.Second},
	} {
		if got := d.attemptTimeout(30*time.Second, c.elapsed); got != c.want {
			t.Errorf("attempt at %v has %v, want %v", c.elapsed, got, c.want)
		}
	}
	if got := d.attemptTimeout(5*time.Second, 0); got != 5*time.Second {
		t.Errorf("the proxy's own limit is the cap: %v", got)
	}
}

// A read made while the cloud is down is held and answered when the cloud comes back inside the
// window: the page never sees the failure.
func TestAReadIsHeldAndAnsweredWhenTheCloudReturnsInsideTheWindow(t *testing.T) {
	// The port is closed at first (connection refused), then a cloud starts on it.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close()

	p := newProxy("http://" + addr)
	p.Retry = Retry{Every: 30 * time.Millisecond, Window: 2 * time.Second, Grace: time.Second}
	started := make(chan *httptest.Server, 1)
	go func() {
		time.Sleep(250 * time.Millisecond)
		l, err := net.Listen("tcp", addr)
		if err != nil {
			started <- nil
			return
		}
		srv := &httptest.Server{Listener: l, Config: &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"ok":true}`)
		})}}
		srv.Start()
		started <- srv
	}()

	begin := time.Now()
	req := httptest.NewRequest("GET", "/api/v1/orders", nil)
	req.Header.Set("X-Correlation-Id", "cid-9")
	rec := doReq(p, req)
	took := time.Since(begin)
	if srv := <-started; srv != nil {
		defer srv.Close()
	}
	if rec.Code != 200 || rec.Body.String() != `{"ok":true}` {
		t.Fatalf("answer: %d %s", rec.Code, rec.Body)
	}
	if took < 200*time.Millisecond || took > 1500*time.Millisecond {
		t.Errorf("answered after %v, want about the 250 ms the cloud was down", took)
	}
}

// Every failure of the table is retried for a read: not sent, a gateway's 502, 503 and 504, and a
// request that was written and never answered. The page sees the answer of the attempt that worked.
func TestAReadIsRetriedAfterEveryKindOfFailureOfTheTable(t *testing.T) {
	for _, c := range []struct {
		name string
		fail func(w http.ResponseWriter, r *http.Request)
	}{
		{"gateway 502", func(w http.ResponseWriter, r *http.Request) { gatewayDown(w) }},
		{"gateway 503", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(503)
		}},
		{"gateway 504", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(504)
		}},
		{"written, never answered", func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }},
	} {
		for _, method := range []string{"GET", "HEAD"} {
			var up *upstream
			up = newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
				if up.count() <= 2 {
					c.fail(w, r)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				io.WriteString(w, `{"ok":true}`)
			})
			p := newProxy(up.srv.URL)
			p.Timeout = 30 * time.Millisecond // an attempt that is never answered gives up quickly
			p.Retry = Retry{Every: 20 * time.Millisecond, Window: time.Second, Grace: time.Second}
			rec := doReq(p, httptest.NewRequest(method, "/api/v1/orders", nil))
			if rec.Code != 200 || (method == "GET" && rec.Body.String() != `{"ok":true}`) {
				t.Errorf("%s %s: %d %s", c.name, method, rec.Code, rec.Body)
			}
			if up.count() != 3 {
				t.Errorf("%s %s: the cloud saw %d attempts, want 3 (two failures, then the answer)", c.name, method, up.count())
			}
		}
	}
}

// Attempts start every 2 s (here 60 ms) from the first, none after the window (here 300 ms), and
// the page is then told 502 CLOUD_UNREACHABLE.
func TestAReadIsRetriedOnTheScheduleAndEndsInA502AfterTheWindow(t *testing.T) {
	var mu sync.Mutex
	var starts []time.Time
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		starts = append(starts, time.Now())
		mu.Unlock()
		gatewayDown(w)
	})
	p := newProxy(up.srv.URL)
	p.Retry = Retry{Every: 60 * time.Millisecond, Window: 300 * time.Millisecond, Grace: 100 * time.Millisecond}

	begin := time.Now()
	req := httptest.NewRequest("GET", "/api/v1/orders?x=1", nil)
	req.Header.Set("X-Correlation-Id", "cid-5")
	rec := doReq(p, req)
	took := time.Since(begin)

	pr := problemOf(t, rec)
	if rec.Code != 502 || pr["code"] != "CLOUD_UNREACHABLE" || pr["correlationId"] != "cid-5" {
		t.Fatalf("final answer: %d %s", rec.Code, rec.Body)
	}
	mu.Lock()
	defer mu.Unlock()
	// Starts at 0, 60, 120, 180, 240 and 300 ms: five or six, depending on how the last falls.
	if len(starts) < 5 || len(starts) > 6 {
		t.Fatalf("%d attempts, want 5 or 6 (every 60 ms for 300 ms)", len(starts))
	}
	for i := 1; i < len(starts); i++ {
		if gap := starts[i].Sub(starts[i-1]); gap < 50*time.Millisecond || gap > 150*time.Millisecond {
			t.Errorf("attempt %d started %v after the one before, want about 60 ms", i+1, gap)
		}
	}
	if last := starts[len(starts)-1].Sub(begin); last > 350*time.Millisecond {
		t.Errorf("an attempt started %v after the request arrived, after the 300 ms window", last)
	}
	if took < 240*time.Millisecond || took > 600*time.Millisecond {
		t.Errorf("the page waited %v, want about the 300 ms window", took)
	}
}

// An attempt has min(limit, time left + grace). Here the cloud takes the request and never
// answers: the first attempt starts inside the window and is given the window's end plus the
// grace, not the proxy's whole limit, and nothing is started after it.
func TestTheLastAttemptIsGivenOnlyWhatIsLeftOfTheWindowPlusTheGrace(t *testing.T) {
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() })
	p := newProxy(up.srv.URL)
	p.Timeout = 5 * time.Second
	p.Retry = Retry{Every: 40 * time.Millisecond, Window: 200 * time.Millisecond, Grace: 100 * time.Millisecond}

	begin := time.Now()
	rec := doReq(p, httptest.NewRequest("GET", "/api/v1/orders", nil))
	took := time.Since(begin)
	if rec.Code != 502 || problemOf(t, rec)["code"] != "CLOUD_UNREACHABLE" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if took < 250*time.Millisecond || took > 1500*time.Millisecond {
		t.Errorf("answered after %v, want about 300 ms (window 200 + grace 100), not the 5 s limit", took)
	}
	if up.count() != 1 {
		t.Errorf("%d attempts, want 1: the first used the whole window", up.count())
	}

	// The same cloud, answering 502 for the first 150 ms and then hanging: the attempt that starts
	// at 160 ms has 200 - 160 + 100 = 140 ms.
	var mu sync.Mutex
	var firstAt time.Time
	up2 := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		if firstAt.IsZero() {
			firstAt = time.Now()
		}
		since := time.Since(firstAt)
		mu.Unlock()
		if since < 150*time.Millisecond {
			gatewayDown(w)
			return
		}
		<-r.Context().Done()
	})
	p = newProxy(up2.srv.URL)
	p.Timeout = 5 * time.Second
	p.Retry = Retry{Every: 40 * time.Millisecond, Window: 200 * time.Millisecond, Grace: 100 * time.Millisecond}
	begin = time.Now()
	rec = doReq(p, httptest.NewRequest("GET", "/api/v1/orders", nil))
	took = time.Since(begin)
	if rec.Code != 502 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	if took < 250*time.Millisecond || took > 700*time.Millisecond {
		t.Errorf("answered after %v, want about window + grace = 300 ms", took)
	}
}

// A page that closes its request stops the retries, between two attempts and in the middle of
// one, and nothing more is sent to the cloud.
func TestRetriesStopWhenThePageGoesAway(t *testing.T) {
	for _, hang := range []bool{false, true} {
		name := "between attempts"
		if hang {
			name = "during an attempt"
		}
		up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
			if hang {
				<-r.Context().Done()
				return
			}
			gatewayDown(w)
		})
		p := newProxy(up.srv.URL)
		p.Timeout = 30 * time.Second
		p.Retry = Retry{Every: 20 * time.Millisecond, Window: time.Minute, Grace: time.Minute}
		done := make(chan struct{})
		front := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p.ServeHTTP(w, r)
			close(done)
		}))

		ctx, cancel := context.WithCancel(context.Background())
		req, _ := http.NewRequestWithContext(ctx, "GET", front.URL+"/api/v1/orders", nil)
		go func() {
			time.Sleep(150 * time.Millisecond)
			cancel()
		}()
		if resp, err := http.DefaultClient.Do(req); err == nil {
			resp.Body.Close()
			t.Fatalf("%s: the page got an answer", name)
		}
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatalf("%s: the proxy was still at it 2 s after the page went away", name)
		}
		seen := up.count()
		time.Sleep(150 * time.Millisecond)
		if after := up.count(); after != seen {
			t.Errorf("%s: %d requests reached the cloud after the page went away", name, after-seen)
		}
		if !hang && seen < 3 {
			t.Errorf("%s: only %d attempts in 150 ms at 20 ms apart", name, seen)
		}
		front.Close()
	}
}

// What a retry must not touch: the live stream, writes with no key (keyed ones are in
// proxy_keyed_test.go), and the application's own answers.
func TestOnlyReadsAreRetriedNotTheLiveStreamNotWritesNotTheApplicationsAnswers(t *testing.T) {
	for _, c := range []struct {
		method, path string
		retried      bool
	}{
		{"GET", "/api/v1/orders", true}, // control: it is retried until the window ends
		{"HEAD", "/api/v1/orders", true},
		{"GET", "/api/v1/live/stream?topics=orders", false},
		{"POST", "/api/v1/orders", false},
		{"PUT", "/api/v1/orders/1", false},
		{"PATCH", "/api/v1/orders/1", false},
		{"DELETE", "/api/v1/orders/1", false},
		{"POST", "/api/v1/payments/1/process", false},
		{"POST", "/api/v1/payments/1/check-terminal", false},
	} {
		up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) { gatewayDown(w) })
		p := newProxy(up.srv.URL)
		p.Retry = Retry{Every: 40 * time.Millisecond, Window: 100 * time.Millisecond, Grace: 100 * time.Millisecond}
		rec := doReq(p, httptest.NewRequest(c.method, c.path, strings.NewReader(`{"a":1}`)))
		if rec.Code != 502 {
			t.Errorf("%s %s: %d", c.method, c.path, rec.Code)
		}
		got := up.count()
		if c.retried && (got < 3 || got > 4) || !c.retried && got != 1 {
			t.Errorf("%s %s: %d attempts reached the cloud (retried=%v)", c.method, c.path, got, c.retried)
		}
	}

	// The application answering 502, 503 or 504 with JSON is an answer, not a failure: once.
	for _, status := range []int{502, 503, 504} {
		up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			io.WriteString(w, `{"code":"FROM_THE_APP"}`)
		})
		rec := doReq(newProxy(up.srv.URL), httptest.NewRequest("GET", "/api/v1/orders", nil))
		if rec.Code != status || rec.Body.String() != `{"code":"FROM_THE_APP"}` || up.count() != 1 {
			t.Errorf("application %d: %d %s after %d attempts", status, rec.Code, rec.Body, up.count())
		}
	}
	// 4xx and 500 are answers too.
	for _, status := range []int{401, 404, 500} {
		up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(status)
		})
		rec := doReq(newProxy(up.srv.URL), httptest.NewRequest("GET", "/api/v1/orders", nil))
		if rec.Code != status || up.count() != 1 {
			t.Errorf("status %d: %d after %d attempts", status, rec.Code, up.count())
		}
	}
}

// A read that carries a body (rare, but legal) sends it again with each attempt.
func TestARetriedReadSendsItsBodyAgainWithEachAttempt(t *testing.T) {
	var mu sync.Mutex
	var bodies []string
	var up *upstream
	up = newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		_, b := up.seen()
		mu.Lock()
		bodies = append(bodies, string(b))
		n := len(bodies)
		mu.Unlock()
		if n < 3 {
			gatewayDown(w)
			return
		}
		w.Header().Set("Content-Length", "2")
		io.WriteString(w, "ok")
	})
	p := newProxy(up.srv.URL)
	p.Retry = Retry{Every: 10 * time.Millisecond, Window: time.Second, Grace: time.Second}
	rec := doReq(p, httptest.NewRequest("GET", "/api/v1/search", strings.NewReader(`{"q":"x"}`)))
	if rec.Code != 200 || rec.Body.String() != "ok" {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 3 || bodies[0] != `{"q":"x"}` || bodies[1] != `{"q":"x"}` || bodies[2] != `{"q":"x"}` {
		t.Errorf("the cloud received %q", bodies)
	}
}

// Attempts that take a whole tick to fail follow one another at once, and the window still ends
// them: the clock does not run ahead and fire a burst.
func TestSlowAttemptsFollowAtOnceAndTheWindowStillEndsThem(t *testing.T) {
	var mu sync.Mutex
	var starts []time.Time
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		starts = append(starts, time.Now())
		mu.Unlock()
		<-r.Context().Done()
	})
	p := newProxy(up.srv.URL)
	p.Timeout = 100 * time.Millisecond
	p.Retry = Retry{Every: 40 * time.Millisecond, Window: 300 * time.Millisecond, Grace: 100 * time.Millisecond}
	begin := time.Now()
	rec := doReq(p, httptest.NewRequest("GET", "/api/v1/orders", nil))
	took := time.Since(begin)
	if rec.Code != 502 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(starts) < 3 || len(starts) > 4 {
		t.Fatalf("%d attempts, want 3 or 4 (each takes 100 ms, none starts after 300 ms)", len(starts))
	}
	for i := 1; i < len(starts); i++ {
		if gap := starts[i].Sub(starts[i-1]); gap < 90*time.Millisecond || gap > 200*time.Millisecond {
			t.Errorf("attempt %d started %v after the one before, want right after its 100 ms", i+1, gap)
		}
	}
	if took > 600*time.Millisecond {
		t.Errorf("answered after %v", took)
	}
}

// Fast failures keep to the clock to the end: with the window a whole number of ticks, an attempt
// is made at the end of the window itself (0, 2 ... 20 s in the real timings), and none after.
func TestTheLastTickOfTheWindowStillGetsItsAttempt(t *testing.T) {
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) { gatewayDown(w) })
	p := newProxy(up.srv.URL)
	p.Retry = Retry{Every: 50 * time.Millisecond, Window: 250 * time.Millisecond, Grace: 100 * time.Millisecond}
	rec := doReq(p, httptest.NewRequest("GET", "/api/v1/orders", nil))
	if rec.Code != 502 {
		t.Fatalf("%d", rec.Code)
	}
	if got := up.count(); got != 6 {
		t.Errorf("%d attempts, want 6 (at 0, 50, 100, 150, 200 and 250 ms)", got)
	}
}
