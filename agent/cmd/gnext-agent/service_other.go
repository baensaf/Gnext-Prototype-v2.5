//go:build !windows

package main

import (
	"context"
	"log/slog"
	"os/exec"
)

func isService() bool { return false }

func runService() {}

func restartServiceIfInstalled() (bool, error) { return false, nil }

func killChildrenOnExit() {}

func serviceCommand([]string) int { println("service commands are Windows only"); return 2 }

func openBrowser(url string) error { return exec.Command("xdg-open", url).Start() }

func runTray() int { println("the tray is Windows only"); return 2 }

func launchTrays(context.Context, *slog.Logger, func() bool) {}

func attachConsole() {}

func runWindow() int {
	if err := openBrowser("http://" + uiAddr()); err != nil {
		return 1
	}
	return 0
}

func runTillWindow() int {
	if err := openBrowser("http://" + uiAddr() + tillPath); err != nil {
		return 1
	}
	return 0
}
