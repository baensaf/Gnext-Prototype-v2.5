package payment

import (
	"context"
	"os"
	"testing"
	"time"

	"gnext/agent/internal/protocol"
)

// Runs the real gnext-saman-bridge.exe against an address with no terminal. Skipped unless
// GNEXT_SAMAN_BRIDGE points at a built bridge (dotnet build saman-bridge -o dist\saman).
func TestSepBridgeUnreachableTerminalIsFailedNotUnknown(t *testing.T) {
	if os.Getenv("GNEXT_SAMAN_BRIDGE") == "" {
		t.Skip("GNEXT_SAMAN_BRIDGE not set")
	}
	t.Setenv("GNEXT_AGENT_HOME", t.TempDir())
	s := &Sep{conn: protocol.Connection{Kind: "tcp", Host: "192.0.2.10"}, run: runBridge}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	out, err := s.Charge(ctx, ChargeRequest{AttemptID: "a", Amount: "10000", Timeout: 20 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != protocol.PayFailed || out.ErrorCode != protocol.ErrTerminalUnreachable {
		t.Fatalf("outcome = %+v", out)
	}
}
