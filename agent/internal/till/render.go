package till

import (
	"regexp"
	"strconv"
	"strings"
	"time"
)

// The paper the offline till prints (§13.8): a port of the cloud's PrintRenderService
// (backend/src/modules/printing/print-render.service.ts), so a ticket printed offline is the one
// the cloud prints for the same order. testdata/tickets holds what the cloud renders for a set of
// cases; the tests here and backend/test/print-render-parity.spec.ts hold both to it, so a change
// on one side fails until the other follows.

// RenderItem is one line on a document.
type RenderItem struct {
	ProductName         string `json:"product_name"`
	Quantity            string `json:"quantity"`
	UnitPrice           string `json:"unit_price,omitempty"`
	TotalPrice          string `json:"total_price,omitempty"`
	SpecialInstructions string `json:"special_instructions,omitempty"`
	OptionsSummary      string `json:"options_summary,omitempty"`
	Change              string `json:"change,omitempty"` // VOID or ADD on a kitchen change
}

// RenderPayment is a payment on a customer document.
type RenderPayment struct {
	Method string `json:"method"`
	Amount string `json:"amount"`
}

// RenderDoc is what a document shows (RenderDocOptions in the cloud).
type RenderDoc struct {
	DocumentType     string          `json:"documentType"`
	OrderNumber      string          `json:"orderNumber"`
	CallNumber       *int            `json:"callNumber,omitempty"`
	Template         string          `json:"template,omitempty"`
	BrandName        string          `json:"brandName,omitempty"`
	BranchName       string          `json:"branchName,omitempty"`
	BranchAddress    string          `json:"branchAddress,omitempty"`
	BranchPhone      string          `json:"branchPhone,omitempty"`
	OrderType        string          `json:"orderType,omitempty"`
	Channel          string          `json:"channel,omitempty"`
	TableNumber      string          `json:"tableNumber,omitempty"`
	CustomerName     string          `json:"customerName,omitempty"`
	CustomerMobile   string          `json:"customerMobile,omitempty"`
	DeliveryAddress  string          `json:"deliveryAddress,omitempty"`
	OrderNotes       string          `json:"orderNotes,omitempty"`
	PlacedAt         string          `json:"placedAt,omitempty"` // RFC 3339
	Calendar         string          `json:"calendar,omitempty"` // JALALI (default) or GREGORIAN
	StationLabel     string          `json:"stationLabel,omitempty"`
	KitchenChange    string          `json:"kitchenChange,omitempty"` // AMENDED or CANCELLED
	ChangeReason     string          `json:"changeReason,omitempty"`
	IsReprint        bool            `json:"isReprint,omitempty"`
	Items            []RenderItem    `json:"items"`
	Subtotal         *string         `json:"subtotal,omitempty"`
	DiscountTotal    string          `json:"discountTotal,omitempty"`
	TaxTotal         string          `json:"taxTotal,omitempty"`
	DeliveryFee      string          `json:"deliveryFee,omitempty"`
	PackagingTotal   string          `json:"packagingTotal,omitempty"`
	GrandTotal       *string         `json:"grandTotal,omitempty"`
	PaidTotal        string          `json:"paidTotal,omitempty"`
	OutstandingTotal *string         `json:"outstandingTotal,omitempty"`
	Payments         []RenderPayment `json:"payments,omitempty"`
}

const (
	reprintSlot = "<!--gnext:reprint-->"
	reprintMark = `<div class="box">چاپ مجدد — نسخه تکراری</div>`
)

var orderTypeNames = map[string]string{
	"DINE_IN":    "سالن",
	"TAKEAWAY":   "بیرون‌بر",
	"DELIVERY":   "ارسال با پیک",
	"AGGREGATOR": "سفارش آنلاین",
}

var channelNames = map[string]string{
	"KIOSK":      "کیوسک",
	"AGGREGATOR": "اسنپ‌فود",
	"SNAPPFOOD":  "اسنپ‌فود",
	"ONLINE":     "سفارش آنلاین",
}

var paymentMethodNames = map[string]string{
	"CASH":            "نقد",
	"CARD":            "کارتخوان",
	"POS":             "کارتخوان",
	"CARD_POS":        "کارتخوان",
	"NETWORK_POS":     "کارتخوان",
	"MOBILE_POS":      "کارتخوان سیار",
	"CUSTOMER_CREDIT": "اعتبار مشتری",
	"BANK_TRANSFER":   "کارت به کارت",
	"ONLINE":          "پرداخت آنلاین",
}

