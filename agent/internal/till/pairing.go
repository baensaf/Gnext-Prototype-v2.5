package till

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Pairing codes (§18.5).
const (
	CodeNotPaired   = "NOT_PAIRED"
	CodeTillTaken   = "TILL_TAKEN"
	CodePairWrong   = "PAIR_CODE_WRONG"
	CodePairLocked  = "PAIR_LOCKED"
	pairCodeFor     = 10 * time.Minute
	pairLockAfter   = 10
	pairLockWindow  = 15 * time.Minute
	pairLockFor     = 15 * time.Minute
	deviceNameLimit = 60
)

// Pairing is a device on the LAN that sells as one of the branch's tills (§18.5). Its token is
// kept only as a hash.
type Pairing struct {
	DeviceID   string     `json:"device_id"`
	TokenHash  string     `json:"token_hash"`
	TerminalID string     `json:"terminal_id"`
	DeviceName string     `json:"device_name"`
	PairedBy   string     `json:"paired_by"`
	PairedAt   time.Time  `json:"paired_at"`
	LastSeenAt *time.Time `json:"last_seen_at,omitempty"`
}

// PairCode is a code a manager made for one register, shown once on the settings page.
type PairCode struct {
	Code       string    `json:"code"`
	TerminalID string    `json:"terminal_id"`
	ExpiresAt  time.Time `json:"expires_at"`
	by         string
}

type pairing struct {
	devices  []Pairing
	codes    map[string]PairCode // by terminal
	failures []time.Time
	locked   time.Time
}

func (t *Till) loadPairings() {
	t.pairing.codes = map[string]PairCode{}
	if t.PairPath == "" {
		return
	}
	var list []Pairing
	if raw, err := os.ReadFile(t.PairPath); err == nil && json.Unmarshal(raw, &list) == nil {
		t.pairing.devices = list
	}
}

// savePairings writes the list; the caller holds mu.
func (t *Till) savePairings() error {
	if t.PairPath == "" {
		return fmt.Errorf("no pairing file")
	}
	return writeJSON(t.PairPath, t.pairing.devices)
}

// Pairings lists the paired devices, without their token hashes.
func (t *Till) Pairings() []Pairing {
	t.init()
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]Pairing, len(t.pairing.devices))
	for i, p := range t.pairing.devices {
		p.TokenHash = ""
		out[i] = p
	}
	return out
}

// pairedTill reports whether a device sells as the terminal.
func (t *Till) pairedTill(terminalID string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return slices.ContainsFunc(t.pairing.devices, func(p Pairing) bool { return p.TerminalID == terminalID })
}

// NewPairCode makes a six-digit code for a register, good for ten minutes and once (§18.5). A new
// code for the same register replaces the old one.
func (t *Till) NewPairCode(terminalID, by string) (PairCode, error) {
	t.init()
	if t.PairPath == "" {
		return PairCode{}, refuse(CodeInvalid, "این نسخه دستگاه دیگری را به صندوق وصل نمی‌کند.")
	}
	s, err := t.readSnapshot()
	if err != nil {
		return PairCode{}, refuse(CodeNoSnapshot, "هنوز فهرست صندوق‌های شعبه از سرور دریافت نشده است.")
	}
	if !slices.ContainsFunc(s.Tills, func(x Register) bool { return x.ID == terminalID }) {
		return PairCode{}, refuse(CodeUnknownTill, "این صندوق در فهرست صندوق‌های شعبه نیست.")
	}
	if b := t.Binding(); b != nil && b.TerminalID == terminalID {
		return PairCode{}, refuse(CodeTillTaken, "این صندوق، صندوق همین رایانه است.")
	}
	if t.pairedTill(terminalID) {
		return PairCode{}, refuse(CodeTillTaken, "این صندوق روی دستگاه دیگری است؛ اول آن دستگاه را جدا کنید.")
	}
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return PairCode{}, err
	}
	c := PairCode{Code: fmt.Sprintf("%06d", n.Int64()), TerminalID: terminalID, ExpiresAt: t.Now().Add(pairCodeFor).UTC(), by: by}
	t.mu.Lock()
	t.pairing.codes[terminalID] = c
	t.mu.Unlock()
	t.Log.Info("pairing code made", "terminal", terminalID, "by", by)
	return c, nil
}

