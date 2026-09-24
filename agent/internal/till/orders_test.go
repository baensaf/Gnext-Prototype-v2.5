package till

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"gnext/agent/internal/branchdata"
)

// A branch whose POS range is 100–102 (so it wraps), whose cloud had drawn 1 number today, with
// a 10-minute edit window and a 5-minute cancel window.
const ordersJSON = `{
  "data_version": "v7", "generated_at": "2026-09-24T06:00:00.000Z",
  "branch": { "time_zone": "Asia/Tehran" },
  "settings": {
    "call_numbers": { "POS": { "start": 100, "end": 102 } },
    "call_number_issued_today": { "business_date": "2026-09-24", "POS": 1 },
    "order_actions": { "edit_window_minutes": 10, "cancel_window_minutes": 5 },
    "auto_logout_minutes": 15
  },
  "products": [
    { "id": "burger", "name": "چیزبرگر", "price": "2450000", "tax_rate": "0.1000", "variants": [], "option_groups": [] },
    { "id": "fries", "name": "سیب‌زمینی", "price": "1000000", "tax_rate": "0.0900", "variants": [], "option_groups": [] }
  ],
  "availability": { "stopped": [], "schedules": [], "daily_stock": [ { "product_id": "fries", "variant_id": null, "remaining": 2 } ] },
  "dining_tables": [ { "id": "t12", "area": "سالن", "number": "12", "seats": 4 } ],
  "tills": [ { "id": "till-1", "code": "T1", "name": "صندوق ۱" } ],
  "open_shifts": [ { "id": "shift-1", "terminal_id": "till-1", "shift_number": "S-1", "business_date": "2026-09-24" } ]
}`

type shop struct {
	t        *testing.T
	dir      string
	now      time.Time
	up       *time.Time // connected since, or nil offline
	uploaded []map[string]any
	failing  bool
	cloud    int // the POS count in the last heartbeat.ack
	till     *Till
	sara     User
	amir     User
}

func newShop(t *testing.T) *shop {
	s := &shop{t: t, dir: t.TempDir(), now: time.Date(2026, 9, 24, 8, 0, 0, 0, time.UTC)}
	s.sara = User{ID: "sara", DisplayName: "سارا", Role: "CASHIER"}
	s.amir = User{ID: "amir", DisplayName: "امیر", Role: "MANAGER"}
	s.till = s.open()
	if _, err := s.till.Bind("till-1", "amir"); err != nil {
		t.Fatal(err)
	}
	return s
}

// open starts the till on the shop's folder, as the agent does after every start.
func (s *shop) open() *Till {
	store, err := OpenStore(filepath.Join(s.dir, "till-orders.db"))
	if err != nil {
		s.t.Fatal(err)
	}
	s.t.Cleanup(func() { store.Close() })
	return &Till{
		Path: filepath.Join(s.dir, "till.json"),
		Staff: func() (branchdata.StaffList, error) {
			return branchdata.StaffList{StaffVersion: "s1", Users: []branchdata.StaffUser{
				{ID: "sara", DisplayName: "سارا", Role: "CASHIER", PINHash: cheap("1111")},
				{ID: "amir", DisplayName: "امیر", Role: "MANAGER", PINHash: cheap("9999")},
			}}, nil
		},
		Snapshot:  func() ([]byte, error) { return []byte(ordersJSON), nil },
		Connected: func() bool { return s.up != nil },
		Log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:       func() time.Time { return s.now },
		Store:     store,
		Upload: func(p json.RawMessage) error {
			if s.failing {
				return errors.New("disk full")
			}
			var m map[string]any
			_ = json.Unmarshal(p, &m)
			s.uploaded = append(s.uploaded, m)
			return nil
		},
		CloudCallCount: func() (string, int) { return "2026-09-24", s.cloud },
		ConnectedSince: func() *time.Time { return s.up },
	}
}

func (s *shop) newOrder() *Order {
	s.t.Helper()
	o, err := s.till.NewOrder(s.sara, TypeTakeaway, "", 0)
	if err != nil {
		s.t.Fatal(err)
	}
	return o
}

func (s *shop) add(o *Order, product string, qty int) *Order {
	s.t.Helper()
	o, err := s.till.AddLine(o.ID, s.sara, LineInput{ProductID: product, Quantity: qty})
	if err != nil {
		s.t.Fatal(err)
	}
	return o
}

func (s *shop) send(o *Order) *Order {
	s.t.Helper()
	o, err := s.till.Send(o.ID, s.sara)
	if err != nil {
		s.t.Fatal(err)
	}
	return o
}

