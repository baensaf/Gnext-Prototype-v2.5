package localui

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"html"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"gnext/agent/internal/appcache"
)

const testIndex = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Gnext</title>
    <script type="module" src="/assets/index-abc123.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`

func testSite() map[string]string {
	return map[string]string{
		"index.html":              testIndex,
		"assets/index-abc123.js":  "console.log('app')",
		"assets/style-9f8e7d.css": "body{margin:0}",
		"fonts/IRANSansX.woff2":   "wOF2",
		"favicon.svg":             "<svg/>",
	}
}

// manifestFor builds build-manifest.json the way starter-vite-ts/vite.config.ts does.
func manifestFor(id string, files map[string]string) []byte {
	type file struct {
		Path   string `json:"path"`
		SHA256 string `json:"sha256"`
		Size   int    `json:"size"`
	}
	paths := make([]string, 0, len(files))
	for p := range files {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	out := struct {
		BuildID string `json:"build_id"`
		BuiltAt string `json:"built_at"`
		Files   []file `json:"files"`
	}{BuildID: id, BuiltAt: "2026-10-06T09:30:00.000Z"}
	for _, p := range paths {
		sum := sha256.Sum256([]byte(files[p]))
		out.Files = append(out.Files, file{p, hex.EncodeToString(sum[:]), len(files[p])})
	}
	b, _ := json.Marshal(out)
	return b
}

// frontendHandler serves a build the way the cloud's nginx does: the manifest, the files, and index.html
// for any other path.
func frontendHandler(id string, files map[string]string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		switch {
		case p == "build-manifest.json":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(manifestFor(id, files))
		case files[p] != "":
			_, _ = w.Write([]byte(files[p]))
		default:
			_, _ = w.Write([]byte(files["index.html"]))
		}
	})
}

// installedCache downloads a build from a fake frontend into a cache of its own.
func installedCache(t *testing.T, id string, files map[string]string) *appcache.Cache {
	t.Helper()
	fe := httptest.NewServer(frontendHandler(id, files))
	t.Cleanup(fe.Close)
	return installFrom(t, fe.URL)
}

func installFrom(t *testing.T, origin string) *appcache.Cache {
	t.Helper()
	c := &appcache.Cache{Dir: filepath.Join(t.TempDir(), "app"), Origin: func() string { return origin }}
	if _, err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	return c
}

