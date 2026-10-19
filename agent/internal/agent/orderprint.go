package agent

import (
	"context"
	"errors"
	"time"

	"gnext/agent/internal/chit"
	"gnext/agent/internal/printing"
	"gnext/agent/internal/protocol"
)

// orderQueue is the queue order.print runs on: one order's chits print one after the other, and
// orders print in the order they came.
const orderQueue = "order.print"

// runOrderPrint routes one order's kitchen lines to the branch's printers with the routing in the
// current config, lays out each chit and prints it (§21). Every chit is reported, printed or not,
// so the cloud's print queue shows each one where it went.
func (a *Agent) runOrderPrint(env protocol.Envelope, op protocol.OrderPrint) {
	if !a.begin(env.ID) {
		return
	}
	defer a.running.Add(-1)
	started := time.Now()
	cfg := a.cfg.Load()
	var printers []protocol.Printer
	var routing *protocol.Routing
	if cfg != nil {
		printers, routing = cfg.Printers, cfg.Routing
	}

	res := protocol.OrderPrintResult{JobID: op.JobID, OrderID: op.OrderID, Chits: []protocol.ChitResult{}, StartedAt: protocol.Now(started)}
	for _, c := range chit.Split(printers, routing, op.Lines) {
		html := chit.Render(op.Heading, c, op.KitchenChange, op.ChangeReason)
		out := protocol.ChitResult{Label: c.Label, WholeOrder: c.WholeOrder, LineIDs: lineIDs(c.Lines), HTML: html, Status: "SUCCESS"}
		if c.Printer != nil {
			out.PrinterID = c.Printer.ID
		}
		if err := a.printChit(c.Printer, html, c.Label, op.JobID); err != nil {
			out.Status, out.Error = "FAILED", err
		}
		res.Chits = append(res.Chits, out)
	}
	res.FinishedAt = protocol.Now(time.Now())
	a.finish(env.ID, protocol.TypeOrderPrintResult, res)
}

// printChit prints one chit, or says why it could not: no printer, a printer out of service, or
// one this agent cannot reach (the cloud's simulator prints a printer with no connection).
func (a *Agent) printChit(p *protocol.Printer, html, label, jobID string) *protocol.Error {
	switch {
	case p == nil:
		return &protocol.Error{Code: protocol.ErrUnrouted, Message: "the branch has no kitchen printer for these items"}
	case !p.Active:
		return &protocol.Error{Code: protocol.ErrPrinterOutOfService, Message: "printer " + p.Name + " is out of service"}
	case p.Connection == nil || !printing.Supported(*p):
		return &protocol.Error{Code: protocol.ErrDeviceNotConfigured, Message: "printer " + p.Name + " is not connected to the branch agent"}
	}
	job := protocol.PrintJob{JobID: jobID, PrinterID: p.ID, DocumentType: "KITCHEN_TICKET", Label: label, Copies: 1}
	job.Content.Format, job.Content.HTML = "html", html
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := a.o.Printer.Print(ctx, *p, job); err != nil {
		code := protocol.ErrPrinterUnreachable
		var f *printing.Failure
		if errors.As(err, &f) {
			code = f.Code
		}
		a.o.Log.Warn("chit failed", "job", jobID, "printer", p.Code, "err", err)
		return &protocol.Error{Code: code, Message: err.Error()}
	}
	return nil
}

func lineIDs(lines []protocol.ChitLine) []string {
	ids := make([]string, len(lines))
	for i, l := range lines {
		ids[i] = l.LineID
	}
	return ids
}
