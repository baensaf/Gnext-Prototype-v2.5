//go:build windows

package main

import (
	"context"
	"os"
	"os/exec"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
)

const serviceName = "GnextAgent"

// wtsSessionLogon is the session-change event for a user signing in (WTS_SESSION_LOGON).
const wtsSessionLogon = 5

func isService() bool {
	ok, err := svc.IsWindowsService()
	return err == nil && ok
}

type handler struct{}

func (handler) Execute(_ []string, req <-chan svc.ChangeRequest, status chan<- svc.Status) (bool, uint32) {
	status <- svc.Status{State: svc.StartPending}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan int, 1)
	go func() { done <- run(ctx, nil) }()
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown | svc.AcceptSessionChange}

	for {
		select {
		case code := <-done:
			if code == exitRestart {
				// Exit without reporting STOPPED: the service manager counts it as a failure
				// and its recovery action starts the new binary (§9.2).
				os.Exit(exitRestart)
			}
			return false, uint32(code)
		case c := <-req:
			switch c.Cmd {
			case svc.Interrogate:
				status <- c.CurrentStatus
			case svc.SessionChange:
				if c.EventType == wtsSessionLogon && c.EventData != 0 {
					n := *(**windows.WTSSESSION_NOTIFICATION)(unsafe.Pointer(&c.EventData))
					select {
					case trayLogons <- n.SessionID:
					default:
					}
				}
			case svc.Stop, svc.Shutdown:
				status <- svc.Status{State: svc.StopPending}
				cancel()
				select {
				case <-done:
				case <-time.After(20 * time.Second):
				}
				return false, 0
			}
		}
	}
}

func runService() {
	repairBinaryPermissions()
	_ = svc.Run(serviceName, handler{})
}

// repairBinaryPermissions gives the running exe its folder's permissions again. Agents up to
// 1.0.4 installed an update by renaming it out of the data folder, which kept that folder's
// SYSTEM-and-Administrators-only permissions, so users could no longer start `gnext-agent open`.
// The service runs as SYSTEM and may fix that; any failure leaves things as they were.
func repairBinaryPermissions() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	cmd := exec.Command("icacls", exe, "/reset")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = cmd.Run()
}
