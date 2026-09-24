package till

import (
	"fmt"
	"math/big"
	"slices"
	"strconv"
	"strings"
	"time"
)

// SoldOffline counts what the till itself sold offline today of a product, or one size of it
// (variantID ""); nil counts nothing. Today's stock in the snapshot is net of what the cloud
// sold, not of this.
type SoldOffline func(productID, variantID string) int

// Menu is the snapshot's catalogue with what can be sold right now (§13.13 `menu`).
type Menu struct {
	Categories []MenuCategory `json:"categories"`
	Products   []MenuProduct  `json:"products"`
	Tables     []MenuTable    `json:"tables"`
}

// MenuTable is a dining table a dine-in order can sit at.
type MenuTable struct {
	ID     string  `json:"id"`
	Area   *string `json:"area"`
	Number string  `json:"number"`
	Seats  *int    `json:"seats"`
}

type MenuCategory struct {
	ID       string  `json:"id"`
	ParentID *string `json:"parent_id"`
	Name     string  `json:"name"`
}

type MenuProduct struct {
	ID           string        `json:"id"`
	Code         *string       `json:"code"`
	Name         string        `json:"name"`
	CategoryID   *string       `json:"category_id"`
	Price        Money         `json:"price"`
	MaxPerOrder  *int          `json:"max_per_order"`
	Available    bool          `json:"available"`
	Reason       string        `json:"reason,omitempty"`
	Variants     []MenuVariant `json:"variants"`
	OptionGroups []MenuGroup   `json:"option_groups"`
}

type MenuVariant struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Price     Money  `json:"price"`
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

type MenuGroup struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// Min is the least number of choices, counting `required` as one.
	Min int `json:"min"`
	// Max is the most, or null for no limit.
	Max   *int         `json:"max"`
	Items []MenuOption `json:"items"`
}

type MenuOption struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	PriceDelta Money  `json:"price_delta"`
	Available  bool   `json:"available"`
}

// Menu evaluates availability at `now` on the branch clock.
func (c *Catalog) Menu(now time.Time, sold SoldOffline) Menu {
	m := Menu{Categories: []MenuCategory{}, Products: []MenuProduct{}, Tables: []MenuTable{}}
	for _, tb := range c.DiningTables {
		m.Tables = append(m.Tables, MenuTable{ID: tb.ID, Area: tb.Area, Number: tb.Number, Seats: tb.Seats})
	}
	for _, cat := range c.Categories {
		m.Categories = append(m.Categories, MenuCategory{ID: cat.ID, ParentID: cat.ParentID, Name: cat.Name})
	}
	for _, p := range c.Products {
		mp := MenuProduct{
			ID: p.ID, Code: p.Code, Name: p.Name, CategoryID: p.CategoryID, Price: p.Price, MaxPerOrder: p.MaxPerOrder,
			Variants: []MenuVariant{}, OptionGroups: []MenuGroup{},
		}
		mp.Reason = c.productReason(now, &p, sold)
		for _, v := range p.Variants {
			reason := c.variantReason(now, &p, v.ID, sold)
			mp.Variants = append(mp.Variants, MenuVariant{ID: v.ID, Name: v.Name, Price: v.Price, Available: reason == "", Reason: reason})
		}
		// A product sold by size is on sale while one of its sizes is.
		if mp.Reason == "" && len(p.Variants) > 0 && !slices.ContainsFunc(mp.Variants, func(v MenuVariant) bool { return v.Available }) {
			mp.Reason = mp.Variants[0].Reason
		}
		mp.Available = mp.Reason == ""
		for _, g := range p.OptionGroups {
			mg := MenuGroup{ID: g.ID, Name: g.Name, Min: g.min(), Max: g.max(), Items: []MenuOption{}}
			for _, it := range g.Items {
				mg.Items = append(mg.Items, MenuOption{ID: it.ID, Name: it.Name, PriceDelta: it.PriceDelta, Available: c.optionOnSale(now, it)})
			}
			mp.OptionGroups = append(mp.OptionGroups, mg)
		}
		m.Products = append(m.Products, mp)
	}
	return m
}

