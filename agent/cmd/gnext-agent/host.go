package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"os"
	"sync"
	"sync/atomic"
	"time"

	"gnext/agent/internal/agent"
	"gnext/agent/internal/branchdata"
	"gnext/agent/internal/cloud"
	"gnext/agent/internal/journal"
	"gnext/agent/internal/localui"
	"gnext/agent/internal/offline"
	"gnext/agent/internal/printing"
	"gnext/agent/internal/protocol"
	"gnext/agent/internal/store"
	"gnext/agent/internal/till"
	"gnext/agent/internal/update"
)

// host runs the agent for the current identity and restarts it when the settings page enrols
// the PC again. It outlives any one agent, so the page stays up while the agent is not enrolled,
// revoked, or restarting.
type host struct {
	log      *slog.Logger
	journal  *journal.Journal
	outbox   *offline.Outbox
	orders   *till.Store
	renderer *printing.BrowserRenderer
	restart  chan struct{}

	mu      sync.Mutex
	server  string
	id      *store.Identity
	agent   *agent.Agent
	client  *cloud.Client
	till    *till.Till
	stopped string
	// callNumbers is the last POS call count written to disk.
	callNumbers protocol.CallNumbers
}

func newHost(log *slog.Logger) (*host, error) {
	j, err := journal.Open(store.JournalPath())
	if err != nil {
		return nil, err
	}
	ob, err := offline.Open(store.OfflinePath())
	if err != nil {
		j.Close()
		return nil, err
	}
	ob.Log = log
	orders, err := till.OpenStore(store.TillOrdersPath())
	if err != nil {
		j.Close()
		ob.Close()
		return nil, err
	}
	h := &host{
		log:      log,
		journal:  j,
		outbox:   ob,
		orders:   orders,
		renderer: &printing.BrowserRenderer{ProfileDir: store.BrowserDir()},
		restart:  make(chan struct{}, 1),
	}
	// The last count the cloud gave, for an agent that starts offline (§13.9).
	_ = store.LoadJSON(store.CallNumbersPath(), &h.callNumbers)
	return h, nil
}

func (h *host) close() {
	h.renderer.Close()
	h.journal.Close()
	h.outbox.Close()
	h.orders.Close()
}

// cloudCallCount is the POS call count from the last heartbeat.ack (§13.9).
func (h *host) cloudCallCount() (string, int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.callNumbers.BusinessDate, h.callNumbers.POS
}

// upload hands an ended offline order to the outbox; one it already holds is handed over.
func (h *host) upload(payload json.RawMessage) error {
	if err := h.outbox.Add(payload); err != nil && !errors.Is(err, offline.ErrExists) {
		return err
	}
	return nil
}

// State implements localui.Host.
func (h *host) State() localui.State {
	h.mu.Lock()
	defer h.mu.Unlock()
	st := localui.State{Server: h.server, Agent: h.agent, Cloud: h.client, Till: h.till, Stopped: h.stopped}
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
	h.server, h.agent, h.client, h.till, h.id, h.stopped = cfg.Server, nil, nil, nil, nil, ""
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
	// The branch snapshot and the staff list are pulled after every welcome, where a 304 costs
	// nothing, and on data.changed (§12.2, §13.3).
	staff := &branchdata.Staff{
		Dir: store.BranchDataDir(), Fetch: client.Staff, NotModified: cloud.ErrNotModified,
		Seal: store.Seal, Unseal: store.Unseal, Log: h.log,
	}
	data := &branchdata.Keeper{Dir: store.BranchDataDir(), Fetch: client, NotModified: cloud.ErrNotModified, Log: h.log, Staff: staff}
	var a *agent.Agent
	// The offline till sells from the snapshot and signs in from the staff list (§13).
	tl := &till.Till{
		Path: store.TillPath(), Staff: staff.Load, Snapshot: data.Load, Log: h.log,
		Connected:      func() bool { return a.Status().Connected },
		ConnectedSince: func() *time.Time { return a.Status().ConnectedSince },
		Store:          h.orders,
		Upload:         h.upload,
		// The upload backlog, for the till's "orders being sent" (§16.7).
		Backlog:        func() int { return h.outbox.Status().PendingOrders },
		CloudCallCount: h.cloudCallCount,
		// Offline card charges use the terminal's driver and queue, with no cloud command (§13.7).
		Charge: func(terminalID, attemptID, amount string) (till.CardResult, error) {
			out, err := a.ChargeLocal(terminalID, attemptID, amount)
			if err != nil {
				return till.CardResult{}, fmt.Errorf("%w: %v", till.ErrChargeNotStarted, err)
			}
			return till.CardResult{
				Status: out.Status, RRN: out.RRN, STAN: out.STAN, CardPANMasked: out.CardPANMasked,
				ResponseCode: out.BankResponseCode, Message: out.Message,
			}, nil
		},
		// Offline tickets use the printer and queue a cloud print.job does (§13.8).
		Print: func(printerID, documentType, label, html string, copies int) error {
			return a.PrintLocal(printerID, documentType, label, html, copies)
		},
		Printers: func() []till.PrinterInfo {
			var out []till.PrinterInfo
			for _, p := range a.Printers() {
				out = append(out, till.PrinterInfo{ID: p.ID, Code: p.Code, Name: p.Name})
			}
			return out
		},
	}
	a = agent.New(agent.Options{
		Version:       version,
		WSURL:         id.WSURL,
		Headers:       client.Headers(),
		Journal:       h.journal,
		Printer:       &printing.Printer{Renderer: h.renderer},
		Log:           h.log,
		Welcomed:      func() { update.Cleanup(""); data.Trigger(); h.outbox.Trigger() },
		DataChanged:   data.Trigger,
		SyncStatus:    func() any { return syncStatus(data.Status(), h.outbox.Status()) },
		TillStatus:    func() any { return tl.Heartbeat() },
		CallNumbers:   h.saveCallNumbers,
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
	}
	h.mu.Lock()
	h.id, h.agent, h.client, h.till = &id, a, client, tl
	h.mu.Unlock()
	go updateLoop(runCtx, a, up, h.log)
	go data.Run(runCtx)
	go h.outbox.Run(runCtx, client)
	go tl.Run(runCtx, 30*time.Second)

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
// (§13.2), or nil when there is none.
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

// saveCallNumbers keeps the POS call count from the last heartbeat.ack (§13.9), writing only
// when it moved: it changes with orders, not with every heartbeat.
func (h *host) saveCallNumbers(n protocol.CallNumbers) {
	h.mu.Lock()
	same := h.callNumbers == n
	h.callNumbers = n
	h.mu.Unlock()
	if same {
		return
	}
	if err := store.SaveJSON(store.CallNumbersPath(), n); err != nil {
		h.log.Warn("could not keep the call-number count", "err", err)
	}
}

// syncStatus is the heartbeat's sync block (§12.7): the snapshot held and the order backlog.
func syncStatus(data branchdata.Status, orders offline.Status) map[string]any {
	return map[string]any{
		"data_version":      data.DataVersion,
		"data_pulled_at":    data.PulledAt,
		"pending_orders":    orders.PendingOrders,
		"oldest_pending_at": orders.OldestPendingAt,
		"last_upload_at":    orders.LastUploadAt,
		"last_upload_error": orders.LastUploadError,
	}
}
