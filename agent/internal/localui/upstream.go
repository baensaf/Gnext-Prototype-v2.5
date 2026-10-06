package localui

import (
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/http/httptrace"
	"strings"
	"sync/atomic"
	"time"
)

// This file is the proxy's one place that talks to the cloud: one attempt at a request, and what
// its failure means (agent-protocol §19.10). The retries of S5 (reads) and S6 (keyed writes) are
// loops around Attempt; the answers they end with come from Answer.

// FailureKind says how far a request got before the cloud failed to answer it.
type FailureKind int

const (
	// NotSent: nothing reached the cloud's application. The connection was refused, DNS or TLS
	// failed, the connection was reset before the request was written, or the cloud's gateway
	// answered 502 or 503. Repeating the request is always safe.
	NotSent FailureKind = iota + 1
	// NoAnswer: the request was written and no answer came in time, the connection broke after it
	// was written, or the gateway answered 504. The cloud may have acted on it.
	NoAnswer
)

func (k FailureKind) String() string {
	switch k {
	case NotSent:
		return "not sent"
	case NoAnswer:
		return "no answer"
	}
	return "no failure"
}

// Failure is an attempt that got no answer from the cloud's application.
type Failure struct {
	Kind FailureKind
	// Err is what the transport said; nil when the gateway answered.
	Err error
	// Status is the gateway's own answer (502, 503 or 504), or 0 when there was none.
	Status int
}

func (f *Failure) Error() string {
	if f.Err != nil {
		return fmt.Sprintf("%s: %v", f.Kind, f.Err)
	}
	return fmt.Sprintf("%s: the gateway answered %d", f.Kind, f.Status)
}

// errTimeout is the cause set when an attempt's time ran out.
var errTimeout = errors.New("the cloud did not answer in time")

// classify says how far a request got when its transport failed: wrote is whether the whole
// request, body included, had been written to the connection. A request that was written and
// never answered may have been acted on; one that was not written cannot have been.
func classify(wrote bool) FailureKind {
	if wrote {
		return NoAnswer
	}
	return NotSent
}

// gatewayKind tells a gateway's failure page from the application's own answer. A 502, 503 or
// 504 with a JSON body is the application speaking (a route may answer 503 on purpose) and is
// passed on to the page; one with any other body is nginx or the CDN saying the application is not
// there. 502 and 503 mean it was not reached; 504 means it was reached and did not answer.
func gatewayKind(status int, contentType string) (FailureKind, bool) {
	switch status {
	case http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
	default:
		return 0, false
	}
	if mt, _, err := mime.ParseMediaType(contentType); err == nil && (mt == "application/json" || strings.HasSuffix(mt, "+json")) {
		return 0, false
	}
	if status == http.StatusGatewayTimeout {
		return NoAnswer, true
	}
	return NotSent, true
}

// Answer is what the agent tells the page when the cloud gave none (§19.10).
type Answer struct {
	Status int
	Code   string
	Title  string
	Detail string
}

// answerFor maps what happened to a request to what the page is told. read is true for GET and HEAD.
// sawNoAnswer is true when any attempt was written and not answered; a request with one attempt
// has it exactly when its Failure.Kind is NoAnswer. A write the cloud may have acted on gets 504;
// everything else is 502.
func answerFor(read, sawNoAnswer bool) Answer {
	if sawNoAnswer && !read {
		return Answer{http.StatusGatewayTimeout, "CLOUD_NO_ANSWER", "Cloud did not answer",
			"The request was sent and Gnext did not answer in time. It may have been saved."}
	}
	return Answer{http.StatusBadGateway, "CLOUD_UNREACHABLE", "Cloud unreachable",
		"The agent could not reach Gnext."}
}

// Upstream makes the agent's requests to the cloud over one connection pool.
type Upstream struct {
	// Transport is used as is when set (tests); otherwise a pool with dial and TLS limits.
	Transport http.RoundTripper
	once      atomic.Pointer[http.Transport]
}

func (u *Upstream) transport() http.RoundTripper {
	if u.Transport != nil {
		return u.Transport
	}
	if t := u.once.Load(); t != nil {
		return t
	}
	t := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   10 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout: 10 * time.Second,
		ForceAttemptHTTP2:   true,
		MaxIdleConnsPerHost: 16,
		// Shorter than nginx's keep-alive (75 s), so the agent closes an idle connection first and
		// never writes a request into one the cloud has just closed.
		IdleConnTimeout: 30 * time.Second,
		// A faithful proxy: the page's Accept-Encoding goes to the cloud and the answer comes back
		// as it is, not unpacked here.
		DisableCompression: true,
	}
	if !u.once.CompareAndSwap(nil, t) {
		return u.once.Load()
	}
	return t
}

// Attempt sends req to the cloud once and returns its response, or a Failure.
//
// timeout bounds the time to the cloud's answer, counted from the start of the attempt (the
// response headers; the body then streams without a limit). Zero means no limit. A failure
// classifies by how far the request got: see classify and gatewayKind. A response of the
// application itself, whatever its status, is returned whole; the caller closes its Body.
//
// If ctx ends the attempt ends with ctx's error as the Failure's Err; the caller checks ctx to
// tell a client that went away from a cloud that did not answer.
func (u *Upstream) Attempt(ctx context.Context, req *http.Request, timeout time.Duration) (*http.Response, *Failure) {
	var wrote atomic.Bool
	actx, cancel := context.WithCancelCause(ctx)
	trace := &httptrace.ClientTrace{
		WroteRequest: func(i httptrace.WroteRequestInfo) {
			if i.Err == nil {
				wrote.Store(true)
			}
		},
	}
	req = req.WithContext(httptrace.WithClientTrace(actx, trace))
	var timer *time.Timer
	if timeout > 0 {
		timer = time.AfterFunc(timeout, func() { cancel(errTimeout) })
	}
	resp, err := u.transport().RoundTrip(req)
	timedOut := timer != nil && !timer.Stop()
	if err == nil && timedOut {
		// The answer arrived as the time ran out; its body would be cut, so count it as none.
		resp.Body.Close()
		err = errTimeout
	}
	if err != nil {
		cancel(nil)
		if cause := context.Cause(actx); errors.Is(cause, errTimeout) {
			err = errTimeout
		}
		return nil, &Failure{Kind: classify(wrote.Load()), Err: err}
	}
	if kind, ok := gatewayKind(resp.StatusCode, resp.Header.Get("Content-Type")); ok {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
		resp.Body.Close()
		cancel(nil)
		return nil, &Failure{Kind: kind, Status: resp.StatusCode}
	}
	resp.Body = &cancelOnClose{ReadCloser: resp.Body, cancel: func() { cancel(nil) }}
	return resp, nil
}

// cancelOnClose releases an attempt's context when its response body is closed.
type cancelOnClose struct {
	io.ReadCloser
	cancel func()
}

func (c *cancelOnClose) Close() error {
	err := c.ReadCloser.Close()
	c.cancel()
	return err
}
