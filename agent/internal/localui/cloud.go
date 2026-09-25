package localui

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"gnext/agent/internal/cloud"
	"gnext/agent/internal/till"
)

// The till online (§16): the cashier's cloud session, kept here with the till session, and the
// path the till page's cloud calls take through the agent. The page never holds a cloud
// credential, and the browser never calls the internet.

// tillCookie carries the till session for requests that cannot set a header: an EventSource.
const tillCookie = "gnext_till"

const (
	proxyTimeout = 30 * time.Second
	proxyMaxBody = 1 << 20
	liveStream   = "/api/v1/live/stream"
)

// proxiedHeaders are the page's own headers the cloud still gets; everything else it sent is
// dropped, the agent's credentials go on instead.
var proxiedHeaders = []string{
	"Content-Type", "Accept", "Accept-Language", "X-Correlation-Id", "X-Skip-Toast",
	"If-None-Match", "If-Modified-Since", "Last-Event-Id",
}

// hopHeaders never cross a proxy.
var hopHeaders = map[string]bool{
	"Connection": true, "Keep-Alive": true, "Proxy-Authenticate": true, "Proxy-Authorization": true,
	"Te": true, "Trailer": true, "Transfer-Encoding": true, "Upgrade": true, "Set-Cookie": true,
}

// cloudSession is the cloud session that belongs to one till session.
type cloudSession struct {
	tillToken string
	session   cloud.TillSession
}

// cloudSessionView is what the page is told about it: who, never the token.
func cloudSessionView(cs *cloud.TillSession) any {
	if cs == nil {
		return nil
	}
	return map[string]json.RawMessage{"user": cs.User, "tenant": cs.Tenant}
}

// tillToken is the request's till session: the header, or the cookie.
func tillToken(r *http.Request) string {
	if v := r.Header.Get(tillSessionHeader); v != "" {
		return v
	}
	if c, err := r.Cookie(tillCookie); err == nil {
		return c.Value
	}
	return ""
}

func setTillCookie(w http.ResponseWriter, token string) {
	c := &http.Cookie{Name: tillCookie, Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode}
	if token == "" {
		c.MaxAge = -1
	}
	http.SetCookie(w, c)
}

// cloudFor is the cloud session of a till session that is still signed in. One whose till
// session ended (signed out, timed out, replaced) is ended in the cloud too.
func (s *Server) cloudFor(t *till.Till, token string) *cloud.TillSession {
	s.mu.Lock()
	cs := s.tillCloud
	s.mu.Unlock()
	if cs == nil {
		return nil
	}
	if _, ok := t.User(cs.tillToken); !ok {
		s.dropCloud(cs.tillToken)
		return nil
	}
	if cs.tillToken != token {
		return nil
	}
	return &cs.session
}

// keepCloud keeps a new cloud session for a till session, ending whichever one it replaces.
func (s *Server) keepCloud(token string, session *cloud.TillSession) {
	s.mu.Lock()
	old := s.tillCloud
	s.tillCloud = nil
	if session != nil {
		s.tillCloud = &cloudSession{tillToken: token, session: *session}
	}
	s.mu.Unlock()
	if old != nil && (session == nil || old.session.Token != session.Token) {
		s.endCloud(old.session.Token)
	}
}

// dropCloud forgets the cloud session of a till session, and ends it in the cloud.
func (s *Server) dropCloud(token string) {
	s.mu.Lock()
	old := s.tillCloud
	if old != nil && old.tillToken == token {
		s.tillCloud = nil
	} else {
		old = nil
	}
	s.mu.Unlock()
	if old != nil {
		s.endCloud(old.session.Token)
	}
}

func (s *Server) endCloud(session string) {
	c := s.Host.State().Cloud
	if c == nil || session == "" {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_ = c.TillLogout(ctx, session)
	}()
}

