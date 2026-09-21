//go:build windows

package main

import (
	"os"

	"golang.org/x/sys/windows"
)

var procAttachConsole = kernel32.NewProc("AttachConsole")

// attachConsole lets a command typed in a terminal print there. Release builds are windowed
// programs (-H windowsgui), so the service, tray and settings window never open a console,
// and Windows gives them none. Output already redirected, as the installer does, has its
// handles and is left alone.
func attachConsole() {
	if h, err := windows.GetStdHandle(windows.STD_OUTPUT_HANDLE); err == nil && h != 0 && h != windows.InvalidHandle {
		return
	}
	if r, _, _ := procAttachConsole.Call(^uintptr(0)); r == 0 { // ATTACH_PARENT_PROCESS
		return
	}
	if f, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
		os.Stdout, os.Stderr = f, f
	}
}
