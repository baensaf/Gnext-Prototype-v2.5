// Package payment drives card terminals (§7.3–7.6).
package payment

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"strings"
	"sync"
	"time"

	"gnext/agent/internal/protocol"
)

var ErrQueryUnsupported = errors.New("terminal driver cannot query transactions")

type ChargeRequest struct {
	AttemptID string
	Amount    string
	Timeout   time.Duration
}

type QueryRequest struct {
	AttemptID string
	Amount    string
}

// Outcome is what a driver learned. Status is a protocol.Pay* value; ErrorCode a §8.3 code.
type Outcome struct {
	Status           string
	Amount           string
	RRN              string
	STAN             string
	AuthCode         string
	TerminalSerial   string
	CardPANMasked    string
	BankResponseCode string
	ErrorCode        string
	Message          string
}

// Driver is one terminal protocol (§7.6).
type Driver interface {
	Charge(ctx context.Context, req ChargeRequest) (Outcome, error)
	Query(ctx context.Context, req QueryRequest) (Outcome, error)
	Probe(ctx context.Context) (string, string)
}

// NewDriver returns the driver named in config, or nil when this build does not have it.
func NewDriver(t protocol.Terminal) Driver {
	if t.Driver == nil {
		return nil
	}
	switch *t.Driver {
	case "fake":
		return fakes.get(t.ID)
	case "sep":
		return seps.get(t)
	}
	return nil
}

// Fake terminal for development (§7.6): amounts ending in 0 are approved, 1 declined,
// 2 time out (UNKNOWN; a later query finds them approved), 3 cancelled on the terminal,
// anything else approved.
type Fake struct {
	mu       sync.Mutex
	approved map[string]Outcome
}

var fakes = fakeRegistry{m: map[string]*Fake{}}

type fakeRegistry struct {
	mu sync.Mutex
	m  map[string]*Fake
}

func (r *fakeRegistry) get(id string) *Fake {
	r.mu.Lock()
	defer r.mu.Unlock()
	if f, ok := r.m[id]; ok {
		return f
	}
	f := &Fake{approved: map[string]Outcome{}}
	r.m[id] = f
	return f
}

func (f *Fake) Charge(ctx context.Context, req ChargeRequest) (Outcome, error) {
	select { // a customer taking a moment with the card
	case <-time.After(2 * time.Second):
	case <-ctx.Done():
		return Outcome{Status: protocol.PayUnknown, ErrorCode: protocol.ErrConnectionLost}, nil
	}
	switch {
	case strings.HasSuffix(req.Amount, "1"):
		return Outcome{Status: protocol.PayDeclined, ErrorCode: protocol.ErrDeclined, BankResponseCode: "51", Message: "insufficient funds (fake)"}, nil
	case strings.HasSuffix(req.Amount, "2"):
		f.remember(req.AttemptID, approve(req.Amount))
		select {
		case <-time.After(req.Timeout):
		case <-ctx.Done():
		}
		return Outcome{Status: protocol.PayUnknown, ErrorCode: protocol.ErrTimeout, Message: "no answer from terminal (fake)"}, nil
	case strings.HasSuffix(req.Amount, "3"):
		return Outcome{Status: protocol.PayCancelled, ErrorCode: protocol.ErrCancelledByUser}, nil
	}
	out := approve(req.Amount)
	f.remember(req.AttemptID, out)
	return out, nil
}

func (f *Fake) Query(_ context.Context, req QueryRequest) (Outcome, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if out, ok := f.approved[req.AttemptID]; ok {
		return out, nil
	}
	return Outcome{Status: protocol.PayUnknown, ErrorCode: protocol.ErrTimeout, Message: "terminal has no record (fake)"}, nil
}

func (f *Fake) Probe(context.Context) (string, string) { return protocol.DeviceOnline, "" }

func (f *Fake) remember(attemptID string, out Outcome) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.approved[attemptID] = out
}

func approve(amount string) Outcome {
	return Outcome{
		Status:           protocol.PayApproved,
		Amount:           amount,
		RRN:              fmt.Sprintf("%012d", rand.Int64N(1e12)),
		STAN:             fmt.Sprintf("%06d", rand.IntN(1e6)),
		AuthCode:         fmt.Sprintf("%06d", rand.IntN(1e6)),
		TerminalSerial:   "FAKE-0001",
		CardPANMasked:    "603799******0000",
		BankResponseCode: "00",
	}
}
