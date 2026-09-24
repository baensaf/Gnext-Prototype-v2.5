package till

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Order states (§12.4). An order is unfinished while it is OPEN and not yet handed over.
const (
	StateOpen      = "OPEN"
	StateCompleted = "COMPLETED"
	StateCancelled = "CANCELLED"
)

// Order types sold offline (§13.1).
const (
	TypeTakeaway = "TAKEAWAY"
	TypeDineIn   = "DINE_IN"
)

// More refusals of the order API (§13.13).
const (
	CodeTillOnline   = "TILL_ONLINE"
	CodeHandover     = "HANDOVER"
	CodeOrderUnknown = "ORDER_UNKNOWN"
	CodeOrderClosed  = "ORDER_CLOSED"
	CodeOrderPaid    = "ORDER_PAID"
	CodeNotPaid      = "ORDER_NOT_PAID"
	CodeLineSent     = "LINE_SENT"
	CodeInvalid      = "INVALID_ORDER"
)

// The cloud's default edit and cancel windows (order-edit-policy), when the snapshot has none.
const defaultWindow = 10 * time.Minute

// Keep is how long an order stays on the till after it ended, for reprints and support.
const Keep = 7 * 24 * time.Hour

// Order is an order as the till holds it (§13.6).
type Order struct {
	ID           string  `json:"id"`
	State        string  `json:"state"`
	DataVersion  string  `json:"data_version"`
	TerminalID   string  `json:"terminal_id"`
	ShiftID      string  `json:"shift_id"`
	BusinessDate string  `json:"business_date"`
	OrderType    string  `json:"order_type"`
	TableID      *string `json:"table_id"`
	GuestCount   *int    `json:"guest_count"`
	CallNumber   *int    `json:"call_number"`
	CreatedBy    string  `json:"created_by"`
	Notes        *string `json:"notes"` // for the kitchen and the courier, as the web POS takes them

	PlacedAt    time.Time  `json:"placed_at"`
	SentAt      *time.Time `json:"sent_at"` // first sent to the kitchen: the edit windows run from here
	CompletedAt *time.Time `json:"completed_at"`
	CancelledAt *time.Time `json:"cancelled_at"`

	CancellationNote *string `json:"cancellation_note"`
	CancelledBy      *string `json:"cancelled_by"`
	ApprovedBy       *string `json:"approved_by"`

	Lines    []OrderLine  `json:"lines"`
	Voided   []VoidedLine `json:"voided_lines"`
	Totals   Totals       `json:"totals"`
	Payments []Payment    `json:"payments"`
	// CardAttempts is every card charge tried on the order and how it ended, so the screen can say
	// why a charge left no payment. It stays on the till.
	CardAttempts []CardAttempt `json:"card_attempts"`
	// Prints is every ticket printed for the order and how it went (§13.8).
	Prints []PrintRecord `json:"prints"`

	// HandedOver is set once the order went to the upload (§12.5): it has left the till.
	HandedOver bool       `json:"handed_over"`
	HandedAt   *time.Time `json:"handed_at"`
}

// OrderLine is a line on the order, priced when it was added.
type OrderLine struct {
	ID string `json:"id"`
	Line
	Input   LineInput  `json:"input"`
	SentAt  *time.Time `json:"sent_at"`
	AddedBy string     `json:"added_by"`
}

// VoidedLine is a line struck after the kitchen had it, kept for the audit (§13.12).
type VoidedLine struct {
	ProductName string    `json:"product_name"`
	VariantName *string   `json:"variant_name"`
	Quantity    string    `json:"quantity"`
	LineTotal   Money     `json:"line_total"`
	VoidedBy    string    `json:"voided_by"`
	ApprovedBy  *string   `json:"approved_by"`
	At          time.Time `json:"at"`
}

func (o *Order) unfinished() bool { return o.State == StateOpen && !o.HandedOver }