// signInToCloud asks the cloud for the cashier's session with the PIN they typed (§16.6). It
// answers the session; refused, when the cloud said no to this PIN or user (the caller refuses
// the sign-in with err); or neither, when the cloud did not answer or cannot sign cashiers in
// (an older cloud), and the cashier works offline.
func (s *Server) signInToCloud(ctx context.Context, t *till.Till, userID, pin string) (session *cloud.TillSession, refused bool, err error) {
	c := s.Host.State().Cloud
	if c == nil {
		return nil, false, nil
	}
	if ok, _ := t.Reachable(); !ok {
		return nil, false, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	got, err := c.TillLogin(ctx, userID, pin)
	var p *cloud.Problem
	switch {
	case err == nil:
		t.CloudAnswered()
		return &got, false, nil
	case errors.As(err, &p):
		t.CloudAnswered()
		switch p.Code {
		case "PIN_WRONG", "PIN_LOCKED", "TILL_SIGN_IN_LOCKED", "FORBIDDEN_ROLE":
			return nil, true, err
		}
		s.Log.Warn("the cloud did not sign the till's cashier in; working offline", "status", p.Status, "code", p.Code)
		return nil, false, nil
	default:
		t.CloudFailed()
		s.Log.Warn("the cloud did not answer the till's sign-in", "err", err)
		return nil, false, nil
	}
}

// tillCloudLogin gets the signed-in cashier a cloud session again, when the link came back or
// the session ended (§16.6).
func (s *Server) tillCloudLogin(w http.ResponseWriter, r *http.Request) {
	t := s.theTill(w)
	if t == nil {
		return
	}
	token := tillToken(r)
	u, ok := s.tillUser(w, r, t)
	if !ok {
		return
	}
	var in struct {
		PIN string `json:"pin"`
	}
	if !readJSON(w, r, &in) {
		return
	}
	if _, err := t.CheckPIN(u.ID, in.PIN); err != nil {
		tillError(w, err)
		return
	}
	if ok, _ := t.Reachable(); !ok || s.Host.State().Cloud == nil {
		fail(w, http.StatusBadGateway, "CLOUD_UNREACHABLE", "ارتباط با سرور برقرار نیست.")
		return
	}
	session, refused, err := s.signInToCloud(r.Context(), t, u.ID, in.PIN)
	switch {
	case refused:
		cloudError(w, err)
	case session == nil:
		fail(w, http.StatusBadGateway, "CLOUD_UNREACHABLE", "ارتباط با سرور برقرار نیست.")
	default:
		s.keepCloud(token, session)
		writeJSON(w, http.StatusOK, map[string]any{"cloud_session": cloudSessionView(session)})
	}
}

// isSubmit is the web POS's place: POST /api/v1/orders/{id}/submit.
func isSubmit(r *http.Request) bool {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	return r.Method == http.MethodPost && len(parts) == 5 && parts[0] == "api" && parts[1] == "v1" && parts[2] == "orders" && parts[4] == "submit"
}

// noteCallNumber tells the till the call number the cloud gave an order it placed.
func noteCallNumber(t *till.Till, body []byte) {
	var order struct {
		CallNumber   json.Number `json:"call_number"`
		BusinessDate string      `json:"business_date"`
	}
	if json.Unmarshal(body, &order) != nil {
		return
	}
	if n, err := order.CallNumber.Int64(); err == nil && order.BusinessDate != "" {
		t.NoteCloudOrder(order.BusinessDate[:min(len(order.BusinessDate), 10)], int(n))
	}
}

// cloudProxy passes the till page's cloud calls on with the cashier's session (§16.4).
func (s *Server) cloudProxy(w http.ResponseWriter, r *http.Request) {
	t := s.theTill(w)
	if t == nil {
		return
	}
	path := r.URL.Path
	if strings.HasPrefix(path, "/api/v1/agent/") ||
		(strings.HasPrefix(path, "/api/v1/auth/") && !(r.Method == http.MethodGet && path == "/api/v1/auth/me")) {
		fail(w, http.StatusForbidden, "NOT_PROXIED", "این درخواست از صندوق به سرور فرستاده نمی‌شود.")
		return
	}
	token := tillToken(r)
	if _, ok := t.User(token); !ok {
		fail(w, http.StatusUnauthorized, till.CodeUnauthenticated, "دوباره با پین وارد شوید.")
		return
	}
	cs := s.cloudFor(t, token)
	if cs == nil {
		fail(w, http.StatusUnauthorized, "CLOUD_SIGN_IN_REQUIRED", "برای فروش آنلاین، پین خود را دوباره وارد کنید.")
		return
	}
	c := s.Host.State().Cloud
	if c == nil {
		fail(w, http.StatusConflict, "NOT_ENROLLED", "این رایانه هنوز به شعبه‌ای وصل نشده است.")
		return
	}

	ctx := r.Context()
	if path != liveStream {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, proxyTimeout)
		defer cancel()
	}
	var body io.Reader
	if r.Body != nil && r.Method != http.MethodGet && r.Method != http.MethodHead {
		body = http.MaxBytesReader(w, r.Body, proxyMaxBody)
	}
	up, err := http.NewRequestWithContext(ctx, r.Method, strings.TrimRight(c.Server, "/")+r.URL.RequestURI(), body)
	if err != nil {
		fail(w, http.StatusBadRequest, "INVALID_PAYLOAD", "درخواست نامعتبر است.")
		return
	}
	for _, h := range proxiedHeaders {
		if v := r.Header.Values(h); len(v) > 0 {
			up.Header[http.CanonicalHeaderKey(h)] = v
		}
	}
	up.Header.Set("Authorization", "Bearer "+cs.Token)
	up.Header.Set("X-CSRF-Token", cs.CSRF)
	up.Header.Set("User-Agent", "gnext-agent/"+s.Version+" till")
	if b := t.Binding(); b != nil {
		up.Header.Set("X-Terminal-Id", b.TerminalID)
	}

	resp, err := c.Forward(up)
	if err != nil {
		var tooBig *http.MaxBytesError
		switch {
		case errors.As(err, &tooBig):
			fail(w, http.StatusRequestEntityTooLarge, "INVALID_PAYLOAD", "درخواست بزرگ‌تر از حد مجاز است.")
		case r.Context().Err() != nil:
			// The page went away; nobody is waiting for an answer.
		default:
			t.CloudFailed()
			s.Log.Warn("the till's request found the cloud unreachable", "path", path, "err", err)
			fail(w, http.StatusBadGateway, "CLOUD_UNREACHABLE", "ارتباط با سرور برقرار نیست.")
		}
		return
	}
	defer resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		t.CloudFailed()
		fail(w, http.StatusBadGateway, "CLOUD_UNREACHABLE", "ارتباط با سرور برقرار نیست.")
		return
	case http.StatusUnauthorized:
		t.CloudAnswered()
		s.dropCloud(token)
		fail(w, http.StatusUnauthorized, "CLOUD_SIGN_IN_REQUIRED", "نشست شما در سرور تمام شد. پین خود را دوباره وارد کنید.")
		return
	}
	t.CloudAnswered()

	for k, v := range resp.Header {
		if !hopHeaders[http.CanonicalHeaderKey(k)] {
			w.Header()[k] = v
		}
	}
	if isSubmit(r) && resp.StatusCode/100 == 2 {
		// An order this till placed in the cloud: its call number is one the till must not give
		// again offline, should the link drop before the next heartbeat says so (§13.9).
		body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		noteCallNumber(t, body)
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(body)
		if err != nil {
			s.Log.Warn("the cloud's answer to a place was cut short", "err", err)
		}
		return
	}
	w.WriteHeader(resp.StatusCode)
	if !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		_, _ = io.Copy(w, resp.Body)
		return
	}
	// Server-Sent Events: each event reaches the page as it arrives.
	flusher, _ := w.(http.Flusher)
	buf := make([]byte, 4<<10)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if err != nil {
			return
		}
	}
}
