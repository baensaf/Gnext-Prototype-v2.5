package payment

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"gnext/agent/internal/protocol"
	"gnext/agent/internal/store"
)

// Sep drives a Saman (SEP) terminal through gnext-saman-bridge.exe, which wraps Saman's own
// PC-POS SDK. One bridge process runs per operation. The terminal is reached over the LAN
// (connection kind tcp, by IP; Saman's SDK picks the port) or a COM port (kind serial).
type Sep struct {
	mu   sync.Mutex // one operation on the terminal at a time
	conn protocol.Connection

	statusMu    sync.Mutex
	lastStatus  string
	lastDetail  string
	lastProbeAt time.Time

	run bridgeRunner
}

// sepProbeEvery keeps status checks from talking to the terminal every minute.
const sepProbeEvery = 5 * time.Minute

type bridgeRequest struct {
	Op       string `json:"op"`
	Media    string `json:"media"`
	IP       string `json:"ip,omitempty"`
	Com      string `json:"com,omitempty"`
	TimeoutS int    `json:"timeout_s,omitempty"`
	Amount   string `json:"amount,omitempty"`
	RRN      string `json:"rrn,omitempty"`
}

type bridgeResponse struct {
	OK     bool   `json:"ok"`
	Stage  string `json:"stage"`
	Error  string `json:"error"`
	Result struct {
		ResponseCode        string `json:"response_code"`
		ResponseDescription string `json:"response_description"`
		RRN                 string `json:"rrn"`
		TraceNumber         string `json:"trace_number"`
		SerialID            string `json:"serial_id"`
		TerminalID          string `json:"terminal_id"`
		CardNumberMask      string `json:"card_number_mask"`
		ReqAmount           string `json:"req_amount"`
		AffectiveAmount     string `json:"affective_amount"`
		PaidAmount          string `json:"paid_amount"`
	} `json:"result"`
}

type bridgeRunner func(ctx context.Context, req bridgeRequest) (bridgeResponse, error)

var seps = sepRegistry{m: map[string]*Sep{}}

type sepRegistry struct {
	mu sync.Mutex
	m  map[string]*Sep
}

func (r *sepRegistry) get(t protocol.Terminal) Driver {
	if t.Connection == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.m[t.ID]
	if !ok {
		s = &Sep{run: runBridge}
		r.m[t.ID] = s
	}
	s.mu.Lock()
	if s.conn.Kind != t.Connection.Kind || s.conn.Host != t.Connection.Host || string(s.conn.Port) != string(t.Connection.Port) {
		s.lastProbeAt = time.Time{} // re-check a changed connection right away
	}
	s.conn = *t.Connection
	s.mu.Unlock()
	return s
}

func (s *Sep) request(op string) (bridgeRequest, error) {
	switch s.conn.Kind {
	case "tcp":
		if s.conn.Host == "" {
			return bridgeRequest{}, errors.New("terminal has no IP address")
		}
		return bridgeRequest{Op: op, Media: "lan", IP: s.conn.Host}, nil
	case "serial":
		var port string
		if json.Unmarshal(s.conn.Port, &port) != nil || port == "" {
			return bridgeRequest{}, errors.New("terminal has no COM port")
		}
		return bridgeRequest{Op: op, Media: "com", Com: port}, nil
	}
	return bridgeRequest{}, fmt.Errorf("Saman terminals connect over the LAN or a COM port, not %q", s.conn.Kind)
}

func (s *Sep) Charge(ctx context.Context, req ChargeRequest) (Outcome, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	br, err := s.request("charge")
	if err != nil {
		return Outcome{Status: protocol.PayFailed, ErrorCode: protocol.ErrTerminalUnreachable, Message: err.Error()}, nil
	}
	br.Amount, br.TimeoutS = req.Amount, int(req.Timeout/time.Second)

	resp, err := s.run(ctx, br)
	if err != nil {
		// The bridge died or was killed mid-charge: the customer may have paid.
		code := protocol.ErrConnectionLost
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			code = protocol.ErrTimeout
		}
		return Outcome{Status: protocol.PayUnknown, ErrorCode: code, Message: err.Error()}, nil
	}
	return chargeOutcome(resp, req.Amount), nil
}

// chargeOutcome turns the bridge's answer into a payment result (§7.4). Only a "connect" stage
// failure is certain enough to be FAILED.
func chargeOutcome(resp bridgeResponse, requested string) Outcome {
	if !resp.OK {
		if resp.Stage == "connect" {
			return Outcome{Status: protocol.PayFailed, ErrorCode: protocol.ErrTerminalUnreachable, Message: resp.Error}
		}
		return Outcome{Status: protocol.PayUnknown, ErrorCode: protocol.ErrBadResponse, Message: resp.Error}
	}
	r := resp.Result
	code := strings.TrimSpace(r.ResponseCode)
	switch {
	case code == "00":
		amount := firstNonEmpty(r.AffectiveAmount, r.PaidAmount, r.ReqAmount, requested)
		return Outcome{
			Status:           protocol.PayApproved,
			Amount:           digits(amount),
			RRN:              strings.TrimSpace(r.RRN),
			STAN:             strings.TrimSpace(r.TraceNumber),
			TerminalSerial:   strings.TrimSpace(r.TerminalID),
			CardPANMasked:    maskPAN(r.CardNumberMask),
			BankResponseCode: code,
		}
	case code == "":
		return Outcome{Status: protocol.PayUnknown, ErrorCode: protocol.ErrBadResponse, Message: "terminal answered without a response code"}
	case cancelled(r.ResponseDescription):
		return Outcome{Status: protocol.PayCancelled, ErrorCode: protocol.ErrCancelledByUser, BankResponseCode: code, Message: r.ResponseDescription}
	default:
		return Outcome{Status: protocol.PayDeclined, ErrorCode: protocol.ErrDeclined, BankResponseCode: code, Message: r.ResponseDescription}
	}
}

