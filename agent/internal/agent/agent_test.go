package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"gnext/agent/internal/journal"
	"gnext/agent/internal/payment"
	"gnext/agent/internal/printing"
	"gnext/agent/internal/protocol"

	"github.com/coder/websocket"
)

// fakeCloud is the smallest cloud that follows §4: it answers hello with welcome, acks
// results, and lets the test send commands and read what the agent sent.
type fakeCloud struct {
	t      *testing.T
	srv    *httptest.Server
	config protocol.Config
	// closeWith, when set, closes each new socket with that code right after welcome.
	closeWith websocket.StatusCode
	// heartbeatS is welcome's heartbeat interval (20 s unless a test needs beats sooner).
	heartbeatS int
	// callNumbers, when set, goes in every heartbeat.ack.
	callNumbers *protocol.CallNumbers

	mu    sync.Mutex
	conn  *websocket.Conn
	inbox chan protocol.Envelope
	beats chan protocol.Envelope
	conns chan struct{}
}

func newFakeCloud(t *testing.T, cfg protocol.Config) *fakeCloud {
	fc := &fakeCloud{
		t: t, config: cfg, heartbeatS: 20,
		inbox: make(chan protocol.Envelope, 100), beats: make(chan protocol.Envelope, 100), conns: make(chan struct{}, 10),
	}
	fc.srv = httptest.NewServer(http.HandlerFunc(fc.serve))
	t.Cleanup(fc.srv.Close)
	return fc
}

func (fc *fakeCloud) wsURL() string {
	return "ws" + strings.TrimPrefix(fc.srv.URL, "http") + "/api/v1/agent/ws"
}

func (fc *fakeCloud) serve(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Authorization") != "Bearer gak_test" {
		http.Error(w, "no", http.StatusUnauthorized)
		return
	}
	c, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	ctx := context.Background()
	_, data, err := c.Read(ctx)
	if err != nil {
		return
	}
	var hello protocol.Envelope
	_ = json.Unmarshal(data, &hello)
	if hello.Type != protocol.TypeHello {
		c.Close(protocol.CloseHandshakeTimeout, "hello first")
		return
	}
	fc.sendOn(c, protocol.TypeWelcome, hello.ID, map[string]any{
		"protocol_version": 1, "session_id": "s", "server_time": protocol.Now(time.Now()),
		"heartbeat_interval_s": fc.heartbeatS, "branch": map[string]string{"id": "b", "name": "Test"},
		"config": fc.config,
	})
	if fc.closeWith != 0 {
		c.Close(fc.closeWith, "test")
		return
	}
	fc.mu.Lock()
	fc.conn = c
	fc.mu.Unlock()
	fc.conns <- struct{}{}
	for {
		_, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		var env protocol.Envelope
		if json.Unmarshal(data, &env) != nil {
			continue
		}
		if strings.HasSuffix(env.Type, ".result") {
			fc.sendOn(c, protocol.TypeAck, env.ID, protocol.Ack{OK: true})
		}
		if env.Type == protocol.TypeHeartbeat {
			fc.sendOn(c, protocol.TypeHeartbeatAck, env.ID, protocol.HeartbeatAck{ServerTime: protocol.Now(time.Now()), CallNumbers: fc.callNumbers})
			select {
			case fc.beats <- env:
			default:
			}
			continue
		}
		fc.inbox <- env
	}
}

func (fc *fakeCloud) sendOn(c *websocket.Conn, typ, ref string, payload any) protocol.Envelope {
	env, _ := protocol.New(typ, ref, payload)
	b, _ := json.Marshal(env)
	_ = c.Write(context.Background(), websocket.MessageText, b)
	return env
}

func (fc *fakeCloud) command(id, typ string, payload map[string]any) {
	if _, ok := payload["expires_at"]; !ok {
		payload["expires_at"] = protocol.Now(time.Now().Add(time.Minute))
	}
	raw, _ := json.Marshal(payload)
	env := protocol.Envelope{V: 1, ID: id, Type: typ, TS: protocol.Now(time.Now()), Payload: raw}
	b, _ := json.Marshal(env)
	fc.mu.Lock()
	c := fc.conn
	fc.mu.Unlock()
	if err := c.Write(context.Background(), websocket.MessageText, b); err != nil {
		fc.t.Fatalf("send command: %v", err)
	}
}