// lanGet asks the LAN listener's handler the way another register would.
func lanGet(h http.Handler, method, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	req.Host = "192.168.1.10:47801"
	req.RemoteAddr = "192.168.1.55:50123"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

var metaPattern = regexp.MustCompile(`<meta name="gnext-agent" content='([^']*)'>`)

// meta reads the agent tag the way the app does: the attribute's value, HTML-unescaped, as JSON.
func meta(t *testing.T, page string) map[string]any {
	t.Helper()
	m := metaPattern.FindAllStringSubmatch(page, -1)
	if len(m) != 1 {
		t.Fatalf("the page has %d gnext-agent tags, want 1:\n%s", len(m), page)
	}
	var out map[string]any
	if err := json.Unmarshal([]byte(html.UnescapeString(m[0][1])), &out); err != nil {
		t.Fatalf("the tag's content is not JSON: %v", err)
	}
	return out
}

func TestTheAppIsServedFromTheCurrentBuild(t *testing.T) {
	s := newServer(&fakeHost{server: "https://gnext.top"})
	s.App = installedCache(t, "9f2c41d7ab03e5c8", testSite())
	h := s.Handler(DefaultAddr)

	rec := call(h, "GET", "/", "", nil)
	if rec.Code != 200 || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("/: %d %s", rec.Code, rec.Header().Get("Content-Type"))
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
		t.Fatalf("index.html Cache-Control = %q", cc)
	}
	page := rec.Body.String()
	// The tag sits right after <head>, once, and the rest of the cloud's page is untouched.
	want := `<head>` + `<meta name="gnext-agent" content='{"version":"2.1.0","cloud_url":"https://gnext.top","lan":false}'>`
	if !strings.Contains(page, want) {
		t.Fatalf("meta tag not right after <head>, or not in the documented format:\n%s", page)
	}
	if got := meta(t, page); got["version"] != "2.1.0" || got["cloud_url"] != "https://gnext.top" || got["lan"] != false {
		t.Fatalf("meta = %v", got)
	}
	if strings.Replace(page, metaPattern.FindString(page), "", 1) != testIndex {
		t.Fatalf("the page was changed beyond the tag:\n%s", page)
	}

	// The app's own routes, on reload, and /index.html itself, get the page with the tag.
	for _, path := range []string{"/app/pos", "/app/orders/123", "/index.html", "/login", "/assets/does-not-exist.js", "/.manifest.json", "/build-manifest.json"} {
		rec := call(h, "GET", path, "", nil)
		if rec.Code != 200 || meta(t, rec.Body.String())["lan"] != false {
			t.Errorf("GET %s = %d, want the page", path, rec.Code)
		}
	}

	// A file of the build, with its type and cache rules.
	rec = call(h, "GET", "/assets/index-abc123.js", "", nil)
	if rec.Code != 200 || rec.Body.String() != "console.log('app')" {
		t.Fatalf("js: %d %q", rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Fatalf("js Content-Type = %q", ct)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Fatalf("assets Cache-Control = %q", cc)
	}
	if ct := call(h, "GET", "/assets/style-9f8e7d.css", "", nil).Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/css") {
		t.Fatalf("css Content-Type = %q", ct)
	}
	rec = call(h, "GET", "/fonts/IRANSansX.woff2", "", nil)
	if rec.Code != 200 || rec.Header().Get("Cache-Control") != "" || rec.Header().Get("Content-Type") != "font/woff2" {
		t.Fatalf("font: %d cache=%q type=%q", rec.Code, rec.Header().Get("Cache-Control"), rec.Header().Get("Content-Type"))
	}
	if rec := call(h, "GET", "/favicon.svg", "", nil); rec.Header().Get("Content-Type") != "image/svg+xml" {
		t.Fatalf("svg Content-Type = %q", rec.Header().Get("Content-Type"))
	}

	// HEAD works; anything else is 405.
	if rec := call(h, "HEAD", "/", "", nil); rec.Code != 200 || rec.Body.Len() != 0 {
		t.Fatalf("HEAD /: %d %d bytes", rec.Code, rec.Body.Len())
	}
	for _, m := range []string{"POST", "PUT", "DELETE", "PATCH"} {
		if rec := call(h, m, "/app/pos", "{}", nil); rec.Code != 405 || rec.Header().Get("Allow") != "GET, HEAD" {
			t.Errorf("%s /app/pos = %d allow=%q", m, rec.Code, rec.Header().Get("Allow"))
		}
	}
}

func TestTheAppFallsBackToIndexOnlyOutsideTheProxiedAndAgentPaths(t *testing.T) {
	// A cloud that is not there: /api/ and /uploads/ must answer 502 from the proxy, never the page.
	dead := httptest.NewServer(http.NotFoundHandler())
	dead.Close()
	s := newServer(&fakeHost{server: dead.URL})
	s.App = installedCache(t, "aaaaaaaaaaaaaaaa", testSite())
	h := s.Handler(DefaultAddr)

	for _, path := range []string{"/api/v1/health", "/api/", "/uploads/x.png", "/api/v1/media/uploads/a.png"} {
		rec := call(h, "GET", path, "", nil)
		if rec.Code != 502 || strings.Contains(rec.Body.String(), "gnext-agent") {
			t.Errorf("GET %s = %d, want the proxy's 502", path, rec.Code)
		}
	}
	if rec := call(h, "GET", "/agent/nothing", "", nil); rec.Code != 404 {
		t.Errorf("GET /agent/nothing = %d, want 404 (not the app)", rec.Code)
	}
}

