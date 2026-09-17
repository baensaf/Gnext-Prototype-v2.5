//go:build windows

package main

import (
	"context"
	"os"
	"time"

	"golang.org/x/sys/windows/svc"
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