// next returns the next message from the agent that matches, skipping others.
func (fc *fakeCloud) next(match func(protocol.Envelope) bool) protocol.Envelope {
	fc.t.Helper()
	timeout := time.After(10 * time.Second)
	for {
		select {
		case env := <-fc.inbox:
			if match(env) {
				return env
			}
		case <-timeout:
			fc.t.Fatal("timed out waiting for a message from the agent")
		}
	}
}

func ofType(typ, ref string) func(protocol.Envelope) bool {
	return func(e protocol.Envelope) bool { return e.Type == typ && (ref == "" || e.Ref == ref) }
}

func (fc *fakeCloud) waitConnected() {
	fc.t.Helper()
	select {
	case <-fc.conns:
	case <-time.After(10 * time.Second):
		fc.t.Fatal("agent did not connect")
	}
}

// whiteRenderer stands in for Edge: a small image with one black line.
type whiteRenderer struct{}

func (whiteRenderer) Render(_ context.Context, _ string, width int) (image.Image, error) {
	img := image.NewGray(image.Rect(0, 0, width, 20))
	for x := 0; x < width; x++ {
		for y := 0; y < 20; y++ {
			img.SetGray(x, y, color.Gray{Y: 255})
		}
		img.SetGray(x, 10, color.Gray{})
	}
	return img, nil
}

// printerLAN accepts raw print jobs like a port-9100 printer that answers no status questions,
// and counts the connections that carried a ticket (device checks carry none).
type printerLAN struct {
	ln   net.Listener
	mu   sync.Mutex
	jobs int
}

func newPrinterLAN(t *testing.T) *printerLAN {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	p := &printerLAN{ln: ln}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer c.Close()
				b, _ := io.ReadAll(c)
				if bytes.Contains(b, []byte{0x1D, 0x76, 0x30}) { // GS v 0
					p.mu.Lock()
					p.jobs++
					p.mu.Unlock()
				}
			}()
		}
	}()
	return p
}

func (p *printerLAN) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.jobs
}

func (p *printerLAN) port() json.RawMessage {
	b, _ := json.Marshal(p.ln.Addr().(*net.TCPAddr).Port)
	return b
}

// stubDriver approves, or blocks until released.
type stubDriver struct {
	mu      sync.Mutex
	charges int
	block   chan struct{}
}

func (d *stubDriver) Charge(ctx context.Context, req payment.ChargeRequest) (payment.Outcome, error) {
	d.mu.Lock()
	d.charges++
	d.mu.Unlock()
	if d.block != nil {
		<-d.block
	}
	return payment.Outcome{Status: protocol.PayApproved, Amount: req.Amount, RRN: "123456789012"}, nil
}

func (d *stubDriver) Query(context.Context, payment.QueryRequest) (payment.Outcome, error) {
	return payment.Outcome{}, payment.ErrQueryUnsupported
}

func (d *stubDriver) Probe(context.Context) (string, string) { return protocol.DeviceOnline, "" }

type harness struct {
	cloud   *fakeCloud
	agent   *Agent
	journal *journal.Journal
	printer *printerLAN
	driver  *stubDriver
	cancel  context.CancelFunc
	done    chan error
	// dataChanged receives each data.changed the agent passed on.
	dataChanged chan struct{}
}

func testConfig(p *printerLAN) protocol.Config {
	fake := "stub"
	return protocol.Config{
		ConfigVersion: 1,
		Printers: []protocol.Printer{{
			ID: "p1", Code: "KIT1", PaperWidthMM: 80, Active: true,
			Connection: &protocol.Connection{Kind: "tcp", Host: "127.0.0.1", Port: p.port()},
		}},
		Terminals: []protocol.Terminal{{ID: "t1", Code: "POS1", Active: true, Driver: &fake, ChargeTimeoutS: 5}},
	}
}

func start(t *testing.T, dir string, cloud *fakeCloud, drv *stubDriver) *harness {
	return startWithKey(t, dir, cloud, drv, "gak_test")
}

func startWithKey(t *testing.T, dir string, cloud *fakeCloud, drv *stubDriver, key string) *harness {
	t.Helper()
	return startWith(t, dir, cloud, drv, key, nil)
}

