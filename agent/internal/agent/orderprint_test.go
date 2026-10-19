package agent

import (
	"encoding/json"
	"testing"
	"time"

	"gnext/agent/internal/protocol"
)

// order.print (§21): the agent routes the lines with its config, prints the chit it can reach,
// and reports every chit, including one for a printer that is out of service and one for lines
// with nowhere to print.
func TestOrderPrintRoutesPrintsAndReportsEveryChit(t *testing.T) {
	lan := newPrinterLAN(t)
	cfg := testConfig(lan)
	cfg.Printers = append(cfg.Printers, protocol.Printer{ID: "p2", Code: "BAR", Name: "Bar", Active: false})
	kit, bar := "p1", "p2"
	cfg.Routing = &protocol.Routing{Routes: []protocol.Route{
		{PrinterID: &kit, CategoryID: "food"},
		{PrinterID: &bar, CategoryID: "drinks"},
	}}
	cloud := newFakeCloud(t, cfg)
	h := start(t, t.TempDir(), cloud, &stubDriver{})
	defer h.stop(t)
	cloud.waitConnected()

	cloud.command("cmd-order-1", protocol.TypeOrderPrint, map[string]any{
		"expires_at": protocol.Now(time.Now().Add(time.Minute)),
		"job_id":     "job-1",
		"order_id":   "order-1",
		"heading":    map[string]any{"display_number": "42", "order_number": "ORD-42", "type_line": "بیرون‌بر", "time": "۱۲:۰۰"},
		"lines": []map[string]any{
			{"line_id": "l1", "product_id": "burger", "category_id": "food", "name": "همبرگر", "quantity": "1", "sent_to": nil},
			{"line_id": "l2", "product_id": "cola", "category_id": "drinks", "name": "نوشابه", "quantity": "2", "sent_to": nil},
			{"line_id": "l3", "product_id": "bread", "category_id": "extras", "name": "نان", "quantity": "1", "sent_to": nil},
		},
	})
	var ack protocol.Ack
	_ = json.Unmarshal(cloud.next(ofType(protocol.TypeAck, "cmd-order-1")).Payload, &ack)
	if !ack.OK {
		t.Fatalf("order.print refused: %+v", ack.Error)
	}
	var res protocol.OrderPrintResult
	_ = json.Unmarshal(cloud.next(ofType(protocol.TypeOrderPrintResult, "cmd-order-1")).Payload, &res)
	if res.JobID != "job-1" || len(res.Chits) != 3 {
		t.Fatalf("result = %+v", res)
	}
	want := []struct{ printer, status, code, line string }{
		{"p1", "SUCCESS", "", "l1"},
		{"p2", "FAILED", protocol.ErrPrinterOutOfService, "l2"},
		{"", "FAILED", protocol.ErrUnrouted, "l3"},
	}
	for i, w := range want {
		c := res.Chits[i]
		code := ""
		if c.Error != nil {
			code = c.Error.Code
		}
		if c.PrinterID != w.printer || c.Status != w.status || code != w.code || len(c.LineIDs) != 1 || c.LineIDs[0] != w.line || c.HTML == "" {
			t.Errorf("chit %d = %+v (code %q), want %+v", i, c, code, w)
		}
	}
	time.Sleep(200 * time.Millisecond)
	if n := lan.count(); n != 1 {
		t.Fatalf("printer received %d jobs, want 1", n)
	}
}
