package till

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// twoTills is the shop with a second till, its own card terminal, receipt printer and shift.
func twoTills(s *shop) {
	snap := strings.Replace(ordersJSON,
		`"tills": [ { "id": "till-1", "code": "T1", "name": "صندوق ۱", "payment_device_id": "pos-1", "receipt_printer_id": "p-till", "receipt_copies": 2, "receipt_template": null } ],
  "open_shifts": [ { "id": "shift-1", "terminal_id": "till-1", "shift_number": "S-1", "business_date": "2026-09-24" } ]`,
		`"tills": [ { "id": "till-1", "code": "T1", "name": "صندوق ۱", "payment_device_id": "pos-1", "receipt_printer_id": "p-till", "receipt_copies": 2, "receipt_template": null },
             { "id": "till-2", "code": "T2", "name": "صندوق ۲", "payment_device_id": "pos-2", "receipt_printer_id": "p-till2", "receipt_copies": 1, "receipt_template": null },
             { "id": "till-3", "code": "T3", "name": "صندوق ۳", "payment_device_id": null } ],
  "open_shifts": [ { "id": "shift-1", "terminal_id": "till-1", "shift_number": "S-1", "business_date": "2026-09-24" },
                   { "id": "shift-2", "terminal_id": "till-2", "shift_number": "S-2", "business_date": "2026-09-24" } ]`, 1)
	if snap == ordersJSON {
		s.t.Fatal("the snapshot fixture changed; update twoTills")
	}
	s.till.Snapshot = func() ([]byte, error) { return []byte(snap), nil }
	s.till.PairPath = filepath.Join(s.dir, "till-devices.json")
	s.printer.reach = []PrinterInfo{{ID: "p-grill"}, {ID: "p-fry"}, {ID: "p-counter"}, {ID: "p-kitchen"}, {ID: "p-till"}, {ID: "p-till2"}}
}

func (s *shop) pair(terminal string) (string, Pairing) {
	s.t.Helper()
	c, err := s.till.NewPairCode(terminal, "amir")
	if err != nil {
		s.t.Fatal(err)
	}
	token, p, err := s.till.Pair(c.Code, "Tablet 1")
	if err != nil {
		s.t.Fatal(err)
	}
	return token, p
}

func TestADeviceIsPairedOnceByCodeAndKnownByItsToken(t *testing.T) {
	s := newShop(t)
	twoTills(s)

	c, err := s.till.NewPairCode("till-2", "amir")
	if err != nil || len(c.Code) != 6 || !c.ExpiresAt.Equal(s.now.Add(10*time.Minute)) {
		t.Fatalf("code = %+v, %v", c, err)
	}
	token, p, err := s.till.Pair(" "+c.Code+" ", "Tablet 1")
	if err != nil || p.TerminalID != "till-2" || p.DeviceName != "Tablet 1" || p.PairedBy != "amir" || p.TokenHash != "" {
		t.Fatalf("pair = %+v, %v", p, err)
	}
	if got, ok := s.till.Device(token); !ok || got.DeviceID != p.DeviceID {
		t.Fatalf("device = %+v, %v", got, ok)
	}
	if _, ok := s.till.Device("someone-elses"); ok {
		t.Fatal("an unknown token was taken")
	}
	// Once only, and the register is taken now: by the device, as the PC's is by the PC.
	if _, _, err := s.till.Pair(c.Code, "again"); code(err) != CodePairWrong {
		t.Fatalf("second use: %v", err)
	}
	for _, till := range []string{"till-1", "till-2"} {
		if _, err := s.till.NewPairCode(till, "amir"); code(err) != CodeTillTaken {
			t.Fatalf("code for %s: %v", till, err)
		}
	}
	if _, err := s.till.Bind("till-2", "amir"); code(err) != CodeTillTaken {
		t.Fatalf("binding the PC to a device's till: %v", err)
	}

	// Kept across a restart, without the token.
	again := &Till{Path: s.till.Path, PairPath: s.till.PairPath, Snapshot: s.till.Snapshot, Log: s.till.Log, Now: s.clock}
	if got, ok := again.Device(token); !ok || got.TerminalID != "till-2" {
		t.Fatalf("after a restart: %+v, %v", got, ok)
	}
	if list := again.Pairings(); len(list) != 1 || list[0].TokenHash != "" {
		t.Fatalf("listed: %+v", list)
	}
}

