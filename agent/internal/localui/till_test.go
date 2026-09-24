package localui

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"gnext/agent/internal/branchdata"
	"gnext/agent/internal/cloud"
	"gnext/agent/internal/till"

	"golang.org/x/crypto/argon2"
)

func quickHash(pin string) string {
	salt := []byte("saltsalt")
	enc := base64.RawStdEncoding.EncodeToString
	return fmt.Sprintf("$argon2id$v=19$m=1024,t=1,p=1$%s$%s", enc(salt), enc(argon2.IDKey([]byte(pin), salt, 1, 1024, 1, 32)))
}

func testTill(t *testing.T) *till.Till {
	return &till.Till{
		Path: filepath.Join(t.TempDir(), "till.json"),
		Staff: func() (branchdata.StaffList, error) {
			return branchdata.StaffList{StaffVersion: "s1", Users: []branchdata.StaffUser{
				{ID: "sara", DisplayName: "سارا", Role: "CASHIER", PINHash: quickHash("1111")},
				{ID: "amir", DisplayName: "امیر", Role: "MANAGER", PINHash: quickHash("9999")},
			}}, nil
		},
		Snapshot: func() ([]byte, error) {
			return []byte(`{"tills":[{"id":"till-1","code":"T1","name":"صندوق ۱"}],"open_shifts":[{"id":"sh","terminal_id":"till-1"}],
			  "branch":{"time_zone":"Asia/Tehran"},
			  "payment_methods":[{"id":"m-cash","code":"CASH","name":"نقد","kind":"CASH"}],
			  "products":[{"id":"cola","name":"کوکا","price":"350000","tax_rate":"0.1000","variants":[],"option_groups":[]}],
			  "availability":{"stopped":[],"schedules":[],"daily_stock":[{"product_id":"cola","variant_id":null,"remaining":2}]}}`), nil
		},
		Connected: func() bool { return false },
		Log:       slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
}

func TestTillSignInAndStateOverTheLocalAPI(t *testing.T) {
	h := newTestServer(&fakeHost{till: testTill(t)})

	rec := call(h, "GET", "/api/till/state", "", nil)
	if rec.Code != 200 || strings.Contains(rec.Body.String(), "argon2") {
		t.Fatalf("state: %d %s", rec.Code, rec.Body)
	}
	var st struct {
		State till.State `json:"state"`
		User  *till.User `json:"user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &st)
	if st.State.Mode != till.ModeOffline || len(st.State.Staff) != 2 || st.User != nil {
		t.Fatalf("state = %+v", st)
	}

	if rec := call(h, "POST", "/api/till/login", `{"user_id":"sara","pin":"0000"}`, nil); rec.Code != 401 || !strings.Contains(rec.Body.String(), "PIN_WRONG") {
		t.Fatalf("wrong PIN: %d %s", rec.Code, rec.Body)
	}
	rec = call(h, "POST", "/api/till/login", `{"user_id":"sara","pin":"1111"}`, nil)
	var login struct {
		Token string    `json:"token"`
		User  till.User `json:"user"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &login)
	if rec.Code != 200 || login.Token == "" || login.User.ID != "sara" {
		t.Fatalf("login: %d %s", rec.Code, rec.Body)
	}
	session := map[string]string{"X-Gnext-Till-Session": login.Token}
	if rec := call(h, "GET", "/api/till/state", "", session); !strings.Contains(rec.Body.String(), `"user":{"id":"sara"`) {
		t.Fatalf("signed-in state: %s", rec.Body)
	}
	call(h, "POST", "/api/till/logout", "", session)
	if rec := call(h, "GET", "/api/till/state", "", session); !strings.Contains(rec.Body.String(), `"user":null`) {
		t.Fatalf("after logout: %s", rec.Body)
	}
}

func TestTillBindingNeedsAManagerOrAnApproversPIN(t *testing.T) {
	var seen []string
	srv := fakeCloud(t, &seen)
	h := newTestServer(&fakeHost{till: testTill(t), cloud: &cloud.Client{Server: srv.URL, Key: "gak_k"}})

	if rec := call(h, "POST", "/api/till/binding", `{"terminal_id":"till-1"}`, nil); rec.Code != 401 {
		t.Fatalf("nobody: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "POST", "/api/till/binding", `{"terminal_id":"till-1","user_id":"sara","pin":"1111"}`, nil); rec.Code != 403 {
		t.Fatalf("cashier PIN: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "POST", "/api/till/binding", `{"terminal_id":"till-1","user_id":"amir","pin":"9999"}`, nil); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"bound_by":"amir"`) {
		t.Fatalf("manager PIN: %d %s", rec.Code, rec.Body)
	}

	// A manager signed in on the settings page binds without a PIN.
	if rec := call(h, "POST", "/api/login", `{"username":"m","password":"right"}`, nil); rec.Code != 200 {
		t.Fatalf("sign-in: %d", rec.Code)
	}
	if rec := call(h, "POST", "/api/till/binding", `{"terminal_id":"till-9"}`, nil); rec.Code != 404 {
		t.Fatalf("unknown till: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "POST", "/api/till/binding", `{"terminal_id":"till-1"}`, nil); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"bound_by":"u"`) {
		t.Fatalf("signed-in manager: %d %s", rec.Code, rec.Body)
	}
}

func TestTillMenuAndPricesNeedASignedInCashier(t *testing.T) {
	h := newTestServer(&fakeHost{till: testTill(t)})
	if rec := call(h, "GET", "/till", "", nil); rec.Code != http.StatusMovedPermanently || rec.Header().Get("Location") != "/till/" {
		t.Fatalf("/till: %d %q", rec.Code, rec.Header().Get("Location"))
	}
	// The screen, built or its stand-in, at its own address and at any route inside it, with
	// scripts still only from the agent.
	for _, path := range []string{"/till/", "/till/sell"} {
		rec := call(h, "GET", path, "", nil)
		if rec.Code != 200 || !strings.Contains(rec.Body.String(), "صندوق آفلاین") {
			t.Fatalf("%s: %d", path, rec.Code)
		}
		if csp := rec.Header().Get("Content-Security-Policy"); !strings.HasPrefix(csp, "default-src 'self';") || strings.Contains(csp, "script-src") {
			t.Fatalf("%s: CSP %q", path, csp)
		}
	}
	if rec := call(h, "GET", "/api/till/menu", "", nil); rec.Code != 401 {
		t.Fatalf("menu without a session: %d", rec.Code)
	}
	if rec := call(h, "POST", "/api/till/price", `{"lines":[]}`, nil); rec.Code != 401 {
		t.Fatalf("price without a session: %d", rec.Code)
	}

	rec := call(h, "POST", "/api/till/login", `{"user_id":"sara","pin":"1111"}`, nil)
	var login struct{ Token string }
	_ = json.Unmarshal(rec.Body.Bytes(), &login)
	session := map[string]string{"X-Gnext-Till-Session": login.Token}

	if rec := call(h, "GET", "/api/till/menu", "", session); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"available":true`) {
		t.Fatalf("menu: %d %s", rec.Code, rec.Body)
	}
	rec = call(h, "POST", "/api/till/price", `{"lines":[{"product_id":"cola","quantity":2}]}`, session)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"grand_total":"770000"`) {
		t.Fatalf("price: %d %s", rec.Code, rec.Body)
	}
	// Only two colas are left today; the refusal says which line.
	rec = call(h, "POST", "/api/till/price", `{"lines":[{"product_id":"cola","quantity":1},{"product_id":"tea","quantity":1}]}`, session)
	if rec.Code != 422 || !strings.Contains(rec.Body.String(), `"code":"NOT_AVAILABLE"`) || !strings.Contains(rec.Body.String(), `"line":1`) {
		t.Fatalf("unknown product: %d %s", rec.Code, rec.Body)
	}
	rec = call(h, "POST", "/api/till/price", `{"lines":[{"product_id":"cola","quantity":3}]}`, session)
	if rec.Code != 422 || !strings.Contains(rec.Body.String(), "مانده") {
		t.Fatalf("over stock: %d %s", rec.Code, rec.Body)
	}
}

func TestTillOrdersOverTheLocalAPI(t *testing.T) {
	tl := testTill(t)
	store, err := till.OpenStore(filepath.Join(t.TempDir(), "orders.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	var uploaded []string
	tl.Store = store
	tl.Upload = func(p json.RawMessage) error { uploaded = append(uploaded, string(p)); return nil }
	if _, err := tl.Bind("till-1", "amir"); err != nil {
		t.Fatal(err)
	}
	h := newTestServer(&fakeHost{till: tl})

	if rec := call(h, "POST", "/api/till/orders", `{"order_type":"TAKEAWAY"}`, nil); rec.Code != 401 {
		t.Fatalf("new order without a session: %d", rec.Code)
	}
	rec := call(h, "POST", "/api/till/login", `{"user_id":"sara","pin":"1111"}`, nil)
	var login struct{ Token string }
	_ = json.Unmarshal(rec.Body.Bytes(), &login)
	session := map[string]string{"X-Gnext-Till-Session": login.Token}

	var res struct {
		Order   till.Order `json:"order"`
		Dropped bool       `json:"dropped"`
	}
	rec = call(h, "POST", "/api/till/orders", `{"order_type":"TAKEAWAY"}`, session)
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	id := res.Order.ID
	if rec.Code != 200 || id == "" || res.Order.ShiftID != "sh" {
		t.Fatalf("new order: %d %s", rec.Code, rec.Body)
	}
	rec = call(h, "POST", "/api/till/orders/"+id+"/lines", `{"product_id":"cola","quantity":2}`, session)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"grand_total":"770000"`) {
		t.Fatalf("add line: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "POST", "/api/till/orders/"+id+"/lines", `{"product_id":"cola","quantity":1}`, session); rec.Code != 422 {
		t.Fatalf("over today's stock: %d %s", rec.Code, rec.Body)
	}
	rec = call(h, "POST", "/api/till/orders/"+id+"/send", "", session)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"call_number":100`) {
		t.Fatalf("send: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "POST", "/api/till/orders/"+id+"/finish", "", session); rec.Code != 409 || !strings.Contains(rec.Body.String(), "ORDER_NOT_PAID") {
		t.Fatalf("finish unpaid: %d %s", rec.Code, rec.Body)
	}
	rec = call(h, "POST", "/api/till/orders/"+id+"/cancel", `{"note":"test"}`, session)
	if rec.Code != 200 || len(uploaded) != 1 || !strings.Contains(uploaded[0], `"state":"CANCELLED"`) {
		t.Fatalf("cancel: %d %s, uploaded %v", rec.Code, rec.Body, uploaded)
	}
	if rec := call(h, "GET", "/api/till/orders", "", session); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"handed_over":true`) {
		t.Fatalf("orders: %d %s", rec.Code, rec.Body)
	}

	// A whole cart placed at once, as the web POS's screen does; then read back on its own.
	rec = call(h, "POST", "/api/till/orders/place", `{"order_type":"TAKEAWAY","notes":"سس جدا","lines":[{"product_id":"cola","quantity":1}]}`, session)
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	if rec.Code != 200 || res.Order.CallNumber == nil || *res.Order.CallNumber != 101 || res.Order.SentAt == nil {
		t.Fatalf("place: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "GET", "/api/till/orders/"+res.Order.ID, "", session); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"notes":"سس جدا"`) {
		t.Fatalf("one order: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "GET", "/api/till/orders/nope", "", session); rec.Code != 404 {
		t.Fatalf("unknown order: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "POST", "/api/till/orders/place", `{"order_type":"TAKEAWAY","lines":[{"product_id":"cola","quantity":5}]}`, session); rec.Code != 422 {
		t.Fatalf("place over stock: %d %s", rec.Code, rec.Body)
	}

	// Paying it (§13.7): this till has no card terminal; cash gives change and finishes the takeaway.
	pay := "/api/till/orders/" + res.Order.ID + "/payments"
	if rec := call(h, "POST", pay, `{"kind":"CARD"}`, session); rec.Code != 409 || !strings.Contains(rec.Body.String(), "NO_TERMINAL") {
		t.Fatalf("card without a terminal: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "POST", pay, `{"kind":"CHEQUE"}`, session); rec.Code != 400 {
		t.Fatalf("unknown kind: %d %s", rec.Code, rec.Body)
	}
	rec = call(h, "POST", pay, `{"kind":"CASH","tendered":"500000"}`, session)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"change":"115000"`) || !strings.Contains(rec.Body.String(), `"state":"COMPLETED"`) {
		t.Fatalf("cash: %d %s", rec.Code, rec.Body)
	}

	// Printing (§13.8): this agent has no printer hook, so a bill is refused and the menu is empty.
	if rec := call(h, "POST", "/api/till/orders/"+res.Order.ID+"/print", `{"document":"GUEST_BILL"}`, session); rec.Code != 409 || !strings.Contains(rec.Body.String(), "NO_PRINTER") {
		t.Fatalf("print without printers: %d %s", rec.Code, rec.Body)
	}
	if rec := call(h, "GET", "/api/till/printers", "", session); rec.Code != 200 || !strings.Contains(rec.Body.String(), `"printers":[]`) {
		t.Fatalf("printers: %d %s", rec.Code, rec.Body)
	}

	// A cart the kitchen never had is dropped.
	rec = call(h, "POST", "/api/till/orders", `{"order_type":"TAKEAWAY"}`, session)
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	rec = call(h, "POST", "/api/till/orders/"+res.Order.ID+"/cancel", `{}`, session)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"dropped":true`) {
		t.Fatalf("drop: %d %s", rec.Code, rec.Body)
	}
}

func TestTillRoutesAnswerNotEnrolledWithoutATill(t *testing.T) {
	h := newTestServer(&fakeHost{})
	if rec := call(h, "GET", "/api/till/state", "", nil); rec.Code != 409 || !strings.Contains(rec.Body.String(), "NOT_ENROLLED") {
		t.Fatalf("state: %d %s", rec.Code, rec.Body)
	}
}
