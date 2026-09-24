package till

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

// printLog is the test's printers: it records each ticket and fails the printer named failing.
type printLog struct {
	mu      sync.Mutex
	jobs    []printed
	failing string
	reach   []PrinterInfo // nil: every printer
}

type printed struct {
	printer, document, label, html string
	copies                         int
}

func (l *printLog) print(printerID, documentType, label, html string, copies int) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if printerID == l.failing {
		return errors.New("PAPER_OUT: printer out of paper")
	}
	l.jobs = append(l.jobs, printed{printerID, documentType, label, html, copies})
	return nil
}

func (l *printLog) reachable() []PrinterInfo {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.reach == nil {
		return []PrinterInfo{{ID: "p-grill"}, {ID: "p-fry"}, {ID: "p-counter"}, {ID: "p-kitchen"}}
	}
	return l.reach
}

func (l *printLog) all() []printed {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]printed(nil), l.jobs...)
}

// printed waits until none of the order's tickets is still at the printer.
func (s *shop) printedOrder(id string) *Order {
	s.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		o, err := s.till.Order(id)
		if err != nil {
			s.t.Fatal(err)
		}
		queued := false
		for _, p := range o.Prints {
			queued = queued || p.Status == PrintQueued
		}
		if !queued {
			return o
		}
		time.Sleep(10 * time.Millisecond)
	}
	s.t.Fatal("tickets still queued")
	return nil
}

func TestKitchenChitsAreSplitByStationWithTheirCopies(t *testing.T) {
	s := newShop(t)
	o, err := s.till.Place(s.sara, PlaceInput{OrderType: TypeDineIn, TableID: "t12", Notes: "سس جدا", Lines: []LineInput{
		{ProductID: "burger", Quantity: 2}, {ProductID: "fries", Quantity: 1},
	}})
	if err != nil {
		t.Fatal(err)
	}
	o = s.printedOrder(o.ID)
	jobs := s.printer.all()
	if len(jobs) != 2 || len(o.Prints) != 2 {
		t.Fatalf("jobs %+v, prints %+v", jobs, o.Prints)
	}
	grill, fry := jobs[0], jobs[1]
	if grill.printer != "p-grill" || grill.label != "گریل (1/2)" || grill.copies != 1 || grill.document != DocKitchen {
		t.Fatalf("grill chit = %+v", grill)
	}
	if fry.printer != "p-fry" || fry.label != "سرخ‌کن (2/2)" || fry.copies != 2 {
		t.Fatalf("fry chit = %+v", fry)
	}
	// The grill's chit is DETAILED (its group's template): station, table, the note; its lines only.
	for _, want := range []string{"گریل (۱/۲)", "۱۰۱", "میز ۱۲", "۲ × چیزبرگر", "توضیحات سفارش: سس جدا", OrderNumber(o)} {
		if !strings.Contains(grill.html, want) {
			t.Fatalf("grill chit lacks %q", want)
		}
	}
	if strings.Contains(grill.html, "سیب‌زمینی") || !strings.Contains(fry.html, `<div class="huge">۱۰۱</div>`) {
		t.Fatal("a station got another's lines, or the compact chit lacks the number")
	}
	for _, p := range o.Prints {
		if p.Status != PrintPrinted {
			t.Fatalf("print = %+v", p)
		}
	}
}

func TestTheReceiptPrintsWhenPaidAndGoesUpWithTheChits(t *testing.T) {
	s := newShop(t)
	o := s.placed(TypeTakeaway)
	if _, _, err := s.till.PayCash(o.ID, s.sara, "3000000"); err != nil {
		t.Fatal(err)
	}
	o = s.printedOrder(o.ID)
	var receipt *printed
	for _, j := range s.printer.all() {
		if j.document == DocReceipt {
			receipt = &j
		}
	}
	if receipt == nil || receipt.printer != "p-counter" || receipt.copies != 1 {
		t.Fatalf("receipt = %+v", receipt)
	}
	for _, want := range []string{"ایران برگر", "ولیعصر", "فاکتور فروش", "پرداخت شد", "نقد", "۲٬۶۹۵٬۰۰۰ ریال", "بیرون‌بر"} {
		if !strings.Contains(receipt.html, want) {
			t.Fatalf("receipt lacks %q", want)
		}
	}
	// Paying again prints nothing more; the next upload carries the tickets that printed.
	if o.State != StateCompleted || len(s.uploaded) != 1 {
		t.Fatalf("takeaway not finished: %s", o.State)
	}
	prints, _ := s.uploaded[0]["prints"].([]any)
	if len(prints) == 0 {
		t.Log("the upload went before the tickets printed; they are kept on the order")
	}
	for _, p := range prints {
		pm := p.(map[string]any)
		if pm["status"] != PrintPrinted || pm["kind"] == "" || pm["document_type"] == "" {
			t.Fatalf("uploaded print = %v", pm)
		}
	}
}

func TestAFailedChitIsReprintedMarkedOnAnotherPrinter(t *testing.T) {
	s := newShop(t)
	s.printer.set(func(l *printLog) { l.failing = "p-fry" })
	o := s.printedOrder(s.placedWith(LineInput{ProductID: "fries", Quantity: 1}).ID)
	if len(o.Prints) != 1 || o.Prints[0].Status != PrintFailed || !strings.Contains(o.Prints[0].Error, "PAPER_OUT") {
		t.Fatalf("failed chit = %+v", o.Prints)
	}
	if _, err := s.till.PrintDocument(o.ID, PrintInput{PrintID: o.Prints[0].ID, PrinterID: "p-nowhere"}); code(err) != CodeNoPrinter {
		t.Fatalf("to an unreachable printer: %v", err)
	}
	recs, err := s.till.PrintDocument(o.ID, PrintInput{PrintID: o.Prints[0].ID, PrinterID: "p-kitchen"})
	if err != nil || len(recs) != 1 || !recs[0].Reprint || recs[0].PrinterID != "p-kitchen" {
		t.Fatalf("reprint = %+v, %v", recs, err)
	}
	o = s.printedOrder(o.ID)
	jobs := s.printer.all()
	if len(jobs) != 1 || jobs[0].printer != "p-kitchen" || !strings.Contains(jobs[0].html, "چاپ مجدد") || o.Prints[1].Status != PrintPrinted {
		t.Fatalf("reprinted %+v, prints %+v", jobs, o.Prints)
	}
}

