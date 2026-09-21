package printing

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"net"
	"sync"
	"testing"
	"time"

	"gnext/agent/internal/protocol"
)

// fakePrinter plays an ESC/POS printer on one end of a pipe: it answers DLE EOT from its
// current state, answers GS r once "printed" unless stuck, and keeps what it was sent.
type fakePrinter struct {
	mu        sync.Mutex
	silent    bool // answers nothing
	noGSr     bool // answers DLE EOT only
	paperOut  bool
	coverOpen bool
	paperLow  bool
	runsOut   bool // paper runs out once a ticket arrives, which then never finishes
	got       bytes.Buffer
	conns     int
}

func (f *fakePrinter) dial(context.Context, string, string) (net.Conn, error) {
	agent, printer := net.Pipe()
	f.mu.Lock()
	f.conns++
	f.mu.Unlock()
	go f.serve(printer)
	return agent, nil
}

func (f *fakePrinter) serve(c net.Conn) {
	defer c.Close()
	var seen []byte
	buf := make([]byte, 4096)
	for {
		n, err := c.Read(buf)
		if err != nil {
			return
		}
		seen = append(seen, buf[:n]...)
		f.mu.Lock()
		f.got.Write(buf[:n])
		if f.runsOut && bytes.Contains(seen, []byte{0x1D, 0x76, 0x30}) {
			f.paperOut = true
		}
		var replies []byte
		for {
			i := bytes.IndexAny(seen, "\x10\x1d")
			if i < 0 || i+2 >= len(seen) {
				break
			}
			switch {
			case seen[i] == 0x10 && seen[i+1] == 0x04:
				if !f.silent {
					replies = append(replies, f.realtime(seen[i+2]))
				}
			case seen[i] == 0x1D && seen[i+1] == 0x72 && seen[i+2] == 0x01:
				if !f.silent && !f.noGSr && !f.paperOut {
					replies = append(replies, 0x00)
				}
			}
			seen = seen[i+1:]
		}
		f.mu.Unlock()
		if len(replies) > 0 {
			if _, err := c.Write(replies); err != nil {
				return
			}
		}
	}
}

func (f *fakePrinter) realtime(n byte) byte {
	b := byte(0x12)
	switch n {
	case 1:
		if f.paperOut || f.coverOpen {
			b |= 0x08
		}
	case 2:
		if f.coverOpen {
			b |= 0x04
		}
		if f.paperOut {
			b |= 0x20
		}
	case 4:
		if f.paperLow {
			b |= 0x0C
		}
		if f.paperOut {
			b |= 0x60
		}
	}
	return b
}

func (f *fakePrinter) printed() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return bytes.Contains(f.got.Bytes(), []byte{0x1D, 0x76, 0x30})
}

