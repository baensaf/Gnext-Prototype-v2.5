package till

import (
	"errors"
	"math/big"
	"testing"
	"time"
)

// A branch in Tehran (UTC+3:30). The doogh is stopped; the salad was stopped until an hour that
// has passed; breakfast sells 07:00–11:00; the late plate sells Thursday 22:00 to 02:00.
const menuJSON = `{
  "data_version": "v1",
  "branch": { "time_zone": "Asia/Tehran" },
  "categories": [ { "id": "c1", "parent_id": null, "name": "برگر", "sort_order": 1 } ],
  "products": [
    { "id": "burger", "code": "B01", "name": "چیزبرگر", "category_id": "c1", "price": "2450000", "tax_rate": "0.1000", "max_per_order": null,
      "variants": [],
      "option_groups": [
        { "id": "drinks", "name": "نوشیدنی", "min": 0, "max": 1, "required": false,
          "items": [ { "id": "cola", "name": "کوکا", "price_delta": "350000", "product_id": null },
                     { "id": "doogh", "name": "دوغ", "price_delta": "250000", "product_id": null } ] },
        { "id": "bread", "name": "نان", "min": 0, "max": 1, "required": true,
          "items": [ { "id": "white", "name": "سفید", "price_delta": "0", "product_id": null },
                     { "id": "brown", "name": "سبوس‌دار", "price_delta": "50000", "product_id": null } ] }
      ] },
    { "id": "fries", "name": "سیب‌زمینی", "category_id": "c1", "price": "0", "tax_rate": "0.0900", "max_per_order": null,
      "variants": [ { "id": "small", "name": "کوچک", "price": "1000000" }, { "id": "large", "name": "بزرگ", "price": "1600000" } ],
      "option_groups": [] },
    { "id": "salad", "name": "سالاد", "category_id": "c1", "price": "900000", "tax_rate": "0", "max_per_order": 2, "variants": [], "option_groups": [] },
    { "id": "breakfast", "name": "املت", "category_id": "c1", "price": "700000", "tax_rate": "0", "max_per_order": null, "variants": [], "option_groups": [] },
    { "id": "late", "name": "شام دیروقت", "category_id": "c1", "price": "5", "tax_rate": "0.1000", "max_per_order": null, "variants": [], "option_groups": [] },
    { "id": "cheap", "name": "آب", "category_id": "c1", "price": "4", "tax_rate": "0.1000", "max_per_order": null, "variants": [], "option_groups": [] }
  ],
  "availability": {
    "stopped": [
      { "product_id": null, "variant_id": null, "option_item_id": "doogh", "until": null },
      { "product_id": "salad", "variant_id": null, "option_item_id": null, "until": "2026-09-24T05:00:00.000Z" }
    ],
    "schedules": [
      { "product_id": "breakfast", "windows": [ { "days": [0,1,2,3,4,5,6], "from": "07:00", "to": "11:00" } ] },
      { "product_id": "late", "windows": [ { "days": [4], "from": "22:00", "to": "02:00" } ] }
    ],
    "daily_stock": [ { "product_id": "fries", "variant_id": "large", "remaining": 2 } ]
  }
}`

// Thursday 24 September 2026, 10:00 in Tehran.
var thursdayMorning = time.Date(2026, 9, 24, 6, 30, 0, 0, time.UTC)