func (o *Order) inputs() []LineInput {
	out := make([]LineInput, 0, len(o.Lines))
	for _, l := range o.Lines {
		out = append(out, l.Input)
	}
	return out
}

func (o *Order) retotal() {
	lines := make([]Line, 0, len(o.Lines))
	for _, l := range o.Lines {
		lines = append(lines, l.Line)
	}
	o.Totals = sumLines(lines)
}

func sortOrders(list []*Order) {
	sort.SliceStable(list, func(i, j int) bool {
		if !list[i].PlacedAt.Equal(list[j].PlacedAt) {
			return list[i].PlacedAt.Before(list[j].PlacedAt)
		}
		return list[i].ID < list[j].ID
	})
}

// ---- reading ----

// Orders returns the unfinished orders and those that ended in the last day, oldest first.
func (t *Till) Orders() ([]*Order, error) {
	t.init()
	if t.Store == nil {
		return []*Order{}, nil
	}
	all, err := t.Store.all()
	if err != nil {
		return nil, err
	}
	since := t.Now().Add(-24 * time.Hour)
	out := []*Order{}
	for _, o := range all {
		if o.unfinished() || o.PlacedAt.After(since) {
			out = append(out, o)
		}
	}
	return out, nil
}

// Order returns one order the till holds.
func (t *Till) Order(id string) (*Order, error) {
	t.init()
	if t.Store == nil {
		return nil, refuse(CodeOrderUnknown, "این سفارش پیدا نشد.")
	}
	o, err := t.Store.get(id)
	if errors.Is(err, errNoOrder) {
		return nil, refuse(CodeOrderUnknown, "این سفارش پیدا نشد.")
	}
	return o, err
}

func (t *Till) openOrders() int {
	if t.Store == nil {
		return 0
	}
	all, _ := t.Store.all()
	n := 0
	for _, o := range all {
		if o.unfinished() {
			n++
		}
	}
	return n
}

// soldOffline counts the till's own sales against today's stock: the active lines of orders
// placed since the snapshot was made (earlier ones are already in its counts), other than the
// order being priced, whose lines are counted with it.
func (t *Till) soldOffline(c *Catalog, except string) SoldOffline {
	if t.Store == nil {
		return nil
	}
	all, _ := t.Store.all()
	since, _ := time.Parse(time.RFC3339Nano, c.GeneratedAt)
	return func(productID, variantID string) int {
		n := 0
		for _, o := range all {
			if o.ID == except || o.State == StateCancelled || o.PlacedAt.Before(since) {
				continue
			}
			for _, l := range o.Lines {
				if l.ProductID == productID && (variantID == "" || (l.VariantID != nil && *l.VariantID == variantID)) {
					n += l.Input.Quantity
				}
			}
		}
		return n
	}
}

// ---- changing ----

// guard refuses changes the mode does not allow (§13.5): nothing online, no new order in
// HANDOVER.
func (t *Till) guard(newOrder bool) error {
	switch t.Mode() {
	case ModeOnline:
		return refuse(CodeTillOnline, "اینترنت وصل است؛ سفارش را در صندوق آنلاین ثبت کنید.")
	case ModeHandover:
		if newOrder {
			return refuse(CodeHandover, "اینترنت برگشته است؛ سفارش جدید را در صندوق آنلاین ثبت کنید.")
		}
	}
	return nil
}

// open loads an order that can still be changed.
func (t *Till) open(id string) (*Order, error) {
	o, err := t.Order(id)
	if err != nil {
		return nil, err
	}
	if !o.unfinished() {
		return nil, refuse(CodeOrderClosed, "این سفارش بسته شده است.")
	}
	return o, nil
}

// NewOrder starts an order on the bound till and its open shift (§13.4, §13.6).
func (t *Till) NewOrder(by User, orderType, tableID string, guests int) (*Order, error) {
	t.omu.Lock()
	defer t.omu.Unlock()
	o, _, err := t.start(by, orderType, tableID, guests)
	if err != nil {
		return nil, err
	}
	if err := t.Store.put(o); err != nil {
		return nil, err
	}
	t.Log.Info("offline order started", "order", o.ID, "by", by.ID)
	return o, nil
}

