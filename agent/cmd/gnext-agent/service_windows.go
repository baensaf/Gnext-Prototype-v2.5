//go:build windows

package main

import (
	"context"
	"log/slog"
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

// legacyFirewallRule is the inbound rule agents 1.x and the old installer added so that paired
// devices on the LAN reached Gnext POS on TCP 47801. Agent 2.0.0 has no till and listens on no
// such port, so it deletes the rule (§19.2). The next version brings its own rule back.
const legacyFirewallRule = "Gnext POS"

// removeLegacyFirewallRule deletes the old Gnext POS rule when it is there, at service start. The
// service runs as SYSTEM, so an agent that updated itself needs no installer run. Any failure is
// only logged: a rule for a port nothing listens on does no harm.
func removeLegacyFirewallRule(log *slog.Logger) {
	show := exec.Command("netsh", "advfirewall", "firewall", "show", "rule", "name="+legacyFirewallRule)
	show.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if show.Run() != nil {
		return // no such rule (netsh exits non-zero then)
	}
	del := exec.Command("netsh", "advfirewall", "firewall", "delete", "rule", "name="+legacyFirewallRule)
	del.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if out, err := del.CombinedOutput(); err != nil {
		log.Warn("the old Gnext POS firewall rule was not removed", "err", err, "out", string(out))
		return
	}
	log.Info("removed the old Gnext POS firewall rule (agent 2.0.0 has no till)")
}
