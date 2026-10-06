// Package localui is the agent's local web server (agent-protocol §19). It listens twice:
//
//   - 127.0.0.1:47800, the branch PC's own address: the app, and the agent's settings page under
//     /agent/ (connection status, enrolment, the branch's printers and terminals, logs);
//   - 0.0.0.0:47801, the branch network: the app only, for every other register.
//
// The app is the cloud's own frontend build, cached on disk (package appcache); /api/* and
// /uploads/* are passed to the cloud (proxy.go). Device changes made on the settings page go to the
// cloud as the signed-in manager; the cloud stays the source of truth and pushes the new list back.
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
	"gnext/agent/internal/appcache"
	"gnext/agent/internal/cloud"
	"gnext/agent/internal/protocol"
)

// DefaultAddr is where the settings page and the app listen for this PC. Only this PC can reach it.
const DefaultAddr = "127.0.0.1:47800"

// DefaultLANAddr is where the app listens for the other registers of the branch (§19.4).
const DefaultLANAddr = "0.0.0.0:47801"

// LANOff, as Server.LANAddr, turns the LAN listener off.
const LANOff = "off"

// sessionIdle signs the manager out after this long without a request.
const sessionIdle = 15 * time.Minute

//go:embed static
var static embed.FS

// State is what the host knows right now.
type State struct {
	Enrolled bool
	// Server is the cloud: the API target, always (§19.7).
	Server string
	// AppOrigin is where the frontend build comes from: app_url when configured, else Server.
	AppOrigin  string
	AgentID    string
	BranchName string
	Stopped    string       // why the agent is not running, when it is not
	Agent      *agent.Agent // nil while not running
	Cloud      *cloud.Client
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
	// Addr is the loopback listener; LANAddr the branch network's ("" for the default, LANOff for none).
	Addr    string
	LANAddr string
	// App is the cached frontend build; nil serves the "not downloaded yet" page.
	App *appcache.Cache
	// Upstream and ProxyTimeout are for tests; the defaults are a pooled transport and 30 s.
	Upstream     *Upstream
	ProxyTimeout time.Duration

	initOnce  sync.Once
	px        *Proxy
	startedAt time.Time

	mu       sync.Mutex
	session  string
	user     *cloud.LocalUser
	lastUsed time.Time
}

func (s *Server) init() {
	s.initOnce.Do(func() {
		s.startedAt = time.Now()
		if s.Log == nil {
			s.Log = slog.New(slog.NewTextHandler(io.Discard, nil))
		}
		up := s.Upstream
		if up == nil {
			up = &Upstream{}
		}
		s.px = &Proxy{
			Up:      up,
			Server:  func() string { return s.Host.State().Server },
			Version: s.Version,
			Log:     s.Log,
			Timeout: s.ProxyTimeout,
		}
	})
}

// ListenAndServe serves both listeners until ctx ends. The loopback one failing to start is an
// error; the LAN one failing (the port is taken) is logged, and the branch PC's own register goes
// on working.
func (s *Server) ListenAndServe(ctx context.Context) error {
	s.init()
	addr := s.Addr
	if addr == "" {
		addr = DefaultAddr
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	if lan := s.LANAddr; lan != LANOff {
		if lan == "" {
			lan = DefaultLANAddr
		}
		go func() {
			lln, err := net.Listen("tcp", lan)
			if err != nil {
				s.Log.Error("the app could not listen for other registers on the network", "addr", lan, "err", err)
				return
			}
			s.Log.Info("app for other registers on the network", "addr", lan)
			if err := serve(ctx, lln, s.LANHandler()); err != nil {
				s.Log.Error("the network listener stopped", "addr", lan, "err", err)
			}
		}()
	}
	s.Log.Info("local app and settings page", "url", "http://"+addr, "settings", "http://"+addr+"/agent/")
	return serve(ctx, ln, s.Handler(addr))
}

func serve(ctx context.Context, ln net.Listener, h http.Handler) error {
	srv := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdown); err != nil {
			_ = srv.Close() // an open live stream would hold the shutdown for good
		}
	}()
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// Handler is the loopback listener's: the app and the settings page, behind the local-only checks.
// addr is the address it listens on.
func (s *Server) Handler(addr string) http.Handler {
	s.init()
	mux := http.NewServeMux()
	files, _ := fs.Sub(static, "static")
	mux.Handle("GET /agent/", http.StripPrefix("/agent", http.FileServerFS(files)))

	mux.HandleFunc("GET /agent/api/app/refresh", s.refreshApp)
	mux.HandleFunc("GET /agent/api/logs", s.logs)
	mux.HandleFunc("POST /agent/api/enrol", s.enrol)
	mux.HandleFunc("GET /agent/api/session", s.whoami)
	mux.HandleFunc("POST /agent/api/login", s.login)
	mux.HandleFunc("POST /agent/api/logout", s.logout)
	mux.HandleFunc("POST /agent/api/scan", s.scan)
	mux.HandleFunc("POST /agent/api/printers/{id}/test", s.testPrint)
	for _, kind := range []string{"printers", "terminals"} {
		mux.HandleFunc("POST /agent/api/"+kind, s.deviceChange(http.MethodPost, "/"+kind))
		mux.HandleFunc("PATCH /agent/api/"+kind+"/{id}", s.deviceChange(http.MethodPatch, "/"+kind+"/{id}"))
		mux.HandleFunc("DELETE /agent/api/"+kind+"/{id}", s.deviceChange(http.MethodDelete, "/"+kind+"/{id}"))
	}
	return localOnly(addr, s.router(false, mux))
}

