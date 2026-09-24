package branchdata

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"
)

const staffBody = `{"staff_version":"s1","generated_at":"2026-09-24T08:00:00.000Z","users":[{"id":"u1","display_name":"سارا","role":"CASHIER","pin_hash":"$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA"}]}`

// xorSeal stands in for DPAPI: reversible, and never the plain text.
func xorSeal(b []byte) ([]byte, error) {
	out := make([]byte, len(b))
	for i, c := range b {
		out[i] = c ^ 0x5a
	}
	return out, nil
}

func staffKeeper(dir string, fetch func(context.Context, string) ([]byte, string, error)) *Staff {
	return &Staff{
		Dir: dir, Fetch: fetch, NotModified: errNotModified, Seal: xorSeal, Unseal: xorSeal,
		Log: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}

func TestStaffListIsKeptSealedAndReadBack(t *testing.T) {
	dir := t.TempDir()
	var held []string
	fetch := func(_ context.Context, h string) ([]byte, string, error) {
		held = append(held, h)
		if h == "s1" {
			return nil, h, errNotModified
		}
		return []byte(staffBody), "s1", nil
	}
	s := staffKeeper(dir, fetch)
	if err := s.Pull(context.Background()); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(filepath.Join(dir, staffName))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("argon2")) || bytes.Contains(raw, []byte("u1")) {
		t.Fatal("the staff list is on disk in the clear")
	}
	list, err := s.Load()
	if err != nil || list.StaffVersion != "s1" || len(list.Users) != 1 || list.Users[0].PINHash == "" {
		t.Fatalf("Load = %+v, %v", list, err)
	}

	// A new keeper (the agent restarted) knows what it holds and asks only for something newer.
	again := staffKeeper(dir, fetch)
	if st := again.Status(); st.StaffVersion != "s1" || st.Users != 1 {
		t.Fatalf("status after restart = %+v", st)
	}
	if err := again.Pull(context.Background()); err != nil {
		t.Fatal(err)
	}
	if held[len(held)-1] != "s1" {
		t.Fatalf("second pull held %q, want s1", held[len(held)-1])
	}
}

func TestStaffPullFailureKeepsTheListHeld(t *testing.T) {
	dir := t.TempDir()
	body := []byte(staffBody)
	fail := error(nil)
	s := staffKeeper(dir, func(context.Context, string) ([]byte, string, error) {
		if fail != nil {
			return nil, "", fail
		}
		return body, "s1", nil
	})
	if err := s.Pull(context.Background()); err != nil {
		t.Fatal(err)
	}
	fail = errors.New("HTTP 403 CAPABILITY_REQUIRED")
	if err := s.Pull(context.Background()); err == nil {
		t.Fatal("want the pull to fail")
	}
	if list, err := s.Load(); err != nil || list.StaffVersion != "s1" {
		t.Fatalf("list after a failed pull = %+v, %v", list, err)
	}
	if st := s.Status(); st.LastError == "" || st.StaffVersion != "s1" {
		t.Fatalf("status = %+v", st)
	}
}

func TestKeeperPullsTheStaffListWithTheSnapshot(t *testing.T) {
	dir := t.TempDir()
	f := &fakeCloud{body: `{"data_version":"v1"}`}
	pulled := make(chan struct{}, 10)
	k := keeper(t, dir, f)
	k.Staff = staffKeeper(dir, func(context.Context, string) ([]byte, string, error) {
		pulled <- struct{}{}
		return []byte(staffBody), "s1", nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go k.Run(ctx)
	k.Trigger()
	select {
	case <-pulled:
	case <-time.After(5 * time.Second):
		t.Fatal("the staff list was not pulled with the snapshot")
	}
}
