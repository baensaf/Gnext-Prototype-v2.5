package localui

import (
	"embed"
	"errors"
	"io/fs"
	"net/http"
	"strings"

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
	till.CodeNotAvailable:     http.StatusUnprocessableEntity,
	till.CodeTillOnline:       http.StatusConflict,
	till.CodeHandover:         http.StatusConflict,
	till.CodeOrderUnknown:     http.StatusNotFound,
	till.CodeOrderClosed:      http.StatusConflict,
	till.CodeOrderPaid:        http.StatusConflict,
	till.CodeNotPaid:          http.StatusConflict,
	till.CodeLineSent:         http.StatusConflict,
	till.CodeInvalid:          http.StatusBadRequest,
	till.CodeNoTerminal:       http.StatusConflict,
	till.CodeTerminalBusy:     http.StatusConflict,
	till.CodeNoMethod:         http.StatusConflict,
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
		body := map[string]any{"code": e.Code, "detail": e.Detail}
		if e.Line != nil {
			body["line"] = *e.Line
		}
		writeJSON(w, status, body)
		return
	}
	fail(w, http.StatusInternalServerError, "INTERNAL", err.Error())
}

// tillUser is who the request's till session belongs to; without one it answers 401.
func (s *Server) tillUser(w http.ResponseWriter, r *http.Request, t *till.Till) (till.User, bool) {
	u, ok := t.User(r.Header.Get(tillSessionHeader))
	if !ok {
		fail(w, http.StatusUnauthorized, till.CodeUnauthenticated, "دوباره با پین وارد شوید.")
	}
	return u, ok
}

// The till screen (§13.13) is the web POS's own register, built from starter-vite-ts with
// `npm run build:till` into tillui. A Go build without it serves NOT-BUILT.html instead.
//
//go:embed tillui
var tillUI embed.FS

// tillCSP is the settings page's policy, plus the inline styles the screen's components set.
// Scripts still come only from the agent.
const tillCSP = "default-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'"

// tillScreen serves the screen's files; any other path under /till/ is the screen itself, which
// routes on its own.
func (s *Server) tillScreen(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Security-Policy", tillCSP)
	files, _ := fs.Sub(tillUI, "tillui")
	name := strings.TrimPrefix(r.URL.Path, "/till/")
	if name != "" && name != "NOT-BUILT.html" {
		if info, err := fs.Stat(files, name); err == nil && !info.IsDir() {
			http.ServeFileFS(w, r, files, name)
			return
		}
	}
	if _, err := fs.Stat(files, "index.html"); err == nil {
		http.ServeFileFS(w, r, files, "index.html")
		return
	}
	http.ServeFileFS(w, r, files, "NOT-BUILT.html")
}

// tillMenu is the branch's menu with what sells right now.
func (s *Server) tillMenu(w http.ResponseWriter, r *http.Request) {
	t := s.theTill(w)
	if t == nil {
		return
	}
	if _, ok := s.tillUser(w, r, t); !ok {
		return
	}
	m, err := t.Menu()
	if err != nil {
		tillError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, m)
}

// tillPrice checks and prices the cart as one order; the till screen shows only what this says.
func (s *Server) tillPrice(w http.ResponseWriter, r *http.Request) {
	t := s.theTill(w)
	if t == nil {
		return
	}
	if _, ok := s.tillUser(w, r, t); !ok {
		return
	}
	var in struct {
		Lines []till.LineInput `json:"lines"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	lines, totals, err := t.Price(in.Lines)
	if err != nil {
		tillError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"lines": lines, "totals": totals})
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
