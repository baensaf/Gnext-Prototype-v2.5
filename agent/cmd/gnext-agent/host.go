package main

import (
	"context"
	"errors"
	"log/slog"
	"math/rand/v2"
	"sync"
	"sync/atomic"
	"time"

	"gnext/agent/internal/agent"
	"gnext/agent/internal/branchdata"
	"gnext/agent/internal/cloud"
	"gnext/agent/internal/journal"
	"gnext/agent/internal/localui"
	"gnext/agent/internal/printing"
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

	mu      sync.Mutex
	server  string
	id      *store.Identity
	agent   *agent.Agent
	client  *cloud.Client
	stopped string
}

func newHost(log *slog.Logger) (*host, error) {
	j, err := journal.Open(store.JournalPath())
	if err != nil {
		return nil, err
	}
	return &host{
		log:      log,
		journal:  j,
		renderer: &printing.BrowserRenderer{ProfileDir: store.BrowserDir()},
		restart:  make(chan struct{}, 1),
	}, nil
}

func (h *host) close() {
	h.renderer.Close()
	h.journal.Close()
}

// State implements localui.Host.
func (h *host) State() localui.State {
	h.mu.Lock()
	defer h.mu.Unlock()
	st := localui.State{Server: h.server, Agent: h.agent, Cloud: h.client, Stopped: h.stopped}
	if h.id != nil {
		st.Enrolled, st.AgentID, st.BranchName = true, h.id.AgentID, h.id.BranchName
	}
	return st
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
			h.log.Warn("not enrolled; waiting for an enrolment code on the settings page", "url", "http://"+uiAddr())
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
	h.server, h.agent, h.client, h.id, h.stopped = cfg.Server, nil, nil, nil, ""
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
	// The branch snapshot is pulled after every welcome, where a 304 costs nothing, and on data.changed (§12.2).
	data := &branchdata.Keeper{Dir: store.BranchDataDir(), Fetch: client, NotModified: cloud.ErrNotModified, Log: h.log}
	a := agent.New(agent.Options{
		Version:     version,
		WSURL:       id.WSURL,
		Headers:     client.Headers(),
		Journal:     h.journal,
		Printer:     &printing.Printer{Renderer: h.renderer},
		Log:         h.log,
		Welcomed:    func() { update.Cleanup(""); data.Trigger() },
		DataChanged: data.Trigger,
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
	}
	h.mu.Lock()
	h.id, h.agent, h.client = &id, a, client
	h.mu.Unlock()
	go updateLoop(runCtx, a, up, h.log)
	go data.Run(runCtx)

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
