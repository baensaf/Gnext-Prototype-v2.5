package store

import (
	"errors"
	"testing"
)

func TestLockIsExclusive(t *testing.T) {
	t.Setenv("GNEXT_AGENT_HOME", t.TempDir())
	release, err := Lock()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Lock(); !errors.Is(err, ErrLocked) {
		t.Fatalf("second lock: got %v, want ErrLocked", err)
	}
	release()
	again, err := Lock()
	if err != nil {
		t.Fatalf("lock after release: %v", err)
	}
	again()
}
