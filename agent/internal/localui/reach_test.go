package localui

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// A Reach with a clock the tests move by hand.
func steppedReach() (*Reach, *time.Time) {
	now := time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)
	r := &Reach{reachable: true}
	r.now = func() time.Time { return now }
	r.since = now
	return r, &now
}

func TestReachStartsReachableAndTwoProbeFailuresInARowMakeItUnreachable(t *testing.T) {
	r, now := steppedReach()
	start := *now
	if up, since := r.State(); !up || !since.Equal(start) {
		t.Fatalf("at start: %v %v", up, since)
	}
	*now = now.Add(3 * time.Second)
	r.Probed(false) // one failure is not enough
	if up, since := r.State(); !up || !since.Equal(start) {
		t.Fatalf("after one failed probe: %v %v, want still reachable since the start", up, since)
	}
	*now = now.Add(3 * time.Second)
	downAt := *now
	r.Probed(false)
	if up, since := r.State(); up || !since.Equal(downAt) {
		t.Fatalf("after two failed probes: %v %v, want unreachable since %v", up, since, downAt)
	}
	*now = now.Add(3 * time.Second)
	r.Probed(false) // a third changes nothing, not even the time
	if up, since := r.State(); up || !since.Equal(downAt) {
		t.Fatalf("after three: %v %v", up, since)
	}
}

func TestReachOneSuccessfulProbeMakesItReachableAndAFailureBetweenSuccessesDoesNotCount(t *testing.T) {
	r, now := steppedReach()
	r.Probed(false)
	r.Probed(false)
	*now = now.Add(10 * time.Second)
	upAt := *now
	r.Probed(true)
	if up, since := r.State(); !up || !since.Equal(upAt) {
		t.Fatalf("after one success: %v %v, want reachable since %v", up, since, upAt)
	}
	// fail, success, fail: the success reset the count, so one failure again is not two in a row.
	r.Probed(false)
	r.Probed(true)
	r.Probed(false)
	if up, _ := r.State(); !up {
		t.Fatal("a failure, a success and a failure made it unreachable")
	}
}

func TestReachProxiedRequestsFeedItAtOnce(t *testing.T) {
	r, now := steppedReach()
	// A request the cloud did not answer: unreachable at once, no second failure needed.
	*now = now.Add(time.Second)
	downAt := *now
	r.Proxied(false)
	if up, since := r.State(); up || !since.Equal(downAt) {
		t.Fatalf("after a request with no answer: %v %v", up, since)
	}
	// A probe failure on top of it changes nothing.
	r.Probed(false)
	if up, _ := r.State(); up {
		t.Fatal("a probe failure after a failed request brought it back")
	}
	// Any answer from the cloud makes it reachable, before the next probe.
	*now = now.Add(time.Second)
	upAt := *now
	r.Proxied(true)
	if up, since := r.State(); !up || !since.Equal(upAt) {
		t.Fatalf("after a request that was answered: %v %v", up, since)
	}
	// The answer cleared the count: one probe failure is the first of two again.
	r.Probed(false)
	if up, _ := r.State(); !up {
		t.Fatal("one probe failure after an answer made it unreachable")
	}
	var none *Reach
	none.Proxied(false) // a proxy with no Reach must not crash
}

