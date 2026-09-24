// Package agent runs the WebSocket session with the cloud and executes its commands (§4–§7).
package agent

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"gnext/agent/internal/journal"
	"gnext/agent/internal/payment"
	"gnext/agent/internal/printing"
	"gnext/agent/internal/protocol"

	"github.com/coder/websocket"
)

type Options struct {
	Version string
	WSURL   string
	Headers http.Header
	Journal *journal.Journal
	Printer *printing.Printer
	Log     *slog.Logger

	// NewDriver picks the terminal driver for a configured terminal; nil means unsupported.
	NewDriver func(protocol.Terminal) payment.Driver
	// Welcomed is called after every welcome (the updater deletes the old binary then).
	Welcomed func()
	// DataChanged is called when the cloud says the branch snapshot changed (§12.3).
	DataChanged func()
	// SyncStatus, when set, is sent in every heartbeat (§12.7).
	SyncStatus func() any
	// TillStatus, when set, is sent in every heartbeat as `till` (§13.10).
	TillStatus func() any
	// CallNumbers is called with the POS call count each heartbeat.ack carries (§13.9).
	CallNumbers func(protocol.CallNumbers)

	// SavedConfig is the config kept from the last run, used until the cloud sends one, so an
	// agent restarted while offline still reaches its devices (§13.2).
	SavedConfig *protocol.Config
	// ConfigChanged is called with every config the cloud sends, to keep it on disk.
	ConfigChanged func(*protocol.Config)

	// Timings, overridable in tests.
	HandshakeTimeout time.Duration
	ResultResend     time.Duration
	ProbeInterval    time.Duration
	BackoffMax       time.Duration
}

// ErrStopped is returned by Run when the cloud refused the agent for good (§3.4, §4.9).
var ErrStopped = errors.New("agent stopped by the cloud; run enrol again")

type Agent struct {
	o         Options
	startedAt time.Time

	offset atomic.Int64 // server − local, nanoseconds
	cfg    atomic.Pointer[protocol.Config]

	connMu sync.Mutex
	conn   *websocket.Conn

	queuesMu sync.Mutex
	queues   map[string]chan func()

	running  atomic.Int32
	updating atomic.Bool

	sentMu sync.Mutex
	sentAt map[string]time.Time // result id → last send

	devMu   sync.Mutex
	devices map[string]protocol.DeviceStatus
	probeCh chan struct{}

	updateCh chan struct{}
	lastBeat atomic.Int64 // unix nanos of the last heartbeat.ack

	// For the local settings page.
	connectedAt atomic.Int64 // unix nanos of the current welcome, 0 while disconnected
	branchName  atomic.Value // string
	lastError   atomic.Value // string
}

func New(o Options) *Agent {
	if o.HandshakeTimeout == 0 {
		o.HandshakeTimeout = 10 * time.Second
	}
	if o.ResultResend == 0 {
		o.ResultResend = 15 * time.Second
	}
	if o.ProbeInterval == 0 {
		o.ProbeInterval = 60 * time.Second
	}
	if o.BackoffMax == 0 {
		o.BackoffMax = 60 * time.Second
	}
	if o.NewDriver == nil {
		o.NewDriver = payment.NewDriver
	}
	a := &Agent{
		o:         o,
		startedAt: time.Now(),
		queues:    map[string]chan func(){},
		sentAt:    map[string]time.Time{},
		devices:   map[string]protocol.DeviceStatus{},
		probeCh:   make(chan struct{}, 1),
		updateCh:  make(chan struct{}, 1),
	}
	if o.SavedConfig != nil {
		a.cfg.Store(o.SavedConfig)
	} else {
		a.cfg.Store(&protocol.Config{})
	}
	return a
}