// PlaceInput is a whole cart, placed at once as the web POS's screen places it.
type PlaceInput struct {
	OrderType  string      `json:"order_type"`
	TableID    string      `json:"table_id"`
	GuestCount int         `json:"guest_count"`
	Notes      string      `json:"notes"`
	Lines      []LineInput `json:"lines"`
}

// Place starts an order with its lines and sends it to the kitchen in one step, all of it or
// nothing: the lines are checked and priced as one order (§12.4, §13.6), and the order gets its
// call number (§13.9).
func (t *Till) Place(by User, in PlaceInput) (*Order, error) {
	t.omu.Lock()
	defer t.omu.Unlock()
	if len(in.Lines) == 0 {
		return nil, refuse(CodeInvalid, "سبد خرید خالی است.")
	}
	o, c, err := t.start(by, in.OrderType, in.TableID, in.GuestCount)
	if err != nil {
		return nil, err
	}
	for i := range in.Lines {
		in.Lines[i].Notes = strings.TrimSpace(in.Lines[i].Notes)
	}
	lines, _, err := c.Price(t.Now(), in.Lines, t.soldOffline(c, ""))
	if err != nil {
		return nil, err
	}
	now := t.Now().UTC()
	for i, l := range lines {
		o.Lines = append(o.Lines, OrderLine{ID: uuid.NewString(), Line: l, Input: in.Lines[i], SentAt: &now, AddedBy: by.ID})
	}
	if notes := strings.TrimSpace(in.Notes); notes != "" {
		o.Notes = &notes
	}
	o.retotal()
	if err := t.number(o); err != nil {
		return nil, err
	}
	o.SentAt = &now
	recs := t.queuePrints(o, t.kitchenTickets(c, o, chitLines(o.Lines, ""), "", "", o.PlacedAt))
	if err := t.Store.put(o); err != nil {
		return nil, err
	}
	t.print(o.ID, recs)
	t.Log.Info("offline order placed and sent to the kitchen", "order", o.ID, "call_number", deref(o.CallNumber), "lines", len(o.Lines), "by", by.ID)
	return o, nil
}

// start makes a new order on the bound till and its open shift, not yet kept.
func (t *Till) start(by User, orderType, tableID string, guests int) (*Order, *Catalog, error) {
	if err := t.guard(true); err != nil {
		return nil, nil, err
	}
	st := t.State()
	for _, p := range []string{CodeNoSnapshot, CodeNoTill, CodeNoShift} {
		if slices.Contains(st.Problems, p) {
			return nil, nil, refuse(p, problemText[p])
		}
	}
	c, err := t.catalog()
	if err != nil {
		return nil, nil, err
	}
	// The order belongs to its shift's business day; a shift without one, to today on the branch clock.
	day := st.Shift.BusinessDate
	if day == "" {
		day = t.Now().In(c.location()).Format("2006-01-02")
	}
	o := &Order{
		ID: uuid.NewString(), State: StateOpen, DataVersion: c.DataVersion,
		TerminalID: st.Binding.TerminalID, ShiftID: st.Shift.ID, BusinessDate: day,
		CreatedBy: by.ID, PlacedAt: t.Now().UTC(), Lines: []OrderLine{}, Voided: []VoidedLine{}, Payments: []Payment{},
	}
	if err := t.setInfo(c, o, orderType, tableID, guests); err != nil {
		return nil, nil, err
	}
	o.retotal()
	return o, c, nil
}

var problemText = map[string]string{
	CodeNoSnapshot: "هنوز منوی شعبه از سرور دریافت نشده است.",
	CodeNoTill:     "هنوز صندوقی برای فروش آفلاین انتخاب نشده است.",
	CodeNoShift:    "این صندوق شیفت باز ندارد؛ بدون شیفت باز، فروش آفلاین ممکن نیست.",
}