func TestAnOrderIsKeptOnTheAgentAndSurvivesARestart(t *testing.T) {
	s := newShop(t)
	o := s.newOrder()
	if o.TerminalID != "till-1" || o.ShiftID != "shift-1" || o.BusinessDate != "2026-09-24" || o.DataVersion != "v7" || o.CreatedBy != "sara" {
		t.Fatalf("new order = %+v", o)
	}
	o = s.add(o, "burger", 2)
	if o.Totals.GrandTotal != "5390000" || o.Lines[0].LineTotal != "4900000" {
		t.Fatalf("totals = %+v", o.Totals)
	}
	if _, err := s.till.SetInfo(o.ID, TypeDineIn, "t12", 3); err != nil {
		t.Fatal(err)
	}

	// The agent restarted: the order is still there, as it was.
	s.till.Store.Close()
	s.till = s.open()
	list, err := s.till.Orders()
	if err != nil || len(list) != 1 {
		t.Fatalf("orders after restart = %v, %v", list, err)
	}
	got := list[0]
	if got.ID != o.ID || got.OrderType != TypeDineIn || *got.TableID != "t12" || *got.GuestCount != 3 || got.Totals.GrandTotal != "5390000" {
		t.Fatalf("order after restart = %+v", got)
	}
	if hb := s.till.Heartbeat(); hb["open_orders"] != 1 {
		t.Fatalf("heartbeat = %v", hb)
	}
}

func TestTheSameItemAgainIsOneLineUntilTheKitchenHasIt(t *testing.T) {
	s := newShop(t)
	o := s.add(s.add(s.newOrder(), "burger", 1), "burger", 2)
	if len(o.Lines) != 1 || o.Lines[0].Quantity != "3" || o.Lines[0].LineTotal != "7350000" {
		t.Fatalf("merged = %+v", o.Lines)
	}
	o = s.add(s.send(o), "burger", 1)
	if len(o.Lines) != 2 || o.Lines[1].Quantity != "1" {
		t.Fatalf("after sending, a new line: %+v", o.Lines)
	}
}

func TestQuantityChangesOnlyUntilTheKitchenHasTheLine(t *testing.T) {
	s := newShop(t)
	o := s.add(s.newOrder(), "burger", 1)
	o, err := s.till.SetQuantity(o.ID, o.Lines[0].ID, 3)
	if err != nil || o.Lines[0].Quantity != "3" || o.Totals.Subtotal != "7350000" {
		t.Fatalf("quantity 3: %+v, %v", o, err)
	}
	o = s.send(o)
	if _, err := s.till.SetQuantity(o.ID, o.Lines[0].ID, 2); !Is(err, CodeLineSent) {
		t.Fatalf("quantity of a sent line: %v", err)
	}
}

func TestCallNumbersCarryOnFromTheHighestCountKnownAndWrap(t *testing.T) {
	s := newShop(t)
	// The snapshot says the cloud drew 1; the last heartbeat.ack says 2: the till starts at the 3rd.
	s.cloud = 2
	var numbers []int
	var first *Order
	for i := 0; i < 3; i++ {
		o := s.send(s.add(s.newOrder(), "burger", 1))
		if first == nil {
			first = o
		}
		numbers = append(numbers, *o.CallNumber)
	}
	// Counts 3, 4, 5 in 100–102: 102, then back to 100 and 101.
	if numbers[0] != 102 || numbers[1] != 100 || numbers[2] != 101 {
		t.Fatalf("numbers = %v", numbers)
	}
	// Sending more lines later keeps the number.
	o := s.add(first, "burger", 1)
	if o = s.send(o); *o.CallNumber != 102 {
		t.Fatalf("second send renumbered: %d", *o.CallNumber)
	}
}

