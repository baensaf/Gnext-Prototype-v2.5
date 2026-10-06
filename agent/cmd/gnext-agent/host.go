package main

import (
	"context"
	"errors"
	"log/slog"
	"math/rand/v2"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"gnext/agent/internal/agent"
	"gnext/agent/internal/appcache"
	"gnext/agent/internal/cloud"
	"gnext/agent/internal/journal"
	"gnext/agent/internal/localui"
	"gnext/agent/internal/payment"
	"gnext/agent/internal/printing"
	"gnext/agent/internal/protocol"
	"gnext/agent/internal/store"
	"gnext/agent/internal/update"
)

// host runs the agent for the current identity and restarts it when the settings page enrols
// the PC again. It outlives any one agent, so the page stays up while the agent is not enrolled,
// revoked, or restarting.
type host struct {
	log      *slog.Logger
	journal  *journal.Journal
	renderer *printing.BrowserRenderer
	restart  chan struct{}
	app      *appcache.Cache
	// lanURLs lists the addresses of the app for other registers (§19.12); set before the agent starts.
	lanURLs func() []string

	mu       sync.Mutex
	server    string
	appOrigin string // where the frontend build comes from: app_url, else server (§19.7)
	id        *store.Identity
	agent     *agent.Agent
	client    *cloud.Client
	stopped   string
}

func newHost(log *slog.Logger) (*host, error) {
	j, err := journal.Open(store.JournalPath())
	if err != nil {
		return nil, err
	}
	h := &host{
		log:      log,
		journal:  j,
		renderer: &printing.BrowserRenderer{ProfileDir: store.BrowserDir()},
		restart:  make(chan struct{}, 1),
	}
	// Known before the first check of the frontend build, which starts with the process.
	cfg, _ := store.LoadInstallConfig() // empty until the PC is configured
	h.server, h.appOrigin = cfg.Server, cfg.AppOrigin()
	h.app = &appcache.Cache{
		Dir:       store.AppDir(),
		Origin:    h.frontendOrigin,
		Log:       log,
		UserAgent: "gnext-agent/" + version + " (windows)",
	}
	return h, nil
}

// frontendOrigin is where the frontend build comes from (§19.7).
func (h *host) frontendOrigin() string {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.appOrigin
}

func (h *host) close() {
	h.renderer.Close()
	h.journal.Close()
}

// State implements localui.Host.
func (h *host) State() localui.State {
	h.mu.Lock()
	defer h.mu.Unlock()
	st := localui.State{Server: h.server, AppOrigin: h.appOrigin, Agent: h.agent, Cloud: h.client, Stopped: h.stopped}
	if h.id != nil {
		st.Enrolled, st.AgentID, st.BranchName = true, h.id.AgentID, h.id.BranchName
	}
	return st
}

// AppAtSignIn implements localui.Host: config.json says whether the app opens at Windows sign-in.
func (h *host) AppAtSignIn() bool {
	c, _ := store.LoadInstallConfig()
	return c.OpenAppAtSignIn()
}

// SetAppAtSignIn implements localui.Host.
func (h *host) SetAppAtSignIn(on bool) error { return store.SetAppAtSignIn(on) }

// appReport is what each heartbeat says about the app (§19.12).
func (h *host) appReport() (string, []string) {
	build := ""
	if b := h.app.Current(); b != nil {
		build = b.BuildID
	}
	var urls []string
	if h.lanURLs != nil {
		urls = h.lanURLs()
	}
	return build, urls
}

// Enrol implements localui.Host.
func (h *host) Enrol(ctx context.Context, server, code string) error {
	if _, err := enrolWith(ctx, server, code); err != nil {
		return err
	}
	select {
	case h.restart <- struct{}{}:
	default:
	}
	return nil
}