// SetInfo changes the order's type, table and guests while it is open.
func (t *Till) SetInfo(id, orderType, tableID string, guests int) (*Order, error) {
	t.omu.Lock()
	defer t.omu.Unlock()
	if err := t.guard(false); err != nil {
		return nil, err
	}
	o, err := t.open(id)
	if err != nil {
		return nil, err
	}
	c, err := t.catalog()
	if err != nil {
		return nil, err
	}
	if err := t.setInfo(c, o, orderType, tableID, guests); err != nil {
		return nil, err
	}
	return o, t.Store.put(o)
}

func (t *Till) setInfo(c *Catalog, o *Order, orderType, tableID string, guests int) error {
	switch orderType {
	case TypeTakeaway:
		o.TableID, o.GuestCount = nil, nil
		o.OrderType = orderType
		return nil
	case TypeDineIn:
	default:
		return refuse(CodeInvalid, "نوع سفارش باید بیرون‌بر یا سالن باشد.")
	}
	o.OrderType = orderType
	o.TableID = nil
	if tableID != "" {
		if !slices.ContainsFunc(c.DiningTables, func(x Table) bool { return x.ID == tableID }) {
			return refuse(CodeInvalid, "این میز در فهرست میزهای شعبه نیست.")
		}
		o.TableID = &tableID
	}
	o.GuestCount = nil
	if guests > 0 {
		o.GuestCount = &guests
	}
	return nil
}

// AddLine adds a line, checked and priced against the snapshot; the lines already on the order
// keep the prices they were charged at.
func (t *Till) AddLine(id string, by User, in LineInput) (*Order, error) {
	t.omu.Lock()
	defer t.omu.Unlock()
	if err := t.guard(false); err != nil {
		return nil, err
	}
	o, err := t.open(id)
	if err != nil {
		return nil, err
	}
	c, err := t.catalog()
	if err != nil {
		return nil, err
	}
	in.Notes = strings.TrimSpace(in.Notes)
	// The same thing again, before the kitchen has it, is one line with more of it.
	if i := slices.IndexFunc(o.Lines, func(l OrderLine) bool { return l.SentAt == nil && sameInput(l.Input, in) }); i >= 0 {
		merged := o.Lines[i].Input
		merged.Quantity += in.Quantity
		others := slices.Delete(o.inputs(), i, i+1)
		line, err := c.PriceAdded(t.Now(), others, merged, t.soldOffline(c, o.ID))
		if err != nil {
			return nil, err
		}
		o.Lines[i].Line, o.Lines[i].Input = line, merged
		o.retotal()
		return o, t.Store.put(o)
	}
	line, err := c.PriceAdded(t.Now(), o.inputs(), in, t.soldOffline(c, o.ID))
	if err != nil {
		return nil, err
	}
	o.Lines = append(o.Lines, OrderLine{ID: uuid.NewString(), Line: line, Input: in, AddedBy: by.ID})
	o.retotal()
	return o, t.Store.put(o)
}

func sameInput(a, b LineInput) bool {
	return a.ProductID == b.ProductID && a.VariantID == b.VariantID && a.Notes == b.Notes && slices.Equal(a.Options, b.Options)
}

// SetQuantity changes how many of a line the kitchen has not had yet; a line it has is voided
// instead (VoidLine).
func (t *Till) SetQuantity(id, lineID string, quantity int) (*Order, error) {
	t.omu.Lock()
	defer t.omu.Unlock()
	if err := t.guard(false); err != nil {
		return nil, err
	}
	o, err := t.open(id)
	if err != nil {
		return nil, err
	}
	i := slices.IndexFunc(o.Lines, func(l OrderLine) bool { return l.ID == lineID })
	if i < 0 {
		return nil, refuse(CodeOrderUnknown, "این ردیف در سفارش نیست.")
	}
	if o.Lines[i].SentAt != nil {
		return nil, refuse(CodeLineSent, "این ردیف به آشپزخانه رفته است؛ برای کم کردن، آن را حذف کنید.")
	}
	if quantity < 1 {
		o.Lines = slices.Delete(o.Lines, i, i+1)
	} else {
		c, err := t.catalog()
		if err != nil {
			return nil, err
		}
		in := o.Lines[i].Input
		in.Quantity = quantity
		others := slices.Delete(o.inputs(), i, i+1)
		line, err := c.PriceAdded(t.Now(), others, in, t.soldOffline(c, o.ID))
		if err != nil {
			return nil, err
		}
		o.Lines[i].Line, o.Lines[i].Input = line, in
	}
	o.retotal()
	return o, t.Store.put(o)
}

