// Package till is the offline till's side of the agent (§13): which till the agent sells as,
// who is signed in, and whether the till may sell. The till screen and its orders build on it.
package till

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"

	"gnext/agent/internal/branchdata"
)

// Modes (§13.5).
const (
	ModeOnline   = "ONLINE"
	ModeOffline  = "OFFLINE"
	ModeHandover = "HANDOVER"
)

// Error codes the till's local API answers with (§13.13).
const (
	CodeNoSnapshot       = "NO_SNAPSHOT"
	CodeNoTill           = "NO_TILL"
	CodeNoShift          = "NO_SHIFT"
	CodeNoStaff          = "NO_STAFF"
	CodeUnknownTill      = "UNKNOWN_TILL"
	CodeUnknownUser      = "UNKNOWN_USER"
	CodePINWrong         = "PIN_WRONG"
	CodePINLocked        = "PIN_LOCKED"
	CodeApprovalRequired = "APPROVAL_REQUIRED"
	CodeUnauthenticated  = "UNAUTHENTICATED"
)

// Error is a refusal the cashier sees: a code and a Persian sentence.
type Error struct {
	Code   string
	Detail string
	// Line is the order line the refusal is about, when it is about one.
	Line *int
}

func (e *Error) Error() string { return e.Code + ": " + e.Detail }

func refuse(code, detail string) *Error { return &Error{Code: code, Detail: detail} }

const (
	// Lockout (§13.13): five wrong PINs for one user in 15 minutes lock that user for 15 minutes.
	lockAfter   = 5
	lockWindow  = 15 * time.Minute
	lockFor     = 15 * time.Minute
	defaultIdle = 15 * time.Minute
)

// ApproverRoles may approve on the till and bind it offline (§13.4).
var ApproverRoles = []string{"SUPERVISOR", "MANAGER", "ADMIN", "OWNER"}

// Binding is which of the branch's tills the agent sells as (§13.4).
type Binding struct {
	TerminalID string    `json:"terminal_id"`
	BoundBy    string    `json:"bound_by"`
	BoundAt    time.Time `json:"bound_at"`
}

// User is who is signed in: never their PIN hash.
type User struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
}

// Till holds the binding on disk and the sign-in state in memory.
type Till struct {
	// Path is the binding file.
	Path      string
	Staff     func() (branchdata.StaffList, error)
	Snapshot  func() ([]byte, error)
	Connected func() bool
	Log       *slog.Logger
	// Now is the clock, overridable in tests.
	Now func() time.Time

	// Store holds the till's orders (§13.6); nil means none can be taken.
	Store *Store
	// Upload hands an order whose offline life ended to the upload (§12.5): offline.Outbox.Add.
	Upload func(payload json.RawMessage) error
	// CloudCallCount is the POS call count from the last heartbeat.ack (§13.9), and its date.
	CloudCallCount func() (businessDate string, count int)
	// ConnectedSince is when the current session with the cloud began, or nil offline.
	ConnectedSince func() *time.Time

	once     sync.Once
	omu      sync.Mutex // orders: one change at a time
	mu       sync.Mutex
	binding  *Binding
	session  *session
	failures map[string][]time.Time
	locked   map[string]time.Time
}

type session struct {
	token    string
	user     User
	lastUsed time.Time
}

func (t *Till) init() {
	t.once.Do(func() {
		if t.Log == nil {
			t.Log = slog.Default()
		}
		if t.Now == nil {
			t.Now = time.Now
		}
		t.failures = map[string][]time.Time{}
		t.locked = map[string]time.Time{}
		var b Binding
		if raw, err := os.ReadFile(t.Path); err == nil && json.Unmarshal(raw, &b) == nil && b.TerminalID != "" {
			t.binding = &b
		}
	})
}

// snapshot is the part of the branch snapshot the till reads here.
type snapshot struct {
	GeneratedAt string      `json:"generated_at"`
	Branch      *BranchInfo `json:"branch"`
	Settings    struct {
		AutoLogoutMinutes int `json:"auto_logout_minutes"`
	} `json:"settings"`
	Tills      []Register `json:"tills"`
	OpenShifts []Shift    `json:"open_shifts"`
}

// BranchInfo is the branch the snapshot is for.
type BranchInfo struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

// Register is one of the branch's tills in the snapshot (a `terminal` in the cloud).
type Register struct {
	ID              string  `json:"id"`
	Code            string  `json:"code"`
	Name            string  `json:"name"`
	PaymentDeviceID *string `json:"payment_device_id"`
}

