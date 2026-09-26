package till

import (
	"encoding/json"
	"fmt"
	"math/big"
	"slices"
	"strconv"
	"strings"
	"time"
	// Windows has no zone database the agent can count on; the branch clock needs one.
	_ "time/tzdata"
)

// Why an item cannot be sold now (§13.6).
const (
	ReasonStopped    = "STOPPED"
	ReasonOutOfHours = "OUT_OF_HOURS"
	ReasonSoldOut    = "SOLD_OUT"
)

// CodeNotAvailable refuses a line the snapshot does not let the till sell (§13.13).
const CodeNotAvailable = "NOT_AVAILABLE"

// Catalog is what the snapshot says the branch sells (§12.2), ready to check a sale against.
type Catalog struct {
	DataVersion string `json:"data_version"`
	GeneratedAt string `json:"generated_at"`
	Branch      struct {
		TimeZone string `json:"time_zone"`
	} `json:"branch"`
	Settings struct {
		CallNumbers struct {
			POS struct {
				Start int `json:"start"`
				End   int `json:"end"`
			} `json:"POS"`
		} `json:"call_numbers"`
		CallNumberIssuedToday struct {
			BusinessDate string `json:"business_date"`
			POS          int    `json:"POS"`
		} `json:"call_number_issued_today"`
		OrderActions struct {
			EditWindowMinutes   *int `json:"edit_window_minutes"`
			CancelWindowMinutes *int `json:"cancel_window_minutes"`
		} `json:"order_actions"`
	} `json:"settings"`
	Categories []struct {
		ID        string  `json:"id"`
		ParentID  *string `json:"parent_id"`
		Name      string  `json:"name"`
		SortOrder int     `json:"sort_order"`
	} `json:"categories"`
	Products     []Product `json:"products"`
	Availability struct {
		Stopped    []Stop     `json:"stopped"`
		Schedules  []Schedule `json:"schedules"`
		DailyStock []Stock    `json:"daily_stock"`
	} `json:"availability"`
	PaymentMethods []struct {
		ID   string `json:"id"`
		Code string `json:"code"`
		Name string `json:"name"`
		Kind string `json:"kind"`
	} `json:"payment_methods"`
	DiningTables []Table `json:"dining_tables"`
	// Tills carry where each till's receipts print (§13.11).
	Tills []Register `json:"tills"`
	// Printing is where offline tickets go and what they are headed with (§13.11).
	Printing Printing `json:"printing"`
}

// Printing is the snapshot's routing of tickets (§13.11), matched in advance by the cloud: each
// product's prep station ("group"), the stations' printers, and the branch's fallback printers.
// Its `documents` are always null now; receipts print at the till's own printer.
type Printing struct {
	Heading struct {
		BrandName     string `json:"brand_name"`
		BranchName    string `json:"branch_name"`
		BranchAddress string `json:"branch_address"`
		BranchPhone   string `json:"branch_phone"`
		Calendar      string `json:"calendar"`
	} `json:"heading"`
	Groups        []PrinterGroup        `json:"groups"`
	KitchenRoutes map[string]PrintRoute `json:"kitchen_routes"`
	Fallback      struct {
		KitchenTicket *string `json:"KITCHEN_TICKET"`
		Other         *string `json:"OTHER"`
	} `json:"fallback"`
}

// PrinterGroup is a prep station's printers, in order, each with its copies.
type PrinterGroup struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	TicketTemplate *string `json:"ticket_template"`
	Printers       []struct {
		PrinterID string `json:"printer_id"`
		Copies    int    `json:"copies"`
	} `json:"printers"`
}

// PrintRoute sends a product's chit to its station, so many times.
type PrintRoute struct {
	GroupID string `json:"group_id"`
	Copies  int    `json:"copies"`
}

// Table is a dining table of the branch.
type Table struct {
	ID     string  `json:"id"`
	Area   *string `json:"area"`
	Number string  `json:"number"`
	Seats  *int    `json:"seats"`
}

// Stop is an in-store stop on a product, one size or one add-on, until a time or for good.
type Stop struct {
	ProductID    *string `json:"product_id"`
	VariantID    *string `json:"variant_id"`
	OptionItemID *string `json:"option_item_id"`
	Until        *string `json:"until"`
}

// Schedule is when a product sells, on the branch clock (0 = Sunday).
type Schedule struct {
	ProductID string   `json:"product_id"`
	Windows   []Window `json:"windows"`
}

type Window struct {
	Days []int  `json:"days"`
	From string `json:"from"`
	To   string `json:"to"`
}

// Stock is what is left of today's count for a product, or one size of it.
type Stock struct {
	ProductID string  `json:"product_id"`
	VariantID *string `json:"variant_id"`
	Remaining int     `json:"remaining"`
}

// Product is one product of the snapshot.
type Product struct {
	ID           string        `json:"id"`
	Code         *string       `json:"code"`
	Name         string        `json:"name"`
	CategoryID   *string       `json:"category_id"`
	Price        string        `json:"price"`
	TaxRate      string        `json:"tax_rate"`
	MaxPerOrder  *int          `json:"max_per_order"`
	Variants     []Variant     `json:"variants"`
	OptionGroups []OptionGroup `json:"option_groups"`
}

type Variant struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Price string `json:"price"`
}