// VoidLine strikes a line. One the kitchen has not had goes freely; one it has follows the
// cloud's edit rules (§13.6): nothing with money on the order, the cashier alone within the edit
// window from when the order was first sent, an approver's PIN after it.
func (t *Till) VoidLine(id, lineID string, by User, approverID, pin string) (*Order, error) {
	t.omu.Lock()
	defer t.omu.Unlock()
	if err := t.guard(false); err != nil {
		return nil, err
	}
	o, err := t.open(id)
	if err != nil {
		return nil, err
	}
	i := slices.IndexFunc(o.Lines, func(l OrderLine) bool { return l.ID == lineID })
	if i < 0 {
		return nil, refuse(CodeOrderUnknown, "این ردیف در سفارش نیست.")
	}
	l := o.Lines[i]
	var recs []PrintRecord
	if l.SentAt != nil {
		approver, err := t.approval(o, false, approverID, pin)
		if err != nil {
			return nil, err
		}
		o.Voided = append(o.Voided, VoidedLine{
			ProductName: l.ProductName, VariantName: l.VariantName, Quantity: l.Quantity, LineTotal: l.LineTotal,
			VoidedBy: by.ID, ApprovedBy: approver, At: t.Now().UTC(),
		})
		t.Log.Info("offline order line voided after sending", "order", o.ID, "by", by.ID, "approved_by", deref(approver))
		if c, err := t.catalog(); err == nil {
			recs = t.queuePrints(o, t.kitchenTickets(c, o, chitLines([]OrderLine{l}, "VOID"), "AMENDED", "", t.Now()))
		}
	}
	o.Lines = slices.Delete(o.Lines, i, i+1)
	o.retotal()
	if err := t.Store.put(o); err != nil {
		return nil, err
	}
	t.print(o.ID, recs)
	return o, nil
}

// approval applies the edit rules to a change of something the kitchen has: it returns who
// approved it (nil when the cashier alone may), or a refusal.
func (t *Till) approval(o *Order, cancel bool, approverID, pin string) (*string, error) {
	if len(o.Payments) > 0 {
		return nil, refuse(CodeOrderPaid, "روی این سفارش پرداخت ثبت شده است؛ حذف یا لغو پس از بازگشت اینترنت در جی‌نکست انجام می‌شود.")
	}
	window := defaultWindow
	if c, err := t.catalog(); err == nil {
		m := c.Settings.OrderActions.EditWindowMinutes
		if cancel {
			m = c.Settings.OrderActions.CancelWindowMinutes
		}
		if m != nil && *m >= 0 {
			window = time.Duration(*m) * time.Minute
		}
	}
	if o.SentAt == nil || t.Now().Sub(*o.SentAt) < window {
		return nil, nil
	}
	if pin == "" {
		return nil, refuse(CodeApprovalRequired, "زمان تغییر سفارش گذشته است؛ مدیر یا سرپرست باید با پین تأیید کند.")
	}
	u, err := t.CheckPIN(approverID, pin)
	if err != nil {
		return nil, err
	}
	if !slices.Contains(ApproverRoles, u.Role) {
		return nil, refuse(CodeApprovalRequired, "این کار را فقط مدیر یا سرپرست می‌تواند تأیید کند.")
	}
	return &u.ID, nil
}

