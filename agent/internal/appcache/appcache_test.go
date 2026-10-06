package appcache

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// cloudBuild stands in for the cloud's frontend: it serves build-manifest.json and the files it
// lists, and counts every request by path.
type cloudBuild struct {
	t   *testing.T
	srv *httptest.Server

	mu      sync.Mutex
	files   map[string]string // path → content of the build being served
	buildID string
	corrupt map[string]string // path → bytes served instead of the real ones
	hits    map[string]int
	down    atomic.Bool
}

func newCloudBuild(t *testing.T) *cloudBuild {
	cb := &cloudBuild{t: t, hits: map[string]int{}, corrupt: map[string]string{}}
	cb.srv = httptest.NewServer(http.HandlerFunc(cb.serve))
	t.Cleanup(cb.srv.Close)
	return cb
}

// set makes the cloud serve a new build.
func (cb *cloudBuild) set(id string, files map[string]string) {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.buildID, cb.files = id, files
}

func (cb *cloudBuild) manifestJSON() []byte {
	m := Manifest{BuildID: cb.buildID, BuiltAt: "2026-10-06T09:30:00.000Z"}
	paths := make([]string, 0, len(cb.files))
	for p := range cb.files {
		paths = append(paths, p)
	}
	sort.Strings(paths)
	for _, p := range paths {
		sum := sha256.Sum256([]byte(cb.files[p]))
		m.Files = append(m.Files, File{Path: p, SHA256: hex.EncodeToString(sum[:]), Size: int64(len(cb.files[p]))})
	}
	b, _ := json.Marshal(m)
	return b
}

func (cb *cloudBuild) serve(w http.ResponseWriter, r *http.Request) {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	p := strings.TrimPrefix(r.URL.Path, "/")
	cb.hits[p]++
	if cb.down.Load() {
		http.Error(w, "down", http.StatusServiceUnavailable)
		return
	}
	if p == "build-manifest.json" {
		_, _ = w.Write(cb.manifestJSON())
		return
	}
	if bad, ok := cb.corrupt[p]; ok {
		_, _ = w.Write([]byte(bad))
		return
	}
	body, ok := cb.files[p]
	if !ok {
		http.NotFound(w, r)
		return
	}
	_, _ = w.Write([]byte(body))
}

func (cb *cloudBuild) hitCount(p string) int {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return cb.hits[p]
}

func newCache(cb *cloudBuild, dir string) *Cache {
	return &Cache{
		Dir:        dir,
		Origin:     func() string { return cb.srv.URL },
		Interval:   time.Hour,
		BackoffMin: 10 * time.Millisecond,
	}
}

func site(version string, extra map[string]string) map[string]string {
	files := map[string]string{
		"index.html":                     "<!doctype html><html><head><title>" + version + "</title></head><body></body></html>",
		"assets/vendor-1.js":             strings.Repeat("vendor", 100),
		"assets/main-" + version + ".js": "main " + version,
		"fonts/a b.woff2":                "font",
	}
	for k, v := range extra {
		files[k] = v
	}
	return files
}

func TestDownloadsOnlyTheFilesItDoesNotHold(t *testing.T) {
	cb := newCloudBuild(t)
	dir := t.TempDir()
	c := newCache(cb, dir)

	cb.set("aaaaaaaaaaaaaaaa", site("1", nil))
	res, err := c.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !res.Changed || res.Fetched != 4 || res.Reused != 0 {
		t.Fatalf("first build: %+v", res)
	}
	if cur := c.Current(); cur == nil || cur.BuildID != "aaaaaaaaaaaaaaaa" || cur.DownloadedAt == "" {
		t.Fatalf("current = %+v", cur)
	}

	// A deploy that changes one chunk (and so the page that names it) downloads two files.
	cb.set("bbbbbbbbbbbbbbbb", site("2", map[string]string{
		"index.html": "<!doctype html><html><head><title>2</title></head><body>new</body></html>",
	}))
	before := cb.hitCount("assets/vendor-1.js")
	res, err = c.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if res.Fetched != 2 || res.Reused != 2 {
		t.Fatalf("second build: %+v, want 2 fetched (index.html, main-2.js) and 2 reused", res)
	}
	if got := cb.hitCount("assets/vendor-1.js"); got != before {
		t.Fatalf("the unchanged vendor chunk was downloaded again (%d hits, was %d)", got, before)
	}
	if got := cb.hitCount("fonts/a b.woff2"); got != 1 {
		t.Fatalf("font fetched %d times, want 1 (a path with a space is escaped, and then held)", got)
	}
	cur := c.Current()
	if cur.BuildID != "bbbbbbbbbbbbbbbb" || !strings.Contains(string(cur.Index()), "new") {
		t.Fatalf("serving %q", cur.BuildID)
	}
	if _, _, ok := cur.File("assets/main-2.js"); !ok {
		t.Fatal("new chunk missing")
	}
	if _, _, ok := cur.File("assets/main-1.js"); ok {
		t.Fatal("the old chunk is in the new build")
	}

	// Same id again: nothing to do.
	res, err = c.Check(context.Background())
	if err != nil || res.Changed || res.Fetched != 0 {
		t.Fatalf("same build: %+v %v", res, err)
	}
}