func catalog(t *testing.T) *Catalog {
	t.Helper()
	c, err := ParseCatalog([]byte(menuJSON))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func find(m Menu, id string) MenuProduct {
	for _, p := range m.Products {
		if p.ID == id {
			return p
		}
	}
	return MenuProduct{}
}

func TestMenuSaysWhatSellsNow(t *testing.T) {
	c := catalog(t)
	m := c.Menu(thursdayMorning, nil)
	if p := find(m, "burger"); !p.Available || p.OptionGroups[1].Min != 1 || p.OptionGroups[0].Items[1].Available {
		t.Fatalf("burger = %+v", p)
	}
	if p := find(m, "salad"); !p.Available {
		t.Fatal("a stop whose time has passed still stops the salad")
	}
	if p := find(m, "breakfast"); !p.Available {
		t.Fatal("breakfast is not on sale at 10:00")
	}
	if p := find(m, "late"); p.Available || p.Reason != ReasonOutOfHours {
		t.Fatalf("late plate at 10:00 = %+v", p)
	}

	// Friday 01:00 in Tehran is still Thursday night's window; 11:00 ends breakfast.
	fridayNight := time.Date(2026, 9, 24, 21, 30, 0, 0, time.UTC)
	m = c.Menu(fridayNight, nil)
	if !find(m, "late").Available || find(m, "breakfast").Available {
		t.Fatalf("at Friday 01:00: late=%v breakfast=%v", find(m, "late").Available, find(m, "breakfast").Available)
	}

	// Two large fries sold offline use up today's count; the small ones still sell.
	sold := func(product, variant string) int {
		if product == "fries" && variant == "large" {
			return 2
		}
		return 0
	}
	fries := find(c.Menu(thursdayMorning, sold), "fries")
	if !fries.Available || fries.Variants[1].Available || fries.Variants[1].Reason != ReasonSoldOut || !fries.Variants[0].Available {
		t.Fatalf("fries after selling two large = %+v", fries)
	}
}

func TestPricesAsTheUploadWill(t *testing.T) {
	c := catalog(t)
	lines, totals, err := c.Price(thursdayMorning, []LineInput{
		{ProductID: "burger", Quantity: 2, Options: []string{"cola", "brown"}, Notes: " بدون پیاز "},
		{ProductID: "fries", VariantID: "large", Quantity: 1},
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	b := lines[0]
	if b.UnitPrice != "2450000" || b.LineTotal != "5700000" || b.Tax != "570000" || b.Quantity != "2" || *b.Notes != "بدون پیاز" {
		t.Fatalf("burger line = %+v", b)
	}
	if len(b.Options) != 2 || b.Options[0].GroupName != "نوشیدنی" || b.Options[1].PriceDelta != "50000" {
		t.Fatalf("burger options = %+v", b.Options)
	}
	f := lines[1]
	if *f.VariantName != "بزرگ" || f.UnitPrice != "1600000" || f.Tax != "144000" {
		t.Fatalf("fries line = %+v", f)
	}
	want := Totals{Subtotal: "7300000", DeliveryFee: "0", DiscountTotal: "0", TaxTotal: "714000", GrandTotal: "8014000"}
	if totals != want {
		t.Fatalf("totals = %+v, want %+v", totals, want)
	}
}

// Tax is rounded per line, halves up: 5 × 10% = 0.5 → 1; 4 × 10% = 0.4 → 0.
func TestTaxRoundsHalvesUpPerLine(t *testing.T) {
	c := catalog(t)
	fridayNight := time.Date(2026, 9, 24, 21, 30, 0, 0, time.UTC)
	lines, totals, err := c.Price(fridayNight, []LineInput{{ProductID: "late", Quantity: 1}, {ProductID: "cheap", Quantity: 1}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if lines[0].Tax != "1" || lines[1].Tax != "0" || totals.TaxTotal != "1" {
		t.Fatalf("taxes = %s, %s", lines[0].Tax, lines[1].Tax)
	}
	if got, _ := taxOf(big.NewInt(3100000), "0.0900"); got.String() != "279000" {
		t.Fatalf("9%% of 3,100,000 = %s", got)
	}
}

func TestRefusesWhatTheTillMayNotSell(t *testing.T) {
	c := catalog(t)
	cases := map[string][]LineInput{
		"no bread":          {{ProductID: "burger", Quantity: 1}},
		"two drinks":        {{ProductID: "burger", Quantity: 1, Options: []string{"cola", "doogh", "white"}}},
		"stopped add-on":    {{ProductID: "burger", Quantity: 1, Options: []string{"doogh", "white"}}},
		"stranger add-on":   {{ProductID: "burger", Quantity: 1, Options: []string{"white", "large"}}},
		"same add-on twice": {{ProductID: "burger", Quantity: 1, Options: []string{"white", "white"}}},
		"size missing":      {{ProductID: "fries", Quantity: 1}},
		"size on no-size":   {{ProductID: "salad", VariantID: "large", Quantity: 1}},
		"unknown product":   {{ProductID: "pizza", Quantity: 1}},
		"quantity 0":        {{ProductID: "salad", Quantity: 0}},
		"quantity too big":  {{ProductID: "salad", Quantity: MaxQuantity + 1}},
		"out of hours":      {{ProductID: "late", Quantity: 1}},
		"stock":             {{ProductID: "fries", VariantID: "large", Quantity: 3}},
		"per order":         {{ProductID: "salad", Quantity: 2}, {ProductID: "salad", Quantity: 1}},
	}
	for name, lines := range cases {
		if _, _, err := c.Price(thursdayMorning, lines, nil); !Is(err, CodeNotAvailable) {
			t.Errorf("%s: %v, want NOT_AVAILABLE", name, err)
		}
	}
}

func TestARefusalNamesItsLine(t *testing.T) {
	c := catalog(t)
	_, _, err := c.Price(thursdayMorning, []LineInput{{ProductID: "salad", Quantity: 1}, {ProductID: "late", Quantity: 1}}, nil)
	var e *Error
	if !errors.As(err, &e) || e.Line == nil || *e.Line != 1 {
		t.Fatalf("err = %#v, want line 1", err)
	}
}
