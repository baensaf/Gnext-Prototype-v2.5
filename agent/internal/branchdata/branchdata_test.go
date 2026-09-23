package branchdata

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

var errNotModified = errors.New("not modified")

// fakeCloud serves one snapshot at a time and records what the agent said it held.
type fakeCloud struct {
	mu    sync.Mutex
	body  string
	fail  error
	calls int
	held  []string
}

func (f *fakeCloud) set(body string) {
	f.mu.Lock()
	f.body = body
	f.mu.Unlock()
}

func (f *fakeCloud) Snapshot(_ context.Context, held string) ([]byte, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.held = append(f.held, held)
	if f.fail != nil {
		return nil, "", f.fail
	}
	v := versionOf([]byte(f.body))
	if v == held {
		return nil, held, errNotModified
	}
	return []byte(f.body), v, nil
}

func (f *fakeCloud) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func keeper(t *testing.T, dir string, f *fakeCloud) *Keeper {
	t.Helper()
	return &Keeper{
		Dir: dir, Fetch: f, NotModified: errNotModified,
		Log:      slog.New(slog.NewTextHandler(io.Discard, nil)),
		Interval: time.Hour, BackoffMax: 20 * time.Millisecond,
	}
}

func TestPullStoresTheSnapshotAndSendsTheVersionHeld(t *testing.T) {
	dir := t.TempDir()
	f := &fakeCloud{body: `{"data_version":"v1","products":[]}`}
	k := keeper(t, dir, f)

	if err := k.Pull(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := k.Status(); got.DataVersion != "v1" || got.PulledAt == nil || got.LastError != "" {
		t.Fatalf("status = %+v", got)
	}
	// Nothing changed: a 304, and the copy stays.
	if err := k.Pull(context.Background()); err != nil {
		t.Fatal(err)
	}
	f.set(`{"data_version":"v2","products":[{"id":"p"}]}`)
	if err := k.Pull(context.Background()); err != nil {
		t.Fatal(err)
	}
	if want := []string{"", "v1", "v1"}; len(f.held) != 3 || f.held[0] != want[0] || f.held[1] != want[1] || f.held[2] != want[2] {
		t.Fatalf("held versions sent = %v, want %v", f.held, want)
	}
	b, err := k.Load()
	if err != nil || versionOf(b) != "v2" {
		t.Fatalf("Load = %s, %v", b, err)
	}
	prev, _ := os.ReadFile(filepath.Join(dir, previousName))
	if versionOf(prev) != "v1" {
		t.Fatalf("previous copy = %s, want v1", prev)
	}
}

func TestAFailedPullKeepsTheCopyHeld(t *testing.T) {
	f := &fakeCloud{body: `{"data_version":"v1"}`}
	k := keeper(t, t.TempDir(), f)
	if err := k.Pull(context.Background()); err != nil {
		t.Fatal(err)
	}
	f.fail = errors.New("no route to host")
	if err := k.Pull(context.Background()); err == nil {
		t.Fatal("want an error")
	}
	if got := k.Status(); got.DataVersion != "v1" || got.LastError == "" {
		t.Fatalf("status = %+v", got)
	}
	if b, err := k.Load(); err != nil || versionOf(b) != "v1" {
		t.Fatalf("Load = %s, %v", b, err)
	}
}

func TestLoadFallsBackToThePreviousCopy(t *testing.T) {
	dir := t.TempDir()
	// A crash between the two renames leaves only the previous copy and the new one half-named.
	if err := os.WriteFile(filepath.Join(dir, previousName), []byte(`{"data_version":"v1"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, currentName+".tmp"), []byte(`{"data_ver`), 0o600); err != nil {
		t.Fatal(err)
	}
	k := keeper(t, dir, &fakeCloud{body: `{"data_version":"v1"}`})
	if b, err := k.Load(); err != nil || versionOf(b) != "v1" {
		t.Fatalf("Load = %s, %v", b, err)
	}
	// It is remembered on start, so the first pull can be a 304.
	if got := k.Status().DataVersion; got != "v1" {
		t.Fatalf("version on start = %q, want v1", got)
	}

	// A damaged current copy is skipped too.
	if err := os.WriteFile(filepath.Join(dir, currentName), []byte(`not json`), 0o600); err != nil {
		t.Fatal(err)
	}
	if b, err := k.Load(); err != nil || versionOf(b) != "v1" {
		t.Fatalf("Load with a damaged current copy = %s, %v", b, err)
	}
}

func TestLoadWithNothingHeld(t *testing.T) {
	k := keeper(t, t.TempDir(), &fakeCloud{})
	if _, err := k.Load(); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Load = %v, want ErrNotExist", err)
	}
}

func TestRunPullsOnTriggerAndRetriesAFailure(t *testing.T) {
	f := &fakeCloud{body: `{"data_version":"v1"}`, fail: errors.New("offline")}
	k := keeper(t, t.TempDir(), f)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go k.Run(ctx)

	k.Trigger()
	deadline := time.Now().Add(5 * time.Second)
	for f.count() < 3 {
		if time.Now().After(deadline) {
			t.Fatalf("pulls = %d, want retries after a failure", f.count())
		}
		time.Sleep(5 * time.Millisecond)
	}
	f.mu.Lock()
	f.fail = nil
	f.mu.Unlock()
	for k.Status().DataVersion != "v1" {
		if time.Now().After(deadline) {
			t.Fatal("the retry never stored the snapshot")
		}
		time.Sleep(5 * time.Millisecond)
	}
	// Once it works, the next pull waits for the interval or a trigger.
	n := f.count()
	time.Sleep(100 * time.Millisecond)
	if f.count() != n {
		t.Fatalf("pulled %d more times without a trigger", f.count()-n)
	}
}
