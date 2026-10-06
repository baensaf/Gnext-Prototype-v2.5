package localui

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

// The proxy passes /api/* and /uploads/* to the cloud (agent-protocol §19.6). It holds no session:
// the page's own headers, Authorization and Cookie among them, go through.

const (
	// maxProxyBody is the largest request body passed on (photo uploads).
	maxProxyBody = 16 << 20
	// proxyTimeout is the time the cloud has to answer one attempt.
	proxyTimeout = 30 * time.Second
	// liveStreamPath is the Server-Sent Events route: no time limit, flushed event by event.
	liveStreamPath = "/api/v1/live/stream"
)

// hopByHop headers are meant for one connection, not for the next (RFC 9110 §7.6.1).
var hopByHop = []string{
	"Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization", "Proxy-Connection",
	"Te", "Trailer", "Transfer-Encoding", "Upgrade",
}

// Retry times the retries of a request that may be repeated (§19.10). The window is counted from
// when the request arrived at the agent. A zero field takes its default; tests shorten them.
type Retry struct {
	// Every is the tick of the clock the attempts keep to, from the request's arrival; default 2 s.
	// An attempt that used up its whole tick is followed by the next one at once.
	Every time.Duration
	// Window is how long after the request arrived a new attempt may still start; default 20 s.
	Window time.Duration
	// Grace is added to the time left in the window to give an attempt its own timeout,
	// min(the proxy's timeout, time left + Grace); default 10 s.
	Grace time.Duration
}

func (r Retry) withDefaults() Retry {
	if r.Every <= 0 {
		r.Every = 2 * time.Second
	}
	if r.Window <= 0 {
		r.Window = 20 * time.Second
	}
	if r.Grace <= 0 {
		r.Grace = 10 * time.Second
	}
	return r
}

// attemptTimeout is the time one attempt has to be answered: limit (the proxy's own, 30 s), or less
// when the window is nearly over, time left plus Grace, so that the request is answered about
// Grace after the window at the latest. elapsed is the time since the request arrived.
func (r Retry) attemptTimeout(limit, elapsed time.Duration) time.Duration {
	return min(limit, max(r.Window-elapsed, 0)+r.Grace)
}

// Proxy passes the page's API calls to the cloud.
type Proxy struct {
	Up *Upstream
	// Server returns the cloud's address (https://gnext.top); empty when none is configured.
	Server  func() string
	Version string
	Log     *slog.Logger

	// Timeout is how long the cloud has to answer one attempt; default 30 s. Tests shorten it.
	Timeout time.Duration
	// Retry times the retries of the requests retryable allows.
	Retry Retry
	// Reach, when set, is told what became of each attempt (reach.go).
	Reach *Reach
}