func TestABadHashRejectsTheWholeBuildAndKeepsTheCurrentOne(t *testing.T) {
	cb := newCloudBuild(t)
	dir := t.TempDir()
	c := newCache(cb, dir)
	cb.set("aaaaaaaaaaaaaaaa", site("1", nil))
	if _, err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}

	cb.set("bbbbbbbbbbbbbbbb", site("2", nil))
	cb.corrupt["assets/main-2.js"] = "main 3" // same size, other bytes
	if _, err := c.Check(context.Background()); err == nil || !strings.Contains(err.Error(), "sha256") {
		t.Fatalf("a file with a bad hash was accepted: %v", err)
	}
	cb.corrupt["assets/main-2.js"] = "short"
	if _, err := c.Check(context.Background()); err == nil || !strings.Contains(err.Error(), "size") {
		t.Fatalf("a file of the wrong size was accepted: %v", err)
	}
	if cur := c.Current(); cur.BuildID != "aaaaaaaaaaaaaaaa" {
		t.Fatalf("serving %q after a rejected build", cur.BuildID)
	}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".tmp-") || e.Name() == "bbbbbbbbbbbbbbbb" {
			t.Fatalf("a rejected build left %s behind", e.Name())
		}
	}
	var rec current
	if err := readJSON(filepath.Join(dir, "current.json"), &rec); err != nil || rec.BuildID != "aaaaaaaaaaaaaaaa" {
		t.Fatalf("current.json = %+v %v", rec, err)
	}

	// The next check, with the cloud right again, installs it.
	delete(cb.corrupt, "assets/main-2.js")
	if res, err := c.Check(context.Background()); err != nil || !res.Changed {
		t.Fatalf("after the fix: %+v %v", res, err)
	}
}

func TestAManifestThatLeavesTheBuildFolderIsRejected(t *testing.T) {
	for _, bad := range []string{"../evil.js", "/abs.js", "a/../../evil.js", `a\b.js`, "C:/x.js", ".manifest.json", "a//b.js", "./x.js"} {
		cb := newCloudBuild(t)
		c := newCache(cb, t.TempDir())
		cb.set("aaaaaaaaaaaaaaaa", site("1", map[string]string{bad: "x"}))
		if _, err := c.Check(context.Background()); err == nil {
			t.Errorf("path %q was accepted", bad)
		}
		if c.Current() != nil {
			t.Errorf("path %q: a build is being served", bad)
		}
	}
	// A build id that is not a folder name, and a build with no page.
	cb := newCloudBuild(t)
	c := newCache(cb, t.TempDir())
	cb.set("../x", site("1", nil))
	if _, err := c.Check(context.Background()); err == nil {
		t.Error("a build id with a slash was accepted")
	}
	cb.set("cccccccccccccccc", map[string]string{"a.js": "x"})
	if _, err := c.Check(context.Background()); err == nil || !strings.Contains(err.Error(), "index.html") {
		t.Errorf("a build with no index.html was accepted: %v", err)
	}
}