// supervise runs agents until ctx ends or an update needs the process restarted.
func (h *host) supervise(ctx context.Context) int {
	for ctx.Err() == nil {
		code, err := h.runOnce(ctx)
		if code != 0 {
			return code
		}
		switch {
		case ctx.Err() != nil:
		case errors.Is(err, errRestart):
			h.log.Info("restarting the agent with the new enrolment")
		case errors.Is(err, errNotEnrolled):
			h.log.Warn("not enrolled; waiting for an enrolment code on the settings page", "url", "http://"+uiAddr()+"/agent/")
			waitOrSignal(ctx, h.restart)
		case errors.Is(err, agent.ErrStopped):
			h.setStopped("کلید این عامل در سرور لغو شده است؛ با کد جدید دوباره ثبت کنید.")
			waitOrSignal(ctx, h.restart)
		case err != nil:
			h.log.Error("agent stopped; retrying in 10 s", "err", err)
			h.setStopped(err.Error())
			select {
			case <-ctx.Done():
			case <-h.restart:
			case <-time.After(10 * time.Second):
			}
		}
	}
	return 0
}

var errRestart = errors.New("restart requested")

// runOnce loads the identity and runs one agent on it. It returns a non-zero exit code only
// when an update was installed.
func (h *host) runOnce(ctx context.Context) (int, error) {
	cfg, cfgErr := store.LoadInstallConfig()
	id, idErr := store.LoadIdentity()
	h.mu.Lock()
	h.server, h.appOrigin, h.agent, h.client, h.id, h.stopped = cfg.Server, cfg.AppOrigin(), nil, nil, nil, ""
	h.mu.Unlock()
	if cfgErr != nil || idErr != nil {
		if !errors.Is(idErr, store.ErrNotEnrolled) && idErr != nil {
			h.log.Error("identity", "err", idErr)
		}
		return 0, errNotEnrolled
	}

	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	var exitCode atomic.Int32
	client := &cloud.Client{Server: cfg.Server, Key: id.DeviceKey, Version: version}
	a := agent.New(agent.Options{
		Version:       version,
		WSURL:         id.WSURL,
		Headers:       client.Headers(),
		Journal:       h.journal,
		Printer:       &printing.Printer{Renderer: h.renderer},
		Log:           h.log,
		Welcomed:      func() { update.Cleanup(""); h.app.Kick() },
		AppReport:     h.appReport,
		SavedConfig:   loadDevices(h.log),
		ConfigChanged: func(c *protocol.Config) { saveDevices(c, h.log) },
	})
	up := &update.Updater{
		Client: client, Version: version, Dir: store.UpdatesDir(), Log: h.log,
		Begin: func() { a.Updating(true) },
		End:   func() { a.Updating(false) },
		Idle:  a.Idle,
		Restart: func() {
			a.Close()
			exitCode.Store(exitRestart)
			cancel()
		},
		BridgeDir:  payment.BridgeDir(),
		LockBridge: payment.LockBridge,
	}
	h.mu.Lock()
	h.id, h.agent, h.client = &id, a, client
	h.mu.Unlock()
	go updateLoop(runCtx, a, up, h.log)

	done := make(chan error, 1)
	go func() { done <- a.Run(runCtx) }()
	var err error
	select {
	case err = <-done:
	case <-h.restart:
		a.Close()
		cancel()
		<-done
		err = errRestart
	}
	a.Close()
	if c := exitCode.Load(); c != 0 {
		return int(c), nil
	}
	if errors.Is(err, context.Canceled) {
		err = nil
	}
	return 0, err
}

func (h *host) setStopped(reason string) {
	h.mu.Lock()
	h.stopped = reason
	h.mu.Unlock()
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

// loadDevices returns the config the cloud last sent, kept for an agent that starts offline
// (devices.json), or nil when there is none.
func loadDevices(log *slog.Logger) *protocol.Config {
	var c protocol.Config
	if err := store.LoadJSON(store.DevicesPath(), &c); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Warn("saved device config unreadable; waiting for the cloud's", "err", err)
		}
		return nil
	}
	return &c
}

func saveDevices(c *protocol.Config, log *slog.Logger) {
	if err := store.SaveJSON(store.DevicesPath(), c); err != nil {
		log.Warn("could not keep the device config on disk", "err", err)
	}
}