func (p *Proxy) timeout() time.Duration {
	if p.Timeout > 0 {
		return p.Timeout
	}
	return proxyTimeout
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	arrived := time.Now()
	if blockedPath(r.URL.EscapedPath()) {
		writeProblem(w, r, http.StatusForbidden, "AGENT_ROUTE_BLOCKED", "Forbidden",
			"This route belongs to the agent and is not passed to the cloud.")
		return
	}
	server := strings.TrimRight(p.Server(), "/")
	if server == "" {
		writeProblem(w, r, http.StatusServiceUnavailable, "AGENT_NOT_CONFIGURED", "Agent not configured",
			"This agent has no Gnext server address.")
		return
	}
	if r.ContentLength > maxProxyBody {
		writeProblem(w, r, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Request too large",
			"The request is larger than the agent passes on (16 MB).")
		return
	}

	live := r.URL.Path == liveStreamPath
	timeout := p.timeout()
	if live {
		timeout = 0
	}
	body := &trackedBody{r: http.MaxBytesReader(w, r.Body, maxProxyBody)}

	// A request that may be repeated has its body (if it has one) read once, here, so that every
	// attempt can send it again.
	retry := p.retryable(r)
	var held []byte
	if retry && hasBody(r) {
		var err error
		if held, err = io.ReadAll(body); err != nil {
			p.fail(w, r, body, &Failure{Kind: NotSent, Err: err}, false)
			return
		}
	}
	attemptBody := func() io.Reader {
		switch {
		case !retry:
			return body
		case len(held) == 0:
			return http.NoBody
		}
		return bytes.NewReader(held)
	}

	rp := p.Retry.withDefaults()
	sawNoAnswer := false
	for attempt := 1; ; attempt++ {
		started := time.Now()
		out, err := p.upstreamRequest(r, server, attemptBody())
		if err != nil {
			writeProblem(w, r, http.StatusBadRequest, "BAD_REQUEST", "Bad request", err.Error())
			return
		}
		if retry {
			out.ContentLength = int64(len(held))
			// An attempt's own time: the proxy's, or less when the window is nearly over.
			timeout = rp.attemptTimeout(p.timeout(), started.Sub(arrived))
		}

		resp, fail := p.Up.Attempt(r.Context(), out, timeout)
		if fail == nil {
			p.Reach.Proxied(true)
			defer resp.Body.Close()
			p.relay(w, r, resp, live)
			return
		}
		if r.Context().Err() != nil {
			return // the page went away: nobody to answer, nothing more to try
		}
		// The cloud failed to answer, unless the failure was the page's own (its body could not be
		// read): that says nothing of the cloud.
		if body.err == nil || errors.Is(body.err, io.EOF) {
			p.Reach.Proxied(false)
		}
		sawNoAnswer = sawNoAnswer || fail.Kind == NoAnswer
		if !retry {
			p.fail(w, r, body, fail, sawNoAnswer)
			return
		}

		// The attempts keep to a clock that starts at the request's arrival, so that a request is
		// tried at 0, 2, 4 ... 20 s however long each attempt took to fail: the next one is due at
		// the next tick of that clock, or at once if this one used up its whole slot. It is made only
		// if it is due inside the window.
		now := time.Now()
		next := arrived.Add((started.Sub(arrived)/rp.Every + 1) * rp.Every)
		if now.Sub(started) >= rp.Every {
			next = now
		}
		if next.Sub(arrived) > rp.Window {
			p.fail(w, r, body, fail, sawNoAnswer)
			return
		}
		if p.Log != nil {
			p.Log.Debug("cloud did not answer, trying again", "method", r.Method, "path", r.URL.Path,
				"attempt", attempt, "kind", fail.Kind.String(), "err", fail.Error())
		}
		timer := time.NewTimer(time.Until(next))
		select {
		case <-r.Context().Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

// idempotencyKeyHeader is the header that makes a write safe to repeat (§19.11): the cloud answers
// a repeat of a request with the same key and body with the first answer, and does the work once.
const idempotencyKeyHeader = "Idempotency-Key"

// retryable says whether a request may be sent to the cloud again after a failure (§19.10, §19.11):
// a read (GET, HEAD), or a write that carries an Idempotency-Key. Never the live stream, which the
// page reconnects by itself, and never a route that starts or checks a terminal charge, key or not
// (see isTerminalChargePath). This is the one place that decides it.
func (p *Proxy) retryable(r *http.Request) bool {
	if r.URL.Path == liveStreamPath {
		return false
	}
	if isRead(r.Method) {
		return true
	}
	return strings.TrimSpace(r.Header.Get(idempotencyKeyHeader)) != "" && !isTerminalChargePath(r.URL.EscapedPath())
}

func hasBody(r *http.Request) bool {
	return r.ContentLength != 0 && r.Body != nil && r.Body != http.NoBody
}

// upstreamRequest builds the request to the cloud: the page's headers less the hop-by-hop ones and
// Host, plus the forwarding headers. The body is passed as it comes.
func (p *Proxy) upstreamRequest(r *http.Request, server string, body io.Reader) (*http.Request, error) {
	if r.ContentLength == 0 || r.Body == nil || r.Body == http.NoBody {
		body = http.NoBody
	}
	out, err := http.NewRequestWithContext(r.Context(), r.Method, server+r.URL.RequestURI(), body)
	if err != nil {
		return nil, err
	}
	out.ContentLength = r.ContentLength
	if body == http.NoBody {
		out.ContentLength = 0
	}
	for k, vv := range r.Header {
		out.Header[k] = append([]string(nil), vv...)
	}
	stripHop(out.Header)
	out.Header.Del("Expect")
	out.Header.Del("Host")
	// Go's transport repeats, by itself and unseen, a request that carries one of these headers when a
	// kept-alive connection breaks after the request went out. The agent decides what is repeated, and
	// has to know which attempts were written (§19.10): a card charge is never repeated (§19.11), and a
	// repeat the transport made would hide whether an earlier attempt was written. The transport looks
	// for the headers by their canonical name, and HTTP header names are not case-sensitive, so they
	// go to the cloud under a lower-case one.
	for _, name := range []string{idempotencyKeyHeader, "X-Idempotency-Key"} {
		if v, ok := out.Header[name]; ok {
			delete(out.Header, name)
			out.Header[strings.ToLower(name)] = v
		}
	}
	out.Host = "" // the cloud's own host name, from the URL

	if ip, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		if prior := strings.Join(r.Header.Values("X-Forwarded-For"), ", "); prior != "" {
			ip = prior + ", " + ip
		}
		out.Header.Set("X-Forwarded-For", ip)
	}
	out.Header.Set("X-Forwarded-Proto", "http")
	out.Header.Set("User-Agent", strings.TrimSpace(r.Header.Get("User-Agent")+" gnext-agent/"+p.Version))
	return out, nil
}

// fail answers the page when the cloud did not (§19.10). A client that went away gets nothing. f is
// the last attempt's failure; sawNoAnswer is true when any attempt was written and not answered.
func (p *Proxy) fail(w http.ResponseWriter, r *http.Request, body *trackedBody, f *Failure, sawNoAnswer bool) {
	if r.Context().Err() != nil {
		return
	}
	var tooBig *http.MaxBytesError
	switch {
	case errors.As(body.err, &tooBig):
		writeProblem(w, r, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "Request too large",
			"The request is larger than the agent passes on (16 MB).")
		return
	case body.err != nil && !errors.Is(body.err, io.EOF):
		writeProblem(w, r, http.StatusBadRequest, "BAD_REQUEST", "Bad request", "The request body could not be read.")
		return
	}
	a := answerFor(isRead(r.Method), sawNoAnswer)
	detail := a.Detail
	if f.Err != nil {
		detail += " (" + f.Err.Error() + ")"
	} else if f.Status != 0 {
		detail += " (the gateway answered " + http.StatusText(f.Status) + ")"
	}
	if p.Log != nil {
		p.Log.Debug("cloud did not answer", "method", r.Method, "path", r.URL.Path, "kind", f.Kind.String(), "err", f.Error())
	}
	writeProblem(w, r, a.Status, a.Code, a.Title, detail)
}

func isRead(method string) bool { return method == http.MethodGet || method == http.MethodHead }

// relay streams the cloud's answer to the page: status, headers and body.
func (p *Proxy) relay(w http.ResponseWriter, r *http.Request, resp *http.Response, live bool) {
	h := w.Header()
	for k, vv := range resp.Header {
		if k == "Set-Cookie" {
			continue
		}
		h[k] = append([]string(nil), vv...)
	}
	stripHop(h)
	for _, c := range resp.Header.Values("Set-Cookie") {
		h.Add("Set-Cookie", rewriteCookie(c))
	}
	w.WriteHeader(resp.StatusCode)
	if r.Method == http.MethodHead || !bodyAllowed(resp.StatusCode) {
		return
	}

	// An event stream, and any answer of unknown length, goes out as it arrives.
	mt, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	flush := live || mt == "text/event-stream" || resp.ContentLength < 0
	rc := http.NewResponseController(w)
	buf := make([]byte, 32<<10)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return // the page went away
			}
			if flush {
				_ = rc.Flush()
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) && r.Context().Err() == nil {
				// The cloud broke off mid-answer: end the page's request as a failure, not as a
				// shorter, complete-looking one.
				panic(http.ErrAbortHandler)
			}
			return
		}
	}
}