// Run keeps the agent connected until ctx ends. It returns ErrStopped when the cloud refuses
// the agent; the caller should then wait for a new enrolment rather than restart.
func (a *Agent) Run(ctx context.Context) error {
	if err := a.recover(); err != nil {
		return err
	}
	go a.resendLoop(ctx)
	go a.probeLoop(ctx)
	go a.pruneLoop(ctx)

	backoff := time.Second
	for ctx.Err() == nil {
		welcomed, err := a.session(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if welcomed {
			backoff = time.Second
		}
		wait := jitter(backoff)
		backoff = min(backoff*2, a.o.BackoffMax)
		if err != nil {
			a.lastError.Store(err.Error())
		}

		switch code := websocket.CloseStatus(err); {
		case errors.Is(err, errRefused), code == protocol.CloseAgentKeyInvalid, code == protocol.CloseAgentRevoked:
			a.o.Log.Error("the cloud refused this agent's key; stopping until it is enrolled again", "err", err)
			return ErrStopped
		case code == protocol.CloseReplaced:
			a.o.Log.Error("another connection with this agent's key replaced this one; stopping", "err", err)
			return ErrStopped
		case code == protocol.CloseProtocolUnsupported:
			a.o.Log.Error("the cloud does not support this protocol version; waiting for an update", "err", err)
			a.triggerUpdate()
			wait = time.Hour
		case code == protocol.CloseUpgradeRequired:
			a.o.Log.Warn("the cloud requires a newer agent; updating", "err", err)
			a.triggerUpdate()
			wait = 5 * time.Minute
		case code == protocol.CloseRateLimited:
			wait = max(wait, 60*time.Second)
		default:
			a.o.Log.Warn("disconnected", "err", err, "retry_in", wait.Round(time.Millisecond))
		}
		select {
		case <-ctx.Done():
		case <-time.After(wait):
		}
	}
	return ctx.Err()
}

// UpdateRequests delivers a signal whenever the cloud asks for an update check.
func (a *Agent) UpdateRequests() <-chan struct{} { return a.updateCh }

// Updating makes the agent refuse new charges while an update waits for running work (§9.2).
func (a *Agent) Updating(on bool) { a.updating.Store(on) }

// Idle reports whether no command is running.
func (a *Agent) Idle() bool { return a.running.Load() == 0 }

// Close closes the socket with 1001, before an update restart or a service stop.
func (a *Agent) Close() {
	a.connMu.Lock()
	defer a.connMu.Unlock()
	if a.conn != nil {
		a.conn.Close(websocket.StatusGoingAway, "agent stopping")
		a.conn = nil
	}
}

var errRefused = errors.New("upgrade refused")

func (a *Agent) session(ctx context.Context) (welcomed bool, err error) {
	dialCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	c, resp, err := websocket.Dial(dialCtx, a.o.WSURL, &websocket.DialOptions{HTTPHeader: a.o.Headers})
	cancel()
	if err != nil {
		if resp != nil && (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) {
			return false, errors.Join(errRefused, err)
		}
		return false, err
	}
	defer c.CloseNow()
	c.SetReadLimit(1 << 20)

	unacked, _ := a.o.Journal.UnackedResults()
	hello, _ := protocol.New(protocol.TypeHello, "", protocol.Hello{
		AgentVersion:     a.o.Version,
		ProtocolVersions: []int{protocol.Version},
		Capabilities:     protocol.Capabilities,
		StartedAt:        protocol.Now(a.startedAt),
		Devices:          a.deviceList(),
		UnackedResults:   len(unacked),
	})
	if err := write(ctx, c, hello); err != nil {
		return false, err
	}

	hsCtx, cancelHS := context.WithTimeout(ctx, a.o.HandshakeTimeout)
	welcome, err := awaitWelcome(hsCtx, c, hello.ID)
	cancelHS()
	if err != nil {
		return false, err
	}
	a.applyClock(welcome.ServerTime)
	if welcome.Config != nil {
		a.setConfig(welcome.Config)
	}
	a.lastBeat.Store(time.Now().UnixNano())
	a.setConn(c)
	defer a.setConn(nil)
	a.branchName.Store(welcome.Branch.Name)
	a.connectedAt.Store(time.Now().UnixNano())
	a.lastError.Store("")
	a.o.Log.Info("connected", "branch", welcome.Branch.Name, "session", welcome.SessionID)
	if a.o.Welcomed != nil {
		a.o.Welcomed()
	}
	if welcome.Update != nil && welcome.Update.Available {
		a.triggerUpdate()
	}

	// Results first, then the cloud redelivers its commands (§4.2).
	for _, r := range unacked {
		a.sendResult(r)
	}
	interval := time.Duration(max(welcome.HeartbeatIntervalS, 1)) * time.Second
	sessCtx, stop := context.WithCancel(ctx)
	defer stop()
	go a.heartbeat(sessCtx, c, interval)

	for {
		typ, data, err := c.Read(sessCtx)
		if err != nil {
			return true, err
		}
		if typ != websocket.MessageText {
			continue
		}
		a.handle(data)
	}
}

func awaitWelcome(ctx context.Context, c *websocket.Conn, helloID string) (protocol.Welcome, error) {
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			return protocol.Welcome{}, err
		}
		var env protocol.Envelope
		if json.Unmarshal(data, &env) != nil || env.Type != protocol.TypeWelcome {
			continue
		}
		var w protocol.Welcome
		if err := json.Unmarshal(env.Payload, &w); err != nil {
			return w, err
		}
		return w, nil
	}
}

