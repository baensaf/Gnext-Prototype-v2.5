package update

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"gnext/agent/internal/cloud"
)

const (
	bridgeExe = "gnext-saman-bridge.exe"
	// BridgeMarker, inside the bridge folder, holds the SHA-256 of the zip it was unpacked from.
	// The installer deletes it, so a PC set up by hand takes the published bridge once.
	BridgeMarker = "release.sha256"
	// The bridge and Saman's SDK are a few hundred kilobytes; anything near this is a mistake.
	maxBridgeBytes = 64 << 20
)

// syncBridge replaces the bridge folder with the one published with the running version (§9.3),
// unless it already holds it. The download and unpacking happen while charges still run; only
// the swap waits for them.
func (u *Updater) syncBridge(ctx context.Context, rel *cloud.Release) error {
	b := rel.Bridge
	held, _ := os.ReadFile(filepath.Join(u.BridgeDir, BridgeMarker))
	if strings.EqualFold(strings.TrimSpace(string(held)), b.SHA256) {
		return nil
	}
	u.Log.Info("Saman bridge update available", "version", rel.Version)

	zipPath, err := u.download(ctx, b.URL, "gnext-saman-bridge-"+rel.Version+".zip", b.Size, b.SHA256)
	if err != nil {
		return err
	}
	defer os.Remove(zipPath)
	staged := u.BridgeDir + ".new"
	_ = os.RemoveAll(staged)
	if err := unpackBridge(zipPath, staged, b.SHA256); err != nil {
		_ = os.RemoveAll(staged)
		return fmt.Errorf("unpack Saman bridge %s: %w", rel.Version, err)
	}

	if err := u.quiesce(ctx); err != nil {
		_ = os.RemoveAll(staged)
		return err
	}
	defer u.End()
	unlock := func() {}
	if u.LockBridge != nil {
		unlock = u.LockBridge()
	}
	old, err := swapDir(staged, u.BridgeDir)
	unlock()
	if err != nil {
		_ = os.RemoveAll(staged)
		return fmt.Errorf("install Saman bridge %s: %w", rel.Version, err)
	}
	if old != "" {
		_ = os.RemoveAll(old)
	}
	u.Log.Info("Saman bridge updated", "version", rel.Version)
	return nil
}

// unpackBridge unpacks the zip into dst, which must not exist, and marks it with sha. Every
// entry must stay inside dst, and the bridge must be there.
func unpackBridge(src, dst, sha string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	budget := int64(maxBridgeBytes)
	for _, f := range r.File {
		// Windows PowerShell writes backslashes into entry names.
		name := strings.TrimSuffix(strings.ReplaceAll(f.Name, `\`, "/"), "/")
		rel := filepath.FromSlash(name)
		if name == "" || !filepath.IsLocal(rel) {
			return fmt.Errorf("entry %q leaves the bridge folder", f.Name)
		}
		target := filepath.Join(dst, rel)
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}
		if !f.Mode().IsRegular() {
			return fmt.Errorf("entry %q is not a plain file", f.Name)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		n, err := unpackFile(f, target, budget)
		if err != nil {
			return err
		}
		budget -= n
	}
	if _, err := os.Stat(filepath.Join(dst, bridgeExe)); err != nil {
		return fmt.Errorf("no %s in it", bridgeExe)
	}
	return os.WriteFile(filepath.Join(dst, BridgeMarker), []byte(strings.ToLower(sha)+"\n"), 0o644)
}

func unpackFile(f *zip.File, target string, budget int64) (int64, error) {
	in, err := f.Open()
	if err != nil {
		return 0, err
	}
	defer in.Close()
	out, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o755)
	if err != nil {
		return 0, err
	}
	n, err := io.Copy(out, io.LimitReader(in, budget+1))
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err == nil && n > budget {
		err = errors.New("the bridge is too large")
	}
	return n, err
}

// swapDir puts staged in the place of dir and returns where the old folder went ("" when there
// was none). When the second rename fails, the old folder goes back.
func swapDir(staged, dir string) (string, error) {
	old := ""
	if _, err := os.Stat(dir); err == nil {
		if old, err = setAsideDir(dir); err != nil {
			return "", err
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return "", err
	}
	if err := os.Rename(staged, dir); err != nil {
		if old != "" {
			_ = os.Rename(old, dir)
		}
		return "", err
	}
	return old, nil
}

// setAsideDir renames dir to dir.old, or dir.old-2 and on when a folder left there by an
// earlier update cannot be removed.
func setAsideDir(dir string) (string, error) {
	var err error
	for i := 1; i <= 20; i++ {
		old := dir + ".old"
		if i > 1 {
			old = fmt.Sprintf("%s.old-%d", dir, i)
		}
		_ = os.RemoveAll(old)
		if err = os.Rename(dir, old); err == nil {
			return old, nil
		}
		if _, statErr := os.Stat(old); statErr != nil {
			return "", err // the name was free, so dir itself cannot move
		}
	}
	return "", err
}