// waitPrinted allows for the fake having read the ticket but not yet recorded it: a silent
// printer gives Print nothing to wait for.
func (f *fakePrinter) waitPrinted() bool {
	for range 100 {
		if f.printed() {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return false
}

type blankRenderer struct{}

func (blankRenderer) Render(_ context.Context, _ string, w int) (image.Image, error) {
	img := image.NewGray(image.Rect(0, 0, w, 40))
	for i := range img.Pix {
		img.Pix[i] = 0xFF
	}
	img.SetGray(1, 1, color.Gray{})
	return img, nil
}

func testPrinter(f *fakePrinter) (*Printer, protocol.Printer) {
	pr := &Printer{Renderer: blankRenderer{}, Dial: f.dial, StatusTimeout: 100 * time.Millisecond, PollEvery: 20 * time.Millisecond}
	p := protocol.Printer{ID: "p1", Code: "KIT", PaperWidthMM: 80, Active: true,
		Connection: &protocol.Connection{Kind: "tcp", Host: "10.0.0.5", Port: []byte("9100")}}
	return pr, p
}

func testJob() protocol.PrintJob {
	j := protocol.PrintJob{JobID: "j1", PrinterID: "p1", Copies: 1}
	j.Content.Format, j.Content.HTML = "html", "<p>x</p>"
	return j
}

func failureCode(err error) string {
	var f *Failure
	if errors.As(err, &f) {
		return f.Code
	}
	return ""
}

func TestPrintConfirmedByPrinter(t *testing.T) {
	f := &fakePrinter{}
	pr, p := testPrinter(f)
	if err := pr.Print(context.Background(), p, testJob()); err != nil {
		t.Fatal(err)
	}
	if !f.printed() {
		t.Fatal("the ticket was not sent")
	}
}

func TestPrintRefusesEmptyOrOpenPrinter(t *testing.T) {
	for name, f := range map[string]*fakePrinter{
		protocol.ErrPaperOut:  {paperOut: true},
		protocol.ErrCoverOpen: {coverOpen: true},
	} {
		pr, p := testPrinter(f)
		err := pr.Print(context.Background(), p, testJob())
		if got := failureCode(err); got != name {
			t.Fatalf("%s: got %v", name, err)
		}
		if f.printed() {
			t.Fatalf("%s: the ticket was sent to a printer that cannot print it", name)
		}
	}
}

func TestPrintReportsPaperRunningOutHalfway(t *testing.T) {
	f := &fakePrinter{runsOut: true}
	pr, p := testPrinter(f)
	err := pr.Print(context.Background(), p, testJob())
	if got := failureCode(err); got != protocol.ErrPaperOut {
		t.Fatalf("got %v, want PAPER_OUT", err)
	}
}

func TestPrintToSilentPrinterStillPrintsAndStopsAsking(t *testing.T) {
	f := &fakePrinter{silent: true}
	pr, p := testPrinter(f)
	if err := pr.Print(context.Background(), p, testJob()); err != nil {
		t.Fatal(err)
	}
	if !f.waitPrinted() {
		t.Fatal("the ticket was not sent")
	}
	start := time.Now()
	if err := pr.Print(context.Background(), p, testJob()); err != nil {
		t.Fatal(err)
	}
	if d := time.Since(start); d > 80*time.Millisecond {
		t.Fatalf("second ticket waited %v for answers a silent printer never gives", d)
	}
}

func TestPrintWithoutGSrDoesNotWaitTwice(t *testing.T) {
	f := &fakePrinter{noGSr: true}
	pr, p := testPrinter(f)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	// The first ticket waits for an answer that never comes; shorten that wait via the deadline.
	short, cancelShort := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancelShort()
	if err := pr.Print(short, p, testJob()); err != nil {
		t.Fatal(err)
	}
	if !pr.quirks.get(address(p)).noDone {
		t.Fatal("the printer was not remembered as ignoring GS r")
	}
	start := time.Now()
	if err := pr.Print(ctx, p, testJob()); err != nil {
		t.Fatal(err)
	}
	if d := time.Since(start); d > 500*time.Millisecond {
		t.Fatalf("second ticket waited %v", d)
	}
}

func TestProbeReportsPrinterFaults(t *testing.T) {
	cases := []struct {
		f      *fakePrinter
		status string
		detail string
	}{
		{&fakePrinter{}, protocol.DeviceOnline, ""},
		{&fakePrinter{paperLow: true}, protocol.DeviceOnline, DetailPaperLow},
		{&fakePrinter{paperOut: true}, protocol.DeviceError, DetailPaperOut},
		{&fakePrinter{coverOpen: true}, protocol.DeviceError, DetailCoverOpen},
		{&fakePrinter{silent: true}, protocol.DeviceOnline, ""},
	}
	for i, c := range cases {
		pr, p := testPrinter(c.f)
		status, detail := pr.Probe(context.Background(), p)
		if status != c.status || detail != c.detail {
			t.Errorf("case %d: got %s %q, want %s %q", i, status, detail, c.status, c.detail)
		}
	}
}
