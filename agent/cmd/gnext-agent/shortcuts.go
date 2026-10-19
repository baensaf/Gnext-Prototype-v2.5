package main

import (
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
)

// Shortcut names over the agent's versions. Only "Gnext" is current (2.5.1): it opens the app.
const (
	shortcutApp      = "Gnext.lnk"
	shortcutSettings = "Gnext Agent.lnk"
)

// staleShortcuts point at what agents 1.x had: the offline till and the POS it became (§19.2).
var staleShortcuts = []string{"Gnext Offline Till.lnk", "Gnext POS.lnk"}

// tidyShortcuts leaves one Gnext shortcut in each folder. An update replaces only the binary,
// so a PC first installed with an older agent keeps that installer's shortcuts: the offline
// till's, which does nothing now, and "Gnext Agent", which opened the agent's own page. Since
// 2.5.1 "Gnext Agent" opens the app once the PC is enrolled, so it is renamed "Gnext" when there
// is none, and removed when there is one. Errors are logged and left: a shortcut is not worth
// failing a start for.
func tidyShortcuts(dirs []string, log *slog.Logger) {
	for _, dir := range dirs {
		for _, name := range staleShortcuts {
			remove(filepath.Join(dir, name), log)
		}
		settings := filepath.Join(dir, shortcutSettings)
		if _, err := os.Stat(settings); err != nil {
			continue
		}
		app := filepath.Join(dir, shortcutApp)
		if _, err := os.Stat(app); errors.Is(err, fs.ErrNotExist) {
			if err := os.Rename(settings, app); err != nil {
				log.Warn("could not rename a shortcut", "from", settings, "err", err)
			} else {
				log.Info("renamed the agent's shortcut to Gnext, which it now opens", "dir", dir)
			}
			continue
		}
		remove(settings, log)
	}
}

func remove(path string, log *slog.Logger) {
	if err := os.Remove(path); err == nil {
		log.Info("removed an old shortcut", "path", path)
	} else if !errors.Is(err, fs.ErrNotExist) {
		log.Warn("could not remove an old shortcut", "path", path, "err", err)
	}
}

// shortcutDirs are where the installer puts shortcuts for everyone: the Start menu's programs
// and the public desktop. The service runs as SYSTEM, which may write to both.
func shortcutDirs() []string {
	var dirs []string
	if pd := os.Getenv("ProgramData"); pd != "" {
		dirs = append(dirs, filepath.Join(pd, "Microsoft", "Windows", "Start Menu", "Programs"))
	}
	if pub := os.Getenv("PUBLIC"); pub != "" {
		dirs = append(dirs, filepath.Join(pub, "Desktop"))
	}
	return dirs
}