func (a *Agent) heartbeat(ctx context.Context, c *websocket.Conn, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		if time.Since(time.Unix(0, a.lastBeat.Load())) > 2*interval {
			a.o.Log.Warn("no heartbeat.ack; reconnecting")
			c.Close(websocket.StatusGoingAway, "HEARTBEAT_TIMEOUT")
			return
		}
		unacked, _ := a.o.Journal.UnackedResults()
		hb := protocol.Heartbeat{InFlight: int(a.running.Load()), UnackedResults: len(unacked)}
		if a.o.SyncStatus != nil {
			hb.Sync = a.o.SyncStatus()
		}
		if a.o.TillStatus != nil {
			hb.Till = a.o.TillStatus()
		}
		a.send(protocol.TypeHeartbeat, "", hb)
	}
}

// handle processes one frame after welcome.
func (a *Agent) handle(data []byte) {
	var env protocol.Envelope
	if err := json.Unmarshal(data, &env); err != nil || env.V == 0 || env.ID == "" || env.Type == "" {
		ref := ""
		if err == nil {
			ref = env.ID
		}
		a.send(protocol.TypeError, ref, protocol.Error{Code: protocol.ErrBadMessage, Message: "not a valid envelope"})
		return
	}
	switch env.Type {
	case protocol.TypeHeartbeatAck:
		var p protocol.HeartbeatAck
		if json.Unmarshal(env.Payload, &p) == nil {
			a.applyClock(p.ServerTime)
			if p.CallNumbers != nil && a.o.CallNumbers != nil {
				a.o.CallNumbers(*p.CallNumbers)
			}
		}
		a.lastBeat.Store(time.Now().UnixNano())
	case protocol.TypeAck:
		if err := a.o.Journal.AckResult(env.Ref); err != nil {
			a.o.Log.Error("journal ack", "err", err)
		}
		a.sentMu.Lock()
		delete(a.sentAt, env.Ref)
		a.sentMu.Unlock()
	case protocol.TypeError:
		a.o.Log.Warn("cloud reported an error", "ref", env.Ref, "payload", string(env.Payload))
	case protocol.TypeWelcome, protocol.TypeHello:
	default:
		if protocol.IsCommand(env.Type) {
			a.command(env)
			return
		}
		a.refuse(env, protocol.ErrUnknownType, "unknown message type "+env.Type)
	}
}

