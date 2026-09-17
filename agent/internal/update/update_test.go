package update

import (
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
	if got, _ := os.ReadFile(OldPath(exe)); string(got) != "old" {
		t.Fatalf("old binary not kept: %q", got)
	}
	Cleanup(exe)
	if _, err := os.Stat(OldPath(exe)); !os.IsNotExist(err) {
		t.Fatal("old binary not cleaned up")
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