func TestACodeExpiresAndWrongCodesLockPairing(t *testing.T) {
	s := newShop(t)
	twoTills(s)
	c, _ := s.till.NewPairCode("till-2", "amir")
	s.advance(11 * time.Minute)
	if _, _, err := s.till.Pair(c.Code, ""); code(err) != CodePairWrong {
		t.Fatalf("expired code: %v", err)
	}
	c, _ = s.till.NewPairCode("till-2", "amir")
	wrong := "000000"
	if c.Code == wrong {
		wrong = "000001"
	}
	var err error
	for range 9 {
		_, _, err = s.till.Pair(wrong, "")
	}
	if _, _, err = s.till.Pair(wrong, ""); code(err) != CodePairLocked {
		t.Fatalf("tenth wrong code: %v", err)
	}
	if _, _, err := s.till.Pair(c.Code, ""); code(err) != CodePairLocked {
		t.Fatalf("the right code while locked: %v", err)
	}
	s.advance(16 * time.Minute)
	c, _ = s.till.NewPairCode("till-2", "amir")
	if _, _, err := s.till.Pair(c.Code, ""); err != nil {
		t.Fatalf("after the lock: %v", err)
	}
}

func TestEachRegisterSellsOnItsOwnTillShiftTerminalAndPrinter(t *testing.T) {
	s := newShop(t)
	twoTills(s)
	_, device := s.pair("till-2")

	// One session a register: the PC's and the device's live side by side.
	pcToken, pcUser, err := s.till.LoginAt("amir", "9999", "")
	if err != nil {
		t.Fatal(err)
	}
	devToken, devUser, err := s.till.LoginAt("sara", "1111", device.TerminalID)
	if err != nil || devUser.Register != "till-2" || pcUser.Register != "" {
		t.Fatalf("sign-ins: %+v %+v %v", pcUser, devUser, err)
	}
	if _, ok := s.till.User(pcToken); !ok {
		t.Fatal("the device's sign-in ended the PC's")
	}
	if st := s.till.StateFor("till-2"); st.Till == nil || st.Till.ID != "till-2" || st.Shift == nil || st.Shift.ID != "shift-2" {
		t.Fatalf("device state: %+v", st)
	}

	charged := make(chan string, 1)
	s.charge = func(terminal, _, _ string) (CardResult, error) {
		charged <- terminal
		return CardResult{Status: PayApproved, RRN: "1", ResponseCode: "00"}, nil
	}
	o, err := s.till.Place(devUser, PlaceInput{OrderType: TypeTakeaway, Lines: []LineInput{{ProductID: "burger", Quantity: 1}}})
	if err != nil || o.TerminalID != "till-2" || o.ShiftID != "shift-2" {
		t.Fatalf("device order: %+v, %v", o, err)
	}
	o, paymentID, err := s.till.PayCard(o.ID, devUser, "")
	if err != nil {
		t.Fatal(err)
	}
	s.settled(o.ID, paymentID)
	if got := <-charged; got != "pos-2" {
		t.Fatalf("charged on %q, want the device's terminal", got)
	}
	deadline := time.Now().Add(5 * time.Second)
	for !s.printer.has("p-till2", DocReceipt) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !s.printer.has("p-till2", DocReceipt) || s.printer.has("p-till", DocReceipt) {
		t.Fatalf("the receipt did not print at the device's printer: %+v", s.printer.jobs)
	}

	// A register without a shift sells nothing; unpairing ends the device's session.
	_, other := s.pair("till-3")
	u3, _ := s.till.CheckPIN("sara", "1111")
	u3.Register = other.TerminalID
	if _, err := s.till.NewOrder(u3, TypeTakeaway, "", 0); code(err) != CodeNoShift {
		t.Fatalf("till without a shift: %v", err)
	}
	if err := s.till.Unpair(device.DeviceID); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.till.User(devToken); ok {
		t.Fatal("the unpaired device is still signed in")
	}
	if hb := s.till.Heartbeat(); len(hb["registers"].([]map[string]any)) != 2 {
		t.Fatalf("heartbeat registers: %v", hb["registers"])
	}
}

func (l *printLog) has(printer, document string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, j := range l.jobs {
		if j.printer == printer && j.document == document {
			return true
		}
	}
	return false
}
