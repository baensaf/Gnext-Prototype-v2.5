//go:build windows

package main

import (
	"context"
	"os"
	"time"

	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const serviceName = "GnextAgent"

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
	status <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}

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
	_ = svc.Run(serviceName, handler{})
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
	if st, err := s.Query(); err == nil && st.State != svc.Stopped {
		if _, err := s.Control(svc.Stop); err != nil {
			return false, err
		}
		for i := 0; i < 60; i++ {
			if st, err := s.Query(); err == nil && st.State == svc.Stopped {
				break
			}
			time.Sleep(500 * time.Millisecond)
		}
	}
	return true, s.Start()
}
