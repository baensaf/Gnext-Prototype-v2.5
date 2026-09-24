package till

import (
	"encoding/json"
	"errors"
	"math/big"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Payment statuses on the till (§13.7). RUNNING is a card charge the terminal has not answered
// yet; it is on disk before the amount goes to the terminal, and never goes up.
const (
	PayRunning  = "RUNNING"
	PayApproved = "APPROVED"
	PayUnknown  = "UNKNOWN"
)

// Refusals of the payment API (§13.13).
const (
	CodeNoTerminal   = "NO_TERMINAL"
	CodeTerminalBusy = "TERMINAL_BUSY"
	CodeNoMethod     = "NO_PAYMENT_METHOD"
)

// ErrChargeNotStarted is what Charge returns when the amount never reached the terminal: no
// terminal set up for the till, or the agent busy updating. The attempt leaves no payment.
var ErrChargeNotStarted = errors.New("the charge did not reach the terminal")

// Payment is money taken on the order (§12.4).
type Payment struct {
	ID         string          `json:"id"`
	MethodID   string          `json:"method_id"`
	MethodKind string          `json:"method_kind"`
	Amount     Money           `json:"amount"`
	Status     string          `json:"status"`
	Card       json.RawMessage `json:"card,omitempty"`
	At         time.Time       `json:"at"`
}

// CardAttempt is one card charge on the order and how it ended: APPROVED, UNKNOWN (both are
// payments), or DECLINED, CANCELLED, FAILED (none is); RUNNING while at the terminal.
type CardAttempt struct {
	PaymentID string    `json:"payment_id"`
	Amount    Money     `json:"amount"`
	Status    string    `json:"status"`
	Message   string    `json:"message,omitempty"`
	At        time.Time `json:"at"`
}

// CardResult is what the terminal said about a charge (payment.Outcome, as the host maps it).
type CardResult struct {
	Status        string // APPROVED, DECLINED, CANCELLED, FAILED or UNKNOWN
	RRN           string
	STAN          string
	CardPANMasked string
	ResponseCode  string
	Message       string
}

// CardKinds are the payment-method kinds of a card reader, as the web POS matches them.
var CardKinds = []string{"CARD_POS", "CARD", "POS"}

func (o *Order) charging() bool {
	return slices.ContainsFunc(o.Payments, func(p Payment) bool { return p.Status == PayRunning })
}

// outstanding is what the payments (running, approved or unknown) leave of the grand total.
func outstanding(o *Order) *big.Int {
	due, err := rials(o.Totals.GrandTotal)
	if err != nil {
		return new(big.Int)
	}
	for _, p := range o.Payments {
		if n, err := rials(p.Amount); err == nil {
			due.Sub(due, n)
		}
	}
	if due.Sign() < 0 {
		return new(big.Int)
	}
	return due
}

// method is the snapshot's first payment method of one of the kinds (§13.7).
func (c *Catalog) method(kinds ...string) (id, kind string, ok bool) {
	for _, pm := range c.PaymentMethods {
		if slices.Contains(kinds, strings.ToUpper(pm.Kind)) {
			return pm.ID, pm.Kind, true
		}
	}
	return "", "", false
}

// payable loads an order that can take money now: open, with lines, something outstanding, and
// no card charge at the terminal.
func (t *Till) payable(id string) (*Order, *Catalog, error) {
	if err := t.guard(false); err != nil {
		return nil, nil, err
	}
	o, err := t.open(id)
	if err != nil {
		return nil, nil, err
	}
	if len(o.Lines) == 0 {
		return nil, nil, refuse(CodeInvalid, "سفارش خالی است.")
	}
	if o.charging() {
		return nil, nil, refuse(CodeTerminalBusy, "پرداخت کارتی این سفارش هنوز تمام نشده است.")
	}
	if outstanding(o).Sign() == 0 {
		return nil, nil, refuse(CodeInvalid, "این سفارش پرداخت شده است.")
	}
	c, err := t.catalog()
	if err != nil {
		return nil, nil, err
	}
	return o, c, nil
}

// PayCash takes cash (§13.7): the payment is the smaller of what was handed over and what is
// outstanding, and the change is the rest. A takeaway paid in full finishes (§13.6).
func (t *Till) PayCash(id string, by User, tendered string) (*Order, Money, error) {
	t.init()
	t.omu.Lock()
	defer t.omu.Unlock()
	o, c, err := t.payable(id)
	if err != nil {
		return nil, "", err
	}
	given, err := rials(tendered)
	if err != nil || given.Sign() == 0 {
		return nil, "", refuse(CodeInvalid, "مبلغ دریافتی را وارد کنید.")
	}
	methodID, kind, ok := c.method("CASH")
	if !ok {
		return nil, "", refuse(CodeNoMethod, "روش پرداخت نقدی برای این شعبه تعریف نشده است.")
	}
	due := outstanding(o)
	amount := new(big.Int).Set(given)
	if amount.Cmp(due) > 0 {
		amount.Set(due)
	}
	change := new(big.Int).Sub(given, amount)
	o.Payments = append(o.Payments, Payment{
		ID: uuid.NewString(), MethodID: methodID, MethodKind: kind, Amount: amount.String(), Status: PayApproved, At: t.Now().UTC(),
	})
	t.Log.Info("offline cash payment", "order", o.ID, "amount", amount.String(), "change", change.String(), "by", by.ID)
	if err := t.afterPayment(o, by); err != nil {
		return nil, "", err
	}
	return o, change.String(), nil
}

// PayCard starts a card charge on the bound till's terminal (§13.7) and returns at once, with
// the charge RUNNING on the order: it is on disk before the amount goes to the terminal, so a
// restart finds it and reports it UNKNOWN rather than charging again. amount "" is what is
// outstanding. The order shows how it ended in CardAttempts.
func (t *Till) PayCard(id string, by User, amount string) (*Order, string, error) {
	t.init()
	t.omu.Lock()
	defer t.omu.Unlock()
	o, c, err := t.payable(id)
	if err != nil {
		return nil, "", err
	}
	due := outstanding(o)
	charge := new(big.Int).Set(due)
	if strings.TrimSpace(amount) != "" {
		n, err := rials(amount)
		if err != nil || n.Sign() == 0 || n.Cmp(due) > 0 {
			return nil, "", refuse(CodeInvalid, "مبلغ کارت باید بیشتر از صفر و حداکثر برابر مانده باشد.")
		}
		charge = n
	}
	terminal := t.terminal()
	if terminal == "" || t.Charge == nil {
		return nil, "", refuse(CodeNoTerminal, "برای این صندوق کارتخوانی تعریف نشده است؛ نقد بگیرید.")
	}
	methodID, kind, ok := c.method(CardKinds...)
	if !ok {
		return nil, "", refuse(CodeNoMethod, "روش پرداخت کارتی برای این شعبه تعریف نشده است.")
	}
	now := t.Now().UTC()
	p := Payment{ID: uuid.NewString(), MethodID: methodID, MethodKind: kind, Amount: charge.String(), Status: PayRunning, At: now}
	p.Card, _ = json.Marshal(map[string]string{"terminal_id": terminal})
	o.Payments = append(o.Payments, p)
	o.CardAttempts = append(o.CardAttempts, CardAttempt{PaymentID: p.ID, Amount: p.Amount, Status: PayRunning, At: now})
	if err := t.Store.put(o); err != nil {
		return nil, "", err
	}
	t.Log.Info("offline card charge started", "order", o.ID, "payment", p.ID, "terminal", terminal, "amount", p.Amount, "by", by.ID)
	go t.charge(o.ID, p.ID, terminal, p.Amount, by)
	return o, p.ID, nil
}

// terminal is the bound till's card terminal in the snapshot, or "".
func (t *Till) terminal() string {
	st := t.State()
	if st.Till == nil || st.Till.PaymentDeviceID == nil {
		return ""
	}
	return *st.Till.PaymentDeviceID
}

// charge runs one card charge to its end and records it. It never charges again on its own.
func (t *Till) charge(orderID, paymentID, terminal, amount string, by User) {
	res, err := t.Charge(terminal, paymentID, amount)
	switch {
	case errors.Is(err, ErrChargeNotStarted):
		res = CardResult{Status: "FAILED", Message: err.Error()}
	case err != nil:
		res = CardResult{Status: PayUnknown, Message: err.Error()}
	}

	t.omu.Lock()
	defer t.omu.Unlock()
	o, err := t.Order(orderID)
	if err != nil {
		t.Log.Error("offline card charge ended on an order the till no longer has", "order", orderID, "payment", paymentID, "status", res.Status)
		return
	}
	i := slices.IndexFunc(o.Payments, func(p Payment) bool { return p.ID == paymentID })
	if i < 0 {
		return
	}
	switch res.Status {
	case PayApproved:
		o.Payments[i].Status = PayApproved
		o.Payments[i].Card, _ = json.Marshal(map[string]string{
			"terminal_id": terminal, "rrn": res.RRN, "stan": res.STAN,
			"card_pan_masked": res.CardPANMasked, "response_code": res.ResponseCode,
		})
	case PayUnknown:
		// It counts as paid, so nobody charges the card again; the cloud resolves it (§12.6).
		o.Payments[i].Status = PayUnknown
	default:
		o.Payments = slices.Delete(o.Payments, i, i+1)
	}
	for j := range o.CardAttempts {
		if o.CardAttempts[j].PaymentID == paymentID {
			o.CardAttempts[j].Status, o.CardAttempts[j].Message = res.Status, cardMessage(res)
		}
	}
	t.Log.Info("offline card charge ended", "order", o.ID, "payment", paymentID, "status", res.Status, "rrn", res.RRN, "message", res.Message)
	if res.Status == PayApproved || res.Status == PayUnknown {
		if err := t.afterPayment(o, by); err != nil {
			t.Log.Error("offline order after a card payment", "order", o.ID, "err", err)
		}
		return
	}
	if err := t.Store.put(o); err != nil {
		t.Log.Error("offline card charge not recorded", "order", o.ID, "payment", paymentID, "err", err)
	}
}

// cardMessage is what the cashier is told about a charge that left no payment, or an unknown one.
func cardMessage(res CardResult) string {
	switch res.Status {
	case PayApproved:
		return ""
	case PayUnknown:
		return "کارتخوان پاسخ روشنی نداد. این مبلغ پرداخت‌شده حساب می‌شود و دوباره کشیده نمی‌شود؛ رسید کارتخوان را اگر هست نگه دارید."
	case "DECLINED":
		return "بانک پرداخت را رد کرد."
	case "CANCELLED":
		return "پرداخت روی کارتخوان لغو شد."
	}
	return "پرداخت به کارتخوان نرسید؛ دوباره امتحان کنید یا نقد بگیرید."
}

// afterPayment keeps the order and, when a takeaway is paid in full, finishes it (§13.6); the
// caller holds omu.
func (t *Till) afterPayment(o *Order, by User) error {
	if o.OrderType == TypeTakeaway && paid(o) && !o.charging() {
		return t.finish(o, by)
	}
	return t.Store.put(o)
}

// recoverCharges ends card charges a previous run left at the terminal (§4.6): each is UNKNOWN,
// counts as paid, and is never charged again.
func (t *Till) recoverCharges() {
	if t.Store == nil {
		return
	}
	all, err := t.Store.all()
	if err != nil {
		return
	}
	for _, o := range all {
		if !o.charging() {
			continue
		}
		for i := range o.Payments {
			if o.Payments[i].Status == PayRunning {
				o.Payments[i].Status = PayUnknown
				t.Log.Warn("offline card charge interrupted by a restart; reported UNKNOWN, never charged again", "order", o.ID, "payment", o.Payments[i].ID)
			}
		}
		for j := range o.CardAttempts {
			if o.CardAttempts[j].Status == PayRunning {
				o.CardAttempts[j].Status = PayUnknown
				o.CardAttempts[j].Message = cardMessage(CardResult{Status: PayUnknown})
			}
		}
		if err := t.Store.put(o); err != nil {
			t.Log.Error("offline card charge left RUNNING", "order", o.ID, "err", err)
		}
	}
}