// LANHandler is the branch network's listener: the app, the proxy, and the status route. Any Host
// is accepted, and nothing else under /agent/ exists.
func (s *Server) LANHandler() http.Handler {
	s.init()
	return s.router(true, nil)
}

// router sends a request to the settings page, the proxy or the app (§19.5). settings is nil on the
// LAN listener.
func (s *Server) router(lan bool, settings http.Handler) http.Handler {
	app := s.serveApp(lan)
	status := s.appStatus(lan)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		switch {
		case p == "/agent/api/status" && (r.Method == http.MethodGet || r.Method == http.MethodHead):
			status(w, r)
		case p == "/agent" || strings.HasPrefix(p, "/agent/"):
			if settings == nil {
				http.NotFound(w, r)
				return
			}
			settings.ServeHTTP(w, r)
		case strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/uploads/"):
			s.px.ServeHTTP(w, r)
		default:
			app(w, r)
		}
	})
}

// localOnly refuses anything a web page elsewhere could make a browser send to the loopback
// listener: a foreign Host (DNS rebinding), and, for the settings page and its API under /agent/,
// a state change without the page's own header and origin. Those routes also get the page's
// security headers. The app and the proxy are not given them: the app is the cloud's page, and what
// the cloud sends is passed on as it is.
func localOnly(addr string, next http.Handler) http.Handler {
	_, port, _ := net.SplitHostPort(addr)
	hosts := map[string]bool{"127.0.0.1:" + port: true, "localhost:" + port: true}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hosts[r.Host] {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		if r.URL.Path == "/agent" || strings.HasPrefix(r.URL.Path, "/agent/") {
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
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) currentBuild() *appcache.Build {
	if s.App == nil {
		return nil
	}
	return s.App.Current()
}

// appStatus is GET /agent/api/status (§19.8): what the app polls, on both listeners and with no
// sign-in. On the loopback listener it also carries what the settings page and the tray show
// (the agent's own state), which the LAN listener never does.
func (s *Server) appStatus(lan bool) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		st := s.Host.State()
		connected, since := false, s.startedAt
		if st.Agent != nil {
			connected, since = st.Agent.Connection()
		}
		out := map[string]any{
			"version": s.Version,
			"cloud":   map[string]any{"connected": connected, "since": protocol.Now(since)},
			"app":     nil,
		}
		if b := s.currentBuild(); b != nil {
			out["app"] = b.Info
		}
		if !lan {
			out["enrolled"] = st.Enrolled
			out["server"] = st.Server
			out["agent_id"] = st.AgentID
			out["branch_name"] = st.BranchName
			out["stopped"] = st.Stopped
			out["user"] = s.currentUser()
			if st.Agent != nil {
				out["agent"] = st.Agent.Status()
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, out)
	}
}

// refreshApp is GET /agent/api/app/refresh: check the cloud for a newer build now. It needs the
// settings page's manager session.
func (s *Server) refreshApp(w http.ResponseWriter, r *http.Request) {
	if s.sessionToken() == "" {
		fail(w, http.StatusUnauthorized, "UNAUTHENTICATED", "برای دریافت نسخه جدید وارد شوید.")
		return
	}
	if s.App == nil {
		fail(w, http.StatusConflict, "APP_CACHE_OFF", "ذخیره‌ی برنامه در این عامل فعال نیست.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Minute)
	defer cancel()
	res, err := s.App.Check(ctx)
	switch {
	case errors.Is(err, appcache.ErrNoOrigin):
		fail(w, http.StatusConflict, "NOT_CONFIGURED", "آدرس سرور تنظیم نشده است.")
		return
	case err != nil:
		s.Log.Warn("app build check from the settings page failed", "err", err)
		fail(w, http.StatusBadGateway, "APP_DOWNLOAD_FAILED", "دریافت نسخه جدید انجام نشد: "+err.Error())
		return
	}
	out := map[string]any{"ok": true, "changed": res.Changed, "files_fetched": res.Fetched, "bytes": res.Bytes, "app": nil}
	if b := s.currentBuild(); b != nil {
		out["app"] = b.Info
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

// sessionToken is the signed-in manager's session, "" when there is none; it counts as use.
func (s *Server) sessionToken() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.user != nil && time.Since(s.lastUsed) > sessionIdle {
		s.session, s.user = "", nil
	}
	if s.session != "" {
		s.lastUsed = time.Now()
	}
	return s.session
}

// deviceChange forwards a device change to the cloud as the signed-in manager.
func (s *Server) deviceChange(method, pattern string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c := s.Host.State().Cloud
		if c == nil {
			fail(w, http.StatusConflict, "NOT_ENROLLED", "این رایانه هنوز به شعبه‌ای وصل نشده است.")
			return
		}
		token := s.sessionToken()
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
