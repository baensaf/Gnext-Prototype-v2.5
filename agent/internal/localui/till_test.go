package localui

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
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
			return []byte(`{"tills":[{"id":"till-1","code":"T1","name":"صندوق ۱"}],"open_shifts":[{"id":"sh","terminal_id":"till-1"}]}`), nil
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

func TestTillRoutesAnswerNotEnrolledWithoutATill(t *testing.T) {
	h := newTestServer(&fakeHost{})
	if rec := call(h, "GET", "/api/till/state", "", nil); rec.Code != 409 || !strings.Contains(rec.Body.String(), "NOT_ENROLLED") {
		t.Fatalf("state: %d %s", rec.Code, rec.Body)
	}
}