// productReason is why the whole product cannot be sold now, or "".
func (c *Catalog) productReason(now time.Time, p *Product, sold SoldOffline) string {
	switch {
	case c.stopped(now, p.ID, "", ""):
		return ReasonStopped
	case !c.onSchedule(now, p.ID):
		return ReasonOutOfHours
	}
	if len(p.Variants) == 0 {
		if left, ok := c.stockLeft(p.ID, "", sold); ok && left <= 0 {
			return ReasonSoldOut
		}
	}
	return ""
}

// variantReason is why one size cannot be sold now, or "".
func (c *Catalog) variantReason(now time.Time, p *Product, variantID string, sold SoldOffline) string {
	if r := c.productReason(now, p, sold); r != "" && r != ReasonSoldOut {
		return r
	}
	if c.stopped(now, "", variantID, "") {
		return ReasonStopped
	}
	if left, ok := c.stockLeft(p.ID, variantID, sold); ok && left <= 0 {
		return ReasonSoldOut
	}
	return ""
}

// optionOnSale: the add-on is not stopped, nor is the dish it stands for.
func (c *Catalog) optionOnSale(now time.Time, it OptionItem) bool {
	if c.stopped(now, "", "", it.ID) {
		return false
	}
	return it.ProductID == nil || !c.stopped(now, *it.ProductID, "", "")
}

// min counts `required` as at least one choice, as the cloud's register does.
func (g OptionGroup) min() int {
	if g.Required && g.Min < 1 {
		return 1
	}
	return g.Min
}

// max is nil for no limit; the cloud treats a max of 0 as none.
func (g OptionGroup) max() *int {
	if g.Max == nil || *g.Max <= 0 {
		return nil
	}
	return g.Max
}

// LineInput is a line as the till screen asks for it.
type LineInput struct {
	ProductID string   `json:"product_id"`
	VariantID string   `json:"variant_id"`
	Quantity  int      `json:"quantity"`
	Options   []string `json:"options"`
	Notes     string   `json:"notes"`
}

// Line is a priced line in the shape the upload carries (§12.4), with the group names the
// cloud keeps (§13.12).
type Line struct {
	ProductID   string       `json:"product_id"`
	ProductName string       `json:"product_name"`
	VariantID   *string      `json:"variant_id"`
	VariantName *string      `json:"variant_name"`
	Quantity    string       `json:"quantity"`
	UnitPrice   Money        `json:"unit_price"`
	Options     []LineOption `json:"options"`
	TaxRate     string       `json:"tax_rate"`
	LineTotal   Money        `json:"line_total"`
	Tax         Money        `json:"tax"`
	Notes       *string      `json:"notes"`
}

type LineOption struct {
	OptionItemID string `json:"option_item_id"`
	Name         string `json:"name"`
	GroupName    string `json:"group_name"`
	PriceDelta   Money  `json:"price_delta"`
}

// Totals are the sums (§12.4). No discounts or delivery offline.
type Totals struct {
	Subtotal      Money `json:"subtotal"`
	DeliveryFee   Money `json:"delivery_fee"`
	DiscountTotal Money `json:"discount_total"`
	TaxTotal      Money `json:"tax_total"`
	GrandTotal    Money `json:"grand_total"`
}

// MaxQuantity bounds one line, so a slip of the finger does not ring up thousands.
const MaxQuantity = 999

// Price checks every line against the snapshot at `now` and prices it, the order as a whole
// against per-order limits and today's stock, and adds up the totals. A line the till may not
// sell is refused with NOT_AVAILABLE and its index in Error.Line.
func (c *Catalog) Price(now time.Time, inputs []LineInput, sold SoldOffline) ([]Line, Totals, error) {
	lines := make([]Line, 0, len(inputs))
	subtotal, taxTotal := new(big.Int), new(big.Int)
	for i, in := range inputs {
		line, total, tax, err := c.priceLine(now, in, sold)
		if err != nil {
			return nil, Totals{}, onLine(err, i)
		}
		lines = append(lines, line)
		subtotal.Add(subtotal, total)
		taxTotal.Add(taxTotal, tax)
	}
	if err := c.checkOrder(inputs, sold); err != nil {
		return nil, Totals{}, err
	}
	return lines, Totals{
		Subtotal:      subtotal.String(),
		DeliveryFee:   "0",
		DiscountTotal: "0",
		TaxTotal:      taxTotal.String(),
		GrandTotal:    new(big.Int).Add(subtotal, taxTotal).String(),
	}, nil
}