type OptionGroup struct {
	ID       string       `json:"id"`
	Name     string       `json:"name"`
	Min      int          `json:"min"`
	Max      *int         `json:"max"`
	Required bool         `json:"required"`
	Items    []OptionItem `json:"items"`
}

type OptionItem struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	PriceDelta string  `json:"price_delta"`
	ProductID  *string `json:"product_id"`
}

// ParseCatalog reads the snapshot.
func ParseCatalog(raw []byte) (*Catalog, error) {
	var c Catalog
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

func (c *Catalog) location() *time.Location {
	if loc, err := time.LoadLocation(c.Branch.TimeZone); err == nil && c.Branch.TimeZone != "" {
		return loc
	}
	loc, err := time.LoadLocation("Asia/Tehran")
	if err != nil {
		return time.UTC
	}
	return loc
}

func (c *Catalog) product(id string) *Product {
	for i := range c.Products {
		if c.Products[i].ID == id {
			return &c.Products[i]
		}
	}
	return nil
}

// stopped reports a live in-store stop on a product, a size or an add-on (§12.2).
func (c *Catalog) stopped(now time.Time, productID, variantID, optionItemID string) bool {
	for _, s := range c.Availability.Stopped {
		if s.Until != nil {
			if until, err := time.Parse(time.RFC3339Nano, *s.Until); err == nil && !now.Before(until) {
				continue
			}
		}
		switch {
		case optionItemID != "" && s.OptionItemID != nil && *s.OptionItemID == optionItemID:
			return true
		case variantID != "" && s.VariantID != nil && *s.VariantID == variantID:
			return true
		case productID != "" && s.ProductID != nil && *s.ProductID == productID && s.VariantID == nil && s.OptionItemID == nil:
			return true
		}
	}
	return false
}

// onSchedule reports whether a product sells at `now` on the branch clock. A product with no
// windows sells all day; a window whose end is at or before its start runs past midnight and
// belongs to the day it opened on; equal times are all day (as the cloud's availability-schedule).
func (c *Catalog) onSchedule(now time.Time, productID string) bool {
	i := slices.IndexFunc(c.Availability.Schedules, func(s Schedule) bool { return s.ProductID == productID })
	if i < 0 || len(c.Availability.Schedules[i].Windows) == 0 {
		return true
	}
	local := now.In(c.location())
	day, minute := int(local.Weekday()), local.Hour()*60+local.Minute()
	yesterday := (day + 6) % 7
	for _, w := range c.Availability.Schedules[i].Windows {
		start, err1 := hhmm(w.From)
		end, err2 := hhmm(w.To)
		if err1 != nil || err2 != nil {
			continue
		}
		switch {
		case start == end:
			if slices.Contains(w.Days, day) {
				return true
			}
		case start < end:
			if slices.Contains(w.Days, day) && minute >= start && minute < end {
				return true
			}
		default:
			if (slices.Contains(w.Days, day) && minute >= start) || (slices.Contains(w.Days, yesterday) && minute < end) {
				return true
			}
		}
	}
	return false
}

func hhmm(s string) (int, error) {
	h, m, ok := strings.Cut(s, ":")
	if !ok {
		return 0, fmt.Errorf("bad time %q", s)
	}
	hh, err1 := strconv.Atoi(h)
	mm, err2 := strconv.Atoi(m)
	if err1 != nil || err2 != nil || hh < 0 || hh > 23 || mm < 0 || mm > 59 {
		return 0, fmt.Errorf("bad time %q", s)
	}
	return hh*60 + mm, nil
}

// stockLeft is how many of a product (or one size of it) the day's count still allows, less what
// the till itself sold offline today; ok is false when there is no count, so no limit.
func (c *Catalog) stockLeft(productID, variantID string, soldOffline func(productID, variantID string) int) (left int, ok bool) {
	for _, s := range c.Availability.DailyStock {
		if s.ProductID != productID {
			continue
		}
		// A count for the whole product covers every size; a count for one size only that size.
		if s.VariantID != nil && *s.VariantID != variantID {
			continue
		}
		v := ""
		if s.VariantID != nil {
			v = *s.VariantID
		}
		n := s.Remaining
		if soldOffline != nil {
			n -= soldOffline(productID, v)
		}
		if !ok || n < left {
			left, ok = n, true
		}
	}
	return left, ok
}

// Money is whole rials as a decimal string (§2.1).
type Money = string

func rials(s string) (*big.Int, error) {
	n, ok := new(big.Int).SetString(strings.TrimSpace(s), 10)
	if !ok || n.Sign() < 0 {
		return nil, fmt.Errorf("not whole rials: %q", s)
	}
	return n, nil
}

// taxOf is line_total × rate, rounded to the rial, halves up (§12.4).
func taxOf(lineTotal *big.Int, rate string) (*big.Int, error) {
	r, ok := new(big.Rat).SetString(strings.TrimSpace(rate))
	if !ok || r.Sign() < 0 {
		return nil, fmt.Errorf("bad tax rate %q", rate)
	}
	x := new(big.Rat).Mul(new(big.Rat).SetInt(lineTotal), r)
	// floor(x + 1/2) for x ≥ 0
	half := new(big.Rat).Add(x, big.NewRat(1, 2))
	return new(big.Int).Quo(half.Num(), half.Denom()), nil
}
