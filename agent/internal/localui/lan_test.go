package localui

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"gnext/agent/internal/cloud"
)

const lanHost = "192.168.1.10:47801"

// callLAN is call, from a device on the LAN.
func callLAN(h http.Handler, method, path, body string, header map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Host = lanHost
	req.Header.Set("X-Gnext-Local", "1")
	for k, v := range header {
		if v == "" {
			req.Header.Del(k)
		} else {
			req.Header.Set(k, v)
		}
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

type lanState struct {
	State struct {
		Binding *struct {
			TerminalID string `json:"terminal_id"`
		} `json:"binding"`
		Staff    []any    `json:"staff"`
		Problems []string `json:"problems"`
	} `json:"state"`
	Register struct {
		Kind *string `json:"kind"`
	} `json:"register"`
}

func readLANState(t *testing.T, rec *httptest.ResponseRecorder) lanState {
	t.Helper()
	var st lanState
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil || rec.Code != 200 {
		t.Fatalf("state: %d %s", rec.Code, rec.Body)
	}
	return st
}

func TestADeviceOnTheLANPairsByCodeAndSellsAsItsOwnRegister(t *testing.T) {
	var seen []string
	srv := fakeCloud(t, &seen)
	tl := testTill(t)
	snap, _ := tl.Snapshot()
	two := strings.Replace(string(snap), `"tills":[{"id":"till-1","code":"T1","name":"صندوق ۱"}],"open_shifts":[{"id":"sh","terminal_id":"till-1"}]`,
		`"tills":[{"id":"till-1","code":"T1","name":"صندوق ۱"},{"id":"till-2","code":"T2","name":"صندوق ۲"}],"open_shifts":[{"id":"sh","terminal_id":"till-1"},{"id":"sh2","terminal_id":"till-2"}]`, 1)
	tl.Snapshot = func() ([]byte, error) { return []byte(two), nil }
	tl.PairPath = filepath.Join(t.TempDir(), "till-devices.json")
	s := &Server{Host: &fakeHost{till: tl, cloud: &cloud.Client{Server: srv.URL, Key: "gak_k"}}, Version: "1.0.0", Log: slog.New(slog.NewTextHandler(io.Discard, nil)), LogFile: "missing.log"}
	pc, lan := s.Handler(DefaultAddr), s.lanHandler()

	// Not paired: the pairing screen's state, and nothing else.
	st := readLANState(t, callLAN(lan, "GET", "/api/till/state", "", nil))
	if st.Register.Kind != nil || len(st.State.Staff) != 0 || len(st.State.Problems) != 1 || st.State.Problems[0] != "NOT_PAIRED" {
		t.Fatalf("unpaired state: %+v", st)
	}
	if rec := callLAN(lan, "POST", "/api/till/login", `{"user_id":"sara","pin":"1111"}`, nil); rec.Code != 401 || !strings.Contains(rec.Body.String(), "NOT_PAIRED") {
		t.Fatalf("unpaired login: %d %s", rec.Code, rec.Body)
	}
	for _, path := range []string{"/api/status", "/api/logs", "/api/pairings", "/"} {
		if rec := callLAN(lan, "GET", path, "", nil); rec.Code != 404 && rec.Code != http.StatusFound {
			t.Fatalf("LAN %s: %d", path, rec.Code)
		}
	}
	if rec := callLAN(lan, "POST", "/api/till/binding", `{"terminal_id":"till-2"}`, nil); rec.Code != 404 && rec.Code != 405 {
		t.Fatalf("LAN binding: %d", rec.Code)
	}

	// The code comes from the manager signed in on the PC's settings page.
	if rec := call(pc, "POST", "/api/pairing-codes", `{"terminal_id":"till-2"}`, nil); rec.Code != 401 {
		t.Fatalf("code without a manager: %d", rec.Code)
	}
	if rec := call(pc, "POST", "/api/login", `{"username":"m","password":"right"}`, nil); rec.Code != 200 {
		t.Fatalf("manager sign-in: %d", rec.Code)
	}
	rec := call(pc, "POST", "/api/pairing-codes", `{"terminal_id":"till-2"}`, nil)
	var code struct{ Code string }
	if _ = json.Unmarshal(rec.Body.Bytes(), &code); rec.Code != 200 || len(code.Code) != 6 {
		t.Fatalf("code: %d %s", rec.Code, rec.Body)
	}

	// Pairing is a change: the page's header and its own origin.
	body := `{"code":"` + code.Code + `","device_name":"Tablet 1"}`
	if rec := callLAN(lan, "POST", "/api/till/pair", body, map[string]string{"X-Gnext-Local": ""}); rec.Code != 403 {
		t.Fatalf("no header: %d", rec.Code)
	}
	if rec := callLAN(lan, "POST", "/api/till/pair", body, map[string]string{"Origin": "http://evil.example"}); rec.Code != 403 {
		t.Fatalf("foreign origin: %d", rec.Code)
	}
	rec = callLAN(lan, "POST", "/api/till/pair", body, map[string]string{"Origin": "http://" + lanHost})
	cookie := ""
	for _, c := range rec.Result().Cookies() {
		if c.Name == deviceCookie {
			cookie = c.Value
			if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode {
				t.Fatalf("cookie %+v", c)
			}
		}
	}
	if rec.Code != 200 || cookie == "" || !strings.Contains(rec.Body.String(), `"name":"صندوق ۲"`) {
		t.Fatalf("pair: %d %s", rec.Code, rec.Body)
	}
	device := map[string]string{"Cookie": deviceCookie + "=" + cookie}

	st = readLANState(t, callLAN(lan, "GET", "/api/till/state", "", device))
	if st.Register.Kind == nil || *st.Register.Kind != "DEVICE" || st.State.Binding == nil || st.State.Binding.TerminalID != "till-2" {
		t.Fatalf("paired state: %+v", st)
	}

	// A cashier signs in on the device; that session is the device's alone.
	rec = callLAN(lan, "POST", "/api/till/login", `{"user_id":"sara","pin":"1111"}`, device)
	var login struct{ Token string }
	if _ = json.Unmarshal(rec.Body.Bytes(), &login); rec.Code != 200 || login.Token == "" {
		t.Fatalf("device login: %d %s", rec.Code, rec.Body)
	}
	if rec := call(pc, "GET", "/api/till/menu", "", map[string]string{"X-Gnext-Till-Session": login.Token}); rec.Code != 401 {
		t.Fatalf("the device's session on the PC: %d", rec.Code)
	}
	withSession := map[string]string{"Cookie": device["Cookie"], "X-Gnext-Till-Session": login.Token}
	if rec := callLAN(lan, "GET", "/api/till/menu", "", withSession); rec.Code != 200 {
		t.Fatalf("device menu: %d %s", rec.Code, rec.Body)
	}

	// Removed on the PC: the device is back at the pairing screen.
	rec = call(pc, "GET", "/api/pairings", "", nil)
	var list struct {
		Devices []struct {
			DeviceID string `json:"device_id"`
		} `json:"devices"`
	}
	if _ = json.Unmarshal(rec.Body.Bytes(), &list); len(list.Devices) != 1 || strings.Contains(rec.Body.String(), "token_hash\":\"") && !strings.Contains(rec.Body.String(), `"token_hash":""`) {
		t.Fatalf("pairings: %s", rec.Body)
	}
	if rec := call(pc, "DELETE", "/api/pairings/"+list.Devices[0].DeviceID, "", nil); rec.Code != 200 {
		t.Fatalf("unpair: %d %s", rec.Code, rec.Body)
	}
	if rec := callLAN(lan, "GET", "/api/till/menu", "", withSession); rec.Code != 401 || !strings.Contains(rec.Body.String(), "NOT_PAIRED") {
		t.Fatalf("after unpair: %d %s", rec.Code, rec.Body)
	}
}