func (a *Agent) command(env protocol.Envelope) {
	// A command seen before is acked again, and its result resent (§4.4 rule 3).
	if e, found, err := a.o.Journal.Get(env.ID); err != nil {
		a.refuse(env, protocol.ErrInternal, err.Error())
		return
	} else if found {
		a.ack(env.ID)
		if e.Result != nil {
			a.sendResult(*e.Result)
		}
		return
	}

	var base protocol.CommandBase
	if err := json.Unmarshal(env.Payload, &base); err != nil {
		a.refuse(env, protocol.ErrInvalidPayload, err.Error())
		return
	}
	if exp, err := time.Parse(time.RFC3339Nano, base.ExpiresAt); err == nil && a.now().After(exp) {
		a.refuse(env, protocol.ErrExpired, "arrived after expires_at")
		return
	}

	cfg := a.cfg.Load()
	switch env.Type {
	case protocol.TypeConfigUpdated:
		var c protocol.Config
		if err := json.Unmarshal(env.Payload, &c); err != nil {
			a.refuse(env, protocol.ErrInvalidPayload, err.Error())
			return
		}
		a.setConfig(&c)
		a.ack(env.ID)

	case protocol.TypeCheckUpdate:
		a.ack(env.ID)
		a.triggerUpdate()

	case protocol.TypeDataChanged:
		a.ack(env.ID)
		if a.o.DataChanged != nil {
			a.o.DataChanged()
		}

	case protocol.TypePrintJob:
		var job protocol.PrintJob
		if err := json.Unmarshal(env.Payload, &job); err != nil || job.PrinterID == "" {
			a.refuse(env, protocol.ErrInvalidPayload, "print.job needs printer_id")
			return
		}
		p, ok := findPrinter(cfg, job.PrinterID)
		if !ok || !p.Active {
			a.refuse(env, protocol.ErrDeviceNotConfigured, "no active printer "+job.PrinterID)
			return
		}
		if !printing.Supported(p) {
			a.refuse(env, protocol.ErrUnsupported, "this agent build cannot reach the printer's connection")
			return
		}
		a.accept(env, p.ID, func() { a.runPrint(env, job, p) })

	case protocol.TypePaymentCharge, protocol.TypePaymentQuery:
		if env.Type == protocol.TypePaymentCharge && a.updating.Load() {
			a.refuse(env, protocol.ErrUnsupported, "updating")
			return
		}
		var ids struct {
			TerminalID string `json:"terminal_id"`
			AttemptID  string `json:"attempt_id"`
		}
		if err := json.Unmarshal(env.Payload, &ids); err != nil || ids.TerminalID == "" || ids.AttemptID == "" {
			a.refuse(env, protocol.ErrInvalidPayload, "needs terminal_id and attempt_id")
			return
		}
		t, ok := findTerminal(cfg, ids.TerminalID)
		var drv payment.Driver
		if ok && t.Active {
			drv = a.o.NewDriver(t)
		}
		if drv == nil {
			a.refuse(env, protocol.ErrDeviceNotConfigured, "no active terminal with a supported driver "+ids.TerminalID)
			return
		}
		if env.Type == protocol.TypePaymentCharge {
			var ch protocol.PaymentCharge
			_ = json.Unmarshal(env.Payload, &ch)
			a.accept(env, t.ID, func() { a.runCharge(env, ch, t, drv) })
		} else {
			var q protocol.PaymentQuery
			_ = json.Unmarshal(env.Payload, &q)
			a.accept(env, t.ID, func() { a.runQuery(env, q, drv) })
		}
	}
}

// accept journals the command, acks it, and queues it behind other work on the same device.
func (a *Agent) accept(env protocol.Envelope, deviceID string, run func()) {
	if _, err := a.o.Journal.Add(env); err != nil && !errors.Is(err, journal.ErrExists) {
		a.refuse(env, protocol.ErrInternal, "journal: "+err.Error())
		return
	}
	a.ack(env.ID)
	a.queue(deviceID) <- run
}

func (a *Agent) queue(deviceID string) chan func() {
	a.queuesMu.Lock()
	defer a.queuesMu.Unlock()
	q, ok := a.queues[deviceID]
	if !ok {
		q = make(chan func(), 256)
		a.queues[deviceID] = q
		go func() {
			for run := range q {
				run()
			}
		}()
	}
	return q
}

