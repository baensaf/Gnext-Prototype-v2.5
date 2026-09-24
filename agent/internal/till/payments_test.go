package till

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

// placed places a cart of one burger (2,450,000 + 10% = 2,695,000).
func (s *shop) placed(orderType string) *Order {
	s.t.Helper()
	table := ""
	if orderType == TypeDineIn {
		table = "t12"
	}
	o, err := s.till.Place(s.sara, PlaceInput{OrderType: orderType, TableID: table, Lines: []LineInput{{ProductID: "burger", Quantity: 1}}})
	if err != nil {
		s.t.Fatal(err)
	}
	return o
}

// settled waits for a card charge to end, and for the upload when the order ended with it.
func (s *shop) settled(id, paymentID string) *Order {
	s.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		o, err := s.till.Order(id)
		if err != nil {
			s.t.Fatal(err)
		}
		for _, a := range o.CardAttempts {
			if a.PaymentID == paymentID && a.Status != PayRunning && (o.State == StateOpen || o.HandedOver) {
				return o
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	s.t.Fatal("the card charge did not end")
	return nil
}

func code(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

func TestCashGivesChangeAndATakeawayPaidInFullFinishes(t *testing.T) {
	s := newShop(t)
	o := s.placed(TypeTakeaway)
	if _, _, err := s.till.PayCash(o.ID, s.sara, "0"); code(err) != CodeInvalid {
		t.Fatalf("nothing handed over: %v", err)
	}
	o, change, err := s.till.PayCash(o.ID, s.sara, "3000000")
	if err != nil {
		t.Fatal(err)
	}
	if change != "305000" || len(o.Payments) != 1 || o.Payments[0].Amount != "2695000" || o.Payments[0].MethodID != "m-cash" {
		t.Fatalf("change %s, payments %+v", change, o.Payments)
	}
	if o.State != StateCompleted || !o.HandedOver || len(s.uploaded) != 1 {
		t.Fatalf("paid takeaway not finished: %s, handed %v", o.State, o.HandedOver)
	}
	p := s.uploaded[0]["payments"].([]any)[0].(map[string]any)
	if p["status"] != "APPROVED" || p["method_kind"] != "CASH" || p["amount"] != "2695000" || p["card"] != nil {
		t.Fatalf("uploaded cash payment = %v", p)
	}
}

func TestADineInIsPaidInPartsAndFinishedByTheCashier(t *testing.T) {
	s := newShop(t)
	o := s.placed(TypeDineIn)
	o, change, err := s.till.PayCash(o.ID, s.sara, "1000000")
	if err != nil || change != "0" || o.State != StateOpen {
		t.Fatalf("part paid: %v, change %s, %s", err, change, o.State)
	}
	if _, err := s.till.Finish(o.ID, s.sara); code(err) != CodeNotPaid {
		t.Fatalf("finish part paid: %v", err)
	}
	// Money on the order: no cancel.
	if _, err := s.till.Cancel(o.ID, s.sara, "", "", ""); code(err) != CodeOrderPaid {
		t.Fatalf("cancel with money on it: %v", err)
	}
	o, change, err = s.till.PayCash(o.ID, s.sara, "2000000")
	if err != nil || change != "305000" || o.State != StateOpen || !paid(o) {
		t.Fatalf("rest paid: %v, change %s, %s", err, change, o.State)
	}
	if _, _, err := s.till.PayCash(o.ID, s.sara, "1000"); code(err) != CodeInvalid {
		t.Fatalf("paying a paid order: %v", err)
	}
	if o, err = s.till.Finish(o.ID, s.sara); err != nil || o.State != StateCompleted || len(s.uploaded) != 1 {
		t.Fatalf("finish: %v, %+v", err, o)
	}
}

func TestACardChargeIsRecordedBeforeTheTerminalAndApprovedWithItsCard(t *testing.T) {
	s := newShop(t)
	release := make(chan struct{})
	var seen struct{ terminal, attempt, amount string }
	var onDisk *Order
	var orderID string
	s.charge = func(terminal, attempt, amount string) (CardResult, error) {
		seen.terminal, seen.attempt, seen.amount = terminal, attempt, amount
		onDisk, _ = s.till.Store.get(orderID)
		<-release
		return CardResult{Status: PayApproved, RRN: "123456789012", STAN: "004512", CardPANMasked: "603799******1234", ResponseCode: "00"}, nil
	}
	o := s.placed(TypeTakeaway)
	orderID = o.ID
	o, paymentID, err := s.till.PayCard(o.ID, s.sara, "")
	if err != nil || len(o.Payments) != 1 || o.Payments[0].Status != PayRunning || o.Payments[0].Amount != "2695000" {
		t.Fatalf("card started: %v, %+v", err, o.Payments)
	}

	// While the customer is at the terminal: no second charge, no cancel, no finish, no hand-over.
	if _, _, err := s.till.PayCard(o.ID, s.sara, ""); code(err) != CodeTerminalBusy {
		t.Fatalf("second charge: %v", err)
	}
	if _, _, err := s.till.PayCash(o.ID, s.sara, "100"); code(err) != CodeTerminalBusy {
		t.Fatalf("cash during a charge: %v", err)
	}
	if _, err := s.till.Cancel(o.ID, s.sara, "", "", ""); code(err) != CodeOrderPaid {
		t.Fatalf("cancel during a charge: %v", err)
	}
	if _, handed, _ := s.till.Handover(); handed != 0 {
		t.Fatalf("handed over during a charge: %d", handed)
	}
	close(release)
	o = s.settled(o.ID, paymentID)

	if seen.terminal != "pos-1" || seen.attempt != paymentID || seen.amount != "2695000" {
		t.Fatalf("charged %+v", seen)
	}
	if onDisk == nil || !onDisk.charging() {
		t.Fatal("the charge was not on disk before the terminal had it")
	}
	if o.State != StateCompleted || o.Payments[0].Status != PayApproved {
		t.Fatalf("after approval: %s %+v", o.State, o.Payments)
	}
	p := s.uploaded[0]["payments"].([]any)[0].(map[string]any)
	card, _ := p["card"].(map[string]any)
	if p["status"] != "APPROVED" || p["method_kind"] != "CARD_POS" || card["rrn"] != "123456789012" || card["terminal_id"] != "pos-1" || card["response_code"] != "00" {
		t.Fatalf("uploaded card payment = %v", p)
	}
}

func TestADeclinedOrUnstartedChargeLeavesNoPaymentAndAnUnknownOneCountsAsPaid(t *testing.T) {
	s := newShop(t)
	o := s.placed(TypeDineIn)

	s.charge = func(string, string, string) (CardResult, error) {
		return CardResult{Status: "DECLINED", ResponseCode: "51"}, nil
	}
	_, id1, err := s.till.PayCard(o.ID, s.sara, "1000000")
	if err != nil {
		t.Fatal(err)
	}
	o = s.settled(o.ID, id1)
	if len(o.Payments) != 0 || o.CardAttempts[0].Status != "DECLINED" || o.CardAttempts[0].Message == "" {
		t.Fatalf("declined: %+v %+v", o.Payments, o.CardAttempts)
	}

	s.charge = nil // no terminal answers: the amount never went out
	_, id2, err := s.till.PayCard(o.ID, s.sara, "")
	if err != nil {
		t.Fatal(err)
	}
	if o = s.settled(o.ID, id2); len(o.Payments) != 0 || o.CardAttempts[1].Status != "FAILED" {
		t.Fatalf("not started: %+v %+v", o.Payments, o.CardAttempts)
	}

	calls := 0
	s.charge = func(string, string, string) (CardResult, error) {
		calls++
		return CardResult{Status: PayUnknown, Message: "timeout"}, nil
	}
	_, id3, err := s.till.PayCard(o.ID, s.sara, "")
	if err != nil {
		t.Fatal(err)
	}
	o = s.settled(o.ID, id3)
	if !paid(o) || o.Payments[0].Status != PayUnknown || calls != 1 {
		t.Fatalf("unknown: paid %v, %+v, calls %d", paid(o), o.Payments, calls)
	}
	if _, _, err := s.till.PayCard(o.ID, s.sara, ""); code(err) != CodeInvalid {
		t.Fatalf("charging an order an unknown charge paid: %v", err)
	}
	if o, err = s.till.Finish(o.ID, s.sara); err != nil {
		t.Fatal(err)
	}
	p := s.uploaded[0]["payments"].([]any)[0].(map[string]any)
	card, _ := p["card"].(map[string]any)
	if p["status"] != "UNKNOWN" || card["terminal_id"] != "pos-1" {
		t.Fatalf("uploaded unknown payment = %v", p)
	}
}

func TestAChargeInterruptedByARestartIsUnknownAndNeverChargedAgain(t *testing.T) {
	s := newShop(t)
	o := s.printedOrder(s.placed(TypeTakeaway).ID)
	// The agent stopped with the amount at the terminal: the charge is on disk, RUNNING.
	raw, _ := json.Marshal(map[string]string{"terminal_id": "pos-1"})
	o.Payments = append(o.Payments, Payment{ID: "pay-1", MethodID: "m-card", MethodKind: "CARD_POS", Amount: "2695000", Status: PayRunning, Card: raw, At: s.now})
	o.CardAttempts = append(o.CardAttempts, CardAttempt{PaymentID: "pay-1", Amount: "2695000", Status: PayRunning, At: s.now})
	if err := s.till.Store.put(o); err != nil {
		t.Fatal(err)
	}
	s.till.Store.Close()

	calls := 0
	s.charge = func(string, string, string) (CardResult, error) { calls++; return CardResult{Status: PayApproved}, nil }
	s.till = s.open()
	o, err := s.till.Order(o.ID)
	if err != nil {
		t.Fatal(err)
	}
	if o.Payments[0].Status != PayUnknown || o.CardAttempts[0].Status != PayUnknown || !paid(o) || calls != 0 {
		t.Fatalf("after restart: %+v %+v, calls %d", o.Payments, o.CardAttempts, calls)
	}
	if _, _, err := s.till.PayCard(o.ID, s.sara, ""); code(err) != CodeInvalid || calls != 0 {
		t.Fatalf("charged again after restart: %v, calls %d", err, calls)
	}
}

func TestACardNeedsATerminalAndAnAmountWithinWhatIsDue(t *testing.T) {
	s := newShop(t)
	o := s.placed(TypeTakeaway)
	if _, _, err := s.till.PayCard(o.ID, s.sara, "9999999"); code(err) != CodeInvalid {
		t.Fatalf("more than due: %v", err)
	}
	s.till.Charge = nil
	if _, _, err := s.till.PayCard(o.ID, s.sara, ""); code(err) != CodeNoTerminal {
		t.Fatalf("no terminal: %v", err)
	}
}
