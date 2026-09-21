package printing

import (
	"net"
	"sync"
	"time"

	"gnext/agent/internal/protocol"
)

// Device status details the agent reports for a printer (§6.3). They are fixed strings so the
// tray and the settings page can put them in Persian.
const (
	DetailPaperOut  = "paper out"
	DetailCoverOpen = "cover open"
	DetailPaperLow  = "paper low"
	DetailOffline   = "printer offline"
	DetailError     = "printer error"
)

// Status is what an ESC/POS printer says about itself when asked with DLE EOT, which printers
// answer at once, even while offline or printing. Answered is false for a printer that does not
// answer: its state is then unknown, not good.
type Status struct {
	Answered   bool
	Offline    bool
	CoverOpen  bool
	FeedButton bool // the feed button is held; the printer is offline only while it is
	PaperOut   bool
	PaperLow   bool
	Error      bool // cutter jam, overheating and the like
}

// Fault returns the §8.3 code and detail of a fault that stops printing, or "" if there is none.
func (s Status) Fault() (code, detail string) {
	switch {
	case !s.Answered:
		return "", ""
	case s.CoverOpen:
		return protocol.ErrCoverOpen, DetailCoverOpen
	case s.PaperOut:
		return protocol.ErrPaperOut, DetailPaperOut
	case s.Error:
		return protocol.ErrPrinterError, DetailError
	case s.Offline && !s.FeedButton:
		return protocol.ErrPrinterOffline, DetailOffline
	}
	return "", ""
}

// link reads a printer's answers while the agent writes to it. Two kinds come back, told apart
// by their fixed bits: real-time status (DLE EOT: bits 1 and 4 set, 0 and 7 clear) and the
// answer to GS r, which the printer only processes after everything sent before it, so it
// arrives once the ticket is printed (bits 4 and 7 clear). Anything else is dropped.
type link struct {
	conn   net.Conn
	rt     chan byte
	done   chan byte
	closed chan struct{}
}

func newLink(conn net.Conn) *link {
	l := &link{conn: conn, rt: make(chan byte, 8), done: make(chan byte, 1), closed: make(chan struct{})}
	go l.read()
	return l
}

func (l *link) read() {
	defer close(l.closed)
	buf := make([]byte, 64)
	for {
		n, err := l.conn.Read(buf)
		for _, b := range buf[:n] {
			switch {
			case b&0x93 == 0x12:
				select {
				case l.rt <- b:
				default:
				}
			case b&0x90 == 0x00:
				select {
				case l.done <- b:
				default:
				}
			}
		}
		if err != nil {
			return
		}
	}
}

// ask sends DLE EOT n and waits for its answer.
func (l *link) ask(n byte, timeout time.Duration) (byte, bool) {
	for len(l.rt) > 0 { // a late answer to an earlier question
		<-l.rt
	}
	if _, err := l.conn.Write([]byte{0x10, 0x04, n}); err != nil {
		return 0, false
	}
	t := time.NewTimer(timeout)
	defer t.Stop()
	select {
	case b := <-l.rt:
		return b, true
	case <-t.C:
	case <-l.closed:
	}
	return 0, false
}

// status asks for the printer status (n=1), the offline cause (n=2) and the paper sensors (n=4).
func (l *link) status(timeout time.Duration) Status {
	b, ok := l.ask(1, timeout)
	if !ok {
		return Status{}
	}
	s := Status{Answered: true, Offline: b&0x08 != 0}
	if b, ok := l.ask(2, timeout); ok {
		s.CoverOpen = b&0x04 != 0
		s.FeedButton = b&0x08 != 0
		s.PaperOut = b&0x20 != 0 // stopped at the paper end
		s.Error = b&0x40 != 0
	}
	if b, ok := l.ask(4, timeout); ok {
		s.PaperLow = b&0x0C != 0
		s.PaperOut = s.PaperOut || b&0x60 != 0
	}
	return s
}

// quirks remembers, per printer address, which questions the printer leaves unanswered, so a
// printer that never answers does not hold up every ticket. They are forgotten when the agent
// restarts, and the silence is forgotten as soon as a device check gets an answer.
type quirks struct {
	mu sync.Mutex
	m  map[string]quirk
}

type quirk struct {
	silent bool // does not answer DLE EOT
	noDone bool // answers DLE EOT but not GS r
}

func (q *quirks) get(addr string) quirk {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.m[addr]
}

func (q *quirks) set(addr string, f func(*quirk)) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.m == nil {
		q.m = map[string]quirk{}
	}
	k := q.m[addr]
	f(&k)
	q.m[addr] = k
}
