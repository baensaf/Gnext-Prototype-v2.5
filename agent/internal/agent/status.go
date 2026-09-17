package agent

import (
	"context"
	"errors"
	"fmt"
	"html"
	"time"

	"gnext/agent/internal/protocol"
)

// Status is what the local settings page shows about the running agent.
type Status struct {
	Connected      bool                    `json:"connected"`
	ConnectedSince *time.Time              `json:"connected_since,omitempty"`
	LastError      string                  `json:"last_error,omitempty"`
	BranchName     string                  `json:"branch_name,omitempty"`
	Config         *protocol.Config        `json:"config"`
	Devices        []protocol.DeviceStatus `json:"devices"`
	Running        int                     `json:"running"`
}

func (a *Agent) Status() Status {
	s := Status{
		Config:  a.cfg.Load(),
		Devices: a.deviceList(),
		Running: int(a.running.Load()),
	}
	if at := a.connectedAt.Load(); at != 0 {
		t := time.Unix(0, at)
		s.Connected, s.ConnectedSince = true, &t
	}
	s.BranchName, _ = a.branchName.Load().(string)
	s.LastError, _ = a.lastError.Load().(string)
	return s
}

// ErrNoSuchPrinter is returned by TestPrint for a printer that is not in the current config.
var ErrNoSuchPrinter = errors.New("no such printer in this branch's configuration")

// TestPrint prints a short Persian test page on a configured printer, outside the journal:
// nothing is reported to the cloud.
func (a *Agent) TestPrint(ctx context.Context, printerID string) error {
	p, ok := findPrinter(a.cfg.Load(), printerID)
	if !ok {
		return ErrNoSuchPrinter
	}
	branch, _ := a.branchName.Load().(string)
	now := time.Now().Format("2006-01-02 15:04:05")
	doc := fmt.Sprintf(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><style>
body { font-family: Tahoma, sans-serif; width: 300px; margin: 0 auto; padding: 16px; font-size: 13px; color: #000; background: #fff; }
h1 { font-size: 20px; text-align: center; margin: 0 0 8px; }
p { margin: 4px 0; }
.ltr { direction: ltr; text-align: left; }
</style></head><body>
<h1>چاپ آزمایشی</h1>
<p>شعبه: %s</p>
<p>چاپگر: %s (%s)</p>
<p class="ltr">%s</p>
<p>اگر این متن فارسی درست خوانده می‌شود، چاپگر آماده است.</p>
</body></html>`, html.EscapeString(branch), html.EscapeString(p.Name), html.EscapeString(p.Code), now)

	job := protocol.PrintJob{JobID: "test", PrinterID: p.ID, DocumentType: "TEST", Copies: 1}
	job.Content.Format, job.Content.HTML = "html", doc
	return a.o.Printer.Print(ctx, p, job)
}