func (a *Agent) runPrint(env protocol.Envelope, job protocol.PrintJob, p protocol.Printer) {
	if !a.begin(env.ID) {
		return
	}
	defer a.running.Add(-1)
	started := time.Now()
	res := protocol.PrintResult{
		JobID: job.JobID, AttemptNo: job.AttemptNo, PrinterID: job.PrinterID,
		Status: "SUCCESS", CopiesPrinted: max(job.Copies, 1), StartedAt: protocol.Now(started),
	}
	if err := a.o.Printer.Print(context.Background(), p, job); err != nil {
		res.Status, res.CopiesPrinted = "FAILED", 0
		code := protocol.ErrPrinterUnreachable
		var f *printing.Failure
		if errors.As(err, &f) {
			code = f.Code
		}
		res.Error = &protocol.Error{Code: code, Message: err.Error()}
		a.o.Log.Warn("print failed", "job", job.JobID, "printer", p.Code, "err", err)
	}
	res.FinishedAt = protocol.Now(time.Now())
	a.finish(env.ID, protocol.TypePrintResult, res)
}

func (a *Agent) runCharge(env protocol.Envelope, ch protocol.PaymentCharge, t protocol.Terminal, drv payment.Driver) {
	if !a.begin(env.ID) {
		return
	}
	defer a.running.Add(-1)
	timeout := time.Duration(ch.TimeoutS) * time.Second
	if timeout <= 0 {
		timeout = time.Duration(max(t.ChargeTimeoutS, 90)) * time.Second
	}
	started := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), timeout+15*time.Second)
	defer cancel()
	out, err := drv.Charge(ctx, payment.ChargeRequest{AttemptID: ch.AttemptID, Amount: ch.Amount, Timeout: timeout})
	if err != nil {
		// Once the amount may have reached the terminal, only UNKNOWN is honest (§7.3).
		out = payment.Outcome{Status: protocol.PayUnknown, ErrorCode: protocol.ErrBadResponse, Message: err.Error()}
	}
	a.finish(env.ID, protocol.TypePaymentResult, paymentResult(ch.PaymentID, ch.AttemptID, ch.TerminalID, out, started))
}

// Refusals of ChargeLocal before the terminal is touched.
var (
	// ErrNoTerminal: the terminal is not in the config, not active, or its driver is not in this build.
	ErrNoTerminal = errors.New("no active terminal with a supported driver")
	// ErrUpdating: the agent is about to swap its binary and takes no new charge.
	ErrUpdating = errors.New("the agent is updating")
)

// ChargeLocal charges a terminal for the offline till (§13.7): the same driver and per-device
// queue as a cloud payment.charge, with no cloud command. The caller records the charge as
// RUNNING on disk first (§4.6). It returns once the terminal has answered or the charge timed
// out; only the errors above mean the amount never reached the terminal.
func (a *Agent) ChargeLocal(terminalID, attemptID, amount string) (payment.Outcome, error) {
	if a.updating.Load() {
		return payment.Outcome{}, ErrUpdating
	}
	t, ok := findTerminal(a.cfg.Load(), terminalID)
	var drv payment.Driver
	if ok && t.Active {
		drv = a.o.NewDriver(t)
	}
	if drv == nil {
		return payment.Outcome{}, ErrNoTerminal
	}
	done := make(chan payment.Outcome, 1)
	a.running.Add(1) // an update waits for it (Idle)
	a.queue(t.ID) <- func() {
		defer a.running.Add(-1)
		timeout := time.Duration(max(t.ChargeTimeoutS, 90)) * time.Second
		ctx, cancel := context.WithTimeout(context.Background(), timeout+15*time.Second)
		defer cancel()
		out, err := drv.Charge(ctx, payment.ChargeRequest{AttemptID: attemptID, Amount: amount, Timeout: timeout})
		if err != nil {
			// Once the amount may have reached the terminal, only UNKNOWN is honest (§7.3).
			out = payment.Outcome{Status: protocol.PayUnknown, ErrorCode: protocol.ErrBadResponse, Message: err.Error()}
		}
		done <- out
	}
	return <-done, nil
}