func TestVoidingASentLineFollowsTheEditWindow(t *testing.T) {
	s := newShop(t)
	o := s.send(s.add(s.add(s.newOrder(), "burger", 1), "fries", 1))
	o = s.send(s.add(o, "burger", 2))

	// Within 10 minutes the cashier alone may strike a line; the kitchen's copy is kept for the audit.
	s.now = s.now.Add(9 * time.Minute)
	o, err := s.till.VoidLine(o.ID, o.Lines[1].ID, s.sara, "", "")
	if err != nil || len(o.Lines) != 2 || len(o.Voided) != 1 || o.Voided[0].ApprovedBy != nil || o.Voided[0].ProductName != "سیب‌زمینی" {
		t.Fatalf("void within the window: %+v, %v", o, err)
	}

	// After it: an approver's PIN, not a cashier's.
	s.now = s.now.Add(2 * time.Minute)
	if _, err := s.till.VoidLine(o.ID, o.Lines[0].ID, s.sara, "", ""); !Is(err, CodeApprovalRequired) {
		t.Fatalf("no PIN: %v", err)
	}
	if _, err := s.till.VoidLine(o.ID, o.Lines[0].ID, s.sara, "sara", "1111"); !Is(err, CodeApprovalRequired) {
		t.Fatalf("cashier PIN: %v", err)
	}
	o, err = s.till.VoidLine(o.ID, o.Lines[0].ID, s.sara, "amir", "9999")
	if err != nil || len(o.Voided) != 2 || *o.Voided[1].ApprovedBy != "amir" || o.Totals.Subtotal != "4900000" {
		t.Fatalf("manager PIN: %+v, %v", o, err)
	}
}

func TestNothingIsStruckOrCancelledOnceMoneyIsOnTheOrder(t *testing.T) {
	s := newShop(t)
	o := s.send(s.add(s.newOrder(), "burger", 1))
	o.Payments = []Payment{{ID: "p1", MethodID: "cash", MethodKind: "CASH", Amount: "1000000", Status: "APPROVED", At: s.now}}
	_ = s.till.Store.put(o)
	if _, err := s.till.VoidLine(o.ID, o.Lines[0].ID, s.sara, "amir", "9999"); !Is(err, CodeOrderPaid) {
		t.Fatalf("void: %v", err)
	}
	if _, err := s.till.Cancel(o.ID, s.sara, "", "amir", "9999"); !Is(err, CodeOrderPaid) {
		t.Fatalf("cancel: %v", err)
	}
	if _, err := s.till.Finish(o.ID, s.sara); !Is(err, CodeNotPaid) {
		t.Fatalf("finish part-paid: %v", err)
	}
}

func TestCancellingAnUnsentCartDropsItAndASentOneIsUploaded(t *testing.T) {
	s := newShop(t)
	cart := s.add(s.newOrder(), "burger", 1)
	if o, err := s.till.Cancel(cart.ID, s.sara, "", "", ""); err != nil || o != nil {
		t.Fatalf("dropping a cart: %v, %v", o, err)
	}
	if _, err := s.till.Order(cart.ID); !Is(err, CodeOrderUnknown) {
		t.Fatalf("dropped cart still held: %v", err)
	}

	o := s.send(s.add(s.newOrder(), "burger", 1))
	s.now = s.now.Add(6 * time.Minute) // past the 5-minute cancel window
	if _, err := s.till.Cancel(o.ID, s.sara, "مشتری رفت", "", ""); !Is(err, CodeApprovalRequired) {
		t.Fatalf("late cancel without a PIN: %v", err)
	}
	o, err := s.till.Cancel(o.ID, s.sara, "مشتری رفت", "amir", "9999")
	if err != nil || o.State != StateCancelled || !o.HandedOver {
		t.Fatalf("cancel: %+v, %v", o, err)
	}
	up := s.uploaded[len(s.uploaded)-1]
	if up["state"] != "CANCELLED" || up["cancellation_note"] != "مشتری رفت" || up["approved_by"] != "amir" || up["cancelled_by"] != "sara" || up["cancelled_at"] == nil {
		t.Fatalf("uploaded = %v", up)
	}
	if _, err := s.till.AddLine(o.ID, s.sara, LineInput{ProductID: "burger", Quantity: 1}); !Is(err, CodeOrderClosed) {
		t.Fatalf("adding to a cancelled order: %v", err)
	}
}