// Send gives the order its call number, if it has none, and hands the lines the kitchen has not
// had yet to it (§13.6), and prints their chits (§13.8).
func (t *Till) Send(id string, by User) (*Order, error) {
	t.omu.Lock()
	defer t.omu.Unlock()
	if err := t.guard(false); err != nil {
		return nil, err
	}
	o, err := t.open(id)
	if err != nil {
		return nil, err
	}
	now := t.Now().UTC()
	first := o.SentAt == nil
	var fresh []OrderLine
	for i := range o.Lines {
		if o.Lines[i].SentAt == nil {
			o.Lines[i].SentAt = &now
			fresh = append(fresh, o.Lines[i])
		}
	}
	if len(fresh) == 0 {
		return nil, refuse(CodeInvalid, "چیزی برای ارسال به آشپزخانه نیست.")
	}
	if err := t.number(o); err != nil {
		return nil, err
	}
	if o.SentAt == nil {
		o.SentAt = &now
	}
	var recs []PrintRecord
	if c, err := t.catalog(); err == nil {
		if first {
			recs = t.queuePrints(o, t.kitchenTickets(c, o, chitLines(fresh, ""), "", "", o.PlacedAt))
		} else {
			recs = t.queuePrints(o, t.kitchenTickets(c, o, chitLines(fresh, "ADD"), "AMENDED", "", now))
		}
	}
	if err := t.Store.put(o); err != nil {
		return nil, err
	}
	t.print(o.ID, recs)
	t.Log.Info("offline order sent to the kitchen", "order", o.ID, "call_number", deref(o.CallNumber), "lines", len(fresh), "by", by.ID)
	return o, nil
}

// number gives the order the next number in the day's POS range (§13.9): it carries on from the
// highest count the till knows for the order's business date, from the snapshot, the last
// heartbeat.ack, and its own.
func (t *Till) number(o *Order) error {
	if o.CallNumber != nil {
		return nil
	}
	c, err := t.catalog()
	if err != nil {
		return err
	}
	floor := 0
	if s := c.Settings.CallNumberIssuedToday; s.BusinessDate == o.BusinessDate {
		floor = s.POS
	}
	if t.CloudCallCount != nil {
		if date, n := t.CloudCallCount(); date == o.BusinessDate {
			floor = max(floor, n)
		}
	}
	n, err := t.Store.nextCall(o.BusinessDate, floor)
	if err != nil {
		return err
	}
	start, end := c.Settings.CallNumbers.POS.Start, c.Settings.CallNumbers.POS.End
	if start < 1 || end < start {
		start, end = 100, 399 // the cloud's default POS range
	}
	number := start + (n-1)%(end-start+1)
	o.CallNumber = &number
	return nil
}

// Finish ends a paid order (§13.6) and hands it to the upload.
func (t *Till) Finish(id string, by User) (*Order, error) {
	t.omu.Lock()
	defer t.omu.Unlock()
	if err := t.guard(false); err != nil {
		return nil, err
	}
	o, err := t.open(id)
	if err != nil {
		return nil, err
	}
	return o, t.finish(o, by)
}

// finish completes an order and hands it to the upload; the caller holds omu.
func (t *Till) finish(o *Order, by User) error {
	if len(o.Lines) == 0 {
		return refuse(CodeInvalid, "سفارش خالی را نمی‌توان بست؛ آن را لغو کنید.")
	}
	if o.charging() {
		return refuse(CodeTerminalBusy, "پرداخت کارتی این سفارش هنوز تمام نشده است.")
	}
	if !paid(o) {
		return refuse(CodeNotPaid, "سفارش هنوز کامل پرداخت نشده است.")
	}
	if err := t.number(o); err != nil {
		return err
	}
	now := t.Now().UTC()
	o.State, o.CompletedAt = StateCompleted, &now
	var recs []PrintRecord
	if o.SentAt == nil {
		for i := range o.Lines {
			o.Lines[i].SentAt = &now
		}
		o.SentAt = &now
		if c, err := t.catalog(); err == nil {
			recs = t.queuePrints(o, t.kitchenTickets(c, o, chitLines(o.Lines, ""), "", "", o.PlacedAt))
		}
	}
	t.Log.Info("offline order completed", "order", o.ID, "by", by.ID)
	if err := t.end(o); err != nil {
		return err
	}
	t.print(o.ID, recs)
	return nil
}