func TestTheSwitchIsAtomic(t *testing.T) {
	cb := newCloudBuild(t)
	dir := t.TempDir()
	c := newCache(cb, dir)
	big := strings.Repeat("x", 200_000)
	cb.set("aaaaaaaaaaaaaaaa", site("1", map[string]string{"assets/big.js": big}))
	if _, err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}

	// Readers that serve whatever build is current must always find every file of it on disk,
	// while the next build is being assembled and switched to.
	stop := make(chan struct{})
	var wg sync.WaitGroup
	var bad atomic.Value
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				b := c.Current()
				if b == nil {
					bad.Store("no build")
					return
				}
				for rel := range b.files {
					p, f, _ := b.File(rel)
					st, err := os.Stat(p)
					broken := err != nil || st.Size() != f.Size
					// A reader that still holds a build older than the previous one may find it pruned.
					if broken && (b == c.Current() || b == c.prev.Load()) {
						bad.Store(fmt.Sprintf("build %s: %s: %v", b.BuildID, rel, err))
						return
					}
				}
			}
		}()
	}
	for i, id := range []string{"bbbbbbbbbbbbbbbb", "cccccccccccccccc", "dddddddddddddddd"} {
		cb.set(id, site(fmt.Sprint(i+2), map[string]string{"assets/big.js": big}))
		if _, err := c.Check(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	close(stop)
	wg.Wait()
	if v := bad.Load(); v != nil {
		t.Fatalf("a reader saw a damaged build: %v", v)
	}
}

func TestKeepsTheCurrentAndThePreviousBuild(t *testing.T) {
	cb := newCloudBuild(t)
	dir := t.TempDir()
	c := newCache(cb, dir)
	for i, id := range []string{"aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", "cccccccccccccccc"} {
		cb.set(id, site(fmt.Sprint(i+1), nil))
		if _, err := c.Check(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	var dirs []string
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.IsDir() {
			dirs = append(dirs, e.Name())
		}
	}
	if strings.Join(dirs, ",") != "bbbbbbbbbbbbbbbb,cccccccccccccccc" {
		t.Fatalf("build folders = %v, want the current and the previous only", dirs)
	}
	var rec current
	if err := readJSON(filepath.Join(dir, "current.json"), &rec); err != nil {
		t.Fatal(err)
	}
	if rec.BuildID != "cccccccccccccccc" || rec.Previous != "bbbbbbbbbbbbbbbb" || rec.DownloadedAt == "" || rec.BuiltAt == "" {
		t.Fatalf("current.json = %+v", rec)
	}

	// The cloud rolls back to the previous build: it is switched to as it is, with no download.
	cb.set("bbbbbbbbbbbbbbbb", site("2", nil))
	hits := cb.hitCount("index.html")
	res, err := c.Check(context.Background())
	if err != nil || !res.Changed || res.Fetched != 0 {
		t.Fatalf("rollback: %+v %v", res, err)
	}
	if cb.hitCount("index.html") != hits {
		t.Fatal("a build held on disk was downloaded again")
	}
	if c.Current().BuildID != "bbbbbbbbbbbbbbbb" {
		t.Fatalf("serving %q", c.Current().BuildID)
	}
}

func TestARestartServesTheSavedBuildWithNoInternet(t *testing.T) {
	cb := newCloudBuild(t)
	dir := t.TempDir()
	c := newCache(cb, dir)
	cb.set("aaaaaaaaaaaaaaaa", site("1", nil))
	if _, err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	cb.set("bbbbbbbbbbbbbbbb", site("2", nil))
	if _, err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	// An interrupted download left a folder behind.
	if err := os.MkdirAll(filepath.Join(dir, ".tmp-cccccccccccccccc-123", "assets"), 0o700); err != nil {
		t.Fatal(err)
	}

	cb.down.Store(true)
	c2 := newCache(cb, dir)
	c2.Load()
	cur := c2.Current()
	if cur == nil || cur.BuildID != "bbbbbbbbbbbbbbbb" || cur.DownloadedAt == "" {
		t.Fatalf("after a restart: %+v", cur)
	}
	if _, err := c2.Check(context.Background()); err == nil {
		t.Fatal("a check against a cloud that is down did not fail")
	}
	if c2.Current().BuildID != "bbbbbbbbbbbbbbbb" {
		t.Fatal("a failed check changed the build")
	}
	if _, err := os.Stat(filepath.Join(dir, ".tmp-cccccccccccccccc-123")); err == nil {
		t.Fatal("the interrupted download was not cleaned up")
	}
	// The previous build is still there: a deploy back to it needs no download.
	cb.down.Store(false)
	cb.set("aaaaaaaaaaaaaaaa", site("1", nil))
	if res, err := c2.Check(context.Background()); err != nil || res.Fetched != 0 {
		t.Fatalf("rollback after restart: %+v %v", res, err)
	}
}

func TestADamagedSavedBuildIsFetchedAgain(t *testing.T) {
	cb := newCloudBuild(t)
	dir := t.TempDir()
	c := newCache(cb, dir)
	cb.set("aaaaaaaaaaaaaaaa", site("1", nil))
	if _, err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dir, "aaaaaaaaaaaaaaaa", "assets", "vendor-1.js")); err != nil {
		t.Fatal(err)
	}
	c2 := newCache(cb, dir)
	c2.Load()
	if c2.Current() != nil {
		t.Fatal("a build with a file missing is being served")
	}
	res, err := c2.Check(context.Background())
	if err != nil || !res.Changed || res.Fetched != 4 {
		t.Fatalf("refetch: %+v %v", res, err)
	}
}