// Shift is an open shift in the snapshot.
type Shift struct {
	ID           string `json:"id"`
	TerminalID   string `json:"terminal_id"`
	ShiftNumber  string `json:"shift_number"`
	BusinessDate string `json:"business_date"`
	OpenedAt     string `json:"opened_at"`
}

func (t *Till) readSnapshot() (*snapshot, error) {
	raw, err := t.Snapshot()
	if err != nil {
		return nil, err
	}
	var s snapshot
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

// Mode is whether the till may sell now (§13.5): OFFLINE without a session; HANDOVER with one
// while unfinished offline orders remain; ONLINE otherwise.
func (t *Till) Mode() string {
	if t.Connected == nil || !t.Connected() {
		return ModeOffline
	}
	if t.openOrders() > 0 {
		return ModeHandover
	}
	return ModeOnline
}

// Binding returns the till the agent sells as, or nil.
func (t *Till) Binding() *Binding {
	t.init()
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.binding == nil {
		return nil
	}
	b := *t.binding
	return &b
}

// Bind makes the agent sell as one of the snapshot's tills. by is who chose it: a manager signed
// in on the settings page, or an approver who gave their PIN (BindWithPIN).
func (t *Till) Bind(terminalID, by string) (Binding, error) {
	t.init()
	s, err := t.readSnapshot()
	if err != nil {
		return Binding{}, refuse(CodeNoSnapshot, "هنوز فهرست صندوق‌های شعبه از سرور دریافت نشده است.")
	}
	if !slices.ContainsFunc(s.Tills, func(x Register) bool { return x.ID == terminalID }) {
		return Binding{}, refuse(CodeUnknownTill, "این صندوق در فهرست صندوق‌های شعبه نیست.")
	}
	b := Binding{TerminalID: terminalID, BoundBy: by, BoundAt: t.Now().UTC()}
	if err := writeJSON(t.Path, b); err != nil {
		return Binding{}, err
	}
	t.mu.Lock()
	t.binding = &b
	t.mu.Unlock()
	t.Log.Info("offline till bound", "terminal", terminalID, "by", by)
	return b, nil
}

// BindWithPIN binds the till on an approver's PIN, for when nobody can sign in online (§13.4).
func (t *Till) BindWithPIN(terminalID, userID, pin string) (Binding, error) {
	u, err := t.CheckPIN(userID, pin)
	if err != nil {
		return Binding{}, err
	}
	if !slices.Contains(ApproverRoles, u.Role) {
		return Binding{}, refuse(CodeApprovalRequired, "انتخاب صندوق با پین مدیر یا سرپرست ممکن است.")
	}
	return t.Bind(terminalID, u.ID)
}

// CheckPIN checks a user's PIN against the staff list, counting wrong ones towards the lockout.
func (t *Till) CheckPIN(userID, pin string) (User, error) {
	t.init()
	list, err := t.Staff()
	if err != nil {
		return User{}, refuse(CodeNoStaff, "فهرست کارکنان هنوز از سرور دریافت نشده است.")
	}
	i := slices.IndexFunc(list.Users, func(u branchdata.StaffUser) bool { return u.ID == userID })
	if i < 0 {
		return User{}, refuse(CodeUnknownUser, "این کاربر در فهرست کارکنان این شعبه نیست یا پین ندارد.")
	}
	staff := list.Users[i]

	now := t.Now()
	t.mu.Lock()
	if until, ok := t.locked[userID]; ok && now.Before(until) {
		t.mu.Unlock()
		return User{}, refuse(CodePINLocked, "به دلیل پین‌های نادرست پیاپی، ورود این کاربر ۱۵ دقیقه بسته است.")
	}
	t.mu.Unlock()

	ok, err := verifyPIN(pin, staff.PINHash)
	if err != nil {
		t.Log.Warn("staff PIN hash unreadable", "user", userID)
	}
	user := User{ID: staff.ID, DisplayName: staff.DisplayName, Role: staff.Role}

	t.mu.Lock()
	defer t.mu.Unlock()
	if ok {
		delete(t.failures, userID)
		delete(t.locked, userID)
		return user, nil
	}
	recent := slices.DeleteFunc(t.failures[userID], func(at time.Time) bool { return now.Sub(at) >= lockWindow })
	recent = append(recent, now)
	if len(recent) >= lockAfter {
		t.locked[userID] = now.Add(lockFor)
		delete(t.failures, userID)
		t.Log.Warn("offline till sign-in locked after wrong PINs", "user", userID)
		return User{}, refuse(CodePINLocked, "به دلیل پین‌های نادرست پیاپی، ورود این کاربر ۱۵ دقیقه بسته است.")
	}
	t.failures[userID] = recent
	return User{}, refuse(CodePINWrong, "پین نادرست است.")
}

// Login signs a user in by PIN. One session at a time: signing in ends the previous one.
func (t *Till) Login(userID, pin string) (string, User, error) {
	u, err := t.CheckPIN(userID, pin)
	if err != nil {
		return "", User{}, err
	}
	token := newToken()
	t.mu.Lock()
	t.session = &session{token: token, user: u, lastUsed: t.Now()}
	t.mu.Unlock()
	t.Log.Info("signed in at the offline till", "user", u.ID, "role", u.Role)
	return token, u, nil
}

// User returns who holds the session token, and keeps the session alive. A session ends after
// the tenant's auto-logout time without a request (15 minutes when it has none).
func (t *Till) User(token string) (User, bool) {
	t.init()
	idle := t.idle()
	t.mu.Lock()
	defer t.mu.Unlock()
	s := t.session
	if s == nil || token == "" || s.token != token {
		return User{}, false
	}
	now := t.Now()
	if now.Sub(s.lastUsed) > idle {
		t.session = nil
		return User{}, false
	}
	s.lastUsed = now
	return s.user, true
}

// Logout ends the session the token holds.
func (t *Till) Logout(token string) {
	t.init()
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.session != nil && t.session.token == token {
		t.session = nil
	}
}

func (t *Till) idle() time.Duration {
	if s, err := t.readSnapshot(); err == nil && s.Settings.AutoLogoutMinutes > 0 {
		return time.Duration(s.Settings.AutoLogoutMinutes) * time.Minute
	}
	return defaultIdle
}

// State is what the till page and the settings page show (§13.13 `state`).
type State struct {
	Mode       string      `json:"mode"`
	Branch     *BranchInfo `json:"branch"`
	Binding    *Binding    `json:"binding"`
	Till       *Register   `json:"till"`
	Shift      *Shift      `json:"shift"`
	Tills      []Register  `json:"tills"`
	Staff      []User      `json:"staff"`
	SnapshotAt string      `json:"snapshot_generated_at,omitempty"`
	// Problems lists what stops the till selling: NO_SNAPSHOT, NO_STAFF, NO_TILL, NO_SHIFT.
	Problems []string `json:"problems"`
}

// State reports the mode, the till and its open shift, and who may sign in.
func (t *Till) State() State {
	t.init()
	st := State{Mode: t.Mode(), Binding: t.Binding(), Tills: []Register{}, Staff: []User{}, Problems: []string{}}
	s, err := t.readSnapshot()
	if err != nil {
		st.Problems = append(st.Problems, CodeNoSnapshot)
	} else {
		st.Tills, st.SnapshotAt, st.Branch = s.Tills, s.GeneratedAt, s.Branch
	}
	if list, err := t.Staff(); err != nil || len(list.Users) == 0 {
		st.Problems = append(st.Problems, CodeNoStaff)
	} else {
		for _, u := range list.Users {
			st.Staff = append(st.Staff, User{ID: u.ID, DisplayName: u.DisplayName, Role: u.Role})
		}
	}
	if st.Binding == nil {
		st.Problems = append(st.Problems, CodeNoTill)
		return st
	}
	if s == nil {
		return st
	}
	if i := slices.IndexFunc(s.Tills, func(x Register) bool { return x.ID == st.Binding.TerminalID }); i >= 0 {
		st.Till = &s.Tills[i]
	} else {
		// The till was removed in the cloud after it was chosen.
		st.Problems = append(st.Problems, CodeNoTill)
	}
	if i := slices.IndexFunc(s.OpenShifts, func(x Shift) bool { return x.TerminalID == st.Binding.TerminalID }); i >= 0 {
		st.Shift = &s.OpenShifts[i]
	} else {
		st.Problems = append(st.Problems, CodeNoShift)
	}
	return st
}

// Heartbeat is the heartbeat's `till` block (§13.10).
func (t *Till) Heartbeat() map[string]any {
	var id any
	if b := t.Binding(); b != nil {
		id = b.TerminalID
	}
	return map[string]any{"terminal_id": id, "mode": t.Mode(), "open_orders": t.openOrders()}
}

func newToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand does not fail on supported platforms
	}
	return hex.EncodeToString(b)
}

func writeJSON(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Is reports whether err is a till refusal with the code.
func Is(err error, code string) bool {
	var e *Error
	return errors.As(err, &e) && e.Code == code
}
