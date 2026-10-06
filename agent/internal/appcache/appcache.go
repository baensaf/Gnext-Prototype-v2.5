// Package appcache keeps the cloud's frontend build on disk and says which build the agent
// serves (agent-protocol §19.7).
//
// The cloud writes build-manifest.json beside its frontend: a build id, and every file with its
// SHA-256 and size. The agent fetches the manifest every few minutes and after each connect. For
// a build id it does not serve yet it takes every file it already holds (same hash) from the
// current or previous build, downloads the others, checks every hash, writes the new build to
// <dir>\<build_id>\ and only then names it in <dir>\current.json. The build being served is never
// changed, and the one before it is kept.
package appcache

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"gnext/agent/internal/protocol"
)

const (
	currentFile = "current.json"
	// manifestFile is the manifest as the cloud sent it, kept inside the build's folder. Only paths
	// the manifest lists are ever served, so this file is not reachable from the page.
	manifestFile = ".manifest.json"
	tmpPrefix    = ".tmp-"

	// maxManifest is the most the agent reads of build-manifest.json.
	maxManifest = 16 << 20
)

// ErrNoOrigin means no server is configured to take the build from.
var ErrNoOrigin = errors.New("no frontend address is configured")

var (
	buildIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	sha256Pattern  = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// File is one entry of build-manifest.json.
type File struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

// Manifest is build-manifest.json (§19.7).
type Manifest struct {
	BuildID string `json:"build_id"`
	BuiltAt string `json:"built_at"`
	Files   []File `json:"files"`
}

// Info says which build is served: the status route's `app` (§19.8).
type Info struct {
	BuildID      string `json:"build_id"`
	BuiltAt      string `json:"built_at"`
	DownloadedAt string `json:"downloaded_at"`
}

// current is current.json.
type current struct {
	Info
	Previous string `json:"previous,omitempty"`
}

// Build is one complete build on disk. It never changes once it exists.
type Build struct {
	Info
	dir   string
	files map[string]File
	index []byte
}

// Index is the build's index.html as the cloud made it.
func (b *Build) Index() []byte { return b.index }

// File finds a file of the build by its path relative to the build (`assets/a.js`). Only files
// the manifest lists are found, whatever else lies in the folder.
func (b *Build) File(rel string) (path string, f File, ok bool) {
	f, ok = b.files[rel]
	if !ok {
		return "", File{}, false
	}
	return filepath.Join(b.dir, filepath.FromSlash(rel)), f, true
}

// Result is what one check did.
type Result struct {
	BuildID string `json:"build_id"`
	// Changed is true when the agent switched to a new build.
	Changed bool  `json:"changed"`
	Fetched int   `json:"files_fetched"`
	Reused  int   `json:"files_reused"`
	Bytes   int64 `json:"bytes"`
}

// Cache is the agent's copy of the cloud's frontend.
type Cache struct {
	// Dir is <data>\app.
	Dir string
	// Origin returns the frontend's address, asked at every check so a new enrolment or config is
	// picked up. An empty answer means none is configured.
	Origin    func() string
	HTTP      *http.Client
	Log       *slog.Logger
	UserAgent string

	// Timings, overridable in tests.
	Interval   time.Duration // between checks; default 5 minutes
	BackoffMin time.Duration // first retry after a failed check; default 5 s, doubling up to Interval

	mu   sync.Mutex // one check at a time
	cur  atomic.Pointer[Build]
	prev atomic.Pointer[Build]
	kick chan struct{}
	once sync.Once
}

func (c *Cache) init() {
	c.once.Do(func() {
		c.kick = make(chan struct{}, 1)
		if c.Log == nil {
			c.Log = slog.New(slog.NewTextHandler(io.Discard, nil))
		}
		if c.Interval <= 0 {
			c.Interval = 5 * time.Minute
		}
		if c.BackoffMin <= 0 {
			c.BackoffMin = 5 * time.Second
		}
		if c.HTTP == nil {
			c.HTTP = &http.Client{Transport: &http.Transport{
				Proxy:                 http.ProxyFromEnvironment,
				TLSHandshakeTimeout:   15 * time.Second,
				ResponseHeaderTimeout: 30 * time.Second,
				MaxIdleConnsPerHost:   4,
				IdleConnTimeout:       30 * time.Second,
			}}
		}
	})
}

// Current is the build being served, or nil while there is none.
func (c *Cache) Current() *Build { return c.cur.Load() }

// Load reads current.json and opens the build it names, so a restart with no internet serves what
// was served before. It also removes folders an interrupted download left. A damaged build is
// dropped and fetched again by the next check.
func (c *Cache) Load() {
	c.init()
	c.mu.Lock()
	defer c.mu.Unlock()
	var cur current
	if err := readJSON(filepath.Join(c.Dir, currentFile), &cur); err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			c.Log.Warn("app build record unreadable; fetching the build again", "err", err)
		}
		c.prune()
		return
	}
	if !buildIDPattern.MatchString(cur.BuildID) {
		c.Log.Warn("app build record names no usable build; fetching the build again", "build", cur.BuildID)
		c.prune()
		return
	}
	b, err := c.open(cur.BuildID, cur.Info)
	if err != nil {
		c.Log.Warn("the saved app build is damaged; fetching it again", "build", cur.BuildID, "err", err)
		_ = os.RemoveAll(filepath.Join(c.Dir, cur.BuildID))
		c.prune()
		return
	}
	c.cur.Store(b)
	if cur.Previous != "" && buildIDPattern.MatchString(cur.Previous) {
		if p, err := c.open(cur.Previous, Info{BuildID: cur.Previous}); err == nil {
			c.prev.Store(p)
		}
	}
	c.prune()
	c.Log.Info("serving the saved app build", "build", b.BuildID, "built_at", b.BuiltAt, "downloaded_at", b.DownloadedAt)
}