// Query cannot find a charge without its RRN, and an UNKNOWN charge has none, so a person
// resolves it from the terminal's own report (§7.5).
func (s *Sep) Query(context.Context, QueryRequest) (Outcome, error) {
	return Outcome{}, ErrQueryUnsupported
}

// Probe runs Saman's connection test, at most every few minutes and never during a charge.
func (s *Sep) Probe(ctx context.Context) (string, string) {
	s.statusMu.Lock()
	fresh := !s.lastProbeAt.IsZero() && time.Since(s.lastProbeAt) < sepProbeEvery
	status, detail := s.lastStatus, s.lastDetail
	s.statusMu.Unlock()
	if fresh {
		return status, detail
	}
	if !s.mu.TryLock() {
		if status == "" {
			return protocol.DeviceUnknown, "busy with a charge"
		}
		return status, detail
	}
	defer s.mu.Unlock()

	status, detail = protocol.DeviceOnline, ""
	br, err := s.request("test")
	if err != nil {
		status, detail = protocol.DeviceError, err.Error()
	} else {
		ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
		resp, err := s.run(ctx, br)
		cancel()
		switch {
		case errors.Is(err, errBridgeMissing):
			status, detail = protocol.DeviceUnsupported, err.Error()
		case err != nil:
			status, detail = protocol.DeviceOffline, err.Error()
		case !resp.OK:
			status, detail = protocol.DeviceOffline, resp.Error
		}
	}
	s.statusMu.Lock()
	s.lastStatus, s.lastDetail, s.lastProbeAt = status, detail, time.Now()
	s.statusMu.Unlock()
	return status, detail
}

var errBridgeMissing = errors.New("gnext-saman-bridge.exe is not installed next to the agent")

// BridgePath is where the Saman bridge lives: GNEXT_SAMAN_BRIDGE, or saman\ beside the agent.
func BridgePath() string {
	if p := os.Getenv("GNEXT_SAMAN_BRIDGE"); p != "" {
		return p
	}
	exe, _ := os.Executable()
	return filepath.Join(filepath.Dir(exe), "saman", "gnext-saman-bridge.exe")
}

// BridgeDir is the bridge folder agent updates keep current (§9.3), or "" when
// GNEXT_SAMAN_BRIDGE points at a bridge of the developer's own.
func BridgeDir() string {
	if os.Getenv("GNEXT_SAMAN_BRIDGE") != "" {
		return ""
	}
	return filepath.Dir(BridgePath())
}

// bridgeMu keeps an update from swapping the bridge folder while a bridge runs from it.
var bridgeMu sync.RWMutex

// LockBridge waits for running bridges to finish and holds new ones off until the returned
// unlock is called.
func LockBridge() (unlock func()) {
	bridgeMu.Lock()
	return bridgeMu.Unlock
}

func runBridge(ctx context.Context, req bridgeRequest) (bridgeResponse, error) {
	bridgeMu.RLock()
	defer bridgeMu.RUnlock()
	var out bridgeResponse
	path := BridgePath()
	if _, err := os.Stat(path); err != nil {
		return out, errBridgeMissing
	}
	in, _ := json.Marshal(req)
	cmd := exec.CommandContext(ctx, path)
	cmd.Dir = filepath.Dir(path)
	// Saman's SDK logs (which may include terminal details) go to the agent's locked log folder.
	cmd.Env = append(os.Environ(), "GNEXT_SAMAN_LOG_DIR="+filepath.Join(store.LogsDir(), "saman"))
	cmd.Stdin = bytes.NewReader(append(in, '\n'))
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	hideWindow(cmd)
	if err := cmd.Run(); err != nil {
		return out, fmt.Errorf("bridge: %w (%s)", err, lastLine(stderr.String()))
	}
	line := lastLine(stdout.String())
	if err := json.Unmarshal([]byte(line), &out); err != nil {
		return out, fmt.Errorf("bridge answered %q: %w", line, err)
	}
	return out, nil
}

func lastLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	return strings.TrimSpace(lines[len(lines)-1])
}

func firstNonEmpty(vs ...string) string {
	for _, v := range vs {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func digits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// maskPAN keeps at most the first 6 and last 4 digits (§7.4), whatever the terminal sent.
func maskPAN(s string) string {
	var chars []rune
	for _, r := range s {
		if (r >= '0' && r <= '9') || r == '*' || r == '#' || r == 'X' || r == 'x' {
			chars = append(chars, r)
		}
	}
	known := 0
	for _, r := range chars {
		if r >= '0' && r <= '9' {
			known++
		}
	}
	if len(chars) < 10 || known < 4 { // a placeholder such as ######-**-####
		return ""
	}
	for i := range chars {
		if i >= 6 && i < len(chars)-4 || chars[i] < '0' || chars[i] > '9' {
			chars[i] = '*'
		}
	}
	return string(chars)
}

func cancelled(description string) bool {
	d := strings.ToLower(description)
	for _, w := range []string{"لغو", "انصراف", "cancel"} {
		if strings.Contains(d, w) {
			return true
		}
	}
	return false
}