func TestOnlyFilesTheManifestListsAreFound(t *testing.T) {
	cb := newCloudBuild(t)
	c := newCache(cb, t.TempDir())
	cb.set("aaaaaaaaaaaaaaaa", site("1", nil))
	if _, err := c.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	b := c.Current()
	for _, rel := range []string{".manifest.json", "../current.json", "assets", "nothing.js"} {
		if _, _, ok := b.File(rel); ok {
			t.Errorf("%q was found", rel)
		}
	}
	if _, _, ok := b.File("assets/vendor-1.js"); !ok {
		t.Error("a listed file was not found")
	}
}

func TestRunChecksAtOnceRetriesWithBackoffAndWhenKicked(t *testing.T) {
	cb := newCloudBuild(t)
	cb.set("aaaaaaaaaaaaaaaa", site("1", nil))
	cb.down.Store(true)
	c := newCache(cb, t.TempDir())
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { c.Run(ctx); close(done) }()
	defer func() { cancel(); <-done }()

	waitFor(t, "the first checks to fail and retry", func() bool { return cb.hitCount("build-manifest.json") >= 3 })
	if c.Current() != nil {
		t.Fatal("a build appeared from a cloud that is down")
	}
	cb.down.Store(false)
	waitFor(t, "the retry after the cloud came back", func() bool { return c.Current() != nil })

	// With the long interval a new build is only noticed when kicked (after a WebSocket connect).
	cb.set("bbbbbbbbbbbbbbbb", site("2", nil))
	time.Sleep(50 * time.Millisecond)
	if c.Current().BuildID != "aaaaaaaaaaaaaaaa" {
		t.Fatal("checked before the interval, with no kick")
	}
	c.Kick()
	waitFor(t, "the kicked check", func() bool { return c.Current().BuildID == "bbbbbbbbbbbbbbbb" })
}

func TestNoOriginIsNotAnError(t *testing.T) {
	c := &Cache{Dir: t.TempDir(), Origin: func() string { return "" }}
	if _, err := c.Check(context.Background()); err != ErrNoOrigin {
		t.Fatalf("err = %v", err)
	}
}

func TestBackoffDoublesUpToTheInterval(t *testing.T) {
	c := &Cache{Interval: 5 * time.Minute, BackoffMin: 5 * time.Second}
	var got []time.Duration
	for i := 1; i <= 8; i++ {
		got = append(got, c.backoff(i))
	}
	want := []time.Duration{5 * time.Second, 10 * time.Second, 20 * time.Second, 40 * time.Second,
		80 * time.Second, 160 * time.Second, 5 * time.Minute, 5 * time.Minute}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("backoff = %v, want %v", got, want)
		}
	}
}

func waitFor(t *testing.T, what string, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}
