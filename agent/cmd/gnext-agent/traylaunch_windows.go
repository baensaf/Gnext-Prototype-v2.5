//go:build windows

package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"

	"gnext/agent/internal/winsession"
)

// trayLogons carries the sessions users sign in to, from the service control handler.
var trayLogons = make(chan uint32, 8)

// launchTrays starts the tray for everyone signed in now, and for each later sign-in. The
// service does this rather than a Run key, which would open a console window at sign-in, and
// because it also covers agents that updated themselves and never ran a newer installer.
func launchTrays(ctx context.Context, log *slog.Logger) {
	if !isService() {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	start := func(session uint32) {
		if err := winsession.Start(session, []string{exe, "tray"}, filepath.Dir(exe)); err != nil && !errors.Is(err, winsession.ErrNoUser) {
			log.Warn("tray not started", "session", session, "err", err)
		}
	}
	for _, s := range winsession.Active() {
		start(s)
	}
	for {
		select {
		case <-ctx.Done():
			return
		case s := <-trayLogons:
			start(s)
		}
	}
}