// The probe itself, against a cloud that is up, down (the gateway's own 502 page), and silent.
func TestReachProbeAsksTheHealthRouteAndFollowsTheCloud(t *testing.T) {
	var mode atomic.Value
	mode.Store("up")
	var hits atomic.Int32
	var gotPath, gotUA atomic.Value
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		gotPath.Store(r.Method + " " + r.URL.Path)
		gotUA.Store(r.Header.Get("User-Agent"))
		switch mode.Load() {
		case "down":
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(502)
			io.WriteString(w, "<html>502</html>")
		case "silent":
			<-r.Context().Done()
		default:
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"status":"ok"}`)
		}
	}))
	defer cloud.Close()

	s := newServer(&fakeHost{server: cloud.URL})
	s.Reach = NewReach()
	s.Reach.Every = 15 * time.Millisecond
	s.Reach.Timeout = 80 * time.Millisecond
	s.init()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.Reach.Run(ctx, s.probeCloud)

	waitFor := func(want bool) {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			if up, _ := s.Reach.State(); up == want {
				return
			}
			time.Sleep(5 * time.Millisecond)
		}
		t.Fatalf("reachable never became %v", want)
	}

	time.Sleep(60 * time.Millisecond)
	if up, _ := s.Reach.State(); !up || hits.Load() == 0 {
		t.Fatalf("with the cloud up: reachable=%v after %d probes", up, hits.Load())
	}
	if gotPath.Load() != "GET /health/live" || !strings.HasPrefix(gotUA.Load().(string), "gnext-agent/") {
		t.Errorf("the probe was %v with User-Agent %v", gotPath.Load(), gotUA.Load())
	}

	mode.Store("down")
	waitFor(false)
	mode.Store("up")
	waitFor(true)

	// A cloud that takes the probe and never answers is down too, after the probe's timeout.
	mode.Store("silent")
	waitFor(false)
	mode.Store("up")
	waitFor(true)
}

type noServerHost struct{ fakeHost }

func (noServerHost) State() State { return State{} }

// A server with no address configured probes nothing and keeps the state it has.
func TestReachProbeWithNoServerChangesNothing(t *testing.T) {
	s := newServer(&noServerHost{})
	s.init()
	if ok, skip := s.probeCloud(context.Background()); ok || !skip {
		t.Fatalf("probe with no server: ok=%v skip=%v", ok, skip)
	}
}

// The proxy tells Reach what became of each request, and the status route reports it.
func TestProxiedOutcomesFeedReachAndTheStatusRouteReportsIt(t *testing.T) {
	var answer atomic.Bool
	answer.Store(true)
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !answer.Load() {
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{}`)
	}))
	defer cloud.Close()

	s := newServer(&fakeHost{server: cloud.URL})
	s.Reach = NewReach()
	h := s.Handler(DefaultAddr)
	status := func() map[string]any {
		var out struct{ Cloud map[string]any }
		rec := call(h, "GET", "/agent/api/status", "", nil)
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("%v %s", err, rec.Body)
		}
		return out.Cloud
	}

	if status()["reachable"] != true {
		t.Fatalf("status at start: %v", status())
	}
	// The cloud's gateway answering for an application that is not there: unreachable at once.
	answer.Store(false)
	if rec := call(h, "GET", "/api/v1/orders", "", nil); rec.Code != 502 {
		t.Fatalf("GET with the cloud down: %d", rec.Code)
	}
	cl := status()
	if cl["reachable"] != false {
		t.Fatalf("status after a request with no answer: %v", cl)
	}
	if _, ok := cl["connected"]; !ok || cl["since"] == nil || cl["reachable_since"] == nil {
		t.Errorf("status lost connected/since or lacks reachable_since: %v", cl)
	}
	// One answer brings it back.
	answer.Store(true)
	if rec := call(h, "GET", "/api/v1/orders", "", nil); rec.Code != 200 {
		t.Fatalf("GET with the cloud up: %d", rec.Code)
	}
	if status()["reachable"] != true {
		t.Fatalf("status after an answer: %v", status())
	}
	// A write the cloud's gateway turned down counts like a read.
	answer.Store(false)
	if rec := call(h, "POST", "/api/v1/orders", `{}`, nil); rec.Code != 502 {
		t.Fatalf("POST with the cloud down: %d", rec.Code)
	}
	if status()["reachable"] != false {
		t.Fatalf("status after a write with no answer: %v", status())
	}
}

// A page that gives up its own request says nothing about the cloud.
func TestAPageThatGoesAwayDoesNotMakeTheCloudUnreachable(t *testing.T) {
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer cloud.Close()
	p := newProxy(cloud.URL)
	p.Reach = NewReach()
	p.Timeout = 5 * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	req := httptest.NewRequest("GET", "/api/v1/orders", nil).WithContext(ctx)
	doReq(p, req)
	if up, _ := p.Reach.State(); !up {
		t.Fatal("a page that went away made the cloud unreachable")
	}
}