func bodyAllowed(status int) bool {
	return status >= 200 && status != http.StatusNoContent && status != http.StatusNotModified
}

// stripHop removes the hop-by-hop headers, and any header the Connection header names.
func stripHop(h http.Header) {
	for _, v := range h.Values("Connection") {
		for _, name := range strings.Split(v, ",") {
			if name = strings.TrimSpace(name); name != "" {
				h.Del(name)
			}
		}
	}
	for _, name := range hopByHop {
		h.Del(name)
	}
}

// rewriteCookie removes the Domain and Secure attributes of a Set-Cookie value: the agent is plain
// HTTP on another host, and a browser would otherwise refuse the cookie.
func rewriteCookie(c string) string {
	parts := strings.Split(c, ";")
	out := parts[:1:1]
	for _, p := range parts[1:] {
		t := strings.ToLower(strings.TrimSpace(p))
		if t == "secure" || strings.HasPrefix(t, "domain=") {
			continue
		}
		out = append(out, p)
	}
	return strings.Join(out, ";")
}

// blockedPath reports whether a request path names the agent's own routes on the cloud:
// /api/v1/agent/* and /api/v1/agent-releases/* (§19.6). The path is decoded, cleaned and lower-cased
// first, as the cloud's nginx and Express would read it, so %61gent, dot segments, doubled slashes
// and capitals do not get round it. A path that cannot be decoded is refused.
func blockedPath(escaped string) bool {
	p, ok := cleanPath(escaped)
	if !ok {
		return true
	}
	for _, prefix := range []string{"/api/v1/agent", "/api/v1/agent-releases"} {
		if p == prefix || strings.HasPrefix(p, prefix+"/") {
			return true
		}
	}
	return false
}

