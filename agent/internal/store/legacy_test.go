package store

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestRemoveLegacyOfflineDataKeepsTheRest(t *testing.T) {
	home := t.TempDir()
	t.Setenv("GNEXT_AGENT_HOME", home)
	write := func(rel string) {
		t.Helper()
		p := filepath.Join(home, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for _, f := range []string{
		"branch-data/snapshot.json", "branch-data/staff.sealed", "offline-orders.db", "till.json", "till.json.tmp",
		"till-orders.db", "till-devices.json", "call-numbers.json",
		// What stays.
		"devices.json", "identity.json", "config.json", "journal.db", "logs/agent.log",
	} {
		write(f)
	}

	removed, failed := RemoveLegacyOfflineData()
	if len(failed) != 0 {
		t.Fatalf("failed = %v", failed)
	}
	want := []string{"branch-data", "offline-orders.db", "till.json", "till.json.tmp", "till-orders.db", "till-devices.json", "call-numbers.json"}
	if !reflect.DeepEqual(removed, want) {
		t.Fatalf("removed = %v, want %v", removed, want)
	}
	for _, f := range want {
		if _, err := os.Stat(filepath.Join(home, f)); !os.IsNotExist(err) {
			t.Errorf("%s is still there (%v)", f, err)
		}
	}
	for _, f := range []string{"devices.json", "identity.json", "config.json", "journal.db", "logs/agent.log"} {
		if _, err := os.Stat(filepath.Join(home, f)); err != nil {
			t.Errorf("%s was removed: %v", f, err)
		}
	}

	// Run again: nothing left, nothing reported.
	if removed, failed := RemoveLegacyOfflineData(); len(removed) != 0 || len(failed) != 0 {
		t.Fatalf("second run removed %v, failed %v", removed, failed)
	}
}
