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

// lanFirewallRule is the inbound rule that lets the branch's other registers reach the app on
// TCP 47801 (§19.4). The installer deletes it on uninstall.
const lanFirewallRule = "Gnext"

// legacyFirewallRule is the inbound rule agents 1.x and the old installer added so that paired
// devices on the LAN reached Gnext POS on TCP 47801. Agent 2.0.0 deleted it (§19.2); it stays
// deleted from PCs that skipped that version.
const legacyFirewallRule = "Gnext POS"

// manageFirewallRules runs at service start, one rule after the other: the old Gnext POS rule is
// deleted, and the Gnext rule for the LAN listener is added if it is not there. The service runs as
// SYSTEM, so an agent that updated itself needs no installer run. Any failure is only logged: the
// register on this PC does not need the rule.
func manageFirewallRules(log *slog.Logger) {
	removeFirewallRule(log, legacyFirewallRule, "the old Gnext POS firewall rule")
	ensureLANFirewallRule(log)
}

func netsh(args ...string) ([]byte, error) {
	cmd := exec.Command("netsh", append([]string{"advfirewall", "firewall"}, args...)...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.CombinedOutput()
}

func removeFirewallRule(log *slog.Logger, name, what string) {
	if _, err := netsh("show", "rule", "name="+name); err != nil {
		return // no such rule (netsh exits non-zero then)
	}
	if out, err := netsh("delete", "rule", "name="+name); err != nil {
		log.Warn(what+" was not removed", "err", err, "out", string(out))
		return
	}
	log.Info("removed " + what)
}

// ensureLANFirewallRule adds the Gnext rule: inbound TCP 47801 on the private and domain profiles
// (not the public one: a café's network is not the branch's).
func ensureLANFirewallRule(log *slog.Logger) {
	if _, err := netsh("show", "rule", "name="+lanFirewallRule); err == nil {
		return
	}
	out, err := netsh("add", "rule", "name="+lanFirewallRule, "dir=in", "action=allow", "protocol=TCP",
		"localport=47801", "profile=private,domain")
	if err != nil {
		log.Warn("the firewall rule for the app on the branch network was not added", "err", err, "out", string(out))
		return
	}
	log.Info("added the Gnext firewall rule for the branch network (TCP 47801, private and domain)")
}