func TestMetaTagIsHTMLEscapedJSON(t *testing.T) {
	tag := metaTag(agentMeta{Version: "2.1.0", CloudURL: `http://host:4173/a'b&c<d>"e`, LAN: true})
	if strings.Count(tag, "'") != 2 || strings.ContainsAny(strings.TrimSuffix(strings.TrimPrefix(tag, `<meta name="gnext-agent" content='`), `'>`), "<>'") {
		t.Fatalf("the tag's attribute is not safe: %s", tag)
	}
	got := meta(t, "<head>"+tag+"</head>")
	if got["cloud_url"] != `http://host:4173/a'b&c<d>"e` || got["lan"] != true {
		t.Fatalf("round trip = %v", got)
	}
}

func TestInjectMetaPutsTheTagAfterHeadOnce(t *testing.T) {
	tag := "<meta name=\"gnext-agent\" content='{}'>"
	for in, want := range map[string]string{
		"<html><head><title>x</title></head></html>":      "<html><head>" + tag + "<title>x</title></head></html>",
		"<HTML><HEAD lang=\"fa\"><title>x</title></HEAD>": "<HTML><HEAD lang=\"fa\">" + tag + "<title>x</title></HEAD>",
		"<html><header>nav</header><head></head></html>":  "<html><header>nav</header><head>" + tag + "</head></html>",
		"<p>no head at all</p>":                           tag + "<p>no head at all</p>",
	} {
		if got := string(injectMeta([]byte(in), tag)); got != want {
			t.Errorf("injectMeta(%q)\n got %q\nwant %q", in, got, want)
		}
	}
}

