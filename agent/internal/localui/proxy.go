package localui

import (
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
	// proxyTimeout is the time the cloud has to answer one request.
	proxyTimeout = 30 * time.Second
	// liveStreamPath is the Server-Sent Events route: no time limit, flushed event by event.
	liveStreamPath = "/api/v1/live/stream"
)

// hopByHop headers are meant for one connection, not for the next (RFC 9110 §7.6.1).
var hopByHop = []string{
	"Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization", "Proxy-Connection",
	"Te", "Trailer", "Transfer-Encoding", "Upgrade",
}

// Proxy passes the page's API calls to the cloud.
type Proxy struct {
	Up *Upstream
	// Server returns the cloud's address (https://gnext.top); empty when none is configured.
	Server  func() string
	Version string
	Log     *slog.Logger

	// Timeout is how long the cloud has to answer; default 30 s. Tests shorten it.
	Timeout time.Duration
}

func (p *Proxy) timeout() time.Duration {
	if p.Timeout > 0 {
		return p.Timeout
	}
	return proxyTimeout
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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
	out, err := p.upstreamRequest(r, server, body)
	if err != nil {
		writeProblem(w, r, http.StatusBadRequest, "BAD_REQUEST", "Bad request", err.Error())
		return
	}

	// One attempt. S5 and S6 turn this into a loop that repeats it, and then tell the page what
	// happened with answerFor.
	resp, fail := p.Up.Attempt(r.Context(), out, timeout)
	if fail != nil {
		p.fail(w, r, body, fail)
		return
	}
	defer resp.Body.Close()
	p.relay(w, r, resp, live)
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

// fail answers the page when the cloud did not (§19.10). A client that went away gets nothing.
func (p *Proxy) fail(w http.ResponseWriter, r *http.Request, body *trackedBody, f *Failure) {
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
	a := answerFor(isRead(r.Method), f.Kind == NoAnswer)
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
	p, err := url.PathUnescape(escaped)
	if err != nil {
		return true
	}
	p = strings.ToLower(path.Clean("/" + p))
	for _, prefix := range []string{"/api/v1/agent", "/api/v1/agent-releases"} {
		if p == prefix || strings.HasPrefix(p, prefix+"/") {
			return true
		}
	}
	return false
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
