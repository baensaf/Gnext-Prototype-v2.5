package chit

import (
	"strings"
	"testing"

	"gnext/agent/internal/protocol"
)

func ptr(s string) *string { return &s }

var (
	grill = protocol.Printer{ID: "grill", Name: "گریل", Active: true}
	fryer = protocol.Printer{ID: "fryer", Name: "سرخ‌کن", Active: true}
	bar   = protocol.Printer{ID: "bar", Name: "بار", Active: true}
	pass  = protocol.Printer{ID: "pass", Name: "پاس", Active: true}
)

func line(id, product, category string) protocol.ChitLine {
	return protocol.ChitLine{LineID: id, ProductID: product, CategoryID: category, Name: id, Quantity: "1"}
}

func summary(chits []Chit) string {
	parts := make([]string, len(chits))
	for i, c := range chits {
		ids := lineIDs(c.Lines)
		name := "-"
		if c.Printer != nil {
			name = c.Printer.ID
		}
		if c.WholeOrder {
			name += "*"
		}
		parts[i] = name + ":" + strings.Join(ids, ",")
	}
	return strings.Join(parts, " ")
}

func lineIDs(lines []protocol.ChitLine) []string {
	out := make([]string, len(lines))
	for i, l := range lines {
		out[i] = l.LineID
	}
	return out
}

// The cloud's rules (print-routing.service.ts): a product's routes beat its category's, a route
// with no printer is "not printed", and anything else takes the default kitchen printer.
func TestSplitFollowsTheCloudsRoutingRules(t *testing.T) {
	printers := []protocol.Printer{bar, fryer, grill}
	r := &protocol.Routing{
		Routes: []protocol.Route{
			{PrinterID: ptr("grill"), CategoryID: "burgers"},
			{PrinterID: ptr("fryer"), ProductID: "fries"},
			{PrinterID: ptr("grill"), ProductID: "combo"},
			{PrinterID: ptr("fryer"), ProductID: "combo"},
			{PrinterID: nil, CategoryID: "drinks"},
		},
		KitchenDefaultPrinterID: "bar",
	}
	got := summary(Split(printers, r, []protocol.ChitLine{
		line("burger", "cheese", "burgers"),
		line("fries", "fries", "burgers"),
		line("cola", "cola", "drinks"),
		line("combo", "combo", "meals"),
		line("salad", "salad", "salads"),
	}))
	// Printers in the branch's order (bar, fryer, grill), each first seen with its first line.
	if want := "grill:burger,combo fryer:fries,combo bar:salad"; got != want {
		t.Fatalf("split = %q, want %q", got, want)
	}
}

func TestLinesWithNowhereToPrintShareAChitWithNoPrinter(t *testing.T) {
	got := Split([]protocol.Printer{grill}, &protocol.Routing{}, []protocol.ChitLine{line("a", "p1", ""), line("b", "p2", "")})
	if summary(got) != "-:a,b" || got[0].Label != "آشپزخانه" {
		t.Fatalf("split = %q label %q", summary(got), got[0].Label)
	}
}

func TestThePassGetsTheWholeOrderAndLabelsCountTheStations(t *testing.T) {
	printers := []protocol.Printer{fryer, grill, pass}
	r := &protocol.Routing{
		Routes: []protocol.Route{
			{PrinterID: ptr("grill"), CategoryID: "burgers"},
			{PrinterID: ptr("fryer"), CategoryID: "sides"},
			{PrinterID: ptr("pass"), CategoryID: "drinks"},
		},
		WholeOrderPrinterIDs: []string{"pass"},
	}
	chits := Split(printers, r, []protocol.ChitLine{line("burger", "b", "burgers"), line("fries", "f", "sides"), line("cola", "c", "drinks")})
	// The drink goes only to the pass, so it is on the whole-order chit alone.
	if want := "grill:burger fryer:fries pass*:burger,fries,cola"; summary(chits) != want {
		t.Fatalf("split = %q, want %q", summary(chits), want)
	}
	if chits[0].Label != "گریل (1/2)" || strings.Join(chits[0].OtherStations, ",") != "سرخ‌کن" {
		t.Fatalf("label %q, others %v", chits[0].Label, chits[0].OtherStations)
	}
	if chits[2].Label != "پاس" {
		t.Fatalf("pass label %q", chits[2].Label)
	}
}

func TestAVoidGoesWhereTheLineFirstPrinted(t *testing.T) {
	printers := []protocol.Printer{fryer, grill}
	r := &protocol.Routing{Routes: []protocol.Route{{PrinterID: ptr("fryer"), CategoryID: "burgers"}}}
	first := []string{"grill"}
	never := []string{}
	void := line("burger", "b", "burgers")
	void.Change, void.SentTo = "VOID", &first
	skipped := line("cola", "c", "burgers")
	skipped.Change, skipped.SentTo = "VOID", &never
	added := line("fries", "f", "burgers")
	added.Change = "ADD"
	if got := summary(Split(printers, r, []protocol.ChitLine{void, skipped, added})); got != "grill:burger fryer:fries" {
		t.Fatalf("split = %q", got)
	}
}

func TestRenderIsTheCloudsCompactChit(t *testing.T) {
	h := protocol.ChitHeading{DisplayNumber: "123", OrderNumber: "ORD-1", TypeLine: "بیرون‌بر", Time: "۱۲:۳۰", OrderNotes: "بدون پیاز <زود>"}
	v := line("burger", "b", "x")
	v.Name, v.Quantity, v.Change, v.Note = "همبرگر", "2.000", "VOID", "تند"
	html := Render(h, Chit{Label: "گریل", Lines: []protocol.ChitLine{v}, OtherStations: []string{"بار"}}, "AMENDED", "مشتری")
	for _, want := range []string{
		`<div class="huge">۱۲۳</div>`,
		`<div class="c title">بیرون‌بر · ۱۲:۳۰</div>`,
		`<div class="inv">تغییر سفارش</div>`,
		`<span class="tag">حذف</span><span class="void">۲ × همبرگر</span>`,
		`<div class="note">* تند</div>`,
		`توضیحات سفارش: بدون پیاز &lt;زود&gt;`,
		`بخش‌های دیگر: بار`,
		`<!--gnext:reprint-->`,
		`width: 300px`,
	} {
		if !strings.Contains(html, want) {
			t.Errorf("chit lacks %q", want)
		}
	}
	if d := Render(protocol.ChitHeading{DisplayNumber: "7", Template: "DETAILED", OrderNumber: "ORD-7"}, Chit{Label: "گریل (1/2)"}, "", ""); !strings.Contains(d, `<div class="inv">گریل (۱/۲)</div>`) {
		t.Errorf("detailed chit lacks the station label:\n%s", d)
	}
}