// Kick asks Run for a check now (after a WebSocket connect). It never blocks.
func (c *Cache) Kick() {
	c.init()
	select {
	case c.kick <- struct{}{}:
	default:
	}
}

// Run checks at once, then every Interval and whenever kicked, until ctx ends. A failed check
// keeps the current build and is tried again after 5 s, 10 s, 20 s… up to Interval.
func (c *Cache) Run(ctx context.Context) {
	c.init()
	delay := time.Duration(0)
	failures := 0
	for {
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-c.kick:
			timer.Stop()
		case <-timer.C:
		}
		_, err := c.Check(ctx)
		switch {
		case ctx.Err() != nil:
			return
		case errors.Is(err, ErrNoOrigin):
			// Nothing to fetch from yet; the address may be configured any moment.
			failures, delay = 0, min(30*time.Second, c.Interval)
		case err != nil:
			failures++
			delay = c.backoff(failures)
			c.Log.Warn("app build check failed; the current build stays", "err", err, "retry_in", delay.Round(time.Millisecond))
		default:
			failures, delay = 0, c.Interval
		}
	}
}

func (c *Cache) backoff(failures int) time.Duration {
	d := c.BackoffMin
	for i := 1; i < failures && d < c.Interval; i++ {
		d *= 2
	}
	return min(d, c.Interval)
}

// Check fetches the manifest and, when its build id is new, installs that build. It is safe to
// call at any time; checks run one after another.
func (c *Cache) Check(ctx context.Context) (Result, error) {
	c.init()
	c.mu.Lock()
	defer c.mu.Unlock()
	origin := ""
	if c.Origin != nil {
		origin = strings.TrimRight(c.Origin(), "/")
	}
	if origin == "" {
		return Result{}, ErrNoOrigin
	}
	m, err := c.fetchManifest(ctx, origin)
	if err != nil {
		return Result{}, err
	}
	if cur := c.cur.Load(); cur != nil && cur.BuildID == m.BuildID {
		return Result{BuildID: m.BuildID}, nil
	}
	if err := validate(m); err != nil {
		return Result{}, fmt.Errorf("the cloud's build manifest is not usable: %w", err)
	}
	return c.install(ctx, origin, m)
}

func (c *Cache) fetchManifest(ctx context.Context, origin string) (*Manifest, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	resp, err := c.get(ctx, origin+"/build-manifest.json")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("build-manifest.json: HTTP %d", resp.StatusCode)
	}
	var m Manifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxManifest)).Decode(&m); err != nil {
		return nil, fmt.Errorf("build-manifest.json is not a build manifest: %w", err)
	}
	if m.BuildID == "" {
		return nil, errors.New("build-manifest.json has no build_id")
	}
	return &m, nil
}

