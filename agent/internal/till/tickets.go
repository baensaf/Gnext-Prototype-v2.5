package till

import (
	"errors"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Print statuses (§13.8). A ticket is QUEUED from when the till decides to print it until the
// printer answers.
const (
	PrintQueued  = "QUEUED"
	PrintPrinted = "PRINTED"
	PrintFailed  = "FAILED"
)

// Documents the till prints (§13.8).
const (
	DocKitchen = "KITCHEN_TICKET"
	DocReceipt = "CUSTOMER_RECEIPT"
	DocBill    = "GUEST_BILL"
)

// CodeNoPrinter refuses a reprint to a printer the agent cannot reach.
const CodeNoPrinter = "NO_PRINTER"

// PrintRecord is one ticket on one printer, and how it went (§12.4 `prints`).
type PrintRecord struct {
	ID           string    `json:"id"`
	DocumentType string    `json:"document_type"`
	Label        string    `json:"label,omitempty"` // the station on a kitchen chit
	PrinterID    string    `json:"printer_id,omitempty"`
	Copies       int       `json:"copies"`
	Status       string    `json:"status"`
	Error        string    `json:"error,omitempty"`
	Reprint      bool      `json:"reprint,omitempty"`
	At           time.Time `json:"at"`
	// HTML is the page as printed, kept for a reprint of this very ticket.
	HTML string `json:"html,omitempty"`
}

// PrinterInfo is a printer the till can send a ticket to.
type PrinterInfo struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

// ErrNoPrinter is what Print returns for a printer the agent cannot reach.
var ErrNoPrinter = errors.New("no active printer this agent can reach")

// target is one printer a ticket goes to, and how many copies.
type target struct {
	printerID string
	copies    int
}

// kitchenLine is one line on a kitchen chit, with the change it announces (VOID or ADD).
type kitchenLine struct {
	line   OrderLine
	change string
}

func (t *Till) printerActive(id string) bool {
	if t.Printers == nil {
		return true
	}
	return slices.ContainsFunc(t.Printers(), func(p PrinterInfo) bool { return p.ID == id })
}

// targets are the printers of a route's group that the agent can reach, each route copies ×
// member copies; else the fallback, route copies times (the cloud's printersForRoute).
func (t *Till) targets(c *Catalog, route *PrintRoute, fallback *string) []target {
	routeCopies := 1
	if route != nil && route.Copies > 0 {
		routeCopies = route.Copies
	}
	if route != nil {
		if g := c.group(route.GroupID); g != nil {
			out := []target{}
			for _, m := range g.Printers {
				if t.printerActive(m.PrinterID) {
					out = append(out, target{printerID: m.PrinterID, copies: routeCopies * max(m.Copies, 1)})
				}
			}
			if len(out) > 0 {
				return out
			}
		}
	}
	if fallback != nil && *fallback != "" && t.printerActive(*fallback) {
		return []target{{printerID: *fallback, copies: routeCopies}}
	}
	return nil
}

func (c *Catalog) group(id string) *PrinterGroup {
	for i := range c.Printing.Groups {
		if c.Printing.Groups[i].ID == id {
			return &c.Printing.Groups[i]
		}
	}
	return nil
}

func (g *PrinterGroup) template() string {
	if g == nil || g.TicketTemplate == nil {
		return ""
	}
	return *g.TicketTemplate
}

// OrderNumber is how an offline order is named on screen and on paper until the cloud numbers it.
func OrderNumber(o *Order) string {
	return "OFF-" + strings.ToUpper(strings.SplitN(o.ID, "-", 2)[0])
}

// heading is what every document for the order is headed with (the cloud's orderHeading).
func heading(c *Catalog, o *Order, at time.Time) RenderDoc {
	h := c.Printing.Heading
	doc := RenderDoc{
		OrderNumber: OrderNumber(o), CallNumber: o.CallNumber, OrderType: o.OrderType, Channel: "POS",
		PlacedAt: at.UTC().Format(time.RFC3339Nano), Calendar: h.Calendar,
		BrandName: h.BrandName, BranchName: h.BranchName, BranchAddress: h.BranchAddress, BranchPhone: h.BranchPhone,
	}
	if o.TableID != nil {
		for _, tb := range c.DiningTables {
			if tb.ID == *o.TableID {
				doc.TableNumber = tb.Number
			}
		}
	}
	if o.Notes != nil {
		doc.OrderNotes = *o.Notes
	}
	return doc
}

// renderItem is a line as the cloud's renderLine puts it on paper.
func renderItem(l OrderLine, change string) RenderItem {
	name := l.ProductName
	if l.VariantName != nil && *l.VariantName != "" {
		name += " (" + *l.VariantName + ")"
	}
	options := make([]string, 0, len(l.Options))
	for _, o := range l.Options {
		options = append(options, o.Name)
	}
	item := RenderItem{
		ProductName: name, Quantity: l.Quantity, UnitPrice: l.UnitPrice, TotalPrice: l.LineTotal,
		OptionsSummary: strings.Join(options, "، "), Change: change,
	}
	if l.Notes != nil {
		item.SpecialInstructions = *l.Notes
	}
	return item
}

// kitchenTickets splits lines by kitchen route as the cloud's splitByRoute does: lines that share
// a printer group share one chit, labelled with the group's name and (n/m) when there are several.
// A line with no route, or a group no printer of which the agent can reach, falls back.
func (t *Till) kitchenTickets(c *Catalog, o *Order, lines []kitchenLine, change, reason string, at time.Time) []PrintRecord {
	var order []string
	batches := map[string]*chitBatch{}
	for _, kl := range lines {
		var route *PrintRoute
		if r, ok := c.Printing.KitchenRoutes[kl.line.ProductID]; ok {
			route = &r
		}
		key := ""
		if route != nil {
			key = route.GroupID
		}
		b, ok := batches[key]
		if !ok {
			batches[key] = &chitBatch{route: route, lines: []kitchenLine{kl}}
			order = append(order, key)
			continue
		}
		b.lines = append(b.lines, kl)
		if route != nil && max(route.Copies, 1) > b.routeCopies() {
			b.route = route
		}
	}
	var out []PrintRecord
	for i, key := range order {
		b := batches[key]
		var g *PrinterGroup
		if b.route != nil {
			g = c.group(b.route.GroupID)
		}
		name := "آشپزخانه"
		if g != nil && g.Name != "" {
			name = g.Name
		}
		label := name
		if len(order) > 1 {
			label = name + " (" + strconv.Itoa(i+1) + "/" + strconv.Itoa(len(order)) + ")"
		}
		doc := heading(c, o, at)
		doc.DocumentType, doc.Template, doc.StationLabel = DocKitchen, g.template(), label
		doc.KitchenChange, doc.ChangeReason = change, reason
		for _, kl := range b.lines {
			doc.Items = append(doc.Items, renderItem(kl.line, kl.change))
		}
		out = append(out, t.records(DocKitchen, label, RenderDocument(doc), t.targets(c, b.route, c.Printing.Fallback.KitchenTicket), false)...)
	}
	return out
}

// chitBatch is one station's chit: its route and its lines.
type chitBatch struct {
	route *PrintRoute
	lines []kitchenLine
}

func (b *chitBatch) routeCopies() int {
	if b.route == nil {
		return 1
	}
	return max(b.route.Copies, 1)
}

// documentTickets prints a whole-order document on its route (§13.8).
func (t *Till) documentTickets(c *Catalog, o *Order, documentType string, reprint bool) []PrintRecord {
	route := c.Printing.Documents[documentType]
	var g *PrinterGroup
	if route != nil {
		g = c.group(route.GroupID)
	}
	doc := heading(c, o, o.PlacedAt)
	doc.DocumentType, doc.Template, doc.IsReprint = documentType, g.template(), reprint
	for _, l := range o.Lines {
		doc.Items = append(doc.Items, renderItem(l, ""))
	}
	due := outstanding(o).String()
	subtotal, grand := o.Totals.Subtotal, o.Totals.GrandTotal
	doc.Subtotal, doc.GrandTotal, doc.OutstandingTotal = &subtotal, &grand, &due
	doc.DiscountTotal, doc.TaxTotal, doc.DeliveryFee = o.Totals.DiscountTotal, o.Totals.TaxTotal, o.Totals.DeliveryFee
	for _, p := range o.Payments {
		if p.Status == PayApproved || p.Status == PayUnknown {
			doc.Payments = append(doc.Payments, RenderPayment{Method: p.MethodKind, Amount: p.Amount})
		}
	}
	return t.records(documentType, "", RenderDocument(doc), t.targets(c, route, c.Printing.Fallback.Other), reprint)
}

// records are the tickets to print, one per printer, or one FAILED when no printer is reachable.
func (t *Till) records(documentType, label, html string, targets []target, reprint bool) []PrintRecord {
	now := t.Now().UTC()
	if len(targets) == 0 {
		return []PrintRecord{{
			ID: uuid.NewString(), DocumentType: documentType, Label: label, Copies: 1, Status: PrintFailed,
			Error: "چاپگری برای این برگه پیدا نشد.", Reprint: reprint, At: now, HTML: html,
		}}
	}
	out := make([]PrintRecord, 0, len(targets))
	for _, tg := range targets {
		out = append(out, PrintRecord{
			ID: uuid.NewString(), DocumentType: documentType, Label: label, PrinterID: tg.printerID, Copies: tg.copies,
			Status: PrintQueued, Reprint: reprint, At: now, HTML: html,
		})
	}
	return out
}

// queuePrints adds tickets to the order, which the caller then keeps; print sends them once kept.
// Without a printer hook (Print) the till prints nothing.
func (t *Till) queuePrints(o *Order, recs []PrintRecord) []PrintRecord {
	if t.Print == nil || len(recs) == 0 {
		return nil
	}
	o.Prints = append(o.Prints, recs...)
	return recs
}

// print sends queued tickets to their printers, one after another, and records how each went.
// It runs after the order holding them is kept, outside the order lock.
func (t *Till) print(orderID string, recs []PrintRecord) {
	if len(recs) == 0 {
		return
	}
	go func() {
		for _, r := range recs {
			if r.Status != PrintQueued {
				continue
			}
			err := t.Print(r.PrinterID, r.DocumentType, r.Label, r.HTML, r.Copies)
			t.omu.Lock()
			if o, gerr := t.Order(orderID); gerr == nil {
				for i := range o.Prints {
					if o.Prints[i].ID == r.ID {
						o.Prints[i].Status, o.Prints[i].At = PrintPrinted, t.Now().UTC()
						if err != nil {
							o.Prints[i].Status, o.Prints[i].Error = PrintFailed, err.Error()
						}
					}
				}
				if perr := t.Store.put(o); perr != nil {
					t.Log.Error("offline print not recorded", "order", orderID, "err", perr)
				}
			}
			t.omu.Unlock()
			if err != nil {
				t.Log.Warn("offline ticket did not print", "order", orderID, "document", r.DocumentType, "printer", r.PrinterID, "err", err)
			}
		}
	}()
}

// receiptPrinted: the order's receipt has been printed once already (a reprint aside).
func (o *Order) receiptPrinted() bool {
	return slices.ContainsFunc(o.Prints, func(p PrintRecord) bool { return p.DocumentType == DocReceipt && !p.Reprint })
}

// PrintInput asks for a document (§13.13): a guest bill, a receipt or the whole order for the
// kitchen, or a reprint of one ticket (PrintID), to its printer or another (PrinterID).
type PrintInput struct {
	Document  string `json:"document"`
	PrintID   string `json:"print_id"`
	PrinterID string `json:"printer_id"`
}

// PrintDocument prints on request. A receipt or a kitchen ticket already printed comes out marked
// as a copy; a reprint of one ticket is that very page, marked, to the printer asked for.
func (t *Till) PrintDocument(id string, in PrintInput) ([]PrintRecord, error) {
	t.init()
	t.omu.Lock()
	o, err := t.Order(id)
	if err != nil {
		t.omu.Unlock()
		return nil, err
	}
	if t.Print == nil {
		t.omu.Unlock()
		return nil, refuse(CodeNoPrinter, "این رایانه به چاپگری وصل نیست.")
	}
	if in.PrinterID != "" && !t.printerActive(in.PrinterID) {
		t.omu.Unlock()
		return nil, refuse(CodeNoPrinter, "این چاپگر در دسترس نیست.")
	}
	c, err := t.catalog()
	if err != nil {
		t.omu.Unlock()
		return nil, err
	}
	var recs []PrintRecord
	switch {
	case in.PrintID != "":
		i := slices.IndexFunc(o.Prints, func(p PrintRecord) bool { return p.ID == in.PrintID })
		if i < 0 {
			t.omu.Unlock()
			return nil, refuse(CodeOrderUnknown, "این برگه در سفارش نیست.")
		}
		p := o.Prints[i]
		printer, copies := p.PrinterID, p.Copies
		if in.PrinterID != "" {
			printer, copies = in.PrinterID, 1
		}
		if printer == "" {
			t.omu.Unlock()
			return nil, refuse(CodeNoPrinter, "چاپگری را انتخاب کنید.")
		}
		recs = t.records(p.DocumentType, p.Label, MarkAsReprint(p.HTML), []target{{printerID: printer, copies: max(copies, 1)}}, true)
	case in.Document == DocBill || in.Document == DocReceipt:
		reprint := in.Document == DocReceipt && o.receiptPrinted()
		recs = t.documentTickets(c, o, in.Document, reprint)
	case in.Document == DocKitchen:
		lines := make([]kitchenLine, 0, len(o.Lines))
		for _, l := range o.Lines {
			lines = append(lines, kitchenLine{line: l})
		}
		recs = t.kitchenTickets(c, o, lines, "", "", o.PlacedAt)
		for i := range recs {
			recs[i].Reprint, recs[i].HTML = true, MarkAsReprint(recs[i].HTML)
		}
	default:
		t.omu.Unlock()
		return nil, refuse(CodeInvalid, "نوع برگه را مشخص کنید.")
	}
	if in.PrinterID != "" && in.PrintID == "" {
		for i := range recs {
			recs[i].PrinterID, recs[i].Copies, recs[i].Status, recs[i].Error = in.PrinterID, 1, PrintQueued, ""
		}
	}
	t.queuePrints(o, recs)
	err = t.Store.put(o)
	t.omu.Unlock()
	if err != nil {
		return nil, err
	}
	t.print(o.ID, recs)
	return recs, nil
}

// PrintersFor lists the printers a ticket can be sent to by hand.
func (t *Till) PrintersFor() []PrinterInfo {
	if t.Printers == nil {
		return []PrinterInfo{}
	}
	return t.Printers()
}

// chitLines are order lines as a chit carries them, each with the same change.
func chitLines(lines []OrderLine, change string) []kitchenLine {
	out := make([]kitchenLine, 0, len(lines))
	for _, l := range lines {
		out = append(out, kitchenLine{line: l, change: change})
	}
	return out
}