// paid: the payments cover the grand total.
func paid(o *Order) bool {
	return outstanding(o).Sign() == 0
}

// Cancel ends an order nobody paid for (§13.6). One the kitchen never had and that has no
// number is simply dropped: it was never a sale.
func (t *Till) Cancel(id string, by User, note, approverID, pin string) (*Order, error) {
	t.omu.Lock()
	defer t.omu.Unlock()
	if err := t.guard(false); err != nil {
		return nil, err
	}
	o, err := t.open(id)
	if err != nil {
		return nil, err
	}
	if len(o.Payments) > 0 {
		return nil, refuse(CodeOrderPaid, "روی این سفارش پرداخت ثبت شده است؛ لغو پس از بازگشت اینترنت در جی‌نکست انجام می‌شود.")
	}
	if o.SentAt == nil && o.CallNumber == nil {
		t.Log.Info("offline order dropped before it reached the kitchen", "order", o.ID, "by", by.ID)
		return nil, t.Store.delete(o.ID)
	}
	approver, err := t.approval(o, true, approverID, pin)
	if err != nil {
		return nil, err
	}
	now := t.Now().UTC()
	o.State, o.CancelledAt, o.CancelledBy, o.ApprovedBy = StateCancelled, &now, &by.ID, approver
	if note = strings.TrimSpace(note); note != "" {
		o.CancellationNote = &note
	}
	var recs []PrintRecord
	if c, err := t.catalog(); err == nil {
		recs = t.queuePrints(o, t.kitchenTickets(c, o, chitLines(o.Lines, "VOID"), "CANCELLED", note, now))
	}
	t.Log.Info("offline order cancelled", "order", o.ID, "by", by.ID, "approved_by", deref(approver))
	if err := t.end(o); err != nil {
		return nil, err
	}
	t.print(o.ID, recs)
	return o, nil
}

// end saves an order whose offline life is over and hands it to the upload (§12.4).
func (t *Till) end(o *Order) error {
	if err := t.Store.put(o); err != nil {
		return err
	}
	return t.handOver(o)
}

// handOver gives an order to the upload once. A failure leaves it for the next try (Run).
func (t *Till) handOver(o *Order) error {
	if o.HandedOver {
		return nil
	}
	if t.Upload != nil {
		payload, err := json.Marshal(uploadPayload(o))
		if err != nil {
			return err
		}
		if err := t.Upload(payload); err != nil {
			t.Log.Error("offline order not handed to the upload; will retry", "order", o.ID, "err", err)
			return nil
		}
	}
	now := t.Now().UTC()
	o.HandedOver, o.HandedAt = true, &now
	return t.Store.put(o)
}

// Handover ends HANDOVER now (§13.5): a cart nobody paid for and the kitchen never had is dropped;
// every other unfinished order goes to the upload as OPEN, or as CANCELLED when every line it
// sent was voided. It returns how many it dropped and handed over.
func (t *Till) Handover() (dropped, handed int, err error) {
	t.init()
	t.omu.Lock()
	defer t.omu.Unlock()
	if t.Store == nil {
		return 0, 0, nil
	}
	all, err := t.Store.all()
	if err != nil {
		return 0, 0, err
	}
	for _, o := range all {
		// An order at the card terminal goes up once the charge has ended (the next tend).
		if !o.unfinished() || o.charging() {
			continue
		}
		switch {
		case o.SentAt == nil && o.CallNumber == nil && len(o.Payments) == 0:
			t.Log.Info("unsent offline cart dropped at hand-over", "order", o.ID, "lines", len(o.Lines))
			if err := t.Store.delete(o.ID); err != nil {
				return dropped, handed, err
			}
			dropped++
			continue
		case len(o.Lines) == 0:
			now := t.Now().UTC()
			o.State, o.CancelledAt = StateCancelled, &now
		}
		if err := t.handOver(o); err != nil {
			return dropped, handed, err
		}
		handed++
	}
	if dropped+handed > 0 {
		t.Log.Info("offline till handed over", "dropped", dropped, "handed", handed)
	}
	return dropped, handed, nil
}