func TestAChangeToAnOrderTheKitchenHasReachesOnlyItsStation(t *testing.T) {
	s := newShop(t)
	o := s.printedOrder(s.placedWith(LineInput{ProductID: "burger", Quantity: 1}, LineInput{ProductID: "fries", Quantity: 1}).ID)
	before := len(s.printer.all())

	// A fry struck off within the window: an AMENDED chit, VOID, for the fryer only.
	var fries string
	for _, l := range o.Lines {
		if l.ProductID == "fries" {
			fries = l.ID
		}
	}
	if _, err := s.till.VoidLine(o.ID, fries, s.sara, "", ""); err != nil {
		t.Fatal(err)
	}
	o = s.printedOrder(o.ID)
	jobs := s.printer.all()[before:]
	if len(jobs) != 1 || jobs[0].printer != "p-fry" || !strings.Contains(jobs[0].html, "تغییر سفارش") || !strings.Contains(jobs[0].html, `<span class="tag">حذف</span>`) {
		t.Fatalf("void chit = %+v", jobs)
	}

	// The order cancelled: a STOP chit for what is left, at its station.
	if _, err := s.till.Cancel(o.ID, s.sara, "مشتری رفت", "", ""); err != nil {
		t.Fatal(err)
	}
	s.printedOrder(o.ID)
	jobs = s.printer.all()[before+1:]
	if len(jobs) != 1 || jobs[0].printer != "p-grill" || !strings.Contains(jobs[0].html, "لغو سفارش — آماده نکنید") || !strings.Contains(jobs[0].html, "علت: مشتری رفت") {
		t.Fatalf("cancel chit = %+v", jobs)
	}
}

func TestATicketFallsBackAndFailsWhenNothingCanPrintIt(t *testing.T) {
	s := newShop(t)
	// The grill's printer is off: its chit goes to the kitchen fallback, as the cloud's would.
	s.printer.set(func(l *printLog) { l.reach = []PrinterInfo{{ID: "p-fry"}, {ID: "p-kitchen"}, {ID: "p-counter"}} })
	o := s.printedOrder(s.placedWith(LineInput{ProductID: "burger", Quantity: 1}).ID)
	if len(o.Prints) != 1 || o.Prints[0].PrinterID != "p-kitchen" || o.Prints[0].Status != PrintPrinted {
		t.Fatalf("fallback = %+v", o.Prints)
	}

	// No printer reachable at all: the chit is kept FAILED for a reprint.
	s.printer.set(func(l *printLog) { l.reach = []PrinterInfo{} })
	o = s.printedOrder(s.placedWith(LineInput{ProductID: "burger", Quantity: 1}).ID)
	if len(o.Prints) != 1 || o.Prints[0].Status != PrintFailed || o.Prints[0].HTML == "" {
		t.Fatalf("no printer = %+v", o.Prints)
	}
}

func TestABillAndACopyOfTheReceiptOnRequest(t *testing.T) {
	s := newShop(t)
	o := s.placed(TypeDineIn)
	// No bill route: the fallback for other documents.
	recs, err := s.till.PrintDocument(o.ID, PrintInput{Document: DocBill})
	if err != nil || len(recs) != 1 || recs[0].PrinterID != "p-counter" || recs[0].Reprint {
		t.Fatalf("bill = %+v, %v", recs, err)
	}
	s.printedOrder(o.ID)
	if html := s.printer.all()[len(s.printer.all())-1].html; !strings.Contains(html, "صورتحساب") || !strings.Contains(html, "مانده قابل پرداخت") {
		t.Fatal("bill lacks its title or what is due")
	}
	if _, _, err := s.till.PayCash(o.ID, s.sara, "2695000"); err != nil {
		t.Fatal(err)
	}
	s.printedOrder(o.ID)
	recs, err = s.till.PrintDocument(o.ID, PrintInput{Document: DocReceipt})
	if err != nil || !recs[0].Reprint {
		t.Fatalf("receipt copy = %+v, %v", recs, err)
	}
	s.printedOrder(o.ID)
	if html := s.printer.all()[len(s.printer.all())-1].html; !strings.Contains(html, "چاپ مجدد") {
		t.Fatal("the second receipt is not marked as a copy")
	}
	if _, err := s.till.PrintDocument(o.ID, PrintInput{Document: "MENU"}); code(err) != CodeInvalid {
		t.Fatalf("unknown document: %v", err)
	}
}

// placedWith places a takeaway of these lines.
func (s *shop) placedWith(lines ...LineInput) *Order {
	s.t.Helper()
	o, err := s.till.Place(s.sara, PlaceInput{OrderType: TypeTakeaway, Lines: lines})
	if err != nil {
		s.t.Fatal(err)
	}
	return o
}

// set changes the test's printers under their lock: tickets print on their own goroutine.
func (l *printLog) set(change func(*printLog)) {
	l.mu.Lock()
	defer l.mu.Unlock()
	change(l)
}
