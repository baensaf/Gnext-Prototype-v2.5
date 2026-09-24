// Package localui serves the agent's settings page on 127.0.0.1: connection status, enrolment,
// the branch's printers and terminals, and logs. Device changes go to the cloud as the signed-in
// manager; the cloud stays the source of truth and pushes the new list back to the agent.
package localui

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"gnext/agent/internal/agent"
	"gnext/agent/internal/cloud"
	"gnext/agent/internal/till"
)

// DefaultAddr is where the page listens. Only this PC can reach it.
const DefaultAddr = "127.0.0.1:47800"

// sessionIdle signs the manager out after this long without a request.
const sessionIdle = 15 * time.Minute

//go:embed static
var static embed.FS

// State is what the host knows right now.
type State struct {
	Enrolled   bool
	Server     string
	AgentID    string
	BranchName string
	Stopped    string       // why the agent is not running, when it is not
	Agent      *agent.Agent // nil while not running
	Cloud      *cloud.Client
	Till       *till.Till // nil while not enrolled
}

// Host is the agent process the page belongs to.
type Host interface {
	State() State
	// Enrol redeems a code, saves the identity, and restarts the agent on it.
	Enrol(ctx context.Context, server, code string) error
}

type Server struct {
	Host    Host
	Version string
	LogFile string
	Log     *slog.Logger
	Addr    string

	mu       sync.Mutex
	session  string
	user     *cloud.LocalUser
	lastUsed time.Time
}