func (a *Agent) runQuery(env protocol.Envelope, q protocol.PaymentQuery, drv payment.Driver) {
	if !a.begin(env.ID) {
		return
	}
	defer a.running.Add(-1)
	started := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	out, err := drv.Query(ctx, payment.QueryRequest{AttemptID: q.AttemptID, Amount: q.Amount})
	switch {
	case errors.Is(err, payment.ErrQueryUnsupported):
		out = payment.Outcome{Status: protocol.PayUnknown, ErrorCode: protocol.ErrQueryUnsupported}
	case err != nil:
		out = payment.Outcome{Status: protocol.PayUnknown, ErrorCode: protocol.ErrBadResponse, Message: err.Error()}
	case out.Status == protocol.PayFailed:
		out.Status = protocol.PayUnknown // FAILED is not allowed for a query (§7.5)
	}
	a.finish(env.ID, protocol.TypePaymentResult, paymentResult(q.PaymentID, q.AttemptID, q.TerminalID, out, started))
}

func paymentResult(paymentID, attemptID, terminalID string, out payment.Outcome, started time.Time) protocol.PaymentResult {
	r := protocol.PaymentResult{
		PaymentID: paymentID, AttemptID: attemptID, TerminalID: terminalID,
		Status: out.Status, Amount: out.Amount, RRN: out.RRN, STAN: out.STAN, AuthCode: out.AuthCode,
		TerminalSerial: out.TerminalSerial, CardPANMasked: out.CardPANMasked, BankResponseCode: out.BankResponseCode,
		StartedAt: protocol.Now(started), FinishedAt: protocol.Now(time.Now()),
	}
	if out.ErrorCode != "" {
		r.Error = &protocol.Error{Code: out.ErrorCode, Message: out.Message}
	}
	return r
}

// begin marks a command RUNNING in the journal before any device is touched.
func (a *Agent) begin(cmdID string) bool {
	if err := a.o.Journal.MarkRunning(cmdID); err != nil {
		a.o.Log.Error("journal: mark running", "cmd", cmdID, "err", err)
		return false
	}
	a.running.Add(1)
	return true
}

// finish stores a result and sends it; it is resent until the cloud acks it.
func (a *Agent) finish(cmdID, typ string, payload any) {
	env, err := protocol.New(typ, cmdID, payload)
	if err != nil {
		a.o.Log.Error("build result", "err", err)
		return
	}
	if err := a.o.Journal.SetResult(cmdID, env); err != nil {
		a.o.Log.Error("journal: store result", "cmd", cmdID, "err", err)
	}
	a.sendResult(env)
}

// recover ends commands a previous run acked but did not finish (§4.6). Nothing is re-run.
func (a *Agent) recover() error {
	unfinished, err := a.o.Journal.Unfinished()
	if err != nil {
		return err
	}
	for _, e := range unfinished {
		cmd := e.Command
		restarted := &protocol.Error{Code: protocol.ErrAgentRestarted, Message: "the agent restarted while the command was pending"}
		now := protocol.Now(time.Now())
		switch cmd.Type {
		case protocol.TypePrintJob:
			var job protocol.PrintJob
			_ = json.Unmarshal(cmd.Payload, &job)
			a.finish(cmd.ID, protocol.TypePrintResult, protocol.PrintResult{
				JobID: job.JobID, AttemptNo: job.AttemptNo, PrinterID: job.PrinterID,
				Status: "FAILED", StartedAt: now, FinishedAt: now, Error: restarted,
			})
		case protocol.TypePaymentCharge, protocol.TypePaymentQuery:
			var p protocol.PaymentCharge
			_ = json.Unmarshal(cmd.Payload, &p)
			status := protocol.PayUnknown
			if cmd.Type == protocol.TypePaymentCharge && e.State == journal.Received {
				status = protocol.PayFailed // never marked running: the terminal was not touched
			}
			a.finish(cmd.ID, protocol.TypePaymentResult, protocol.PaymentResult{
				PaymentID: p.PaymentID, AttemptID: p.AttemptID, TerminalID: p.TerminalID,
				Status: status, StartedAt: now, FinishedAt: now, Error: restarted,
			})
		}
		a.o.Log.Warn("closed a command left over from before a restart", "cmd", cmd.ID, "type", cmd.Type, "state", e.State)
	}
	return nil
}