func TestAPaidOrderFinishesAndIsUploadedInTheSection12Shape(t *testing.T) {
	s := newShop(t)
	o := s.add(s.newOrder(), "burger", 2)
	o.Payments = []Payment{{ID: "p1", MethodID: "cash", MethodKind: "CASH", Amount: "5390000", Status: "APPROVED", At: s.now}}
	_ = s.till.Store.put(o)
	s.now = s.now.Add(3 * time.Minute)

	o, err := s.till.Finish(o.ID, s.sara)
	if err != nil || o.State != StateCompleted || o.CallNumber == nil || o.SentAt == nil {
		t.Fatalf("finish: %+v, %v", o, err)
	}
	up := s.uploaded[0]
	lines := up["lines"].([]any)
	line := lines[0].(map[string]any)
	totals := up["totals"].(map[string]any)
	if up["id"] != o.ID || up["state"] != "COMPLETED" || up["channel"] != "POS" || up["shift_id"] != "shift-1" || up["terminal_id"] != "till-1" ||
		up["business_date"] != "2026-09-24" || up["data_version"] != "v7" || up["completed_at"] != "2026-09-24T08:03:00.000Z" ||
		// The snapshot says the cloud drew 1 today: this is the 2nd, 101.
		up["placed_at"] != "2026-09-24T08:00:00.000Z" || up["call_number"] != float64(101) {
		t.Fatalf("uploaded = %v", up)
	}
	if line["quantity"] != "2" || line["unit_price"] != "2450000" || line["tax"] != "490000" || line["id"] == "" {
		t.Fatalf("uploaded line = %v", line)
	}
	if totals["grand_total"] != "5390000" || totals["discount_total"] != "0" || len(up["payments"].([]any)) != 1 {
		t.Fatalf("uploaded totals = %v, payments = %v", totals, up["payments"])
	}
}

func TestTheTillsOwnSalesCountAgainstTodaysStock(t *testing.T) {
	s := newShop(t)
	s.send(s.add(s.newOrder(), "fries", 2))
	if _, err := s.till.AddLine(s.newOrder().ID, s.sara, LineInput{ProductID: "fries", Quantity: 1}); !Is(err, CodeNotAvailable) {
		t.Fatalf("a third fries of two: %v", err)
	}
	m, _ := s.till.Menu()
	if find(m, "fries").Available {
		t.Fatal("the menu still offers the fries")
	}
}

func TestOnlineTheTillTakesNothingAndInHandoverNothingNew(t *testing.T) {
	s := newShop(t)
	sent := s.send(s.add(s.newOrder(), "burger", 1))
	cart := s.add(s.newOrder(), "burger", 1)
	struck := s.send(s.add(s.newOrder(), "fries", 1))
	struck, _ = s.till.VoidLine(struck.ID, struck.Lines[0].ID, s.sara, "", "")

	up := s.now
	s.up = &up
	if s.till.Mode() != ModeHandover {
		t.Fatalf("mode = %s", s.till.Mode())
	}
	if _, err := s.till.NewOrder(s.sara, TypeTakeaway, "", 0); !Is(err, CodeHandover) {
		t.Fatalf("new order in HANDOVER: %v", err)
	}
	if _, err := s.till.AddLine(sent.ID, s.sara, LineInput{ProductID: "burger", Quantity: 1}); err != nil {
		t.Fatalf("an open order goes on in HANDOVER: %v", err)
	}

	// 14 minutes connected: nothing yet. 15: the orders go.
	s.now = s.now.Add(14 * time.Minute)
	s.till.tend()
	if len(s.uploaded) != 0 {
		t.Fatal("handed over before 15 minutes")
	}
	s.now = s.now.Add(time.Minute)
	s.till.tend()
	if len(s.uploaded) != 2 {
		t.Fatalf("uploaded %d orders, want 2", len(s.uploaded))
	}
	byID := map[string]string{}
	for _, u := range s.uploaded {
		byID[u["id"].(string)] = u["state"].(string)
	}
	if byID[sent.ID] != "OPEN" || byID[struck.ID] != "CANCELLED" {
		t.Fatalf("handed over as %v", byID)
	}
	if _, err := s.till.Order(cart.ID); !Is(err, CodeOrderUnknown) {
		t.Fatal("the unsent cart was not dropped")
	}
	if s.till.Mode() != ModeOnline {
		t.Fatalf("mode after hand-over = %s", s.till.Mode())
	}
	if _, err := s.till.NewOrder(s.sara, TypeTakeaway, "", 0); !Is(err, CodeTillOnline) {
		t.Fatalf("new order online: %v", err)
	}
}

func TestAnOrderTheUploadDidNotTakeIsTriedAgain(t *testing.T) {
	s := newShop(t)
	o := s.send(s.add(s.newOrder(), "burger", 1))
	s.failing = true
	o, err := s.till.Cancel(o.ID, s.sara, "", "", "")
	if err != nil || o.HandedOver {
		t.Fatalf("cancel with the upload failing: %+v, %v", o, err)
	}
	s.failing = false
	s.till.tend()
	if len(s.uploaded) != 1 {
		t.Fatalf("uploaded %d, want 1 after the retry", len(s.uploaded))
	}
	if got, _ := s.till.Order(o.ID); !got.HandedOver {
		t.Fatal("not marked handed over")
	}
}
