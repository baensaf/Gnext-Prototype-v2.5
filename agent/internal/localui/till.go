package localui

import (
	"errors"
	"net/http"

	"gnext/agent/internal/till"
)

// tillSessionHeader carries the offline till's session (§13.13).
const tillSessionHeader = "X-Gnext-Till-Session"

// tillStatus maps a till refusal to an HTTP status.
var tillStatus = map[string]int{
	till.CodeNoSnapshot:       http.StatusConflict,
	till.CodeNoStaff:          http.StatusConflict,
	till.CodeNoTill:           http.StatusConflict,
	till.CodeNoShift:          http.StatusConflict,
	till.CodeUnknownTill:      http.StatusNotFound,
	till.CodeUnknownUser:      http.StatusNotFound,
	till.CodePINWrong:         http.StatusUnauthorized,
	till.CodePINLocked:        http.StatusLocked,
	till.CodeApprovalRequired: http.StatusForbidden,
	till.CodeUnauthenticated:  http.StatusUnauthorized,
}

// theTill returns the agent's till, or answers that there is none yet.
func (s *Server) theTill(w http.ResponseWriter) *till.Till {
	t := s.Host.State().Till
	if t == nil {
		fail(w, http.StatusConflict, "NOT_ENROLLED", "این رایانه هنوز به شعبه‌ای وصل نشده است.")
	}
	return t
}

func tillError(w http.ResponseWriter, err error) {
	var e *till.Error
	if errors.As(err, &e) {
		status, ok := tillStatus[e.Code]
		if !ok {
			status = http.StatusBadRequest
		}
		fail(w, status, e.Code, e.Detail)
		return
	}
	fail(w, http.StatusInternalServerError, "INTERNAL", err.Error())
}

// tillState is the mode, the till and its shift, who may sign in, and who has.
func (s *Server) tillState(w http.ResponseWriter, r *http.Request) {
	t := s.theTill(w)
	if t == nil {
		return
	}
	var user *till.User
	if u, ok := t.User(r.Header.Get(tillSessionHeader)); ok {
		user = &u
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": t.State(), "user": user})
}

func (s *Server) tillLogin(w http.ResponseWriter, r *http.Request) {
	t := s.theTill(w)
	if t == nil {
		return
	}
	var in struct {
		UserID string `json:"user_id"`
		PIN    string `json:"pin"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	token, user, err := t.Login(in.UserID, in.PIN)
	if err != nil {
		tillError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user})
}

func (s *Server) tillLogout(w http.ResponseWriter, r *http.Request) {
	if t := s.theTill(w); t != nil {
		t.Logout(r.Header.Get(tillSessionHeader))
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// tillBinding chooses which till the agent sells as (§13.4): by the manager signed in on this
// settings page, or, with nobody signed in, by an approver's PIN.
func (s *Server) tillBinding(w http.ResponseWriter, r *http.Request) {
	t := s.theTill(w)
	if t == nil {
		return
	}
	var in struct {
		TerminalID string `json:"terminal_id"`
		UserID     string `json:"user_id"`
		PIN        string `json:"pin"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	var (
		b   till.Binding
		err error
	)
	switch manager := s.currentUser(); {
	case manager != nil:
		b, err = t.Bind(in.TerminalID, manager.ID)
	case in.PIN != "":
		b, err = t.BindWithPIN(in.TerminalID, in.UserID, in.PIN)
	default:
		fail(w, http.StatusUnauthorized, till.CodeUnauthenticated, "برای انتخاب صندوق، مدیر وارد شود یا پین مدیر را وارد کنید.")
		return
	}
	if err != nil {
		tillError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"binding": b})
}