func TestContentTypesDoNotDependOnTheRegistry(t *testing.T) {
	for name, want := range map[string]string{
		"assets/a.js": "text/javascript; charset=utf-8", "a.mjs": "text/javascript; charset=utf-8",
		"a.css": "text/css; charset=utf-8", "a.json": "application/json; charset=utf-8",
		"a.woff2": "font/woff2", "a.PNG": "image/png", "a.webp": "image/webp", "a.ico": "image/x-icon",
		"a.unknownext": "application/octet-stream",
	} {
		if got := contentType(name); got != want {
			t.Errorf("contentType(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestWithNoBuildYetTheAppRoutesAnswerThePersianPage(t *testing.T) {
	s := newServer(&fakeHost{})
	s.App = &appcache.Cache{Dir: t.TempDir(), Origin: func() string { return "" }}
	h := s.Handler(DefaultAddr)

	for _, path := range []string{"/", "/app/pos", "/assets/x.js"} {
		rec := call(h, "GET", path, "", nil)
		if rec.Code != 503 || !strings.Contains(rec.Body.String(), "بارگیری نشده") || strings.Contains(rec.Body.String(), "gnext-agent") {
			t.Errorf("GET %s = %d, want the not-downloaded page", path, rec.Code)
		}
	}
	// The settings page and the status route work without a build.
	if rec := call(h, "GET", "/agent/", "", nil); rec.Code != 200 {
		t.Errorf("settings page: %d", rec.Code)
	}
	rec := call(h, "GET", "/agent/api/status", "", nil)
	var st map[string]any
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &st) != nil || st["app"] != nil {
		t.Fatalf("status: %d %s", rec.Code, rec.Body)
	}
	// And so is a server with no cache at all.
	s2 := newServer(&fakeHost{})
	if rec := call(s2.Handler(DefaultAddr), "GET", "/", "", nil); rec.Code != 503 {
		t.Errorf("no cache: %d", rec.Code)
	}
}

func TestStatusRouteShapeOnBothListeners(t *testing.T) {
	s := newServer(&fakeHost{server: "https://gnext.top"})
	s.App = installedCache(t, "9f2c41d7ab03e5c8", testSite())

	var loop, lan map[string]any
	rec := call(s.Handler(DefaultAddr), "GET", "/agent/api/status", "", nil)
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &loop) != nil {
		t.Fatalf("loopback status: %d %s", rec.Code, rec.Body)
	}
	rec = lanGet(s.LANHandler(), "GET", "/agent/api/status")
	if rec.Code != 200 || json.Unmarshal(rec.Body.Bytes(), &lan) != nil {
		t.Fatalf("LAN status: %d %s", rec.Code, rec.Body)
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("status Cache-Control = %q", rec.Header().Get("Cache-Control"))
	}

	// §19.8: exactly these on the LAN.
	if len(lan) != 3 || lan["version"] != "2.1.0" {
		t.Fatalf("LAN status = %v, want version, cloud and app only", lan)
	}
	cl, _ := lan["cloud"].(map[string]any)
	if cl["connected"] != false {
		t.Errorf("cloud.connected = %v with no agent running", cl["connected"])
	}
	if since, _ := cl["since"].(string); !regexp.MustCompile(`^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$`).MatchString(since) {
		t.Errorf("cloud.since = %q, want a protocol timestamp", since)
	}
	app, _ := lan["app"].(map[string]any)
	if app["build_id"] != "9f2c41d7ab03e5c8" || app["built_at"] != "2026-10-06T09:30:00.000Z" || app["downloaded_at"] == "" || len(app) != 3 {
		t.Errorf("app = %v", app)
	}
	for _, k := range []string{"enrolled", "server", "agent_id", "branch_name", "stopped", "user", "agent"} {
		if _, ok := lan[k]; ok {
			t.Errorf("the LAN status leaks %q", k)
		}
	}
	// The loopback one is the same, plus what the settings page and the tray read.
	for _, k := range []string{"version", "cloud", "app", "enrolled", "server", "stopped", "user"} {
		if _, ok := loop[k]; !ok {
			t.Errorf("the loopback status lacks %q", k)
		}
	}
	if loop["server"] != "https://gnext.top" {
		t.Errorf("loopback server = %v", loop["server"])
	}
}

func TestTheLANListenerServesTheAppAndNothingOfTheSettingsPage(t *testing.T) {
	s := newServer(&fakeHost{server: "https://gnext.top"})
	s.App = installedCache(t, "9f2c41d7ab03e5c8", testSite())
	h := s.LANHandler()

	rec := lanGet(h, "GET", "/app/pos")
	if rec.Code != 200 || meta(t, rec.Body.String())["lan"] != true {
		t.Fatalf("app on the LAN: %d, want the page with lan=true", rec.Code)
	}
	if rec := lanGet(h, "GET", "/assets/index-abc123.js"); rec.Code != 200 {
		t.Fatalf("asset on the LAN: %d", rec.Code)
	}
	// Any Host is fine on the LAN.
	req := httptest.NewRequest("GET", "/", nil)
	req.Host = "pos-pc.local:47801"
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != 200 {
		t.Fatalf("LAN with a name as Host: %d", rr.Code)
	}

	for _, path := range []string{
		"/agent", "/agent/", "/agent/index.html", "/agent/app.js", "/agent/api/logs", "/agent/api/session",
		"/agent/api/app/refresh", "/agent/api/nothing", "/agent/api/status/x",
	} {
		if rec := lanGet(h, "GET", path); rec.Code != 404 {
			t.Errorf("LAN GET %s = %d, want 404", path, rec.Code)
		}
	}
	for _, c := range []struct{ method, path string }{
		{"POST", "/agent/api/status"}, {"POST", "/agent/api/login"}, {"POST", "/agent/api/enrol"},
		{"POST", "/agent/api/printers"}, {"POST", "/agent/api/scan"}, {"DELETE", "/agent/api/terminals/t1"},
	} {
		if rec := lanGet(h, c.method, c.path); rec.Code != 404 {
			t.Errorf("LAN %s %s = %d, want 404", c.method, c.path, rec.Code)
		}
	}
	if rec := lanGet(h, "HEAD", "/agent/api/status"); rec.Code != 200 {
		t.Errorf("LAN HEAD status = %d", rec.Code)
	}
}

func TestBothListenersListen(t *testing.T) {
	free := func() string {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		defer ln.Close()
		return ln.Addr().String()
	}
	loop, lan := free(), free()
	s := newServer(&fakeHost{})
	s.Addr, s.LANAddr = loop, lan
	s.App = installedCache(t, "9f2c41d7ab03e5c8", testSite())
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.ListenAndServe(ctx) }()
	defer func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("the server did not stop")
		}
	}()

	get := func(addr, path string) (int, string) {
		var resp *http.Response
		var err error
		for i := 0; i < 100; i++ {
			if resp, err = http.Get("http://" + addr + path); err == nil {
				break
			}
			time.Sleep(20 * time.Millisecond)
		}
		if err != nil {
			t.Fatalf("GET %s%s: %v", addr, path, err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	if code, body := get(loop, "/"); code != 200 || meta(t, body)["lan"] != false {
		t.Fatalf("loopback /: %d", code)
	}
	if code, _ := get(loop, "/agent/"); code != 200 {
		t.Fatalf("loopback /agent/: %d", code)
	}
	if code, body := get(lan, "/"); code != 200 || meta(t, body)["lan"] != true {
		t.Fatalf("LAN /: %d", code)
	}
	if code, _ := get(lan, "/agent/"); code != 404 {
		t.Fatalf("LAN /agent/: %d", code)
	}
}

func TestTheLANListenerCanBeTurnedOff(t *testing.T) {
	s := newServer(&fakeHost{})
	s.Addr, s.LANAddr = "127.0.0.1:0", LANOff
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.ListenAndServe(ctx) }()
	time.Sleep(100 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the server did not stop")
	}
}

// The real frontend build, if starter-vite-ts has been built (npm run build): the manifest the Vite
// plugin wrote is accepted, downloaded in full, and served.
func TestTheRealFrontendBuildIsServed(t *testing.T) {
	dist, err := filepath.Abs(filepath.Join("..", "..", "..", "starter-vite-ts", "dist"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dist, "build-manifest.json"))
	if err != nil {
		t.Skip("starter-vite-ts has not been built: no dist/build-manifest.json")
	}
	var m appcache.Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("build-manifest.json: %v", err)
	}
	fe := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := filepath.Join(dist, filepath.FromSlash(strings.TrimPrefix(r.URL.Path, "/")))
		if st, err := os.Stat(p); err != nil || st.IsDir() {
			p = filepath.Join(dist, "index.html")
		}
		http.ServeFile(w, r, p)
	}))
	defer fe.Close()

	c := installFrom(t, fe.URL)
	if c.Current().BuildID != m.BuildID {
		t.Fatalf("serving %q, the manifest says %q", c.Current().BuildID, m.BuildID)
	}
	s := newServer(&fakeHost{server: "https://gnext.top", appOrigin: fe.URL})
	s.App = c
	h := s.Handler(DefaultAddr)
	rec := call(h, "GET", "/app/pos", "", nil)
	if rec.Code != 200 || meta(t, rec.Body.String())["cloud_url"] != fe.URL {
		t.Fatalf("/app/pos: %d", rec.Code)
	}
	for _, f := range m.Files {
		if !strings.HasPrefix(f.Path, "assets/") || !(strings.HasSuffix(f.Path, ".js") || strings.HasSuffix(f.Path, ".css")) {
			continue
		}
		rec := call(h, "GET", "/"+f.Path, "", nil)
		if rec.Code != 200 || int64(rec.Body.Len()) != f.Size || rec.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
			t.Fatalf("GET /%s: %d, %d bytes (want %d), cache %q", f.Path, rec.Code, rec.Body.Len(), f.Size, rec.Header().Get("Cache-Control"))
		}
	}
}