// validate refuses a manifest that could write outside the build's folder or that has no page.
func validate(m *Manifest) error {
	if !buildIDPattern.MatchString(m.BuildID) {
		return fmt.Errorf("build_id %q", m.BuildID)
	}
	seen := make(map[string]bool, len(m.Files))
	for _, f := range m.Files {
		if !fs.ValidPath(f.Path) || f.Path == "." || strings.ContainsAny(f.Path, `\:`) || f.Path == manifestFile {
			return fmt.Errorf("file path %q", f.Path)
		}
		if !sha256Pattern.MatchString(f.SHA256) {
			return fmt.Errorf("file %q has no sha256", f.Path)
		}
		if f.Size < 0 {
			return fmt.Errorf("file %q has a negative size", f.Path)
		}
		if seen[f.Path] {
			return fmt.Errorf("file %q is listed twice", f.Path)
		}
		seen[f.Path] = true
	}
	if !seen["index.html"] {
		return errors.New("no index.html")
	}
	return nil
}

func (c *Cache) install(ctx context.Context, origin string, m *Manifest) (Result, error) {
	res := Result{BuildID: m.BuildID, Changed: true}
	target := filepath.Join(c.Dir, m.BuildID)
	info := Info{BuildID: m.BuildID, BuiltAt: m.BuiltAt}

	// A build the agent already holds in full (the previous one, after the cloud was rolled back)
	// is switched to as it is.
	b, err := c.open(m.BuildID, info)
	if err != nil {
		if b, err = c.fetchBuild(ctx, origin, m, target, &res); err != nil {
			return Result{}, err
		}
	}

	b.DownloadedAt = protocol.Now(time.Now())
	old := c.cur.Load()
	rec := current{Info: b.Info}
	if old != nil {
		rec.Previous = old.BuildID
	}
	if err := writeJSON(filepath.Join(c.Dir, currentFile), rec); err != nil {
		return Result{}, err
	}
	c.prev.Store(old)
	c.cur.Store(b)
	c.prune()
	oldID := ""
	if old != nil {
		oldID = old.BuildID
	}
	c.Log.Info("app build switched", "old", oldID, "new", b.BuildID,
		"files_fetched", res.Fetched, "files_reused", res.Reused, "bytes", res.Bytes)
	return res, nil
}