// startWith starts an agent, letting the test change its options first.
func startWith(t *testing.T, dir string, cloud *fakeCloud, drv *stubDriver, key string, tweak func(*Options)) *harness {
	t.Helper()
	j, err := journal.Open(filepath.Join(dir, "journal.db"))
	if err != nil {
		t.Fatal(err)
	}
	h := &harness{cloud: cloud, journal: j, driver: drv, done: make(chan error, 1), dataChanged: make(chan struct{}, 10)}
	opts := Options{
		Version: "1.0.0",
		WSURL:   cloud.wsURL(),
		Headers: http.Header{"Authorization": {"Bearer " + key}},
		Journal: j,
		Printer: &printing.Printer{Renderer: whiteRenderer{}, StatusTimeout: 50 * time.Millisecond},
		Log:     slog.New(slog.NewTextHandler(io.Discard, nil)),
		NewDriver: func(t protocol.Terminal) payment.Driver {
			if t.Driver != nil && *t.Driver == "stub" {
				return drv
			}
			return nil
		},
		DataChanged:  func() { h.dataChanged <- struct{}{} },
		ResultResend: 300 * time.Millisecond,
		BackoffMax:   200 * time.Millisecond,
	}
	if tweak != nil {
		tweak(&opts)
	}
	h.agent = New(opts)
	ctx, cancel := context.WithCancel(context.Background())
	h.cancel = cancel
	go func() { h.done <- h.agent.Run(ctx) }()
	return h
}

func (h *harness) stop(t *testing.T) {
	h.cancel()
	select {
	case <-h.done:
	case <-time.After(5 * time.Second):
		t.Fatal("agent did not stop")
	}
	h.journal.Close()
}

func printPayload() map[string]any {
	return map[string]any{
		"job_id": "job1", "attempt_no": 1, "printer_id": "p1", "document_type": "KITCHEN_TICKET",
		"copies": 1, "content": map[string]string{"format": "html", "html": "<p>سلام</p>"},
	}
}

func chargePayload() map[string]any {
	return map[string]any{
		"payment_id": "pay1", "attempt_id": "att1", "attempt_no": 1, "terminal_id": "t1",
		"amount": "1250000", "currency": "IRR", "timeout_s": 5,
	}
}

func TestPrintJobIsAckedThenPrintedOnceEvenWhenRedelivered(t *testing.T) {
	lan := newPrinterLAN(t)
	cloud := newFakeCloud(t, testConfig(lan))
	h := start(t, t.TempDir(), cloud, &stubDriver{})
	defer h.stop(t)
	cloud.waitConnected()

	cloud.command("cmd-print-1", protocol.TypePrintJob, printPayload())
	ack := cloud.next(ofType(protocol.TypeAck, "cmd-print-1"))
	var a protocol.Ack
	_ = json.Unmarshal(ack.Payload, &a)
	if !a.OK {
		t.Fatalf("print.job refused: %+v", a.Error)
	}
	res := cloud.next(ofType(protocol.TypePrintResult, "cmd-print-1"))
	var pr protocol.PrintResult
	_ = json.Unmarshal(res.Payload, &pr)
	if pr.Status != "SUCCESS" || pr.JobID != "job1" {
		t.Fatalf("result = %+v", pr)
	}

	// The same command again: acked, same result id resent, nothing printed twice.
	cloud.command("cmd-print-1", protocol.TypePrintJob, printPayload())
	cloud.next(ofType(protocol.TypeAck, "cmd-print-1"))
	again := cloud.next(ofType(protocol.TypePrintResult, "cmd-print-1"))
	if again.ID != res.ID {
		t.Fatalf("resent result id %s, want %s", again.ID, res.ID)
	}
	time.Sleep(200 * time.Millisecond)
	if n := lan.count(); n != 1 {
		t.Fatalf("printer received %d jobs, want 1", n)
	}
}

func TestRefusesExpiredAndUnknownDevices(t *testing.T) {
	lan := newPrinterLAN(t)
	cloud := newFakeCloud(t, testConfig(lan))
	h := start(t, t.TempDir(), cloud, &stubDriver{})
	defer h.stop(t)
	cloud.waitConnected()

	expired := printPayload()
	expired["expires_at"] = protocol.Now(time.Now().Add(-time.Minute))
	cloud.command("cmd-old", protocol.TypePrintJob, expired)
	wantRefusal(t, cloud.next(ofType(protocol.TypeAck, "cmd-old")), protocol.ErrExpired)

	other := printPayload()
	other["printer_id"] = "nope"
	cloud.command("cmd-nope", protocol.TypePrintJob, other)
	wantRefusal(t, cloud.next(ofType(protocol.TypeAck, "cmd-nope")), protocol.ErrDeviceNotConfigured)

	cloud.command("cmd-sync", "sync.orders", map[string]any{})
	wantRefusal(t, cloud.next(ofType(protocol.TypeAck, "cmd-sync")), protocol.ErrUnknownType)
}

