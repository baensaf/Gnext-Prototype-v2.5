package agent

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"gnext/agent/internal/protocol"
)

// A live query (§20) is answered with one agent.query.result, ref'd to the query, never acked or
// journaled; an unknown query and a failed one say why.
func TestLiveQueriesAreAnsweredByName(t *testing.T) {
	lan := newPrinterLAN(t)
	cloud := newFakeCloud(t, testConfig(lan))
	h := startWith(t, t.TempDir(), cloud, &stubDriver{}, "gak_test", func(o *Options) {
		o.Queries = map[string]QueryFunc{
			protocol.QueryLogs: func(_ context.Context, args json.RawMessage) (any, error) {
				var in struct{ Lines int }
				_ = json.Unmarshal(args, &in)
				return map[string]any{"lines": []string{strings.Repeat("x", in.Lines)}}, nil
			},
			protocol.QueryScan: func(context.Context, json.RawMessage) (any, error) {
				return nil, errors.New("no network")
			},
		}
	})
	defer h.stop(t)
	cloud.waitConnected()
	cloud.mu.Lock()
	raw := cloud.hello.Payload
	cloud.mu.Unlock()
	var hello protocol.Hello
	if err := json.Unmarshal(raw, &hello); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(hello.Capabilities, " "), protocol.CapabilityQuery) {
		t.Fatalf("hello does not advertise %s: %v", protocol.CapabilityQuery, hello.Capabilities)
	}

	result := func(id string) protocol.AgentQueryResult {
		t.Helper()
		env := cloud.next(ofType(protocol.TypeAgentQueryResult, id))
		var r protocol.AgentQueryResult
		if err := json.Unmarshal(env.Payload, &r); err != nil {
			t.Fatal(err)
		}
		return r
	}
	expires := protocol.Now(time.Now().Add(time.Minute))

	cloud.command("q-logs", protocol.TypeAgentQuery, map[string]any{"expires_at": expires, "query": "logs", "args": map[string]any{"lines": 3}})
	if r := result("q-logs"); !r.OK || !strings.Contains(mustJSON(t, r.Data), `"xxx"`) {
		t.Fatalf("logs = %+v", r)
	}
	cloud.command("q-scan", protocol.TypeAgentQuery, map[string]any{"expires_at": expires, "query": "scan"})
	if r := result("q-scan"); r.OK || r.Error == nil || r.Error.Message != "no network" {
		t.Fatalf("failed scan = %+v", r)
	}
	cloud.command("q-what", protocol.TypeAgentQuery, map[string]any{"expires_at": expires, "query": "what"})
	if r := result("q-what"); r.OK || r.Error == nil || r.Error.Code != protocol.ErrUnsupported {
		t.Fatalf("unknown query = %+v", r)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}
