package update

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"gnext/agent/internal/cloud"
)

func TestCompare(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1.0.3", "1.0.0", 1},
		{"1.0.0", "1.0.0", 0},
		{"1.2.0", "1.10.0", -1},
		{"1.0.0", "1.0.0-dev", 1},
		{"v2.0.0", "1.9.9", 1},
	}
	for _, c := range cases {
		if got := Compare(c.a, c.b); got != c.want {
			t.Errorf("Compare(%s, %s) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func releaseServer(t *testing.T, body []byte, sha string) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/agent/releases/latest":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"version": "1.0.3", "url": "/api/v1/agent/releases/1.0.3/gnext-agent.exe",
				"sha256": sha, "size": len(body),
			})
		case "/api/v1/agent/releases/1.0.3/gnext-agent.exe":
			_, _ = w.Write(body)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func newUpdater(t *testing.T, srv *httptest.Server, restarted *bool) (*Updater, string) {
	dir := t.TempDir()
	exe := filepath.Join(dir, "gnext-agent.exe")
	if err := os.WriteFile(exe, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	return &Updater{
		Client:  &cloud.Client{Server: srv.URL, Key: "gak_x", Version: "1.0.0"},
		Version: "1.0.0",
		Dir:     filepath.Join(dir, "updates"),
		Exe:     exe,
		Log:     slog.New(slog.NewTextHandler(io.Discard, nil)),
		Begin:   func() {},
		End:     func() {},
		Idle:    func() bool { return true },
		Restart: func() { *restarted = true },
	}, exe
}

func TestCheckInstallsVerifiedRelease(t *testing.T) {
	body := []byte("new binary")
	sum := sha256.Sum256(body)
	srv := releaseServer(t, body, hex.EncodeToString(sum[:]))
	restarted := false
	u, exe := newUpdater(t, srv, &restarted)

	if err := u.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(exe); string(got) != "new binary" || !restarted {
		t.Fatalf("exe = %q, restarted = %v", got, restarted)
	}
	if got, _ := os.ReadFile(OldPath(exe, "1.0.0")); string(got) != "old" {
		t.Fatalf("old binary not kept: %q", got)
	}
	Cleanup(exe)
	if _, err := os.Stat(OldPath(exe, "1.0.0")); !os.IsNotExist(err) {
		t.Fatal("old binary not cleaned up")
	}
}

// A binary an earlier update set aside may still be in use (a window opened before it), and
// Windows refuses to delete or replace it. The update must go ahead anyway. A non-empty folder
// under that name stands in for the locked file: neither Remove nor Rename can take its place.
func TestCheckInstallsPastABinaryStillInUse(t *testing.T) {
	body := []byte("new binary")
	sum := sha256.Sum256(body)
	srv := releaseServer(t, body, hex.EncodeToString(sum[:]))
	restarted := false
	u, exe := newUpdater(t, srv, &restarted)
	locked := OldPath(exe, "1.0.0")
	if err := os.MkdirAll(filepath.Join(locked, "in-use"), 0o755); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(filepath.Dir(exe), "gnext-agent.old.exe")
	if err := os.WriteFile(legacy, []byte("older"), 0o755); err != nil {
		t.Fatal(err)
	}

	if err := u.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(exe); string(got) != "new binary" || !restarted {
		t.Fatalf("exe = %q, restarted = %v", got, restarted)
	}
	if got, _ := os.ReadFile(OldPath(exe, "1.0.0-2")); string(got) != "old" {
		t.Fatalf("old binary not set aside beside the one in use: %q", got)
	}
	Cleanup(exe)
	if _, err := os.Stat(OldPath(exe, "1.0.0-2")); !os.IsNotExist(err) {
		t.Fatal("old binary not cleaned up")
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatal("binary set aside under the pre-1.10.2 name not cleaned up")
	}
}

func TestCheckRejectsBadChecksum(t *testing.T) {
	srv := releaseServer(t, []byte("tampered"), "00")
	restarted := false
	u, exe := newUpdater(t, srv, &restarted)

	if err := u.Check(context.Background()); err == nil {
		t.Fatal("expected a checksum error")
	}
	if got, _ := os.ReadFile(exe); string(got) != "old" || restarted {
		t.Fatalf("exe = %q, restarted = %v", got, restarted)
	}
	if entries, _ := os.ReadDir(u.Dir); len(entries) != 0 {
		t.Fatalf("bad download left behind: %v", entries)
	}
}

func zipOf(t *testing.T, files map[string]string) []byte {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, body := range files {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = f.Write([]byte(body))
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func hexSHA(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// bridgeServer publishes version with a bridge zip whose advertised checksum is sha, and counts
// the bridge downloads.
func bridgeServer(t *testing.T, version string, zipBody []byte, sha string, downloads *atomic.Int32) *httptest.Server {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/agent/releases/latest":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"version": version, "url": "/api/v1/agent/releases/" + version + "/gnext-agent.exe",
				"sha256": hexSHA([]byte("agent")), "size": 5,
				"bridge": map[string]any{
					"url":    "/api/v1/agent/releases/" + version + "/gnext-saman-bridge.zip",
					"sha256": sha, "size": len(zipBody),
				},
			})
		case "/api/v1/agent/releases/" + version + "/gnext-agent.exe":
			_, _ = w.Write([]byte("agent"))
		case "/api/v1/agent/releases/" + version + "/gnext-saman-bridge.zip":
			downloads.Add(1)
			_, _ = w.Write(zipBody)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

// bridgeUpdater runs 1.0.0 with an installed bridge folder holding the old bridge and a stray file.
func bridgeUpdater(t *testing.T, srv *httptest.Server, restarted *bool, locks *atomic.Int32) (*Updater, string) {
	u, exe := newUpdater(t, srv, restarted)
	dir := filepath.Join(filepath.Dir(exe), "saman")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{bridgeExe: "old bridge", "stray.dll": "x"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	u.BridgeDir = dir
	u.LockBridge = func() func() { locks.Add(1); return func() {} }
	var begun int
	u.Begin = func() { begun++ }
	u.End = func() {
		if begun--; begun != 0 {
			t.Error("End without Begin")
		}
	}
	return u, dir
}

func TestCheckBringsInTheBridgeOfTheRunningVersion(t *testing.T) {
	zipBody := zipOf(t, map[string]string{bridgeExe: "new bridge", `sdk\SSP1126.PcPos.dll`: "sdk"})
	var downloads, locks atomic.Int32
	srv := bridgeServer(t, "1.0.0", zipBody, hexSHA(zipBody), &downloads)
	restarted := false
	u, dir := bridgeUpdater(t, srv, &restarted, &locks)

	if err := u.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, bridgeExe)); string(got) != "new bridge" {
		t.Fatalf("bridge = %q", got)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "sdk", "SSP1126.PcPos.dll")); string(got) != "sdk" {
		t.Fatalf("backslash entry not unpacked into a folder: %q", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "stray.dll")); !os.IsNotExist(err) {
		t.Fatal("the old bridge's files were kept")
	}
	if restarted || locks.Load() != 1 {
		t.Fatalf("restarted = %v, locks = %d", restarted, locks.Load())
	}
	for _, left := range []string{dir + ".new", dir + ".old", filepath.Join(u.Dir, "gnext-saman-bridge-1.0.0.zip")} {
		if _, err := os.Stat(left); !os.IsNotExist(err) {
			t.Fatalf("%s left behind", left)
		}
	}

	// The marker says the bridge is current: the next check downloads nothing.
	if err := u.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if downloads.Load() != 1 {
		t.Fatalf("bridge downloaded %d times", downloads.Load())
	}
}

// A newer release is the agent's own update; its new binary takes the bridge at its first check.
func TestCheckLeavesTheBridgeToTheNewBinary(t *testing.T) {
	zipBody := zipOf(t, map[string]string{bridgeExe: "new bridge"})
	var downloads, locks atomic.Int32
	srv := bridgeServer(t, "1.0.3", zipBody, hexSHA(zipBody), &downloads)
	restarted := false
	u, dir := bridgeUpdater(t, srv, &restarted, &locks)

	if err := u.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !restarted || downloads.Load() != 0 {
		t.Fatalf("restarted = %v, bridge downloads = %d", restarted, downloads.Load())
	}
	if got, _ := os.ReadFile(filepath.Join(dir, bridgeExe)); string(got) != "old bridge" {
		t.Fatalf("bridge = %q", got)
	}
}

func TestCheckKeepsTheBridgeOnABadDownload(t *testing.T) {
	cases := map[string]struct {
		zip []byte
		sha func([]byte) string
	}{
		"checksum":       {zipOf(t, map[string]string{bridgeExe: "tampered"}), func([]byte) string { return "00" }},
		"escaping entry": {zipOf(t, map[string]string{bridgeExe: "new", "../evil.exe": "x"}), hexSHA},
		"no bridge":      {zipOf(t, map[string]string{"readme.txt": "x"}), hexSHA},
		"not a zip":      {[]byte("MZ not a zip"), hexSHA},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			var downloads, locks atomic.Int32
			srv := bridgeServer(t, "1.0.0", c.zip, c.sha(c.zip), &downloads)
			restarted := false
			u, dir := bridgeUpdater(t, srv, &restarted, &locks)

			if err := u.Check(context.Background()); err == nil {
				t.Fatal("expected an error")
			}
			if got, _ := os.ReadFile(filepath.Join(dir, bridgeExe)); string(got) != "old bridge" {
				t.Fatalf("bridge = %q", got)
			}
			if _, err := os.Stat(filepath.Join(filepath.Dir(dir), "evil.exe")); !os.IsNotExist(err) {
				t.Fatal("an entry was written outside the bridge folder")
			}
			if _, err := os.Stat(dir + ".new"); !os.IsNotExist(err) {
				t.Fatal("the staged folder was left behind")
			}
			if locks.Load() != 0 {
				t.Fatal("charges were held off for a bridge that was not installed")
			}
		})
	}
}

// A PC set up without a bridge folder (an installer built without it) gets one.
func TestCheckInstallsTheBridgeWhereThereWasNone(t *testing.T) {
	zipBody := zipOf(t, map[string]string{bridgeExe: "new bridge"})
	var downloads, locks atomic.Int32
	srv := bridgeServer(t, "1.0.0", zipBody, hexSHA(zipBody), &downloads)
	restarted := false
	u, dir := bridgeUpdater(t, srv, &restarted, &locks)
	if err := os.RemoveAll(dir); err != nil {
		t.Fatal(err)
	}

	if err := u.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, bridgeExe)); string(got) != "new bridge" {
		t.Fatalf("bridge = %q", got)
	}
}