func wantRefusal(t *testing.T, ack protocol.Envelope, code string) {
	t.Helper()
	var a protocol.Ack
	_ = json.Unmarshal(ack.Payload, &a)
	if a.OK || a.Error == nil || a.Error.Code != code {
		t.Fatalf("ack = %+v, want refusal %s", a, code)
	}
}

func TestChargeResultSurvivesReconnect(t *testing.T) {
	lan := newPrinterLAN(t)
	cloud := newFakeCloud(t, testConfig(lan))
	drv := &stubDriver{block: make(chan struct{})}
	h := start(t, t.TempDir(), cloud, drv)
	defer h.stop(t)
	cloud.waitConnected()

	cloud.command("cmd-charge", protocol.TypePaymentCharge, chargePayload())
	cloud.next(ofType(protocol.TypeAck, "cmd-charge"))

	// The socket drops while the customer is at the terminal.
	cloud.mu.Lock()
	cloud.conn.CloseNow()
	cloud.mu.Unlock()
	close(drv.block)
	cloud.waitConnected()

	res := cloud.next(ofType(protocol.TypePaymentResult, "cmd-charge"))
	var pr protocol.PaymentResult
	_ = json.Unmarshal(res.Payload, &pr)
	if pr.Status != protocol.PayApproved || pr.RRN == "" {
		t.Fatalf("result = %+v", pr)
	}
	if drv.charges != 1 {
		t.Fatalf("terminal charged %d times", drv.charges)
	}
}

func TestChargeInterruptedByRestartIsReportedUnknownAndNeverRerun(t *testing.T) {
	dir := t.TempDir()
	j, err := journal.Open(filepath.Join(dir, "journal.db"))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(chargePayload())
	cmd := protocol.Envelope{V: 1, ID: "cmd-crash", Type: protocol.TypePaymentCharge, Payload: raw}
	if _, err := j.Add(cmd); err != nil {
		t.Fatal(err)
	}
	if err := j.MarkRunning(cmd.ID); err != nil {
		t.Fatal(err)
	}
	j.Close()

	lan := newPrinterLAN(t)
	cloud := newFakeCloud(t, testConfig(lan))
	drv := &stubDriver{}
	h := start(t, dir, cloud, drv)
	defer h.stop(t)
	cloud.waitConnected()

	res := cloud.next(ofType(protocol.TypePaymentResult, "cmd-crash"))
	var pr protocol.PaymentResult
	_ = json.Unmarshal(res.Payload, &pr)
	if pr.Status != protocol.PayUnknown || pr.Error == nil || pr.Error.Code != protocol.ErrAgentRestarted {
		t.Fatalf("result = %+v", pr)
	}

	// Redelivery after the restart must not charge again.
	cloud.command("cmd-crash", protocol.TypePaymentCharge, chargePayload())
	cloud.next(ofType(protocol.TypeAck, "cmd-crash"))
	time.Sleep(200 * time.Millisecond)
	if drv.charges != 0 {
		t.Fatalf("terminal charged %d times after restart", drv.charges)
	}
}