// PriceAdded prices one line joining an order that already holds `held`, whose prices stand as
// they were charged: the new line is checked on its own, and the order as a whole against
// per-order limits and today's stock.
func (c *Catalog) PriceAdded(now time.Time, held []LineInput, add LineInput, sold SoldOffline) (Line, error) {
	line, _, _, err := c.priceLine(now, add, sold)
	if err != nil {
		return Line{}, err
	}
	if err := c.checkOrder(append(append([]LineInput{}, held...), add), sold); err != nil {
		return Line{}, err
	}
	return line, nil
}

// sumLines adds up priced lines (§12.4).
func sumLines(lines []Line) Totals {
	subtotal, tax := new(big.Int), new(big.Int)
	for _, l := range lines {
		if n, err := rials(l.LineTotal); err == nil {
			subtotal.Add(subtotal, n)
		}
		if n, err := rials(l.Tax); err == nil {
			tax.Add(tax, n)
		}
	}
	return Totals{
		Subtotal: subtotal.String(), DeliveryFee: "0", DiscountTotal: "0",
		TaxTotal: tax.String(), GrandTotal: new(big.Int).Add(subtotal, tax).String(),
	}
}

func (c *Catalog) priceLine(now time.Time, in LineInput, sold SoldOffline) (Line, *big.Int, *big.Int, error) {
	p := c.product(in.ProductID)
	if p == nil {
		return Line{}, nil, nil, notAvailable("این کالا در منوی شعبه نیست.")
	}
	if in.Quantity < 1 || in.Quantity > MaxQuantity {
		return Line{}, nil, nil, notAvailable(fmt.Sprintf("تعداد «%s» باید بین ۱ و %s باشد.", p.Name, faDigits(MaxQuantity)))
	}
	line := Line{ProductID: p.ID, ProductName: p.Name, Quantity: strconv.Itoa(in.Quantity), TaxRate: p.TaxRate, Options: []LineOption{}}
	unit := p.Price
	if len(p.Variants) > 0 {
		i := slices.IndexFunc(p.Variants, func(v Variant) bool { return v.ID == in.VariantID })
		if i < 0 {
			return Line{}, nil, nil, notAvailable(fmt.Sprintf("برای «%s» اندازه را انتخاب کنید.", p.Name))
		}
		v := p.Variants[i]
		if r := c.variantReason(now, p, v.ID, sold); r != "" {
			return Line{}, nil, nil, notAvailable(reasonText(r, p.Name+" "+v.Name))
		}
		line.VariantID, line.VariantName, unit = &v.ID, &v.Name, v.Price
	} else {
		if in.VariantID != "" {
			return Line{}, nil, nil, notAvailable(fmt.Sprintf("«%s» اندازه ندارد.", p.Name))
		}
		if r := c.productReason(now, p, sold); r != "" {
			return Line{}, nil, nil, notAvailable(reasonText(r, p.Name))
		}
	}
	line.UnitPrice = unit

	sum, err := rials(unit)
	if err != nil {
		return Line{}, nil, nil, err
	}
	seen := map[string]bool{}
	counts := map[string]int{}
	for _, id := range in.Options {
		if seen[id] {
			return Line{}, nil, nil, notAvailable(fmt.Sprintf("یک افزودنی برای «%s» دو بار انتخاب شده است.", p.Name))
		}
		seen[id] = true
		g, it := p.option(id)
		if it == nil {
			return Line{}, nil, nil, notAvailable(fmt.Sprintf("این افزودنی برای «%s» ارائه نمی‌شود.", p.Name))
		}
		if !c.optionOnSale(now, *it) {
			return Line{}, nil, nil, notAvailable(fmt.Sprintf("«%s» اکنون موجود نیست.", it.Name))
		}
		delta, err := rials(it.PriceDelta)
		if err != nil {
			return Line{}, nil, nil, err
		}
		sum.Add(sum, delta)
		counts[g.ID]++
		line.Options = append(line.Options, LineOption{OptionItemID: it.ID, Name: it.Name, GroupName: g.Name, PriceDelta: it.PriceDelta})
	}
	for _, g := range p.OptionGroups {
		n := counts[g.ID]
		if min := g.min(); n < min {
			return Line{}, nil, nil, notAvailable(fmt.Sprintf("برای «%s» دست‌کم %s انتخاب از «%s» لازم است.", p.Name, faDigits(min), g.Name))
		}
		if max := g.max(); max != nil && n > *max {
			return Line{}, nil, nil, notAvailable(fmt.Sprintf("برای «%s» حداکثر %s انتخاب از «%s» ممکن است.", p.Name, faDigits(*max), g.Name))
		}
	}

	total := new(big.Int).Mul(sum, big.NewInt(int64(in.Quantity)))
	tax, err := taxOf(total, p.TaxRate)
	if err != nil {
		return Line{}, nil, nil, err
	}
	line.LineTotal, line.Tax = total.String(), tax.String()
	if notes := strings.TrimSpace(in.Notes); notes != "" {
		line.Notes = &notes
	}
	return line, total, tax, nil
}

