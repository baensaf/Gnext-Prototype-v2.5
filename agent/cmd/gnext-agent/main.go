// Command gnext-agent is the Gnext branch agent: a Windows service that connects a branch's
// printers and card terminals to the Gnext cloud (docs/agent-gateway/agent-protocol.md).
//
//	gnext-agent.exe enrol --code XXXX-XXXX [--server https://…]
//	gnext-agent.exe run        (console; the service runs the same loop)
//	gnext-agent.exe version
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"os"
	"os/signal"
	"path/filepath"
	"sync/atomic"
	"time"

	"gnext/agent/internal/agent"
	"gnext/agent/internal/cloud"
	"gnext/agent/internal/journal"
	"gnext/agent/internal/printing"
	"gnext/agent/internal/store"
	"gnext/agent/internal/update"

	"gopkg.in/natefinch/lumberjack.v2"
)

// version is set at build time: -ldflags "-X main.version=1.0.3".
var version = "1.0.0"

// exitRestart tells the service manager to start the (new) binary again (§9.2).
const exitRestart = 3

func main() {
	if isService() {
		runService()
		return
	}
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "enrol", "enroll":
		os.Exit(enrol(os.Args[2:]))
	case "service":
		os.Exit(serviceCommand(os.Args[2:]))
	case "run":
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
		defer stop()
		os.Exit(run(ctx, os.Stderr))
	case "version", "--version", "-v":
		fmt.Println(version)
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `gnext-agent %s

  gnext-agent enrol --code XXXX-XXXX [--server https://app.example.ir]
  gnext-agent run
  gnext-agent service install|uninstall|start|stop
  gnext-agent version

Data folder: %s
`, version, store.Home())
}

func enrol(args []string) int {
	fs := flag.NewFlagSet("enrol", flag.ExitOnError)
	code := fs.String("code", "", "enrolment code from head office")
	server := fs.String("server", "", "Gnext server URL; saved to config.json")
	_ = fs.Parse(args)
	if *code == "" {
		fmt.Fprintln(os.Stderr, "enrol: --code is required")
		return 2
	}
	if *server != "" {
		if err := store.SaveInstallConfig(store.InstallConfig{Server: *server}); err != nil {
			fmt.Fprintln(os.Stderr, "enrol:", err)
			return 1
		}
	}
	cfg, err := store.LoadInstallConfig()
	if err != nil {
		fmt.Fprintln(os.Stderr, "enrol: no server configured; pass --server:", err)
		return 1
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	c := &cloud.Client{Server: cfg.Server, Version: version}
	id, err := c.Enrol(ctx, *code, cloud.ThisMachine())
	if err != nil {
		fmt.Fprintln(os.Stderr, "enrol failed:", err)
		return 1
	}
	if err := store.SaveIdentity(id); err != nil {
		fmt.Fprintln(os.Stderr, "enrol: save identity:", err)
		return 1
	}
	c.Key = id.DeviceKey
	if _, err := c.Me(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "enrol: the new key does not work:", err)
		return 1
	}
	fmt.Printf("Enrolled as agent %s for branch %s.\n", id.AgentID, id.BranchName)
	if restarted, err := restartServiceIfInstalled(); err != nil {
		fmt.Fprintln(os.Stderr, "Could not restart the GnextAgent service:", err)
	} else if restarted {
		fmt.Println("Restarted the GnextAgent service.")
	}
	return 0
}

// run is the agent's main loop, shared by the console and the service. It returns an exit code.
func run(ctx context.Context, console io.Writer) int {
	killChildrenOnExit()
	log := newLogger(console)
	log.Info("starting", "version", version, "home", store.Home())

	if err := os.MkdirAll(store.Home(), 0o700); err != nil {
		log.Error("data folder", "err", err)
		return 1
	}
	cfg, err := store.LoadInstallConfig()
	if err != nil {
		log.Error("config.json", "err", err)
		return waitForStop(ctx, 1)
	}
	id, err := store.LoadIdentity()
	if err != nil {
		log.Error("identity", "err", err)
		return waitForStop(ctx, 1)
	}
	j, err := journal.Open(store.JournalPath())
	if err != nil {
		log.Error("journal", "err", err)
		return 1
	}
	defer j.Close()

	renderer := &printing.BrowserRenderer{ProfileDir: store.BrowserDir()}
	defer renderer.Close()
	client := &cloud.Client{Server: cfg.Server, Key: id.DeviceKey, Version: version}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var exitCode atomic.Int32

	a := agent.New(agent.Options{
		Version:  version,
		WSURL:    id.WSURL,
		Headers:  client.Headers(),
		Journal:  j,
		Printer:  &printing.Printer{Renderer: renderer},
		Log:      log,
		Welcomed: func() { update.Cleanup("") },
	})
	up := &update.Updater{
		Client: client, Version: version, Dir: store.UpdatesDir(), Log: log,
		Begin: func() { a.Updating(true) },
		End:   func() { a.Updating(false) },
		Idle:  a.Idle,
		Restart: func() {
			a.Close()
			exitCode.Store(exitRestart)
			cancel()
		},
	}
	go updateLoop(ctx, a, up, log)

	err = a.Run(ctx)
	switch {
	case exitCode.Load() != 0:
		log.Info("exiting for update restart")
		return int(exitCode.Load())
	case errors.Is(err, agent.ErrStopped):
		return waitForStop(ctx, 1)
	case err != nil && ctx.Err() == nil:
		log.Error("agent stopped", "err", err)
		return 1
	}
	a.Close()
	log.Info("stopped")
	return 0
}

// updateLoop checks for a release on start, hourly (±5 min), and whenever the cloud asks (§9.1).
func updateLoop(ctx context.Context, a *agent.Agent, up *update.Updater, log *slog.Logger) {
	next := 10 * time.Second
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(next):
		case <-a.UpdateRequests():
		}
		if err := up.Check(ctx); err != nil && ctx.Err() == nil {
			log.Warn("update check failed", "err", err)
		}
		next = time.Hour + time.Duration(rand.Int64N(int64(10*time.Minute))) - 5*time.Minute
	}
}

// waitForStop keeps the process alive without working, so the service manager does not
// restart it in a loop when the agent needs a technician (not enrolled, key revoked).
func waitForStop(ctx context.Context, code int) int {
	<-ctx.Done()
	return code
}

func newLogger(console io.Writer) *slog.Logger {
	file := &lumberjack.Logger{
		Filename:   filepath.Join(store.LogsDir(), "agent.log"),
		MaxSize:    10, // MB
		MaxBackups: 5,
	}
	var w io.Writer = file
	if console != nil {
		w = io.MultiWriter(file, console)
	}
	return slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{Level: slog.LevelInfo}))
}
