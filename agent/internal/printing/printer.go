// Package printing prints the cloud's HTML tickets on branch printers (§6.2, §7.1).
package printing

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"time"

	"gnext/agent/internal/protocol"
)

// Failure carries a device error code (§8.3) for print.result.
type Failure struct {
	Code string
	Err  error
}

func (f *Failure) Error() string { return f.Code + ": " + f.Err.Error() }

func fail(code string, err error) *Failure { return &Failure{Code: code, Err: err} }

// Printer prints jobs through a Renderer and a raw TCP connection.
type Printer struct {
	Renderer Renderer
	Dial     func(ctx context.Context, network, addr string) (net.Conn, error)

	// How long to wait for each status answer, and between status checks while a ticket
	// prints; zero means the defaults. Tests shorten them.
	StatusTimeout time.Duration
	PollEvery     time.Duration

	quirks quirks
}

// Supported reports whether this build can drive the printer's connection.
func Supported(p protocol.Printer) bool {
	return p.Connection != nil && p.Connection.Kind == "tcp" && p.Connection.Host != "" && p.Connection.TCPPort() > 0
}

// Print renders and sends one job. The returned error is always a *Failure.
//
// A printer that answers status questions is asked before the ticket is sent, so a ticket is
// not sent into an empty or open printer, and asked to confirm once it has printed (GS r),
// with its status checked while it prints: paper running out halfway is reported, not taken
// for a printed ticket. A printer that does not answer is sent the ticket as before, and
// success then only means the printer took the data.
func (pr *Printer) Print(ctx context.Context, p protocol.Printer, job protocol.PrintJob) error {
	if !Supported(p) {
		return fail(protocol.ErrPrinterUnreachable, errors.New("connection kind not supported by this agent build"))
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	if job.Content.Format != "html" {
		return fail(protocol.ErrRenderFailed, fmt.Errorf("content format %q", job.Content.Format))
	}
	dots := DotsForPaper(p.PaperWidthMM)
	img, err := pr.Renderer.Render(ctx, job.Content.HTML, dots)
	if err != nil {
		return fail(protocol.ErrRenderFailed, err)
	}
	copies := max(job.Copies, 1)
	data := EncodeRaster(ToMono(img, dots), copies)

	addr := address(p)
	conn, err := pr.dial(ctx, addr)
	if err != nil {
		return fail(protocol.ErrPrinterUnreachable, err)
	}
	defer conn.Close()
	if dl, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(dl)
	}
	l := newLink(conn)

	q := pr.quirks.get(addr)
	if !q.silent {
		st := l.status(pr.statusTimeout())
		if !st.Answered {
			pr.quirks.set(addr, func(q *quirk) { q.silent = true })
			q.silent = true
		} else if code, detail := st.Fault(); code != "" {
			return fail(code, errors.New(detail+"; nothing was sent"))
		}
	}

	if _, err := conn.Write(data); err != nil {
		if ctx.Err() != nil {
			return fail(protocol.ErrTimeout, err)
		}
		return fail(protocol.ErrPrinterUnreachable, err)
	}
	if q.silent || q.noDone {
		return nil
	}
	return pr.awaitPrinted(ctx, l, addr, copies)
}

// awaitPrinted asks the printer to answer once everything before has printed, checking its
// status meanwhile. No answer and no fault means a printer that ignores GS r: the ticket is
// taken as printed, and later tickets on it do not wait.
func (pr *Printer) awaitPrinted(ctx context.Context, l *link, addr string, copies int) error {
	if _, err := l.conn.Write([]byte{0x1D, 0x72, 0x01}); err != nil {
		return nil // the ticket itself went through
	}
	wait := 10*time.Second + time.Duration(copies)*4*time.Second
	if dl, ok := ctx.Deadline(); ok {
		wait = min(wait, time.Until(dl)-time.Second)
	}
	giveUp := time.NewTimer(wait)
	defer giveUp.Stop()
	poll := time.NewTicker(pr.pollEvery())
	defer poll.Stop()
	for {
		select {
		case <-l.done:
			return nil
		case <-poll.C:
			if code, detail := l.status(pr.statusTimeout()).Fault(); code != "" {
				return fail(code, errors.New(detail+" while printing; the ticket may be partly printed, and the rest may print once the printer is fixed"))
			}
		case <-giveUp.C:
			pr.quirks.set(addr, func(q *quirk) { q.noDone = true })
			return nil
		case <-l.closed:
			return nil
		}
	}
}

// Probe checks that the printer accepts a connection and, if it answers, that it is ready.
func (pr *Printer) Probe(ctx context.Context, p protocol.Printer) (string, string) {
	if p.Connection == nil {
		// §6.1 still calls this UNSUPPORTED; the detail says why.
		return protocol.DeviceUnsupported, "not connected to the agent; the cloud prints it on the simulator"
	}
	if !Supported(p) {
		return protocol.DeviceUnsupported, "connection kind " + p.Connection.Kind + " is not supported by this agent build"
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	addr := address(p)
	conn, err := pr.dial(ctx, addr)
	if err != nil {
		return protocol.DeviceOffline, err.Error()
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
	st := newLink(conn).status(pr.statusTimeout())
	if !st.Answered {
		return protocol.DeviceOnline, ""
	}
	pr.quirks.set(addr, func(q *quirk) { q.silent = false })
	if _, detail := st.Fault(); detail != "" {
		return protocol.DeviceError, detail
	}
	if st.PaperLow {
		return protocol.DeviceOnline, DetailPaperLow
	}
	return protocol.DeviceOnline, ""
}

func (pr *Printer) statusTimeout() time.Duration {
	if pr.StatusTimeout > 0 {
		return pr.StatusTimeout
	}
	return 800 * time.Millisecond
}

func (pr *Printer) pollEvery() time.Duration {
	if pr.PollEvery > 0 {
		return pr.PollEvery
	}
	return time.Second
}

func address(p protocol.Printer) string {
	return net.JoinHostPort(p.Connection.Host, strconv.Itoa(p.Connection.TCPPort()))
}

func (pr *Printer) dial(ctx context.Context, addr string) (net.Conn, error) {
	dial := pr.Dial
	if dial == nil {
		dial = (&net.Dialer{}).DialContext
	}
	return dial(ctx, "tcp", addr)
}
