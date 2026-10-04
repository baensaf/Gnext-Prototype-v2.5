package localui

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"gnext/agent/internal/till"
)

// Every register on the agent (§18): paired devices on the branch LAN open Gnext POS from a
// second listener, beside the settings page on 127.0.0.1.

// DefaultLANPort is where paired devices reach the till.
const DefaultLANPort = 47801

// deviceCookie carries a paired device's token (§18.3).
const deviceCookie = "gnext_device"

// register is where a request came from: the PC (the loopback listener) or a LAN device.
type register struct {
	lan    bool
	device *till.Pairing // nil on the PC, or for a device not paired yet
}

type registerKey struct{}

func registerOf(r *http.Request) register {
	if reg, ok := r.Context().Value(registerKey{}).(register); ok {
		return reg
	}
	return register{}
}

// registerID is the request's register as till.User.Register keeps it: "" for the PC.
func registerID(r *http.Request) string {
	if reg := registerOf(r); reg.device != nil {
		return reg.device.TerminalID
	}
	return ""
}

// registerTerminal is the till the request's register sells as, or "".
func (s *Server) registerTerminal(r *http.Request, t *till.Till) string {
	if id := registerID(r); id != "" {
		return id
	}
	if b := t.Binding(); b != nil {
		return b.TerminalID
	}
	return ""
}

// notPaired answers for a LAN device that has not been paired; it reports whether it did.
func notPaired(w http.ResponseWriter, r *http.Request) bool {
	if reg := registerOf(r); reg.lan && reg.device == nil {
		fail(w, http.StatusUnauthorized, till.CodeNotPaired, "این دستگاه هنوز به صندوقی وصل نشده است.")
		return true
	}
	return false
}

// lanAddr is where the LAN listener listens; "" is off.
func (s *Server) lanAddr() string {
	switch s.LANAddr {
	case "":
		return ":" + strconv.Itoa(DefaultLANPort)
	case "off":
		return ""
	}
	return s.LANAddr
}

func (s *Server) lanPort() int {
	_, port, err := net.SplitHostPort(s.lanAddr())
	if n, _ := strconv.Atoi(port); err == nil && n > 0 {
		return n
	}
	return DefaultLANPort
}

// LANURLs are the addresses paired devices open Gnext POS at: this PC's IPv4 addresses on
// private networks (§18.6).
func (s *Server) LANURLs() []string {
	if s.lanAddr() == "" {
		return nil
	}
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var out []string
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			if ip := ipn.IP.To4(); ip != nil && ip.IsPrivate() {
				out = append(out, "http://"+net.JoinHostPort(ip.String(), strconv.Itoa(s.lanPort()))+"/till/")
			}
		}
	}
	return out
}

// lanHandler is what the LAN listener serves: the till and pairing, nothing of the settings page.
func (s *Server) lanHandler() http.Handler {
	mux := http.NewServeMux()
	mux.Handle("GET /till", http.RedirectHandler("/till/", http.StatusMovedPermanently))
	mux.Handle("GET /{$}", http.RedirectHandler("/till/", http.StatusFound))
	mux.HandleFunc("GET /till/", s.tillScreen)
	mux.HandleFunc("GET /api/till/state", s.tillState)
	mux.HandleFunc("POST /api/till/pair", s.tillPair)
	paired := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if !notPaired(w, r) {
				h(w, r)
			}
		}
	}
	for pattern, h := range map[string]http.HandlerFunc{
		"POST /api/till/login":                             s.tillLogin,
		"POST /api/till/logout":                            s.tillLogout,
		"GET /api/till/menu":                               s.tillMenu,
		"POST /api/till/price":                             s.tillPrice,
		"GET /api/till/orders":                             s.tillOrders,
		"POST /api/till/orders":                            s.tillNewOrder,
		"POST /api/till/orders/place":                      s.tillPlace,
		"GET /api/till/orders/{id}":                        s.tillOrder,
		"POST /api/till/orders/{id}/info":                  s.tillOrderInfo,
		"POST /api/till/orders/{id}/lines":                 s.tillAddLine,
		"POST /api/till/orders/{id}/lines/{line}/quantity": s.tillLineQuantity,
		"POST /api/till/orders/{id}/lines/{line}/void":     s.tillVoidLine,
		"POST /api/till/orders/{id}/send":                  s.tillSend,
		"POST /api/till/orders/{id}/payments":              s.tillPay,
		"POST /api/till/orders/{id}/finish":                s.tillFinish,
		"POST /api/till/orders/{id}/print":                 s.tillPrint,
		"GET /api/till/printers":                           s.tillPrinters,
		"POST /api/till/orders/{id}/cancel":                s.tillCancel,
		"POST /api/till/handover":                          s.tillHandover,
		"POST /api/till/cloud-login":                       s.tillCloudLogin,
	} {
		mux.HandleFunc(pattern, paired(h))
	}
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		mux.HandleFunc(method+" /api/v1/", paired(s.cloudProxy))
	}
	return s.lanGuard(mux)
}

