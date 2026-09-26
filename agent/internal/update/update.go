// Package update checks for, downloads, verifies and installs new agent builds and the Saman
// bridge published with them (§9).
package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gnext/agent/internal/cloud"
)

type Updater struct {
	Client  *cloud.Client
	Version string
	Dir     string // where downloads land
	Exe     string // the running binary; empty = os.Executable()
	Log     *slog.Logger

	// Begin is called before waiting for running work: the agent stops taking charges.
	// Idle reports whether no command is running. End undoes Begin when the update is abandoned.
	Begin func()
	Idle  func() bool
	End   func()
	// Restart closes the socket and exits with code 3 so the service restarts on the new binary.
	Restart func()

	// BridgeDir is the Saman bridge folder this updater keeps at the release's bridge (§9.3);
	// empty leaves it alone. LockBridge, when set, holds off bridge runs while the folder is
	// swapped and returns the unlock.
	BridgeDir  string
	LockBridge func() (unlock func())
}

// Check installs a newer release if one is published, or else brings the Saman bridge up to the
// one published with the running version. It returns only on failure or when there is nothing
// to do; after a new binary is installed Restart does not return.
func (u *Updater) Check(ctx context.Context) error {
	rel, err := u.Client.LatestRelease(ctx)
	if err != nil {
		return fmt.Errorf("release check: %w", err)
	}
	switch {
	case rel == nil:
		return nil
	case Newer(rel.Version, u.Version):
		// The new binary brings its bridge in on its own first check.
		return u.install(ctx, rel)
	case Compare(rel.Version, u.Version) == 0 && rel.Bridge != nil && u.BridgeDir != "":
		return u.syncBridge(ctx, rel)
	}
	return nil
}

// quiesce stops new charges and waits until no command runs. The caller must call u.End unless
// the agent is about to restart.
func (u *Updater) quiesce(ctx context.Context) error {
	u.Begin()
	for !u.Idle() {
		select {
		case <-ctx.Done():
			u.End()
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return nil
}

func (u *Updater) install(ctx context.Context, rel *cloud.Release) error {
	u.Log.Info("update available", "from", u.Version, "to", rel.Version)
	if err := u.quiesce(ctx); err != nil {
		return err
	}
	installed := false
	defer func() {
		if !installed {
			u.End()
		}
	}()

	path, err := u.download(ctx, rel.URL, "gnext-agent-"+rel.Version+".exe", rel.Size, rel.SHA256)
	if err != nil {
		return err
	}
	exe := u.Exe
	if exe == "" {
		if exe, err = os.Executable(); err != nil {
			return err
		}
	}
	staged, err := stageBeside(path, exe)
	if err != nil {
		return fmt.Errorf("stage new binary: %w", err)
	}
	old, err := setAside(exe, u.Version)
	if err != nil {
		_ = os.Remove(staged)
		return fmt.Errorf("move running binary aside: %w", err)
	}
	if err := os.Rename(staged, exe); err != nil {
		_ = os.Remove(staged)
		_ = os.Rename(old, exe)
		return fmt.Errorf("install new binary: %w", err)
	}
	installed = true
	u.Log.Info("update installed; restarting", "version", rel.Version)
	u.Restart()
	return nil
}

// download fetches url into the updates folder as name and checks its size and SHA-256. A file
// that fails the check is deleted.
func (u *Updater) download(ctx context.Context, url, name string, wantSize int64, wantSHA string) (string, error) {
	if err := os.MkdirAll(u.Dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(u.Dir, name)
	f, err := os.Create(path)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	err = u.Client.Download(ctx, url, io.MultiWriter(f, h))
	size, _ := f.Seek(0, io.SeekCurrent)
	f.Close()
	if err == nil && wantSize > 0 && size != wantSize {
		err = fmt.Errorf("size %d, expected %d", size, wantSize)
	}
	if err == nil && !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), wantSHA) {
		err = fmt.Errorf("sha256 mismatch")
	}
	if err != nil {
		os.Remove(path)
		return "", fmt.Errorf("download %s: %w", name, err)
	}
	return path, nil
}

// OldPath is where the binary of version is kept once an update replaces it, until the new one
// gets a welcome.
func OldPath(exe, version string) string {
	return strings.TrimSuffix(exe, filepath.Ext(exe)) + ".old-" + version + filepath.Ext(exe)
}

// setAside moves the running binary out of the way of the new one. A binary set aside earlier
// can still be in use: a settings or till window opened before that update runs from it until
// it closes, and Windows neither deletes nor replaces a file a process runs from. Such a file
// gets a numbered neighbour instead of blocking every update after it.
func setAside(exe, version string) (string, error) {
	var err error
	for i := 1; i <= 20; i++ {
		old := OldPath(exe, version)
		if i > 1 {
			old = OldPath(exe, fmt.Sprintf("%s-%d", version, i))
		}
		_ = os.Remove(old)
		if err = os.Rename(exe, old); err == nil {
			return old, nil
		}
	}
	return "", err
}

// Cleanup deletes the binaries earlier updates set aside, once the new one is known to work.
// One still in use stays until a later cleanup finds it free.
func Cleanup(exe string) {
	if exe == "" {
		exe, _ = os.Executable()
	}
	if exe == "" {
		return
	}
	// ".old*" also finds "gnext-agent.old.exe", the name agents before 1.10.2 used.
	stale, _ := filepath.Glob(strings.TrimSuffix(exe, filepath.Ext(exe)) + ".old*" + filepath.Ext(exe))
	for _, f := range stale {
		_ = os.Remove(f)
	}
}

// stageBeside copies the download to "<exe>.new" and removes the download. The copy is a new
// file in the install folder, so on Windows it takes that folder's permissions. Renaming the
// download instead would carry over the data folder's, which only SYSTEM and Administrators may
// read: the service would still run, but the Start-menu shortcut could not.
func stageBeside(from, exe string) (string, error) {
	staged := exe + ".new"
	_ = os.Remove(staged)
	in, err := os.Open(from)
	if err != nil {
		return "", err
	}
	defer in.Close()
	out, err := os.OpenFile(staged, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o755)
	if err != nil {
		return "", err
	}
	_, err = io.Copy(out, in)
	if err == nil {
		err = out.Sync()
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		_ = os.Remove(staged)
		return "", err
	}
	in.Close()
	_ = os.Remove(from)
	return staged, nil
}

// Newer reports whether version a is greater than b (major.minor.patch; a pre-release suffix
// sorts before the release).
func Newer(a, b string) bool { return Compare(a, b) > 0 }

func Compare(a, b string) int {
	pa, preA := parse(a)
	pb, preB := parse(b)
	for i := range 3 {
		if pa[i] != pb[i] {
			if pa[i] > pb[i] {
				return 1
			}
			return -1
		}
	}
	switch {
	case preA == preB:
		return 0
	case preA == "":
		return 1
	case preB == "":
		return -1
	case preA > preB:
		return 1
	}
	return -1
}

func parse(v string) ([3]int, string) {
	v = strings.TrimPrefix(v, "v")
	pre := ""
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		pre, v = v[i+1:], v[:i]
	}
	var out [3]int
	for i, part := range strings.SplitN(v, ".", 3) {
		out[i], _ = strconv.Atoi(part)
	}
	return out, pre
}