// uploadPayload is the order as §12.4 uploads it, with the §13.12 additions.
func uploadPayload(o *Order) map[string]any {
	lines := make([]map[string]any, 0, len(o.Lines))
	for _, l := range o.Lines {
		lines = append(lines, map[string]any{
			"id": l.ID, "product_id": l.ProductID, "product_name": l.ProductName,
			"variant_id": l.VariantID, "variant_name": l.VariantName, "quantity": l.Quantity,
			"unit_price": l.UnitPrice, "options": l.Options, "tax_rate": l.TaxRate,
			"line_total": l.LineTotal, "tax": l.Tax, "notes": l.Notes,
		})
	}
	voided := make([]map[string]any, 0, len(o.Voided))
	for _, v := range o.Voided {
		voided = append(voided, map[string]any{
			"product_name": v.ProductName, "variant_name": v.VariantName, "quantity": v.Quantity,
			"line_total": v.LineTotal, "voided_by": v.VoidedBy, "approved_by": v.ApprovedBy, "at": stamp(&v.At),
		})
	}
	payments := make([]map[string]any, 0, len(o.Payments))
	for _, p := range o.Payments {
		pm := map[string]any{"id": p.ID, "method_id": p.MethodID, "method_kind": p.MethodKind, "amount": p.Amount, "status": p.Status, "at": stamp(&p.At)}
		if len(p.Card) > 0 {
			pm["card"] = p.Card
		}
		payments = append(payments, pm)
	}
	return map[string]any{
		"id": o.ID, "data_version": o.DataVersion, "state": o.State,
		"terminal_id": o.TerminalID, "shift_id": o.ShiftID, "created_by": o.CreatedBy, "channel": "POS",
		"order_type": o.OrderType, "table_id": o.TableID, "guest_count": o.GuestCount, "delivery_zone_id": nil,
		"call_number": o.CallNumber, "business_date": o.BusinessDate,
		"placed_at": stamp(&o.PlacedAt), "completed_at": stamp(o.CompletedAt), "cancelled_at": stamp(o.CancelledAt),
		"cancellation_note": o.CancellationNote, "notes": o.Notes,
		"lines": lines, "totals": o.Totals, "payments": payments, "prints": uploadPrints(o),
		"voided_lines": voided, "cancelled_by": o.CancelledBy, "approved_by": o.ApprovedBy,
	}
}

// uploadPrints is every ticket that printed or failed (§12.4 `prints`, with §13.12's document
// type, copies and error). One still at the printer goes up with the order's next upload, if any.
func uploadPrints(o *Order) []map[string]any {
	kinds := map[string]string{DocKitchen: "KITCHEN", DocReceipt: "RECEIPT", DocBill: "BILL"}
	out := []map[string]any{}
	for _, p := range o.Prints {
		if p.Status == PrintQueued {
			continue
		}
		pm := map[string]any{
			"printer_id": nilIfEmpty(p.PrinterID), "kind": kinds[p.DocumentType], "document_type": p.DocumentType,
			"copies": p.Copies, "status": p.Status, "at": stamp(&p.At),
		}
		if p.Error != "" {
			pm["error"] = p.Error
		}
		out = append(out, pm)
	}
	return out
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// stamp is a protocol timestamp (§2.1), or nil.
func stamp(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}

func deref[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}

// String is for logs.
func (o *Order) String() string { return fmt.Sprintf("order %s (%s)", o.ID, o.State) }
