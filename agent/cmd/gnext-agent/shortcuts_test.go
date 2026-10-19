package main

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
)

func touch(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("lnk"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// A PC installed with agent 1.x keeps its shortcuts through updates; 2.5.1 leaves one "Gnext".
func TestTidyShortcutsLeavesOneGnext(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	old := t.TempDir() // a 1.x install: the settings shortcut and the offline till's
	touch(t, filepath.Join(old, "Gnext Agent.lnk"))
	touch(t, filepath.Join(old, "Gnext Offline Till.lnk"))
	both := t.TempDir() // a 2.x install: the app's shortcut and the settings one
	touch(t, filepath.Join(both, "Gnext.lnk"))
	touch(t, filepath.Join(both, "Gnext Agent.lnk"))
	touch(t, filepath.Join(both, "Gnext POS.lnk"))

	tidyShortcuts([]string{old, both, filepath.Join(old, "missing")}, log)

	for _, dir := range []string{old, both} {
		entries, _ := os.ReadDir(dir)
		if len(entries) != 1 || !exists(filepath.Join(dir, "Gnext.lnk")) {
			t.Errorf("%s holds %d files, want only Gnext.lnk", dir, len(entries))
		}
	}
}
