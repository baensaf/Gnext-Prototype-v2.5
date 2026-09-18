//go:build windows

package update

import (
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"testing"
)

// acl returns icacls' listing of path without the path itself, so two files can be compared.
func acl(t *testing.T, path string) string {
	t.Helper()
	out, err := exec.Command("icacls", path).CombinedOutput()
	if err != nil {
		t.Fatalf("icacls %s: %v: %s", path, err, out)
	}
	var lines []string
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), path))
		if line != "" && !strings.HasPrefix(line, "Successfully processed") {
			lines = append(lines, line)
		}
	}
	return strings.Join(lines, "\n")
}

// A download in a locked-down folder must not bring that folder's permissions to the install
// folder: the staged binary gets the same permissions as any new file there.
func TestStageBesideTakesTheInstallFolderPermissions(t *testing.T) {
	root := t.TempDir()
	data := filepath.Join(root, "data")
	install := filepath.Join(root, "install")
	for _, dir := range []string{data, install} {
		if err := os.Mkdir(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	me, err := user.Current()
	if err != nil {
		t.Fatal(err)
	}
	// Only this user, nothing inherited: stands in for the SYSTEM-and-Administrators data folder.
	if out, err := exec.Command("icacls", data, "/inheritance:r", "/grant:r", me.Username+":(OI)(CI)F").CombinedOutput(); err != nil {
		t.Fatalf("lock data folder: %v: %s", err, out)
	}

	download := filepath.Join(data, "gnext-agent-9.9.9.exe")
	if err := os.WriteFile(download, []byte("MZ new build"), 0o644); err != nil {
		t.Fatal(err)
	}
	control := filepath.Join(install, "control.exe")
	if err := os.WriteFile(control, []byte("MZ"), 0o644); err != nil {
		t.Fatal(err)
	}
	if acl(t, download) == acl(t, control) {
		t.Fatal("test setup: the data folder's permissions should differ from the install folder's")
	}

	exe := filepath.Join(install, "gnext-agent.exe")
	staged, err := stageBeside(download, exe)
	if err != nil {
		t.Fatal(err)
	}
	if staged != exe+".new" {
		t.Fatalf("staged at %s", staged)
	}
	if got, want := acl(t, staged), acl(t, control); got != want {
		t.Fatalf("staged binary has\n%s\nwant the install folder's\n%s", got, want)
	}
	if b, _ := os.ReadFile(staged); string(b) != "MZ new build" {
		t.Fatalf("staged content %q", b)
	}
	if _, err := os.Stat(download); !os.IsNotExist(err) {
		t.Fatalf("download should be gone, stat err = %v", err)
	}

	// The rename that puts it in place keeps those permissions.
	if err := os.Rename(staged, exe); err != nil {
		t.Fatal(err)
	}
	if got, want := acl(t, exe), acl(t, control); got != want {
		t.Fatalf("installed binary has\n%s\nwant\n%s", got, want)
	}
}