// Pair turns a code into a paired device (§18.5): the device's token, which only the device keeps.
func (t *Till) Pair(code, deviceName string) (string, Pairing, error) {
	t.init()
	now := t.Now()
	code = strings.TrimSpace(code)
	t.mu.Lock()
	defer t.mu.Unlock()
	if now.Before(t.pairing.locked) {
		return "", Pairing{}, refuse(CodePairLocked, "به دلیل کدهای نادرست پیاپی، اتصال دستگاه ۱۵ دقیقه بسته است.")
	}
	var found *PairCode
	for id, c := range t.pairing.codes {
		if now.After(c.ExpiresAt) {
			delete(t.pairing.codes, id)
			continue
		}
		if c.Code == code {
			found = &c
		}
	}
	if found == nil {
		t.pairing.failures = append(slices.DeleteFunc(t.pairing.failures, func(at time.Time) bool { return now.Sub(at) >= pairLockWindow }), now)
		if len(t.pairing.failures) >= pairLockAfter {
			t.pairing.locked, t.pairing.failures = now.Add(pairLockFor), nil
			t.Log.Warn("device pairing locked after wrong codes")
			return "", Pairing{}, refuse(CodePairLocked, "به دلیل کدهای نادرست پیاپی، اتصال دستگاه ۱۵ دقیقه بسته است.")
		}
		return "", Pairing{}, refuse(CodePairWrong, "کد نادرست است یا وقتش گذشته؛ از مدیر کد تازه بگیرید.")
	}
	delete(t.pairing.codes, found.TerminalID)
	if slices.ContainsFunc(t.pairing.devices, func(p Pairing) bool { return p.TerminalID == found.TerminalID }) ||
		(t.binding != nil && t.binding.TerminalID == found.TerminalID) {
		return "", Pairing{}, refuse(CodeTillTaken, "این صندوق روی دستگاه دیگری است.")
	}
	name := strings.TrimSpace(deviceName)
	if r := []rune(name); len(r) > deviceNameLimit {
		name = string(r[:deviceNameLimit])
	}
	if name == "" {
		name = "دستگاه"
	}
	token := newToken()
	p := Pairing{DeviceID: uuid.NewString(), TokenHash: hashToken(token), TerminalID: found.TerminalID, DeviceName: name, PairedBy: found.by, PairedAt: now.UTC()}
	t.pairing.devices = append(t.pairing.devices, p)
	if err := t.savePairings(); err != nil {
		t.pairing.devices = t.pairing.devices[:len(t.pairing.devices)-1]
		return "", Pairing{}, err
	}
	t.Log.Info("device paired", "device", p.DeviceID, "terminal", p.TerminalID, "name", name)
	p.TokenHash = ""
	return token, p, nil
}

// Device is the paired device a token belongs to; it notes when the device was last seen.
func (t *Till) Device(token string) (Pairing, bool) {
	t.init()
	if token == "" {
		return Pairing{}, false
	}
	h := hashToken(token)
	t.mu.Lock()
	defer t.mu.Unlock()
	for i := range t.pairing.devices {
		if t.pairing.devices[i].TokenHash == h {
			now := t.Now().UTC()
			t.pairing.devices[i].LastSeenAt = &now
			p := t.pairing.devices[i]
			p.TokenHash = ""
			return p, true
		}
	}
	return Pairing{}, false
}

// Unpair removes a device and ends its till session.
func (t *Till) Unpair(deviceID string) error {
	t.init()
	t.mu.Lock()
	i := slices.IndexFunc(t.pairing.devices, func(p Pairing) bool { return p.DeviceID == deviceID })
	if i < 0 {
		t.mu.Unlock()
		return refuse(CodeInvalid, "این دستگاه در فهرست نیست.")
	}
	gone := t.pairing.devices[i]
	t.pairing.devices = slices.Delete(t.pairing.devices, i, i+1)
	err := t.savePairings()
	delete(t.sessions, gone.TerminalID)
	t.mu.Unlock()
	t.Log.Info("device unpaired", "device", deviceID, "terminal", gone.TerminalID)
	return err
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
