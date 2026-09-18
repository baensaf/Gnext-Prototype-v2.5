// Package update checks for, downloads, verifies and installs new agent builds (§9).
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
}

// Check installs a newer release if one is published. It returns only on failure or when there
// is nothing to do; on success Restart does not return.
func (u *Updater) Check(ctx context.Context) error {
	rel, err := u.Client.LatestRelease(ctx)
	if err != nil {
		return fmt.Errorf("release check: %w", err)
	}
	if rel == nil || !Newer(rel.Version, u.Version) {
		return nil
	}
	u.Log.Info("update available", "from", u.Version, "to", rel.Version)

	u.Begin()
	installed := false
	defer func() {
		if !installed {
			u.End()
		}
	}()
	for !u.Idle() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}

	path, err := u.download(ctx, rel)
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
	old := OldPath(exe)
	_ = os.Remove(old)
	if err := os.Rename(exe, old); err != nil {
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

func (u *Updater) download(ctx context.Context, rel *cloud.Release) (string, error) {
	if err := os.MkdirAll(u.Dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(u.Dir, "gnext-agent-"+rel.Version+".exe")
	f, err := os.Create(path)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	err = u.Client.Download(ctx, rel.URL, io.MultiWriter(f, h))
	size, _ := f.Seek(0, io.SeekCurrent)
	f.Close()
	if err == nil && rel.Size > 0 && size != rel.Size {
		err = fmt.Errorf("size %d, expected %d", size, rel.Size)
	}
	if err == nil && !strings.EqualFold(hex.EncodeToString(h.Sum(nil)), rel.SHA256) {
		err = fmt.Errorf("sha256 mismatch")
	}
	if err != nil {
		os.Remove(path)
		return "", fmt.Errorf("download %s: %w", rel.Version, err)
	}
	return path, nil
}

// OldPath is where the previous binary is kept until the new one gets a welcome.
func OldPath(exe string) string {
	return strings.TrimSuffix(exe, filepath.Ext(exe)) + ".old" + filepath.Ext(exe)
}

// Cleanup deletes the previous binary once the new one is known to work.
func Cleanup(exe string) {
	if exe == "" {
		exe, _ = os.Executable()
	}
	if exe != "" {
		_ = os.Remove(OldPath(exe))
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
