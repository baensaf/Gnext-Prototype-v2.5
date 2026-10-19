package chit

import (
	"strconv"
	"strings"

	"gnext/agent/internal/protocol"
)

// Render lays out one kitchen chit as the cloud's print-render.service.ts does: Persian, right to
// left, 300 CSS px wide, which the printer package scales to the roll. kitchenChange is "",
// AMENDED or CANCELLED.
func Render(h protocol.ChitHeading, c Chit, kitchenChange, changeReason string) string {
	var body string
	if h.Template == "DETAILED" {
		body = detailed(h, c, kitchenChange, changeReason)
	} else {
		body = compact(h, c, kitchenChange, changeReason)
	}
	return page(body)
}

// reprintSlot is where a reprint of the stored chit puts its "copy" marker (REPRINT_SLOT in the cloud).
const reprintSlot = "<!--gnext:reprint-->"

func changeBanner(kind string) string {
	switch kind {
	case "CANCELLED":
		return `<div class="inv">لغو سفارش — آماده نکنید</div>`
	case "AMENDED":
		return `<div class="inv">تغییر سفارش</div>`
	}
	return ""
}

func lines(c Chit) string {
	rows := make([]string, len(c.Lines))
	for i, l := range c.Lines {
		tag, strike := "", ""
		switch l.Change {
		case "VOID":
			tag, strike = `<span class="tag">حذف</span>`, ` class="void"`
		case "ADD":
			tag = `<span class="tag">اضافه</span>`
		}
		var b strings.Builder
		b.WriteString("<tr><td>\n  <div class=\"item\">" + tag + "<span" + strike + ">" + fa(qty(l.Quantity)) + " × " + esc(l.Name) + "</span></div>\n")
		if l.Options != "" {
			b.WriteString(`  <div class="sub">+ ` + esc(l.Options) + "</div>\n")
		}
		if l.Note != "" {
			b.WriteString(`  <div class="note">* ` + esc(l.Note) + "</div>\n")
		}
		b.WriteString("</td></tr>")
		rows[i] = b.String()
	}
	return strings.Join(rows, "<tr><td><hr/></td></tr>")
}

func reasonBox(reason string) string {
	if reason == "" {
		return ""
	}
	return `<div class="box">علت: ` + esc(reason) + "</div>"
}

func notes(h protocol.ChitHeading) string {
	if h.OrderNotes == "" {
		return ""
	}
	return `<hr/><div class="note">توضیحات سفارش: ` + esc(h.OrderNotes) + "</div>"
}

// compact is what an Iranian kitchen chit is: the number the order is called by, very large, how
// it leaves and when, this station's items, the order's note, and the other stations it went to.
func compact(h protocol.ChitHeading, c Chit, change, reason string) string {
	typeLine := h.TypeLine
	if h.Time != "" {
		if typeLine != "" {
			typeLine += " · "
		}
		typeLine += h.Time
	}
	whole, others := "", ""
	if c.WholeOrder {
		whole = `<div class="inv">کل سفارش</div>`
	}
	if len(c.OtherStations) > 0 {
		others = `<hr/><div class="c small">بخش‌های دیگر: ` + esc(strings.Join(c.OtherStations, "، ")) + "</div>"
	}
	return reprintSlot + "\n" + changeBanner(change) + "\n" + whole + "\n" +
		`<div class="huge">` + fa(esc(h.DisplayNumber)) + "</div>\n" +
		`<div class="c title">` + esc(typeLine) + "</div>\n" +
		reasonBox(reason) + "\n<hr/>\n<table>" + lines(c) + "</table>\n" + notes(h) + "\n" + others
}

func detailed(h protocol.ChitHeading, c Chit, change, reason string) string {
	station := ""
	if c.Label != "" {
		station = `<div class="inv">` + fa(esc(c.Label)) + "</div>"
	}
	return reprintSlot + "\n" + changeBanner(change) + "\n" + station + "\n" +
		"<div class=\"c\">\n  <div class=\"small\">شماره سفارش</div>\n  <div class=\"big\">" + fa(esc(h.DisplayNumber)) + "</div>\n" +
		`  <div class="title">` + esc(h.TypeLine) + "</div>\n  <div>" + esc(h.DateTime) + "</div>\n</div>\n" +
		reasonBox(reason) + "\n<hr/>\n<table>" + lines(c) + "</table>\n" + notes(h) + "\n<hr/>\n" +
		`<div class="c small ltr">` + esc(h.OrderNumber) + "</div>"
}

func page(body string) string {
	return `<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  /* 300 px plus the padding is the 332 px the agent scales to the roll's width. */
  body { box-sizing: content-box; font-family: Tahoma, 'Segoe UI', Arial, sans-serif; width: 300px; margin: 0 auto; padding: 16px; background: #fff; color: #000; font-size: 13px; line-height: 1.55; }
  .c { text-align: center; }
  .small { font-size: 11px; }
  .title { font-size: 15px; font-weight: bold; margin: 6px 0 2px; }
  .big { font-size: 30px; font-weight: bold; line-height: 1.2; }
  .huge { font-size: 64px; font-weight: bold; line-height: 1.1; text-align: center; }
  .box { border: 2px solid #000; padding: 4px; margin: 6px 0; text-align: center; font-weight: bold; font-size: 15px; }
  .inv { background: #000; color: #fff; padding: 6px 4px; margin: 6px 0; text-align: center; font-weight: bold; font-size: 20px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 3px 0; vertical-align: top; }
  .ltr { direction: ltr; unicode-bidi: embed; }
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

// qty prints a quantity as a plain number: "2.000" is 2.
func qty(q string) string {
	if f, err := strconv.ParseFloat(strings.TrimSpace(q), 64); err == nil {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return esc(q)
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
