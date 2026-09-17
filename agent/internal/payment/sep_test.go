package payment

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"gnext/agent/internal/protocol"
)

func sepWith(conn protocol.Connection, run bridgeRunner) *Sep {
	return &Sep{conn: conn, run: run}
}

func lan() protocol.Connection {
	return protocol.Connection{Kind: "tcp", Host: "192.168.1.60", Port: json.RawMessage(`8888`)}
}

func answer(code, desc string) bridgeRunner {
	return func(_ context.Context, req bridgeRequest) (bridgeResponse, error) {
		var r bridgeResponse
		r.OK, r.Stage = true, "done"
		r.Result.ResponseCode, r.Result.ResponseDescription = code, desc
		r.Result.RRN, r.Result.TraceNumber, r.Result.TerminalID = "123456789012", "004512", "T-1"
		r.Result.CardNumberMask = "603799-****-**-1234"
		r.Result.AffectiveAmount = "1,250,000"
		return r, nil
	}
}

func TestSepChargeOutcomes(t *testing.T) {
	ctx := context.Background()
	req := ChargeRequest{AttemptID: "a", Amount: "1250000", Timeout: 90 * time.Second}

	var sent bridgeRequest
	s := sepWith(lan(), func(ctx context.Context, r bridgeRequest) (bridgeResponse, error) {
		sent = r
		return answer("00", "")(ctx, r)
	})
	out, _ := s.Charge(ctx, req)
	if out.Status != protocol.PayApproved || out.RRN != "123456789012" || out.STAN != "004512" || out.Amount != "1250000" {
		t.Fatalf("approved: %+v", out)
	}
	if out.CardPANMasked != "603799******1234" {
		t.Fatalf("pan: %q", out.CardPANMasked)
	}
	if sent.Media != "lan" || sent.IP != "192.168.1.60" || sent.Amount != "1250000" || sent.TimeoutS != 90 || sent.Op != "charge" {
		t.Fatalf("bridge request: %+v", sent)
	}

	if out, _ := sepWith(lan(), answer("51", "موجودی کافی نیست")).Charge(ctx, req); out.Status != protocol.PayDeclined || out.BankResponseCode != "51" {
		t.Fatalf("declined: %+v", out)
	}
	if out, _ := sepWith(lan(), answer("12", "تراکنش توسط کاربر لغو شد")).Charge(ctx, req); out.Status != protocol.PayCancelled {
		t.Fatalf("cancelled: %+v", out)
	}
	if out, _ := sepWith(lan(), answer("", "")).Charge(ctx, req); out.Status != protocol.PayUnknown {
		t.Fatalf("no code: %+v", out)
	}

	unreachable := func(context.Context, bridgeRequest) (bridgeResponse, error) {
		return bridgeResponse{OK: false, Stage: "connect", Error: "cannot reach"}, nil
	}
	if out, _ := sepWith(lan(), unreachable).Charge(ctx, req); out.Status != protocol.PayFailed || out.ErrorCode != protocol.ErrTerminalUnreachable {
		t.Fatalf("connect failure must be FAILED: %+v", out)
	}
	midCharge := func(context.Context, bridgeRequest) (bridgeResponse, error) {
		return bridgeResponse{OK: false, Stage: "send", Error: "IOException"}, nil
	}
	if out, _ := sepWith(lan(), midCharge).Charge(ctx, req); out.Status != protocol.PayUnknown {
		t.Fatalf("send failure must be UNKNOWN: %+v", out)
	}
	killed := func(context.Context, bridgeRequest) (bridgeResponse, error) {
		return bridgeResponse{}, errors.New("exit status 1")
	}
	if out, _ := sepWith(lan(), killed).Charge(ctx, req); out.Status != protocol.PayUnknown {
		t.Fatalf("bridge death must be UNKNOWN: %+v", out)
	}
}

func TestSepUsesComPortForSerial(t *testing.T) {
	var sent bridgeRequest
	s := sepWith(protocol.Connection{Kind: "serial", Port: json.RawMessage(`"COM4"`), Baud: 115200}, func(ctx context.Context, r bridgeRequest) (bridgeResponse, error) {
		sent = r
		return answer("00", "")(ctx, r)
	})
	if status, _ := s.Probe(context.Background()); status != protocol.DeviceOnline {
		t.Fatalf("probe: %s", status)
	}
	if sent.Media != "com" || sent.Com != "COM4" || sent.Op != "test" {
		t.Fatalf("bridge request: %+v", sent)
	}
}

func TestSepProbeIsCachedAndSkipsBusyTerminal(t *testing.T) {
	calls := 0
	s := sepWith(lan(), func(ctx context.Context, r bridgeRequest) (bridgeResponse, error) {
		calls++
		return answer("00", "")(ctx, r)
	})
	s.Probe(context.Background())
	s.Probe(context.Background())
	if calls != 1 {
		t.Fatalf("probe ran %d times", calls)
	}

	busy := sepWith(lan(), func(context.Context, bridgeRequest) (bridgeResponse, error) {
		t.Fatal("probed a terminal in the middle of a charge")
		return bridgeResponse{}, nil
	})
	busy.mu.Lock()
	if status, _ := busy.Probe(context.Background()); status != protocol.DeviceUnknown {
		t.Fatalf("busy probe: %s", status)
	}
	busy.mu.Unlock()
}

func TestSepQueryIsUnsupported(t *testing.T) {
	if _, err := sepWith(lan(), nil).Query(context.Background(), QueryRequest{}); !errors.Is(err, ErrQueryUnsupported) {
		t.Fatalf("err = %v", err)
	}
}

func TestMaskPAN(t *testing.T) {
	for in, want := range map[string]string{
		"6037991234561234":    "603799******1234",
		"603799-****-**-1234": "603799******1234",
		"######-**-####":      "",
		"":                    "",
	} {
		if got := maskPAN(in); got != want {
			t.Errorf("maskPAN(%q) = %q, want %q", in, got, want)
		}
	}
}