func TestRevokedAgentStops(t *testing.T) {
	lan := newPrinterLAN(t)
	cloud := newFakeCloud(t, testConfig(lan))
	cloud.closeWith = protocol.CloseAgentRevoked
	h := start(t, t.TempDir(), cloud, &stubDriver{})
	defer h.journal.Close()
	select {
	case err := <-h.done:
		if !errors.Is(err, ErrStopped) {
			t.Fatalf("Run returned %v, want ErrStopped", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("agent kept running after 4003")
	}
	h.cancel()
}

func TestUnknownKeyStops(t *testing.T) {
	lan := newPrinterLAN(t)
	cloud := newFakeCloud(t, testConfig(lan))
	h := startWithKey(t, t.TempDir(), cloud, &stubDriver{}, "gak_wrong")
	defer h.journal.Close()
	select {
	case err := <-h.done:
		if !errors.Is(err, ErrStopped) {
			t.Fatalf("Run returned %v, want ErrStopped", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("agent kept retrying after 401")
	}
	h.cancel()
}

// An agent restarted with the internet down still reaches its printers (§13.2).
func TestSavedConfigIsUsedWhileTheCloudIsUnreachable(t *testing.T) {
	lan := newPrinterLAN(t)
	cloud := newFakeCloud(t, protocol.Config{})
	cloud.srv.Close() // nothing answers
	saved := testConfig(lan)
	h := startWith(t, t.TempDir(), cloud, &stubDriver{}, "gak_test", func(o *Options) { o.SavedConfig = &saved })
	defer h.stop(t)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := h.agent.TestPrint(ctx, "p1"); err != nil {
		t.Fatalf("test print from the saved config: %v", err)
	}
	// The printer counts a job once it has read the whole connection.
	for deadline := time.Now().Add(5 * time.Second); lan.count() == 0 && time.Now().Before(deadline); {
		time.Sleep(20 * time.Millisecond)
	}
	if lan.count() != 1 {
		t.Fatalf("printer received %d jobs, want 1", lan.count())
	}
}

func TestEveryConfigFromTheCloudIsHandedOnToKeep(t *testing.T) {
	lan := newPrinterLAN(t)
	cloud := newFakeCloud(t, testConfig(lan))
	kept := make(chan *protocol.Config, 10)
	stale := protocol.Config{ConfigVersion: 0}
	h := startWith(t, t.TempDir(), cloud, &stubDriver{}, "gak_test", func(o *Options) {
		o.SavedConfig = &stale
		o.ConfigChanged = func(c *protocol.Config) { kept <- c }
	})
	defer h.stop(t)
	cloud.waitConnected()

	select {
	case c := <-kept:
		if c.ConfigVersion != 1 || len(c.Printers) != 1 || c.Printers[0].ID != "p1" {
			t.Fatalf("kept config = %+v, want the welcome's", c)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("welcome's config was not handed on")
	}

	cloud.command("cmd-cfg", protocol.TypeConfigUpdated, map[string]any{"config_version": 2, "printers": []any{}, "terminals": []any{}})
	select {
	case c := <-kept:
		if c.ConfigVersion != 2 {
			t.Fatalf("kept config version = %d, want 2", c.ConfigVersion)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("config.updated was not handed on")
	}
}

func TestHeartbeatCarriesTheTillAndItsAckTheCallCount(t *testing.T) {
	lan := newPrinterLAN(t)
	cloud := newFakeCloud(t, testConfig(lan))
	cloud.heartbeatS = 1
	cloud.callNumbers = &protocol.CallNumbers{BusinessDate: "2026-09-24", POS: 41}
	counts := make(chan protocol.CallNumbers, 10)
	h := startWith(t, t.TempDir(), cloud, &stubDriver{}, "gak_test", func(o *Options) {
		o.TillStatus = func() any { return map[string]any{"terminal_id": nil, "mode": "ONLINE", "open_orders": 0} }
		o.CallNumbers = func(n protocol.CallNumbers) { counts <- n }
	})
	defer h.stop(t)
	cloud.waitConnected()

	select {
	case beat := <-cloud.beats:
		var hb struct {
			Till map[string]any `json:"till"`
		}
		_ = json.Unmarshal(beat.Payload, &hb)
		if hb.Till["mode"] != "ONLINE" || hb.Till["open_orders"] != float64(0) {
			t.Fatalf("heartbeat till = %v", hb.Till)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("no heartbeat")
	}
	select {
	case n := <-counts:
		if n != (protocol.CallNumbers{BusinessDate: "2026-09-24", POS: 41}) {
			t.Fatalf("call count = %+v", n)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("heartbeat.ack's call count was not passed on")
	}
}

func TestDataChangedIsAckedAndPassedOn(t *testing.T) {
	lan := newPrinterLAN(t)
	cloud := newFakeCloud(t, testConfig(lan))
	h := start(t, t.TempDir(), cloud, &stubDriver{})
	defer h.stop(t)
	cloud.waitConnected()

	cloud.command("cmd-data", protocol.TypeDataChanged, map[string]any{"data_version": "abc"})
	var a protocol.Ack
	_ = json.Unmarshal(cloud.next(ofType(protocol.TypeAck, "cmd-data")).Payload, &a)
	if !a.OK {
		t.Fatalf("data.changed ack = %+v, want ok", a)
	}
	select {
	case <-h.dataChanged:
	case <-time.After(5 * time.Second):
		t.Fatal("data.changed was not passed on")
	}
}
