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
}

// Supported reports whether this build can drive the printer's connection.
func Supported(p protocol.Printer) bool {
	return p.Connection != nil && p.Connection.Kind == "tcp" && p.Connection.Host != "" && p.Connection.TCPPort() > 0
}

// Print renders and sends one job. The returned error is always a *Failure.
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

	conn, err := pr.dial(ctx, p)
	if err != nil {
		return fail(protocol.ErrPrinterUnreachable, err)
	}
	defer conn.Close()
	if dl, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(dl)
	}
	if _, err := conn.Write(data); err != nil {
		if ctx.Err() != nil {
			return fail(protocol.ErrTimeout, err)
		}
		return fail(protocol.ErrPrinterUnreachable, err)
	}
	return nil
}

// Probe checks that the printer's port accepts a connection.
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
	conn, err := pr.dial(ctx, p)
	if err != nil {
		return protocol.DeviceOffline, err.Error()
	}
	conn.Close()
	return protocol.DeviceOnline, ""
}

func (pr *Printer) dial(ctx context.Context, p protocol.Printer) (net.Conn, error) {
	addr := net.JoinHostPort(p.Connection.Host, strconv.Itoa(p.Connection.TCPPort()))
	dial := pr.Dial
	if dial == nil {
		dial = (&net.Dialer{}).DialContext
	}
	return dial(ctx, "tcp", addr)
}