// defaultTemplate: a kitchen chit is compact unless its station asks for more; customer paper
// is detailed unless the counter asks for less.
func defaultTemplate(documentType string) string {
	if documentType == "KITCHEN_TICKET" {
		return "COMPACT"
	}
	return "DETAILED"
}

// RenderDocument is the whole HTML page, 300 CSS px wide, which the printer scales to the roll.
func RenderDocument(o RenderDoc) string {
	template := o.Template
	if template == "" {
		template = defaultTemplate(o.DocumentType)
	}
	var body string
	switch {
	case o.DocumentType == "KITCHEN_TICKET" && template == "COMPACT":
		body = compactKitchenChit(o)
	case o.DocumentType == "KITCHEN_TICKET":
		body = kitchenChit(o)
	case template == "COMPACT" && o.DocumentType != "COURIER_SLIP":
		body = compactReceipt(o)
	default:
		body = customerDocument(o)
	}
	return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  /* 300 px plus the padding is the 332 px the agent scales to the roll's width. */
  body { box-sizing: content-box; font-family: Tahoma, 'Segoe UI', Arial, sans-serif; width: 300px; margin: 0 auto; padding: 16px; background: #fff; color: #000; font-size: 13px; line-height: 1.55; }
  .c { text-align: center; }
  .brand { font-size: 20px; font-weight: bold; }
  .small { font-size: 11px; }
  .title { font-size: 15px; font-weight: bold; margin: 6px 0 2px; }
  .big { font-size: 30px; font-weight: bold; line-height: 1.2; }
  .huge { font-size: 64px; font-weight: bold; line-height: 1.1; text-align: center; }
  .box { border: 2px solid #000; padding: 4px; margin: 6px 0; text-align: center; font-weight: bold; font-size: 15px; }
  .inv { background: #000; color: #fff; padding: 6px 4px; margin: 6px 0; text-align: center; font-weight: bold; font-size: 20px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; vertical-align: top; }
  .num { text-align: left; white-space: nowrap; padding-right: 6px; }
  .ltr { direction: ltr; unicode-bidi: embed; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .total { font-size: 17px; font-weight: bold; }
  .sub { font-size: 12px; padding-right: 10px; }
  .note { font-weight: bold; border: 1px solid #000; padding: 2px 4px; margin-top: 2px; display: inline-block; }
  .item { font-size: 18px; font-weight: bold; }
  .void { text-decoration: line-through; }
  .tag { font-size: 12px; font-weight: bold; border: 1px solid #000; padding: 0 3px; margin-left: 4px; }
</style>
</head>
<body>
` + body + `
</body>
</html>`
}

// MarkAsReprint marks a stored document as a copy where the original left room for it.
func MarkAsReprint(html string) string {
	if strings.Contains(html, reprintSlot) {
		return strings.Replace(html, reprintSlot, reprintMark, 1)
	}
	return html
}

// ---- kitchen ----

func changeBanner(o RenderDoc) string {
	switch o.KitchenChange {
	case "CANCELLED":
		return `<div class="inv">لغو سفارش — آماده نکنید</div>`
	case "AMENDED":
		return `<div class="inv">تغییر سفارش</div>`
	}
	return ""
}

func reprintTop(o RenderDoc) string {
	if o.IsReprint {
		return reprintMark
	}
	return reprintSlot
}

func kitchenLines(o RenderDoc) string {
	lines := make([]string, 0, len(o.Items))
	for _, item := range o.Items {
		tag := ""
		switch item.Change {
		case "VOID":
			tag = `<span class="tag">حذف</span>`
		case "ADD":
			tag = `<span class="tag">اضافه</span>`
		}
		voidClass := ""
		if item.Change == "VOID" {
			voidClass = ` class="void"`
		}
		options := ""
		if item.OptionsSummary != "" {
			options = `<div class="sub">+ ` + esc(item.OptionsSummary) + `</div>`
		}
		note := ""
		if item.SpecialInstructions != "" {
			note = `<div class="note">* ` + esc(item.SpecialInstructions) + `</div>`
		}
		lines = append(lines, `<tr><td>
  <div class="item">`+tag+`<span`+voidClass+`>`+fa(qty(item.Quantity))+` × `+esc(item.ProductName)+`</span></div>
  `+options+`
  `+note+`
</td></tr>`)
	}
	return strings.Join(lines, `<tr><td><hr/></td></tr>`)
}

func compactKitchenChit(o RenderDoc) string {
	return reprintTop(o) + `
` + changeBanner(o) + `
<div class="huge">` + fa(displayNumber(o)) + `</div>
<hr/>
<table>` + kitchenLines(o) + `</table>`
}

func kitchenChit(o RenderDoc) string {
	station := ""
	if o.StationLabel != "" {
		station = `<div class="inv">` + fa(esc(o.StationLabel)) + `</div>`
	}
	reason := ""
	if o.ChangeReason != "" {
		reason = `<div class="box">علت: ` + esc(o.ChangeReason) + `</div>`
	}
	notes := ""
	if o.OrderNotes != "" {
		notes = `<hr/><div class="note">توضیحات سفارش: ` + esc(o.OrderNotes) + `</div>`
	}
	return reprintTop(o) + `
` + changeBanner(o) + `
` + station + `
<div class="c">
  <div class="small">شماره سفارش</div>
  <div class="big">` + fa(displayNumber(o)) + `</div>
  <div class="title">` + orderTypeLine(o) + `</div>
  <div>` + renderDate(o) + `</div>
</div>
` + reason + `
<hr/>
<table>` + kitchenLines(o) + `</table>
` + notes + `
<hr/>
<div class="c small ltr">` + esc(o.OrderNumber) + `</div>`
}

// ---- receipt, guest bill, courier slip ----

func row(label, value, class string) string {
	if value == "" {
		return ""
	}
	return `<div class="row ` + class + `"><span>` + label + `</span><span>` + value + `</span></div>`
}

func positive(v string) string {
	if money(v) > 0 {
		return rial(v)
	}
	return ""
}

func customerDocument(o RenderDoc) string {
	isSlip := o.DocumentType == "COURIER_SLIP"
	title := o.DocumentType
	switch {
	case o.DocumentType == "GUEST_BILL":
		title = "صورتحساب"
	case isSlip:
		title = "برگه پیک"
	case o.DocumentType == "CUSTOMER_RECEIPT":
		title = "فاکتور فروش"
	}

	var outstanding int64
	if o.OutstandingTotal != nil {
		outstanding = money(*o.OutstandingTotal)
	}
	paidInFull := o.OutstandingTotal != nil && outstanding <= 0

	var lines strings.Builder
	for _, item := range o.Items {
		unit := ""
		if item.UnitPrice != "" {
			unit = rial(item.UnitPrice)
		}
		lineTotal := rial(firstOf(item.TotalPrice, item.UnitPrice))
		if isSlip {
			// The courier checks the bag, not the prices.
			lines.WriteString(`<tr><td>` + fa(qty(item.Quantity)) + ` × ` + esc(item.ProductName) + `</td></tr>`)
			continue
		}
		options := ""
		if item.OptionsSummary != "" {
			options = `<div class="sub">+ ` + esc(item.OptionsSummary) + `</div>`
		}
		instructions := ""
		if item.SpecialInstructions != "" {
			instructions = `<div class="sub">* ` + esc(item.SpecialInstructions) + `</div>`
		}
		lines.WriteString(`<tr>
  <td>` + esc(item.ProductName) + `
    <div class="small">` + fa(qty(item.Quantity)) + ` × ` + unit + `</div>
    ` + options + `
    ` + instructions + `
  </td>
  <td class="num">` + lineTotal + `</td>
</tr>`)
	}

	totals := ""
	if !isSlip {
		subtotal := ""
		if o.Subtotal != nil {
			subtotal = rial(*o.Subtotal)
		}
		discount := ""
		if d := positive(o.DiscountTotal); d != "" {
			discount = row("تخفیف", d+"-", "")
		}
		grand := ""
		if o.GrandTotal != nil {
			grand = rial(*o.GrandTotal) + " ریال"
		}
		totals = `<hr/>
` + row("جمع اقلام", subtotal, "") + `
` + discount + `
` + row("بسته‌بندی", positive(o.PackagingTotal), "") + `
` + row("هزینه ارسال", positive(o.DeliveryFee), "") + `
` + row("مالیات بر ارزش افزوده", positive(o.TaxTotal), "") + `
` + row("مبلغ قابل پرداخت", grand, "total")
	}

	payments := ""
	if len(o.Payments) > 0 {
		var b strings.Builder
		b.WriteString("<hr/>")
		for _, p := range o.Payments {
			name := paymentMethodNames[p.Method]
			if name == "" {
				name = p.Method
			}
			b.WriteString(row(name, rial(p.Amount), ""))
		}
		payments = b.String()
	}

	status := ""
	if o.OutstandingTotal != nil {
		switch {
		case isSlip && paidInFull:
			status = `<div class="box">پرداخت شده — وجهی دریافت نشود</div>`
		case isSlip:
			status = `<div class="inv">دریافت از مشتری: ` + rial(*o.OutstandingTotal) + ` ریال</div>`
		case o.DocumentType == "CUSTOMER_RECEIPT" && paidInFull:
			status = `<div class="box">پرداخت شد</div>`
		case o.DocumentType == "CUSTOMER_RECEIPT":
			status = `<div class="box">پرداخت نشده — مانده ` + rial(*o.OutstandingTotal) + ` ریال</div>`
		case !paidInFull:
			status = `<div class="box">مانده قابل پرداخت: ` + rial(*o.OutstandingTotal) + ` ریال</div>`
		}
	}

	customerName, customerMobile := "", ""
	if o.CustomerName != "" {
		customerName = esc(o.CustomerName)
	}
	if o.CustomerMobile != "" {
		customerMobile = `<span class="ltr">` + fa(esc(o.CustomerMobile)) + `</span>`
	}
	customer := row("مشتری", customerName, "") + row("تلفن", customerMobile, "")
	address := ""
	if o.DeliveryAddress != "" {
		class := ""
		if isSlip {
			class = "box"
		}
		address = `<div class="` + class + `">نشانی: ` + esc(o.DeliveryAddress) + `</div>`
	}

	branchLine, addressLine, phoneLine := "", "", ""
	if o.BrandName != "" && o.BranchName != "" {
		branchLine = `<div>` + esc(o.BranchName) + `</div>`
	}
	if o.BranchAddress != "" {
		addressLine = `<div class="small">` + esc(o.BranchAddress) + `</div>`
	}
	if o.BranchPhone != "" {
		phoneLine = `<div class="small">تلفن: <span class="ltr">` + fa(esc(o.BranchPhone)) + `</span></div>`
	}
	notes := ""
	if o.OrderNotes != "" {
		notes = `<div class="sub">توضیحات: ` + esc(o.OrderNotes) + `</div>`
	}
	thanks := "از خرید شما سپاسگزاریم"
	if isSlip {
		thanks = "نسخه پیک"
	}

	return `<div class="c">
  <div class="brand">` + esc(firstOf(o.BrandName, o.BranchName)) + `</div>
  ` + branchLine + `
  ` + addressLine + `
  ` + phoneLine + `
</div>
<hr/>
` + reprintTop(o) + `
<div class="c">
  <div class="title">` + title + `</div>
  <div class="small">شماره سفارش</div>
  <div class="big">` + fa(displayNumber(o)) + `</div>
  <div>` + orderTypeLine(o) + `</div>
</div>
` + row("تاریخ", renderDate(o), "") + `
` + row("سفارش", `<span class="ltr">`+esc(o.OrderNumber)+`</span>`, "") + `
` + customer + `
` + address + `
<hr/>
<table>` + lines.String() + `</table>
` + totals + `
` + payments + `
` + status + `
` + notes + `
<hr/>
<div class="c small">` + thanks + `</div>`
}

// compactReceipt is a receipt for the counter that wants it short.
func compactReceipt(o RenderDoc) string {
	title := "فاکتور فروش"
	if o.DocumentType == "GUEST_BILL" {
		title = "صورتحساب"
	}
	var lines strings.Builder
	for _, item := range o.Items {
		lines.WriteString(`<tr>
  <td>` + fa(qty(item.Quantity)) + ` × ` + esc(item.ProductName) + `</td>
  <td class="num">` + rial(firstOf(item.TotalPrice, item.UnitPrice)) + `</td>
</tr>`)
	}
	status := ""
	if o.OutstandingTotal != nil {
		if money(*o.OutstandingTotal) <= 0 {
			status = `<div class="box">پرداخت شد</div>`
		} else {
			status = `<div class="box">مانده: ` + rial(*o.OutstandingTotal) + ` ریال</div>`
		}
	}
	grand := ""
	if o.GrandTotal != nil {
		grand = `<div class="row total"><span>مبلغ کل</span><span>` + rial(*o.GrandTotal) + ` ریال</span></div>`
	}
	return `<div class="c brand">` + esc(firstOf(o.BrandName, o.BranchName)) + `</div>
` + reprintTop(o) + `
<div class="c small">` + title + ` — ` + renderDate(o) + `</div>
<div class="huge">` + fa(displayNumber(o)) + `</div>
<hr/>
<table>` + lines.String() + `</table>
<hr/>
` + grand + `
` + status
}

// ---- helpers ----

func orderTypeLine(o RenderDoc) string {
	first := orderTypeNames[o.OrderType]
	if first == "" {
		first = o.OrderType
	}
	parts := []string{first}
	if o.TableNumber != "" {
		parts = append(parts, "میز "+esc(o.TableNumber))
	}
	if channel := channelNames[o.Channel]; channel != "" && channel != parts[0] {
		parts = append(parts, channel)
	}
	kept := parts[:0]
	for _, p := range parts {
		if p != "" {
			kept = append(kept, p)
		}
	}
	return fa(strings.Join(kept, " — "))
}

func renderDate(o RenderDoc) string {
	at := time.Now()
	if o.PlacedAt != "" {
		t, err := time.Parse(time.RFC3339Nano, o.PlacedAt)
		if err != nil {
			return ""
		}
		at = t
	}
	return businessDateTime(at, o.Calendar)
}

// businessDateTime is `1405/06/26 14:05` on the business clock (Asia/Tehran) in the chain's
// calendar, in Persian digits, as the cloud's formatBusinessDateTime prints it.
func businessDateTime(at time.Time, calendar string) string {
	loc, err := time.LoadLocation("Asia/Tehran")
	if err != nil {
		loc = time.UTC
	}
	local := at.In(loc)
	y, m, d := local.Year(), int(local.Month()), local.Day()
	if calendar != "GREGORIAN" {
		y, m, d = jalali(y, m, d)
	}
	return fa(pad(y, 1) + "/" + pad(m, 2) + "/" + pad(d, 2) + " " + pad(local.Hour(), 2) + ":" + pad(local.Minute(), 2))
}

func pad(n, width int) string {
	s := strconv.Itoa(n)
	for len(s) < width {
		s = "0" + s
	}
	return s
}

// jalali converts a Gregorian date to the Solar Hijri calendar (the algorithm of jalaali-js).
func jalali(gy, gm, gd int) (int, int, int) {
	gdm := []int{0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334}
	gy2 := gy
	if gm > 2 {
		gy2 = gy + 1
	}
	days := 355666 + (365 * gy) + ((gy2 + 3) / 4) - ((gy2 + 99) / 100) + ((gy2 + 399) / 400) + gd + gdm[gm-1]
	jy := -1595 + (33 * (days / 12053))
	days %= 12053
	jy += 4 * (days / 1461)
	days %= 1461
	if days > 365 {
		jy += (days - 1) / 365
		days = (days - 1) % 365
	}
	var jm, jd int
	if days < 186 {
		jm = 1 + days/31
		jd = 1 + days%31
	} else {
		jm = 7 + (days-186)/30
		jd = 1 + (days-186)%30
	}
	return jy, jm, jd
}

func displayNumber(o RenderDoc) string {
	if o.CallNumber != nil && *o.CallNumber != 0 {
		return strconv.Itoa(*o.CallNumber)
	}
	return shortNumber(o.OrderNumber)
}

var (
	leadingZeros = regexp.MustCompile(`^0+(\d)`)
	allDigits    = regexp.MustCompile(`^\d+$`)
	moneyPrefix  = regexp.MustCompile(`^(-?)(\d+)`)
)

func shortNumber(orderNumber string) string {
	parts := strings.Split(orderNumber, "-")
	tail := parts[len(parts)-1]
	trimmed := leadingZeros.ReplaceAllString(tail, "$1")
	if allDigits.MatchString(trimmed) {
		return trimmed
	}
	return esc(orderNumber)
}

func qty(q string) string {
	if f, err := strconv.ParseFloat(strings.TrimSpace(q), 64); err == nil {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return esc(q)
}

// money is whole rials; amounts may arrive as "42292000.0000".
func money(v string) int64 {
	m := moneyPrefix.FindStringSubmatch(strings.TrimSpace(v))
	if m == nil {
		return 0
	}
	n, _ := strconv.ParseInt(m[2], 10, 64)
	if m[1] != "" {
		return -n
	}
	return n
}

func rial(v string) string {
	n := money(v)
	neg := n < 0
	if neg {
		n = -n
	}
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteRune('٬')
		}
		b.WriteRune(r)
	}
	if neg {
		return fa("-" + b.String())
	}
	return fa(b.String())
}

// fa writes digits in Persian, for what is read on paper.
func fa(s string) string {
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return '۰' + (r - '0')
		}
		return r
	}, s)
}

func esc(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(s)
}

func firstOf(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
