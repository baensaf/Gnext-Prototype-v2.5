package till

import (
	"sync"
	"time"
)

// Whether the cloud answers (§16.5). The WebSocket session says it is there, once it has lasted
// a little; a request the till's proxy sends that gets no answer says it is not, at once, before
// the heartbeat notices.

const (
	// reachAfter is how long a new session must last before the till sells through the cloud.
	reachAfter = 10 * time.Second
	// failureHolds is how long one unanswered proxied request keeps the cloud unreachable while
	// the session stays up: long enough to move the cashier over, short enough that a blip on the
	// HTTP side alone does not keep the till offline for the rest of the day.
	failureHolds = 30 * time.Second
)

type reach struct {
	mu         sync.Mutex
	failedAt   time.Time
	answeredAt time.Time
	last       bool
	since      time.Time
}

// CloudFailed records a proxied request that got no answer.
func (t *Till) CloudFailed() {
	t.init()
	t.reach.mu.Lock()
	t.reach.failedAt = t.Now()
	t.reach.mu.Unlock()
}

// CloudAnswered records a proxied request the cloud answered, whatever it said.
func (t *Till) CloudAnswered() {
	t.init()
	t.reach.mu.Lock()
	t.reach.answeredAt = t.Now()
	t.reach.mu.Unlock()
}

// Reachable reports whether the cloud answers now, and since when that has been so.
func (t *Till) Reachable() (bool, time.Time) {
	t.init()
	now := t.Now()
	ok := t.Connected != nil && t.Connected()
	var start time.Time
	if ok {
		if s := t.connectedSince(); s != nil {
			start = *s
			ok = now.Sub(start) >= reachAfter
		}
	}
	r := &t.reach
	r.mu.Lock()
	defer r.mu.Unlock()
	if ok && !r.failedAt.IsZero() && r.failedAt.After(start) && !r.answeredAt.After(r.failedAt) && now.Sub(r.failedAt) < failureHolds {
		ok = false
	}
	if ok != r.last || r.since.IsZero() {
		r.last, r.since = ok, now
	}
	return ok, r.since
}

// PendingUploads is how many offline orders still wait to reach the cloud (§16.7).
func (t *Till) PendingUploads() int {
	if t.Backlog == nil {
		return 0
	}
	return t.Backlog()
}
