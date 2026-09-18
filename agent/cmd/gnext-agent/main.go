// Command gnext-agent is the Gnext branch agent: a Windows service that connects a branch's
// printers and card terminals to the Gnext cloud (docs/agent-gateway/agent-protocol.md), with a
// settings page on http://127.0.0.1:47800.
//
//	gnext-agent.exe enrol --code XXXX-XXXX [--server https://…]
//	gnext-agent.exe run        (console; the service runs the same loop)
//	gnext-agent.exe open       (opens the settings page)
//	gnext-agent.exe version
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"time"

	"gnext/agent/internal/cloud"
	"gnext/agent/internal/localui"
	"gnext/agent/internal/store"

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
	case "open":
		if err := openBrowser("http://" + uiAddr()); err != nil {
			fmt.Fprintln(os.Stderr, "open:", err)
			os.Exit(1)
		}
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
  gnext-agent open
  gnext-agent service install|uninstall|start|stop
  gnext-agent version

Data folder:   %s
Settings page: http://%s
`, version, store.Home(), uiAddr())
}

// uiAddr is where the settings page listens; GNEXT_AGENT_UI_ADDR overrides it for development.
func uiAddr() string {
	if a := os.Getenv("GNEXT_AGENT_UI_ADDR"); a != "" {
		return a
	}
	return localui.DefaultAddr
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
	if *server == "" {
		cfg, err := store.LoadInstallConfig()
		if err != nil {
			fmt.Fprintln(os.Stderr, "enrol: no server configured; pass --server:", err)
			return 1
		}
		*server = cfg.Server
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	id, err := enrolWith(ctx, *server, *code)
	if err != nil {
		fmt.Fprintln(os.Stderr, "enrol failed:", err)
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

// enrolWith redeems a code and, only once the new key is known to work, saves the server and
// the identity.
func enrolWith(ctx context.Context, server, code string) (store.Identity, error) {
	c := &cloud.Client{Server: server, Version: version}
	id, err := c.Enrol(ctx, code, cloud.ThisMachine())
	if err != nil {
		return id, err
	}
	c.Key = id.DeviceKey
	if _, err := c.Me(ctx); err != nil {
		return id, fmt.Errorf("the new key does not work: %w", err)
	}
	if err := store.SaveInstallConfig(store.InstallConfig{Server: server}); err != nil {
		return id, err
	}
	return id, store.SaveIdentity(id)
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
	release, err := store.Lock()
	if err != nil {
		log.Error("not starting", "home", store.Home(), "err", err)
		return 1
	}
	defer release()

	h, err := newHost(log)
	if err != nil {
		log.Error("start", "err", err)
		return 1
	}
	defer h.close()

	ui := &localui.Server{Host: h, Version: version, LogFile: logFile(), Log: log, Addr: uiAddr()}
	go func() {
		if err := ui.ListenAndServe(ctx); err != nil {
			log.Error("settings page could not start", "addr", uiAddr(), "err", err)
		}
	}()

	code := h.supervise(ctx)
	if code == exitRestart {
		log.Info("exiting for update restart")
	} else {
		log.Info("stopped")
	}
	return code
}

// waitOrSignal blocks until ctx ends or sig fires, and reports whether sig fired.
func waitOrSignal(ctx context.Context, sig <-chan struct{}) bool {
	select {
	case <-ctx.Done():
		return false
	case <-sig:
		return true
	}
}

func logFile() string { return filepath.Join(store.LogsDir(), "agent.log") }

func newLogger(console io.Writer) *slog.Logger {
	file := &lumberjack.Logger{
		Filename:   logFile(),
		MaxSize:    10, // MB
		MaxBackups: 5,
	}
	var w io.Writer = file
	if console != nil {
		w = io.MultiWriter(file, console)
	}
	return slog.New(slog.NewTextHandler(w, &slog.HandlerOptions{Level: slog.LevelInfo}))
}

var errNotEnrolled = errors.New("not enrolled")