// ListenAndServe serves until ctx ends.
func (s *Server) ListenAndServe(ctx context.Context) error {
	addr := s.Addr
	if addr == "" {
		addr = DefaultAddr
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	srv := &http.Server{Handler: s.Handler(addr), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	s.Log.Info("local settings page", "url", "http://"+addr)
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// Handler routes the page and its API behind the local-only checks.
func (s *Server) Handler(addr string) http.Handler {
	mux := http.NewServeMux()
	files, _ := fs.Sub(static, "static")
	mux.Handle("GET /", http.FileServerFS(files))

	mux.HandleFunc("GET /api/status", s.status)
	mux.HandleFunc("GET /api/logs", s.logs)
	mux.HandleFunc("POST /api/enrol", s.enrol)
	mux.HandleFunc("GET /api/session", s.whoami)
	mux.HandleFunc("POST /api/login", s.login)
	mux.HandleFunc("POST /api/logout", s.logout)
	mux.HandleFunc("POST /api/scan", s.scan)
	mux.HandleFunc("POST /api/printers/{id}/test", s.testPrint)
	// The offline till (§13.13); see till.go.
	mux.HandleFunc("GET /api/till/state", s.tillState)
	mux.HandleFunc("POST /api/till/login", s.tillLogin)
	mux.HandleFunc("POST /api/till/logout", s.tillLogout)
	mux.HandleFunc("POST /api/till/binding", s.tillBinding)
	mux.Handle("GET /till", http.RedirectHandler("/till/", http.StatusMovedPermanently))
	mux.HandleFunc("GET /till/", s.tillScreen)
	mux.HandleFunc("GET /api/till/menu", s.tillMenu)
	mux.HandleFunc("POST /api/till/price", s.tillPrice)
	// Its orders; see till_orders.go.
	mux.HandleFunc("GET /api/till/orders", s.tillOrders)
	mux.HandleFunc("POST /api/till/orders", s.tillNewOrder)
	mux.HandleFunc("POST /api/till/orders/place", s.tillPlace)
	mux.HandleFunc("GET /api/till/orders/{id}", s.tillOrder)
	mux.HandleFunc("POST /api/till/orders/{id}/info", s.tillOrderInfo)
	mux.HandleFunc("POST /api/till/orders/{id}/lines", s.tillAddLine)
	mux.HandleFunc("POST /api/till/orders/{id}/lines/{line}/quantity", s.tillLineQuantity)
	mux.HandleFunc("POST /api/till/orders/{id}/lines/{line}/void", s.tillVoidLine)
	mux.HandleFunc("POST /api/till/orders/{id}/send", s.tillSend)
	mux.HandleFunc("POST /api/till/orders/{id}/payments", s.tillPay)
	mux.HandleFunc("POST /api/till/orders/{id}/finish", s.tillFinish)
	mux.HandleFunc("POST /api/till/orders/{id}/cancel", s.tillCancel)
	mux.HandleFunc("POST /api/till/handover", s.tillHandover)
	for _, kind := range []string{"printers", "terminals"} {
		mux.HandleFunc("POST /api/"+kind, s.proxy(http.MethodPost, "/"+kind))
		mux.HandleFunc("PATCH /api/"+kind+"/{id}", s.proxy(http.MethodPatch, "/"+kind+"/{id}"))
		mux.HandleFunc("DELETE /api/"+kind+"/{id}", s.proxy(http.MethodDelete, "/"+kind+"/{id}"))
	}
	return localOnly(addr, mux)
}

// localOnly refuses anything a web page elsewhere could make a browser send here: a foreign
// Host (DNS rebinding) or a state change without the page's own header and origin.
func localOnly(addr string, next http.Handler) http.Handler {
	_, port, _ := net.SplitHostPort(addr)
	hosts := map[string]bool{"127.0.0.1:" + port: true, "localhost:" + port: true}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hosts[r.Host] {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			origin := r.Header.Get("Origin")
			if r.Header.Get("X-Gnext-Local") != "1" || (origin != "" && !hosts[strings.TrimPrefix(origin, "http://")]) {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
		}
		h := w.Header()
		h.Set("X-Frame-Options", "DENY")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:")
		h.Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) status(w http.ResponseWriter, _ *http.Request) {
	st := s.Host.State()
	out := map[string]any{
		"version":     s.Version,
		"enrolled":    st.Enrolled,
		"server":      st.Server,
		"agent_id":    st.AgentID,
		"branch_name": st.BranchName,
		"stopped":     st.Stopped,
		"user":        s.currentUser(),
	}
	if st.Agent != nil {
		out["agent"] = st.Agent.Status()
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) logs(w http.ResponseWriter, r *http.Request) {
	lines, _ := strconv.Atoi(r.URL.Query().Get("lines"))
	if lines <= 0 || lines > 2000 {
		lines = 300
	}
	writeJSON(w, http.StatusOK, map[string]any{"lines": tail(s.LogFile, lines)})
}

func (s *Server) enrol(w http.ResponseWriter, r *http.Request) {
	var in struct{ Server, Code string }
	if !readJSON(w, r, &in) {
		return
	}
	in.Server = strings.TrimRight(strings.TrimSpace(in.Server), "/")
	if !strings.HasPrefix(in.Server, "https://") && !strings.HasPrefix(in.Server, "http://") {
		fail(w, http.StatusBadRequest, "INVALID_SERVER", "آدرس سرور باید با https:// شروع شود.")
		return
	}
	if strings.TrimSpace(in.Code) == "" {
		fail(w, http.StatusBadRequest, "INVALID_CODE", "کد ثبت را وارد کنید.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), time.Minute)
	defer cancel()
	if err := s.Host.Enrol(ctx, in.Server, in.Code); err != nil {
		cloudError(w, err)
		return
	}
	s.signOut(context.Background())
	s.Log.Info("enrolled from the local page", "server", in.Server)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) whoami(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"user": s.currentUser()})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	c := s.Host.State().Cloud
	if c == nil {
		fail(w, http.StatusConflict, "NOT_ENROLLED", "این رایانه هنوز به شعبه‌ای وصل نشده است.")
		return
	}
	var in struct{ Username, Password string }
	if !readJSON(w, r, &in) {
		return
	}
	token, user, err := c.LocalLogin(r.Context(), in.Username, in.Password)
	if err != nil {
		cloudError(w, err)
		return
	}
	s.mu.Lock()
	old := s.session
	s.session, s.user, s.lastUsed = token, &user, time.Now()
	s.mu.Unlock()
	if old != "" {
		go func() { _ = c.Local(context.Background(), http.MethodPost, "/logout", old, nil, nil) }()
	}
	s.Log.Info("signed in on the local page", "user", user.Username, "role", user.Role)
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	s.signOut(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) signOut(ctx context.Context) {
	s.mu.Lock()
	token := s.session
	s.session, s.user = "", nil
	s.mu.Unlock()
	if c := s.Host.State().Cloud; token != "" && c != nil {
		_ = c.Local(ctx, http.MethodPost, "/logout", token, nil, nil)
	}
}

func (s *Server) currentUser() *cloud.LocalUser {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.user != nil && time.Since(s.lastUsed) > sessionIdle {
		s.session, s.user = "", nil
	}
	return s.user
}

// proxy forwards a device change to the cloud as the signed-in manager.
func (s *Server) proxy(method, pattern string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c := s.Host.State().Cloud
		if c == nil {
			fail(w, http.StatusConflict, "NOT_ENROLLED", "این رایانه هنوز به شعبه‌ای وصل نشده است.")
			return
		}
		s.mu.Lock()
		if s.user != nil && time.Since(s.lastUsed) > sessionIdle {
			s.session, s.user = "", nil
		}
		token := s.session
		if token != "" {
			s.lastUsed = time.Now()
		}
		s.mu.Unlock()
		if token == "" {
			fail(w, http.StatusUnauthorized, "UNAUTHENTICATED", "برای تغییر دستگاه‌ها وارد شوید.")
			return
		}
		path := strings.Replace(pattern, "{id}", r.PathValue("id"), 1)
		var in any
		if method != http.MethodDelete && !readJSON(w, r, &in) {
			return
		}
		var out any
		if err := c.Local(r.Context(), method, path, token, in, &out); err != nil {
			var p *cloud.Problem
			if errors.As(err, &p) && p.Status == http.StatusUnauthorized {
				s.mu.Lock()
				s.session, s.user = "", nil
				s.mu.Unlock()
			}
			cloudError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func (s *Server) testPrint(w http.ResponseWriter, r *http.Request) {
	a := s.Host.State().Agent
	if a == nil {
		fail(w, http.StatusConflict, "AGENT_NOT_RUNNING", "عامل در حال اجرا نیست.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	if err := a.TestPrint(ctx, r.PathValue("id")); err != nil {
		fail(w, http.StatusBadGateway, "PRINT_FAILED", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) scan(w http.ResponseWriter, r *http.Request) {
	var in struct{ Port int }
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&in)
	if in.Port <= 0 || in.Port > 65535 {
		in.Port = 9100
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	writeJSON(w, http.StatusOK, map[string]any{"found": ScanLAN(ctx, in.Port)})
}

func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(v); err != nil {
		fail(w, http.StatusBadRequest, "INVALID_PAYLOAD", "درخواست نامعتبر است.")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, code, detail string) {
	writeJSON(w, status, map[string]string{"code": code, "detail": detail})
}

// cloudError passes the cloud's problem on to the page, or reports that it could not be reached.
func cloudError(w http.ResponseWriter, err error) {
	var p *cloud.Problem
	if errors.As(err, &p) {
		detail := p.Detail
		if detail == "" {
			detail = p.Error()
		}
		fail(w, p.Status, p.Code, detail)
		return
	}
	fail(w, http.StatusBadGateway, "CLOUD_UNREACHABLE", "ارتباط با سرور برقرار نشد: "+err.Error())
}

// tail returns up to n last lines of a file, reading at most its last 512 KB.
func tail(path string, n int) []string {
	f, err := os.Open(path)
	if err != nil {
		return []string{}
	}
	defer f.Close()
	const window = 512 << 10
	if st, err := f.Stat(); err == nil && st.Size() > window {
		_, _ = f.Seek(st.Size()-window, io.SeekStart)
	}
	b, _ := io.ReadAll(f)
	lines := strings.Split(strings.TrimRight(string(b), "\r\n"), "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return lines
}
