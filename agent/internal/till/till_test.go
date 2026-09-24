package till

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"testing"
	"time"

	"gnext/agent/internal/branchdata"

	"golang.org/x/crypto/argon2"
)

// A hash made by the backend's own argon2 library (node `argon2`), of the PIN 2468.
const nodeHash = "$argon2id$v=19$m=65536,t=3,p=4$np+F+B5TUCGrQWtVnpkV+A$B4poN20SLIBo4f1Fpz5CqKvsdqICVt2phfq/lSoyoCs"

func TestVerifiesAHashTheCloudMade(t *testing.T) {
	if ok, err := verifyPIN("2468", nodeHash); !ok || err != nil {
		t.Fatalf("verify 2468 = %v, %v", ok, err)
	}
	if ok, _ := verifyPIN("2469", nodeHash); ok {
		t.Fatal("a wrong PIN matched")
	}
	for _, bad := range []string{"", "plain", "$argon2id$v=19$m=999999999,t=3,p=4$c2FsdA$aGFzaA", "$bcrypt$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA"} {
		if ok, err := verifyPIN("2468", bad); ok || err == nil {
			t.Fatalf("hash %q: ok=%v err=%v, want an unreadable hash", bad, ok, err)
		}
	}
}

// cheap hashes a PIN quickly, so tests can check many.
func cheap(pin string) string {
	salt := []byte("saltsalt")
	sum := argon2.IDKey([]byte(pin), salt, 1, 1024, 1, 32)
	enc := base64.RawStdEncoding.EncodeToString
	return fmt.Sprintf("$argon2id$v=19$m=1024,t=1,p=1$%s$%s", enc(salt), enc(sum))
}

const snapshotJSON = `{
  "data_version": "v1", "generated_at": "2026-09-24T08:00:00.000Z",
  "settings": { "auto_logout_minutes": 5 },
  "tills": [ { "id": "till-1", "code": "T1", "name": "صندوق ۱", "payment_device_id": null },
             { "id": "till-2", "code": "T2", "name": "صندوق ۲", "payment_device_id": null } ],
  "open_shifts": [ { "id": "shift-1", "terminal_id": "till-1", "shift_number": "S-1", "business_date": "2026-09-24" } ]
}`

type fixture struct {
	till *Till
	now  time.Time
	dir  string
	up   bool
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{now: time.Date(2026, 9, 24, 10, 0, 0, 0, time.UTC), dir: t.TempDir()}
	f.till = f.open()
	return f
}

// open makes a Till on the fixture's folder, as the agent does on every start.
func (f *fixture) open() *Till {
	return &Till{
		Path: filepath.Join(f.dir, "till.json"),
		Staff: func() (branchdata.StaffList, error) {
			return branchdata.StaffList{StaffVersion: "s1", Users: []branchdata.StaffUser{
				{ID: "sara", DisplayName: "سارا", Role: "CASHIER", PINHash: cheap("1111")},
				{ID: "amir", DisplayName: "امیر", Role: "MANAGER", PINHash: cheap("9999")},
			}}, nil
		},
		Snapshot:  func() ([]byte, error) { return []byte(snapshotJSON), nil },
		Connected: func() bool { return f.up },
		Log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
		Now:       func() time.Time { return f.now },
	}
}

func TestSignsInByPINAndEndsTheSessionWhenIdle(t *testing.T) {
	f := newFixture(t)
	token, u, err := f.till.Login("sara", "1111")
	if err != nil || u.DisplayName != "سارا" || u.Role != "CASHIER" {
		t.Fatalf("login = %+v, %v", u, err)
	}
	f.now = f.now.Add(4 * time.Minute)
	if _, ok := f.till.User(token); !ok {
		t.Fatal("session ended before the snapshot's 5 minutes")
	}
	// Each request keeps it alive; 5 idle minutes end it.
	f.now = f.now.Add(5*time.Minute + time.Second)
	if _, ok := f.till.User(token); ok {
		t.Fatal("session outlived the auto-logout time")
	}
}

func TestOneSessionAtATime(t *testing.T) {
	f := newFixture(t)
	first, _, _ := f.till.Login("sara", "1111")
	second, _, _ := f.till.Login("amir", "9999")
	if _, ok := f.till.User(first); ok {
		t.Fatal("the first session survived a second sign-in")
	}
	if u, ok := f.till.User(second); !ok || u.ID != "amir" {
		t.Fatal("the second session is not signed in")
	}
	f.till.Logout(second)
	if _, ok := f.till.User(second); ok {
		t.Fatal("logout left the session")
	}
}