// cleanPath reads a request path as the cloud's nginx and Express would: decoded, cleaned of dot
// segments, doubled slashes and a trailing slash, and lower-cased (Express routes ignore case). ok is
// false for a path that cannot be decoded.
func cleanPath(escaped string) (clean string, ok bool) {
	p, err := url.PathUnescape(escaped)
	if err != nil {
		return "", false
	}
	return strings.ToLower(path.Clean("/" + p)), true
}

// terminalChargeRoutes are the routes under /api/v1/payments/:id/ that start or check a charge on a
// card terminal, or settle one (§19.11), by the last segment of their path. The agent never repeats
// them, key or not: a charge that was written and not answered may have reached the customer's card.
//
//	process           starts the charge on the terminal (POST /api/v1/payments/:id/process)
//	check-terminal    asks the terminal how an unconfirmed charge ended
//	correct           reverses a payment and takes a replacement, which may be a new card charge
//	resolve-terminal  a manager settles an unconfirmed charge by hand from the terminal's report
var terminalChargeRoutes = map[string]bool{
	"process": true, "check-terminal": true, "correct": true, "resolve-terminal": true,
}

// isTerminalChargePath reports whether a request path is one of terminalChargeRoutes. The path is
// read the way blockedPath reads it, so %70rocess, capitals and doubled slashes do not get round
// it; one that cannot be decoded counts as one.
func isTerminalChargePath(escaped string) bool {
	p, ok := cleanPath(escaped)
	if !ok {
		return true
	}
	parts := strings.Split(strings.TrimPrefix(p, "/"), "/")
	// api / v1 / payments / <id> / <route>
	return len(parts) == 5 && parts[0] == "api" && parts[1] == "v1" && parts[2] == "payments" && terminalChargeRoutes[parts[4]]
}

// trackedBody remembers the error its reader gave, to tell a request that was too large or cut off
// by the page from a cloud that failed.
type trackedBody struct {
	r   io.Reader
	err error
}

func (b *trackedBody) Read(p []byte) (int, error) {
	n, err := b.r.Read(p)
	if err != nil {
		b.err = err
	}
	return n, err
}

// writeProblem answers with the web app's problem body (§19.6).
func writeProblem(w http.ResponseWriter, r *http.Request, status int, code, title, detail string) {
	cid := r.Header.Get("X-Correlation-Id")
	if cid == "" {
		cid = "00000000-0000-0000-0000-000000000000"
	}
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Correlation-Id", cid)
	w.WriteHeader(status)
	if r.Method == http.MethodHead {
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type":          "https://gnext.local/problems/" + strings.ToLower(strings.ReplaceAll(code, "_", "-")),
		"title":         title,
		"status":        status,
		"code":          code,
		"detail":        detail,
		"instance":      r.URL.RequestURI(),
		"correlationId": cid,
	})
}
