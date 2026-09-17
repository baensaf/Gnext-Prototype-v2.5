//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"time"

	"gnext/agent/internal/store"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

// serviceCommand handles `gnext-agent service install|uninstall|start|stop`. The installer
// calls these; they need an elevated process.
func serviceCommand(args []string) int {
	if len(args) != 1 {
		fmt.Fprintln(os.Stderr, "usage: gnext-agent service install|uninstall|start|stop")
		return 2
	}
	var err error
	switch args[0] {
	case "install":
		err = installService()
	case "uninstall":
		err = uninstallService()
	case "start":
		err = withService(startService)
	case "stop":
		err = withService(stopService)
	default:
		fmt.Fprintln(os.Stderr, "usage: gnext-agent service install|uninstall|start|stop")
		return 2
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "service %s: %v\n", args[0], err)
		return 1
	}
	return 0
}

// installService registers GnextAgent to start automatically and restart after any failure,
// including the exit code 3 an update uses (§3.1, §9.2). Running it again updates the path.
func installService() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if err := secureDataDir(); err != nil {
		return fmt.Errorf("data folder: %w", err)
	}
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()

	s, err := m.OpenService(serviceName)
	if err == nil {
		cfg, err := s.Config()
		if err == nil {
			cfg.BinaryPathName = `"` + exe + `"`
			cfg.StartType = mgr.StartAutomatic
			err = s.UpdateConfig(cfg)
		}
		if err != nil {
			s.Close()
			return err
		}
	} else {
		s, err = m.CreateService(serviceName, exe, mgr.Config{
			DisplayName: "Gnext Branch Agent",
			Description: "Connects this branch's printers and card terminals to Gnext.",
			StartType:   mgr.StartAutomatic,
		})
		if err != nil {
			return err
		}
	}
	defer s.Close()
	restart := mgr.RecoveryAction{Type: mgr.ServiceRestart, Delay: 10 * time.Second}
	if err := s.SetRecoveryActions([]mgr.RecoveryAction{restart, restart, restart}, 86400); err != nil {
		return err
	}
	return s.SetRecoveryActionsOnNonCrashFailures(true)
}

func uninstallService() error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(serviceName)
	if err != nil {
		return nil // not installed
	}
	defer s.Close()
	if err := stopService(s); err != nil {
		return err
	}
	return s.Delete()
}

func withService(fn func(*mgr.Service) error) error {
	m, err := mgr.Connect()
	if err != nil {
		return err
	}
	defer m.Disconnect()
	s, err := m.OpenService(serviceName)
	if err != nil {
		return fmt.Errorf("%s is not installed", serviceName)
	}
	defer s.Close()
	return fn(s)
}

func startService(s *mgr.Service) error {
	if st, err := s.Query(); err == nil && (st.State == svc.Running || st.State == svc.StartPending) {
		return nil
	}
	if err := s.Start(); err != nil && !errors.Is(err, windows.ERROR_SERVICE_ALREADY_RUNNING) {
		return err
	}
	return nil
}

func stopService(s *mgr.Service) error {
	st, err := s.Query()
	if err != nil || st.State == svc.Stopped {
		return err
	}
	if st.State != svc.StopPending {
		if _, err := s.Control(svc.Stop); err != nil && !errors.Is(err, windows.ERROR_SERVICE_NOT_ACTIVE) {
			return err
		}
	}
	for deadline := time.Now().Add(30 * time.Second); time.Now().Before(deadline); time.Sleep(300 * time.Millisecond) {
		if st, err := s.Query(); err == nil && st.State == svc.Stopped {
			return nil
		}
	}
	return errors.New("timed out waiting for the service to stop")
}

// restartServiceIfInstalled restarts GnextAgent after a fresh enrolment.
func restartServiceIfInstalled() (bool, error) {
	m, err := mgr.Connect()
	if err != nil {
		return false, nil // not an administrator, or no service manager access
	}
	defer m.Disconnect()
	s, err := m.OpenService(serviceName)
	if err != nil {
		return false, nil
	}
	defer s.Close()
	if err := stopService(s); err != nil {
		return false, err
	}
	return true, startService(s)
}

// secureDataDir creates %ProgramData%\Gnext\Agent readable only by SYSTEM and Administrators:
// identity.json holds the device key.
func secureDataDir() error {
	dir := store.Home()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	out, err := exec.Command("icacls", dir, "/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F").CombinedOutput()
	if err != nil {
		return fmt.Errorf("icacls: %v: %s", err, out)
	}
	return nil
}