func (a *Agent) resendLoop(ctx context.Context) {
	t := time.NewTicker(max(a.o.ResultResend/3, 100*time.Millisecond))
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		unacked, err := a.o.Journal.UnackedResults()
		if err != nil {
			continue
		}
		for _, r := range unacked {
			a.sentMu.Lock()
			last, ok := a.sentAt[r.ID]
			a.sentMu.Unlock()
			if !ok || time.Since(last) >= a.o.ResultResend {
				a.sendResult(r)
			}
		}
	}
}

func (a *Agent) pruneLoop(ctx context.Context) {
	for {
		if err := a.o.Journal.Prune(time.Now().Add(-7 * 24 * time.Hour)); err != nil {
			a.o.Log.Warn("journal prune", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(6 * time.Hour):
		}
	}
}

func (a *Agent) sendResult(r protocol.Envelope) {
	if a.write(r) {
		a.sentMu.Lock()
		a.sentAt[r.ID] = time.Now()
		a.sentMu.Unlock()
	}
}

func (a *Agent) ack(ref string) { a.send(protocol.TypeAck, ref, protocol.Ack{OK: true}) }

func (a *Agent) refuse(env protocol.Envelope, code, msg string) {
	a.o.Log.Warn("refused command", "type", env.Type, "id", env.ID, "code", code, "msg", msg)
	a.send(protocol.TypeAck, env.ID, protocol.Ack{OK: false, Error: &protocol.Error{Code: code, Message: msg}})
}

func (a *Agent) send(typ, ref string, payload any) {
	env, err := protocol.New(typ, ref, payload)
	if err != nil {
		a.o.Log.Error("build message", "type", typ, "err", err)
		return
	}
	a.write(env)
}

func (a *Agent) write(env protocol.Envelope) bool {
	a.connMu.Lock()
	c := a.conn
	a.connMu.Unlock()
	if c == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := write(ctx, c, env); err != nil {
		a.o.Log.Warn("send failed", "type", env.Type, "err", err)
		return false
	}
	return true
}

func write(ctx context.Context, c *websocket.Conn, env protocol.Envelope) error {
	b, err := json.Marshal(env)
	if err != nil {
		return err
	}
	return c.Write(ctx, websocket.MessageText, b)
}

func (a *Agent) setConn(c *websocket.Conn) {
	a.connMu.Lock()
	a.conn = c
	a.connMu.Unlock()
	if c == nil {
		a.connectedAt.Store(0)
	}
}

func (a *Agent) applyClock(serverTime string) {
	if t, err := time.Parse(time.RFC3339Nano, serverTime); err == nil {
		a.offset.Store(int64(time.Until(t)))
	}
}

func (a *Agent) now() time.Time { return time.Now().Add(time.Duration(a.offset.Load())) }

func (a *Agent) setConfig(c *protocol.Config) {
	a.cfg.Store(c)
	if a.o.ConfigChanged != nil {
		a.o.ConfigChanged(c)
	}
	select {
	case a.probeCh <- struct{}{}:
	default:
	}
}

func (a *Agent) triggerUpdate() {
	select {
	case a.updateCh <- struct{}{}:
	default:
	}
}

func findPrinter(c *protocol.Config, id string) (protocol.Printer, bool) {
	for _, p := range c.Printers {
		if p.ID == id {
			return p, true
		}
	}
	return protocol.Printer{}, false
}

func findTerminal(c *protocol.Config, id string) (protocol.Terminal, bool) {
	for _, t := range c.Terminals {
		if t.ID == id {
			return t, true
		}
	}
	return protocol.Terminal{}, false
}

func jitter(d time.Duration) time.Duration {
	return time.Duration(float64(d) * (0.8 + 0.4*rand.Float64()))
}