// lanGuard is §18.3's rules: a change needs the page's own header and, if the browser names an
// origin, this very host; the device is known by its cookie.
func (s *Server) lanGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			origin := r.Header.Get("Origin")
			if r.Header.Get("X-Gnext-Local") != "1" || (origin != "" && !sameHost(origin, r.Host)) {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
		}
		reg := register{lan: true}
		if t := s.Host.State().Till; t != nil {
			if c, err := r.Cookie(deviceCookie); err == nil {
				if p, ok := t.Device(c.Value); ok {
					reg.device = &p
				}
			}
		}
		h := w.Header()
		h.Set("X-Frame-Options", "DENY")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'self'; img-src 'self' data:")
		h.Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), registerKey{}, reg)))
	})
}

func sameHost(origin, host string) bool {
	u, err := url.Parse(origin)
	return err == nil && u.Scheme == "http" && strings.EqualFold(u.Host, host)
}

// listenLAN serves paired devices until ctx ends. A port in use is logged, not fatal: the PC's
// own till still works.
func (s *Server) listenLAN(ctx context.Context) {
	addr := s.lanAddr()
	if addr == "" {
		return
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		s.Log.Warn("Gnext POS is not served on the LAN", "addr", addr, "err", err)
		return
	}
	srv := &http.Server{Handler: s.lanHandler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	s.Log.Info("Gnext POS on the LAN", "addr", addr, "urls", s.LANURLs())
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		s.Log.Warn("Gnext POS on the LAN stopped", "err", err)
	}
}

// ---- pairing (§18.5) ----

// tillPair turns a manager's code into a paired device on this browser.
func (s *Server) tillPair(w http.ResponseWriter, r *http.Request) {
	t := s.theTill(w)
	if t == nil {
		return
	}
	var in struct {
		Code       string `json:"code"`
		DeviceName string `json:"device_name"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	token, p, err := t.Pair(in.Code, in.DeviceName)
	if err != nil {
		tillError(w, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: deviceCookie, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode,
		MaxAge: 10 * 365 * 24 * 3600,
	})
	writeJSON(w, http.StatusOK, map[string]any{"device_id": p.DeviceID, "register": s.registerView(t, p.TerminalID)})
}

// registerView is a till of the snapshot as the page names it.
func (s *Server) registerView(t *till.Till, terminalID string) map[string]any {
	view := map[string]any{"terminal_id": terminalID}
	for _, r := range t.State().Tills {
		if r.ID == terminalID {
			view["code"], view["name"] = r.Code, r.Name
		}
	}
	return view
}

// pairingCode makes a code for a register, for the manager signed in on the settings page.
func (s *Server) pairingCode(w http.ResponseWriter, r *http.Request) {
	t := s.theTill(w)
	if t == nil {
		return
	}
	manager := s.currentUser()
	if manager == nil {
		fail(w, http.StatusUnauthorized, till.CodeUnauthenticated, "برای وصل کردن دستگاه، مدیر با حساب جی‌نکست وارد شود.")
		return
	}
	var in struct {
		TerminalID string `json:"terminal_id"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	c, err := t.NewPairCode(in.TerminalID, manager.ID)
	if err != nil {
		tillError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"code": c.Code, "terminal_id": c.TerminalID, "expires_at": c.ExpiresAt, "urls": s.LANURLs()})
}

// pairings lists the paired devices and where they open Gnext POS.
func (s *Server) pairings(w http.ResponseWriter, _ *http.Request) {
	t := s.theTill(w)
	if t == nil {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"devices": t.Pairings(), "urls": s.LANURLs()})
}

// unpair removes a device, for the manager signed in on the settings page.
func (s *Server) unpair(w http.ResponseWriter, r *http.Request) {
	t := s.theTill(w)
	if t == nil {
		return
	}
	if s.currentUser() == nil {
		fail(w, http.StatusUnauthorized, till.CodeUnauthenticated, "برای جدا کردن دستگاه، مدیر با حساب جی‌نکست وارد شود.")
		return
	}
	if err := t.Unpair(r.PathValue("id")); err != nil {
		tillError(w, err)
		return
	}
	s.sweepClouds(t)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
