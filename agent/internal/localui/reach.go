package localui

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Reach says whether the cloud can be reached from this PC over HTTP (agent-protocol §19.8, §19.10),
// which is what the register needs, as the WebSocket's state (cloud.connected) is not: that one
// is noticed only after missed heartbeats, and says nothing about the plain requests the app makes.
//
// It is fed by two things:
//   - a probe every few seconds, a cheap unauthenticated GET of the cloud's /health/live: two
//     failures in a row make the cloud unreachable, one success makes it reachable again;
//   - the proxied requests themselves: one that the cloud did not answer (not sent, or written and
//     not answered) makes it unreachable at once, and any answer from the cloud makes it reachable,
//     so a busy register finds out before the next probe.
type Reach struct {
	// Every is the pause between two probes, from the end of one to the start of the next; default 3 s.
	Every time.Duration
	// Timeout is the time a probe has to be answered; default 5 s.
	Timeout time.Duration

	mu        sync.Mutex
	reachable bool
	since     time.Time
	fails     int
	now       func() time.Time
}

const (
	reachEvery   = 3 * time.Second
	reachTimeout = 5 * time.Second
	// reachFailsToDown is how many probes in a row must fail before the cloud counts as away.
	reachFailsToDown = 2
	// reachProbePath is the cheapest route the cloud answers with no sign-in and no database: the
	// backend's liveness check, which nginx serves under /health/.
	reachProbePath = "/health/live"
)

// NewReach starts out reachable: nothing is known against it yet.
func NewReach() *Reach {
	r := &Reach{now: time.Now, reachable: true}
	r.since = r.now()
	return r
}

func (r *Reach) set(reachable bool) {
	if r.reachable != reachable {
		r.reachable, r.since = reachable, r.now()
	}
}

// Probed records the result of one probe: a success is reachable at once, the second failure in a
// row is unreachable.
func (r *Reach) Probed(ok bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if ok {
		r.fails = 0
		r.set(true)
		return
	}
	r.fails++
	if r.fails >= reachFailsToDown {
		r.set(false)
	}
}

// Proxied records what became of a proxied request: answered by the cloud, or not. A nil Reach
// ignores it.
func (r *Reach) Proxied(answered bool) {
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if answered {
		r.fails = 0
		r.set(true)
		return
	}
	r.fails = reachFailsToDown
	r.set(false)
}

// State is whether the cloud is reachable and since when that has been so.
func (r *Reach) State() (bool, time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.reachable, r.since
}

// Run probes until ctx ends. probe returns whether the cloud answered, and false for skip when
// there is nothing to ask (no server configured), which changes nothing.
func (r *Reach) Run(ctx context.Context, probe func(ctx context.Context) (ok, skip bool)) {
	every := r.Every
	if every <= 0 {
		every = reachEvery
	}
	for {
		if ok, skip := probe(ctx); !skip && ctx.Err() == nil {
			r.Probed(ok)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(every):
		}
	}
}

// probeCloud is one probe: GET <server>/health/live, answered by the cloud's application within the
// timeout. A gateway's own failure page counts as no answer (Attempt says so).
func (s *Server) probeCloud(ctx context.Context) (ok, skip bool) {
	server := strings.TrimRight(s.Host.State().Server, "/")
	if server == "" {
		return false, true
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server+reachProbePath, nil)
	if err != nil {
		return false, true
	}
	req.Header.Set("User-Agent", "gnext-agent/"+s.Version)
	timeout := s.Reach.Timeout
	if timeout <= 0 {
		timeout = reachTimeout
	}
	resp, fail := s.px.Up.Attempt(ctx, req, timeout)
	if fail != nil {
		return false, false
	}
	resp.Body.Close()
	return true, false
}