// fetchBuild assembles the build in a folder of its own, checks every file, and renames the folder
// to target only when it is complete.
func (c *Cache) fetchBuild(ctx context.Context, origin string, m *Manifest, target string, res *Result) (*Build, error) {
	if err := os.RemoveAll(target); err != nil { // an incomplete folder of an earlier try
		return nil, err
	}
	if err := os.MkdirAll(c.Dir, 0o700); err != nil {
		return nil, err
	}
	tmp, err := os.MkdirTemp(c.Dir, tmpPrefix+m.BuildID+"-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp) // a no-op once the folder was renamed into place
	held := c.held()
	for _, f := range m.Files {
		dest := filepath.Join(tmp, filepath.FromSlash(f.Path))
		if err := os.MkdirAll(filepath.Dir(dest), 0o700); err != nil {
			return nil, err
		}
		if src, ok := held[f.SHA256]; ok && reuse(src, dest, f) == nil {
			res.Reused++
			continue
		}
		n, err := c.download(ctx, origin, f, dest)
		if err != nil {
			return nil, err
		}
		res.Fetched++
		res.Bytes += n
	}
	if err := writeJSON(filepath.Join(tmp, manifestFile), m); err != nil {
		return nil, err
	}
	if err := rename(tmp, target); err != nil {
		return nil, err
	}
	return c.open(m.BuildID, Info{BuildID: m.BuildID, BuiltAt: m.BuiltAt})
}

// held maps the hash of every file of the current and previous builds to where it lies.
func (c *Cache) held() map[string]string {
	out := map[string]string{}
	for _, b := range []*Build{c.prev.Load(), c.cur.Load()} {
		if b == nil {
			continue
		}
		for rel, f := range b.files {
			out[f.SHA256] = filepath.Join(b.dir, filepath.FromSlash(rel))
		}
	}
	return out
}

// reuse puts a file the agent already holds in a new build: a hard link where the disk allows it,
// else a copy that is checked against the hash.
func reuse(src, dest string, f File) error {
	if st, err := os.Stat(src); err != nil || st.Size() != f.Size {
		return errors.New("the held file is gone or changed")
	}
	if os.Link(src, dest) == nil {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if _, err := writeVerified(dest, in, f); err != nil {
		_ = os.Remove(dest)
		return err
	}
	return nil
}

func (c *Cache) download(ctx context.Context, origin string, f File, dest string) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	resp, err := c.get(ctx, origin+"/"+escapePath(f.Path))
	if err != nil {
		return 0, fmt.Errorf("%s: %w", f.Path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("%s: HTTP %d", f.Path, resp.StatusCode)
	}
	n, err := writeVerified(dest, resp.Body, f)
	if err != nil {
		_ = os.Remove(dest)
		return 0, fmt.Errorf("%s: %w", f.Path, err)
	}
	return n, nil
}

// writeVerified writes r to dest and checks its size and SHA-256 against the manifest.
func writeVerified(dest string, r io.Reader, f File) (int64, error) {
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, err
	}
	h := sha256.New()
	// One byte more than the manifest says, so a longer file is told from an exact one.
	n, err := io.Copy(io.MultiWriter(out, h), io.LimitReader(r, f.Size+1))
	if err == nil {
		err = out.Sync()
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return n, err
	}
	if n != f.Size {
		return n, fmt.Errorf("size is %d, the manifest says %d", n, f.Size)
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != f.SHA256 {
		return n, fmt.Errorf("sha256 is %s, the manifest says %s", got, f.SHA256)
	}
	return n, nil
}

func (c *Cache) get(ctx context.Context, rawURL string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Cache-Control", "no-cache")
	if c.UserAgent != "" {
		req.Header.Set("User-Agent", c.UserAgent)
	}
	return c.HTTP.Do(req)
}

// escapePath percent-encodes each segment of a manifest path.
func escapePath(p string) string {
	parts := strings.Split(p, "/")
	for i, s := range parts {
		parts[i] = url.PathEscape(s)
	}
	return strings.Join(parts, "/")
}

// open reads a build folder: its manifest, and that every file in it is there with the right size.
func (c *Cache) open(id string, info Info) (*Build, error) {
	dir := filepath.Join(c.Dir, id)
	var m Manifest
	if err := readJSON(filepath.Join(dir, manifestFile), &m); err != nil {
		return nil, err
	}
	if m.BuildID != id {
		return nil, fmt.Errorf("folder %s holds build %s", id, m.BuildID)
	}
	if err := validate(&m); err != nil {
		return nil, err
	}
	b := &Build{Info: info, dir: dir, files: make(map[string]File, len(m.Files))}
	if b.BuiltAt == "" {
		b.BuiltAt = m.BuiltAt
	}
	for _, f := range m.Files {
		st, err := os.Stat(filepath.Join(dir, filepath.FromSlash(f.Path)))
		if err != nil {
			return nil, err
		}
		if st.Size() != f.Size {
			return nil, fmt.Errorf("%s has the wrong size", f.Path)
		}
		b.files[f.Path] = f
	}
	idx, err := os.ReadFile(filepath.Join(dir, "index.html"))
	if err != nil {
		return nil, err
	}
	b.index = idx
	return b, nil
}

// prune keeps the current and the previous build and removes every other build folder and every
// interrupted download. Folders it does not recognise are left alone.
func (c *Cache) prune() {
	keep := map[string]bool{}
	for _, b := range []*Build{c.cur.Load(), c.prev.Load()} {
		if b != nil {
			keep[b.BuildID] = true
		}
	}
	entries, err := os.ReadDir(c.Dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		if !e.IsDir() || keep[name] || !(strings.HasPrefix(name, tmpPrefix) || buildIDPattern.MatchString(name)) {
			continue
		}
		if err := os.RemoveAll(filepath.Join(c.Dir, name)); err != nil {
			c.Log.Warn("could not remove an old app build", "folder", name, "err", err)
		}
	}
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

// writeJSON replaces path in one step: the file is written and flushed beside it, then renamed.
func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	var rnd [4]byte
	_, _ = rand.Read(rnd[:])
	tmp := fmt.Sprintf("%s.%x.tmp", path, rnd)
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, err = f.Write(b)
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := rename(tmp, path); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return nil
}

// rename is os.Rename, tried a few times: on Windows a virus scanner that has just looked at a new
// file or folder can make the rename fail for a moment.
func rename(from, to string) error {
	var err error
	for i := 0; i < 10; i++ {
		if err = os.Rename(from, to); err == nil {
			return nil
		}
		time.Sleep(time.Duration(i+1) * 50 * time.Millisecond)
	}
	return err
}