// checkOrder holds the order to each product's per-order limit and to today's stock, adding up
// its lines as the cloud's register does.
func (c *Catalog) checkOrder(inputs []LineInput, sold SoldOffline) error {
	byProduct := map[string]int{}
	for _, in := range inputs {
		byProduct[in.ProductID] += in.Quantity
	}
	for id, qty := range byProduct {
		p := c.product(id)
		if p.MaxPerOrder != nil && *p.MaxPerOrder > 0 && qty > *p.MaxPerOrder {
			return notAvailable(fmt.Sprintf("هر سفارش حداکثر %s «%s» دارد.", faDigits(*p.MaxPerOrder), p.Name))
		}
	}
	for _, s := range c.Availability.DailyStock {
		wanted := 0
		for _, in := range inputs {
			if in.ProductID == s.ProductID && (s.VariantID == nil || *s.VariantID == in.VariantID) {
				wanted += in.Quantity
			}
		}
		if wanted == 0 {
			continue
		}
		v := ""
		if s.VariantID != nil {
			v = *s.VariantID
		}
		left, _ := c.stockLeft(s.ProductID, v, sold)
		if wanted > left {
			name := c.product(s.ProductID).Name
			if left <= 0 {
				return notAvailable(fmt.Sprintf("«%s» امروز تمام شده است.", name))
			}
			return notAvailable(fmt.Sprintf("از «%s» امروز فقط %s عدد مانده است.", name, faDigits(left)))
		}
	}
	return nil
}

func (p *Product) option(itemID string) (*OptionGroup, *OptionItem) {
	for gi := range p.OptionGroups {
		g := &p.OptionGroups[gi]
		for ii := range g.Items {
			if g.Items[ii].ID == itemID {
				return g, &g.Items[ii]
			}
		}
	}
	return nil, nil
}

func reasonText(reason, name string) string {
	switch reason {
	case ReasonOutOfHours:
		return fmt.Sprintf("«%s» در این ساعت فروخته نمی‌شود.", name)
	case ReasonSoldOut:
		return fmt.Sprintf("«%s» امروز تمام شده است.", name)
	}
	return fmt.Sprintf("«%s» اکنون موجود نیست.", name)
}

func notAvailable(detail string) *Error { return refuse(CodeNotAvailable, detail) }

// onLine records which line a refusal is about.
func onLine(err error, i int) error {
	if e, ok := err.(*Error); ok {
		e.Line = &i
	}
	return err
}

func faDigits(n int) string {
	return strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return '۰' + (r - '0')
		}
		return r
	}, strconv.Itoa(n))
}