func TestFiveWrongPINsLockTheUserForFifteenMinutes(t *testing.T) {
	f := newFixture(t)
	for i := 0; i < 4; i++ {
		if _, _, err := f.till.Login("sara", "0000"); !Is(err, CodePINWrong) {
			t.Fatalf("attempt %d: %v, want PIN_WRONG", i+1, err)
		}
	}
	if _, _, err := f.till.Login("sara", "0000"); !Is(err, CodePINLocked) {
		t.Fatalf("fifth wrong PIN: %v, want PIN_LOCKED", err)
	}
	// Locked even with the right PIN; another user is not.
	if _, _, err := f.till.Login("sara", "1111"); !Is(err, CodePINLocked) {
		t.Fatalf("right PIN while locked: %v", err)
	}
	if _, _, err := f.till.Login("amir", "9999"); err != nil {
		t.Fatalf("another user: %v", err)
	}
	f.now = f.now.Add(15 * time.Minute)
	if _, _, err := f.till.Login("sara", "1111"); err != nil {
		t.Fatalf("after 15 minutes: %v", err)
	}
}

func TestWrongPINsSpreadOverMoreThanFifteenMinutesDoNotLock(t *testing.T) {
	f := newFixture(t)
	for i := 0; i < 8; i++ {
		if _, _, err := f.till.Login("sara", "0000"); !Is(err, CodePINWrong) {
			t.Fatalf("attempt %d: %v, want PIN_WRONG", i+1, err)
		}
		f.now = f.now.Add(4 * time.Minute)
	}
}

func TestUnknownUserIsRefused(t *testing.T) {
	f := newFixture(t)
	if _, _, err := f.till.Login("nobody", "1111"); !Is(err, CodeUnknownUser) {
		t.Fatalf("got %v", err)
	}
	f.till.Staff = func() (branchdata.StaffList, error) { return branchdata.StaffList{}, errors.New("none") }
	if _, _, err := f.till.Login("sara", "1111"); !Is(err, CodeNoStaff) {
		t.Fatalf("without a staff list: %v", err)
	}
}

func TestBindingIsCheckedKeptAndReportedWithItsShift(t *testing.T) {
	f := newFixture(t)
	st := f.till.State()
	if st.Binding != nil || !contains(st.Problems, CodeNoTill) || len(st.Tills) != 2 || len(st.Staff) != 2 {
		t.Fatalf("unbound state = %+v", st)
	}
	if _, err := f.till.Bind("till-9", "amir"); !Is(err, CodeUnknownTill) {
		t.Fatalf("unknown till: %v", err)
	}
	if _, err := f.till.Bind("till-1", "amir"); err != nil {
		t.Fatal(err)
	}

	// The agent restarted: the choice is still there.
	again := f.open()
	st = again.State()
	if st.Binding == nil || st.Binding.TerminalID != "till-1" || st.Binding.BoundBy != "amir" {
		t.Fatalf("binding after restart = %+v", st.Binding)
	}
	if st.Till == nil || st.Till.Name != "صندوق ۱" || st.Shift == nil || st.Shift.ID != "shift-1" || len(st.Problems) != 0 {
		t.Fatalf("bound state = %+v", st)
	}

	// A till with no open shift cannot sell.
	if _, err := again.Bind("till-2", "amir"); err != nil {
		t.Fatal(err)
	}
	if st := again.State(); st.Shift != nil || !contains(st.Problems, CodeNoShift) {
		t.Fatalf("till without a shift = %+v", st)
	}
	if hb := again.Heartbeat(); hb["terminal_id"] != "till-2" || hb["mode"] != ModeOffline {
		t.Fatalf("heartbeat = %v", hb)
	}
	f.up = true
	if again.Mode() != ModeOnline {
		t.Fatal("mode while connected is not ONLINE")
	}
}

func TestOnlyAnApproversPINBindsTheTill(t *testing.T) {
	f := newFixture(t)
	if _, err := f.till.BindWithPIN("till-1", "sara", "1111"); !Is(err, CodeApprovalRequired) {
		t.Fatalf("cashier: %v", err)
	}
	if _, err := f.till.BindWithPIN("till-1", "amir", "0000"); !Is(err, CodePINWrong) {
		t.Fatalf("wrong manager PIN: %v", err)
	}
	b, err := f.till.BindWithPIN("till-1", "amir", "9999")
	if err != nil || b.TerminalID != "till-1" || b.BoundBy != "amir" {
		t.Fatalf("manager: %+v, %v", b, err)
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
