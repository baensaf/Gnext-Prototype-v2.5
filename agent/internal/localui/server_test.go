package localui

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
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
	enrol := `{"server":"https://gnext.test","code":"ABCD-EFGH"}`
	if rec := call(h, "POST", "/agent/api/enrol", enrol, map[string]string{"X-Gnext-Local": ""}); rec.Code != 403 {
		t.Fatalf("write without header: %d", rec.Code)
	}
	if rec := call(h, "POST", "/agent/api/enrol", enrol, map[string]string{"Origin": "http://evil.example"}); rec.Code != 403 {
		t.Fatalf("write from another origin: %d", rec.Code)
	}
	// From the page's own origin it reaches the handler, which passes on the cloud's refusal.
	if rec := call(h, "POST", "/agent/api/enrol", enrol, map[string]string{"Origin": "http://127.0.0.1:47800"}); rec.Code != 400 {
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
	// Nor, since 2.5.0, a sign-in, device forms, a scan or settings: those are the cloud's (§20).
	for _, path := range []string{"/agent/api/session", "/agent/api/app/refresh"} {
		if rec := call(h, "GET", path, "", nil); rec.Code != 404 {
			t.Errorf("GET %s = %d, want 404", path, rec.Code)
		}
	}
	for _, path := range []string{"/agent/api/till/cloud-login", "/agent/api/pairing-codes", "/agent/api/login", "/agent/api/logout", "/agent/api/settings", "/agent/api/scan", "/agent/api/printers"} {
		if rec := call(h, "POST", path, `{}`, nil); rec.Code != 404 && rec.Code != 405 {
			t.Errorf("POST %s = %d, want 404 or 405", path, rec.Code)
		}
	}
}

// The status route lists the LAN addresses on the loopback listener only (§19.12).
func TestLANURLsAreShownOnLoopbackOnly(t *testing.T) {
	s := newServer(&fakeHost{})
	s.Addresses = func() []string { return []string{"192.168.1.10", "10.0.0.7"} }
	s.lanBound.Store("0.0.0.0:47801")
	h := s.Handler(DefaultAddr)

	var st struct {
		LANURLs []string `json:"lan_urls"`
	}
	rec := call(h, "GET", "/agent/api/status", "", nil)
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil {
		t.Fatalf("status: %s", rec.Body)
	}
	if len(st.LANURLs) != 2 || st.LANURLs[0] != "http://192.168.1.10:47801/" || st.LANURLs[1] != "http://10.0.0.7:47801/" {
		t.Fatalf("lan_urls = %v", st.LANURLs)
	}

	lanReq := httptest.NewRequest("GET", "/agent/api/status", nil)
	lanRec := httptest.NewRecorder()
	s.LANHandler().ServeHTTP(lanRec, lanReq)
	if strings.Contains(lanRec.Body.String(), "lan_urls") {
		t.Fatalf("the LAN listener leaks the PC's fields: %s", lanRec.Body)
	}
}

func TestLANURLsFollowTheListenerAndThePCsPrivateAddresses(t *testing.T) {
	ips := []string{"192.168.1.10", "10.0.0.7"}
	if got := lanURLs("0.0.0.0:47801", ips); len(got) != 2 || got[0] != "http://192.168.1.10:47801/" {
		t.Errorf("all addresses: %v", got)
	}
	if got := lanURLs("[::]:47801", ips); len(got) != 2 {
		t.Errorf("IPv6 any: %v", got)
	}
	if got := lanURLs("127.0.0.1:18801", ips); len(got) != 1 || got[0] != "http://127.0.0.1:18801/" {
		t.Errorf("one address: %v", got)
	}
	for _, none := range []string{"", "garbage"} {
		if got := lanURLs(none, ips); got == nil || len(got) != 0 {
			t.Errorf("bound %q: %#v, want an empty list", none, got)
		}
	}
	if got := lanURLs("0.0.0.0:47801", nil); got == nil || len(got) != 0 {
		t.Errorf("no private address: %#v, want an empty list", got)
	}
	s := newServer(&fakeHost{})
	if got := s.LANURLs(); got == nil || len(got) != 0 {
		t.Errorf("a listener that is not listening: %#v", got)
	}
}

func TestPrivateIPv4sKeepsTheBranchNetworkOnly(t *testing.T) {
	addr := func(cidr string) net.Addr {
		ip, n, _ := net.ParseCIDR(cidr)
		n.IP = ip
		return n
	}
	got := privateIPv4s([]netIface{
		{Name: "Ethernet", Up: true, Addrs: []net.Addr{addr("192.168.1.10/24"), addr("fe80::1/64"), addr("2001:db8::1/64")}},
		{Name: "Wi-Fi", Up: true, Addrs: []net.Addr{addr("10.0.0.7/8"), addr("192.168.1.10/24")}},
		{Name: "Ethernet 2", Up: false, Addrs: []net.Addr{addr("192.168.9.9/24")}},
		{Name: "Loopback Pseudo-Interface 1", Up: true, Loopback: true, Addrs: []net.Addr{addr("127.0.0.1/8")}},
		{Name: "vEthernet (WSL)", Up: true, Addrs: []net.Addr{addr("172.20.0.1/20")}},
		{Name: "VirtualBox Host-Only Network", Up: true, Addrs: []net.Addr{addr("192.168.56.1/24")}},
		{Name: "Ethernet 3", Up: true, Addrs: []net.Addr{addr("169.254.3.4/16"), addr("8.8.4.4/24"), addr("172.16.5.5/12"), addr("100.64.0.9/10")}},
	})
	want := []string{"192.168.1.10", "10.0.0.7", "172.16.5.5"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("addresses = %v, want %v", got, want)
	}
	if got := privateIPv4s(nil); got == nil || len(got) != 0 {
		t.Fatalf("no adapters: %#v, want an empty list", got)
	}
}
