package localui

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// Writes with an Idempotency-Key (agent-protocol §19.11, S6). The helpers newUpstream, newProxy,
// doReq, problemOf and gatewayDown are those of proxy_test.go.

// dropConn hangs up without a word: the request was read, and the cloud never answered it.
func dropConn(w http.ResponseWriter) {
	if c, _, err := w.(http.Hijacker).Hijack(); err == nil {
		c.Close()
	}
}

// keyed makes a write that carries an Idempotency-Key, as the register's Place does.
func keyed(method, path, key, body string) *http.Request {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Idempotency-Key", key)
	req.Header.Set("Content-Type", "application/json")
	return req
}

// A Place whose answer was lost: the first attempt was written and the connection dropped. The
// agent sends the same request again, key and body as they were, and the page sees the answer.
func TestAKeyedWriteIsRetriedAfterADropMidRequestAndAnswered(t *testing.T) {
	for _, method := range []string{"POST", "PUT", "PATCH", "DELETE"} {
		var mu sync.Mutex
		var keys, bodies []string
		var up *upstream
		up = newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
			_, b := up.seen()
			mu.Lock()
			keys = append(keys, r.Header.Get("Idempotency-Key"))
			bodies = append(bodies, string(b))
			n := len(keys)
			mu.Unlock()
			if n == 1 {
				dropConn(w)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			io.WriteString(w, `{"id":"o1"}`)
		})
		p := newProxy(up.srv.URL)
		p.Retry = Retry{Every: 20 * time.Millisecond, Window: time.Second, Grace: time.Second}

		rec := doReq(p, keyed(method, "/api/v1/orders", "k-1", `{"items":[1,2,3]}`))
		if rec.Code != 201 || rec.Body.String() != `{"id":"o1"}` {
			t.Errorf("%s: %d %s", method, rec.Code, rec.Body)
		}
		mu.Lock()
		if len(keys) != 2 || keys[0] != "k-1" || keys[1] != "k-1" {
			t.Errorf("%s: the cloud saw the keys %q, want k-1 twice", method, keys)
		}
		if len(bodies) != 2 || bodies[0] != `{"items":[1,2,3]}` || bodies[1] != bodies[0] {
			t.Errorf("%s: the cloud saw the bodies %q, want the same body twice", method, bodies)
		}
		mu.Unlock()
	}
}

// Every failure of the table is repeated for a keyed write, as it is for a read: not sent, the
// gateway's 502, 503 and 504, and a request that was written and never answered.
func TestAKeyedWriteIsRetriedAfterEveryKindOfFailureOfTheTable(t *testing.T) {
	for _, c := range []struct {
		name string
		fail func(w http.ResponseWriter, r *http.Request)
	}{
		{"gateway 502", func(w http.ResponseWriter, r *http.Request) { gatewayDown(w) }},
		{"gateway 503", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(503)
		}},
		{"gateway 504", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(504)
		}},
		{"written, never answered", func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }},
		{"dropped", func(w http.ResponseWriter, r *http.Request) { dropConn(w) }},
	} {
		var up *upstream
		up = newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
			if up.count() <= 2 {
				c.fail(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"ok":true}`)
		})
		p := newProxy(up.srv.URL)
		p.Timeout = 150 * time.Millisecond // an attempt that is never answered gives up quickly
		p.Retry = Retry{Every: 20 * time.Millisecond, Window: 10 * time.Second, Grace: 5 * time.Second}
		rec := doReq(p, keyed("POST", "/api/v1/orders", "k-2", `{"a":1}`))
		if rec.Code != 200 || rec.Body.String() != `{"ok":true}` {
			t.Errorf("%s: %d %s", c.name, rec.Code, rec.Body)
		}
		// Two failures, then the answer; more only if a busy machine let an attempt time out.
		if up.count() < 3 {
			t.Errorf("%s: the cloud saw %d attempts, want at least 3 (two failures, then the answer)", c.name, up.count())
		}
	}
}

// A write with no key is never repeated, however the cloud failed. A blank key is no key.
func TestAnUnkeyedWriteIsNotRetriedAfterADrop(t *testing.T) {
	for _, key := range []string{"", " "} {
		for _, method := range []string{"POST", "PUT", "PATCH", "DELETE"} {
			up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) { dropConn(w) })
			p := newProxy(up.srv.URL)
			req := httptest.NewRequest(method, "/api/v1/orders", strings.NewReader(`{"a":1}`))
			if key != "" {
				req.Header.Set("Idempotency-Key", key)
			}
			rec := doReq(p, req)
			if rec.Code != 504 || problemOf(t, rec)["code"] != "CLOUD_NO_ANSWER" {
				t.Errorf("%s key %q: %d %s", method, key, rec.Code, rec.Body)
			}
			if up.count() != 1 {
				t.Errorf("%s key %q: the cloud saw %d requests, want 1", method, key, up.count())
			}
		}
	}
}

// A card charge is never repeated, key or not, however the request is spelled: a charge written
// and not answered may have reached the customer's card (§19.11).
func TestTerminalChargeRoutesAreNeverRetriedEvenWithAKey(t *testing.T) {
	paths := []string{
		"/api/v1/payments/1/process",
		"/api/v1/payments/1/check-terminal",
		"/api/v1/payments/1/correct",
		"/api/v1/payments/1/resolve-terminal",
		"/api/v1/payments/6f1c2a50-9d2e-4c1a-8f6b-0a9d2e4c1a8f/process?x=1",
		"/API/V1/Payments/1/PROCESS",
		"/api/v1/payments/1/%70rocess",
		"/api/v1/payments/1/process/",
		"//api/v1//payments/1/process",
		"/api/v1/payments/1/./process",
		"/api/v1/payments/2/../1/check-terminal",
	}
	for _, mode := range []string{"dropped", "gateway 502", "gateway 504"} {
		for _, path := range paths {
			up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
				switch mode {
				case "dropped":
					dropConn(w)
				case "gateway 502":
					gatewayDown(w)
				default:
					w.Header().Set("Content-Type", "text/html")
					w.WriteHeader(504)
				}
			})
			p := newProxy(up.srv.URL)
			rec := doReq(p, keyed("POST", path, "k-3", `{"scenarioId":"SUCCESS"}`))
			want := 504
			if mode == "gateway 502" {
				want = 502
			}
			if rec.Code != want {
				t.Errorf("%s %s: %d %s, want %d", mode, path, rec.Code, rec.Body, want)
			}
			if up.count() != 1 {
				t.Errorf("%s %s: the cloud saw %d attempts, want 1", mode, path, up.count())
			}
		}
	}
}

// The key reaches the cloud, but Go's own transport must not see it: it repeats, unseen, a request
// that carries one when a kept-alive connection breaks after the request was written, which would
// repeat a card charge that has no body (and hide that an attempt of a keyed write was written).
func TestTheKeyReachesTheCloudButGoDoesNotRepeatARequestWithItByItself(t *testing.T) {
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{}`)
	})
	p := newProxy(up.srv.URL)
	req := httptest.NewRequest("POST", "/api/v1/payments/1/check-terminal", nil)
	req.Header.Set("Idempotency-Key", "k-4")
	req.Header.Set("X-Idempotency-Key", "k-4b")
	req.Header.Set("X-Terminal-Id", "t-1")
	if rec := doReq(p, req); rec.Code != 200 {
		t.Fatalf("%d", rec.Code)
	}
	got, _ := up.seen()
	if got.Header.Get("Idempotency-Key") != "k-4" || got.Header.Get("X-Idempotency-Key") != "k-4b" || got.Header.Get("X-Terminal-Id") != "t-1" {
		t.Errorf("the cloud saw %v", got.Header)
	}
	rec := doReq(p, keyed("POST", "/api/v1/orders", "k-5", `{}`))
	if got, _ = up.seen(); rec.Code != 200 || got.Header.Get("Idempotency-Key") != "k-5" {
		t.Errorf("%d, the cloud saw %v", rec.Code, got.Header)
	}

	// The case it is for: a kept-alive connection that breaks after a request that was written.
	for _, c := range []struct {
		name, method, path, body string
	}{
		{"a charge with no body", "POST", "/api/v1/payments/1/process", ""},
		{"a charge with a body", "POST", "/api/v1/payments/1/process", `{"a":1}`},
		{"a keyed write with no body", "POST", "/api/v1/orders/o1/submit", ""},
		{"a keyed write with a body", "POST", "/api/v1/orders", `{"a":1}`},
	} {
		var hits int
		var mu sync.Mutex
		up2 := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
			mu.Lock()
			hits++
			n := hits
			mu.Unlock()
			if n == 1 {
				w.Header().Set("Content-Type", "application/json")
				io.WriteString(w, `{}`) // warms the connection
				return
			}
			dropConn(w)
		})
		p2 := newProxy(up2.srv.URL)
		// One attempt of the agent's own: the next tick is an hour away, past the window. So the cloud
		// sees the warm-up and one request, unless Go's transport repeats it by itself.
		p2.Retry = Retry{Every: time.Hour, Window: time.Millisecond, Grace: 5 * time.Second}
		if rec := doReq(p2, httptest.NewRequest("GET", "/api/v1/orders", nil)); rec.Code != 200 {
			t.Fatalf("%s: warm-up: %d", c.name, rec.Code)
		}
		req := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
		req.Header.Set("Idempotency-Key", "k-6")
		rec := doReq(p2, req)
		mu.Lock()
		if rec.Code != 504 || hits != 2 {
			t.Errorf("%s: %d after %d requests to the cloud, want 504 after 2 (the warm-up and the agent's one attempt)", c.name, rec.Code, hits)
		}
		mu.Unlock()
	}
}

// What the page is told when a keyed write runs out of attempts (§19.10): 504 CLOUD_NO_ANSWER if any
// attempt was written and not answered, else 502 CLOUD_UNREACHABLE.
func TestAKeyedWriteThatRunsOutOfAttemptsEnds504IfAnyWasWrittenAndUnansweredElse502(t *testing.T) {
	for _, c := range []struct {
		name     string
		fail     func(n int, w http.ResponseWriter, r *http.Request)
		wantCode int
		wantBody string
		attempts int // at least
	}{
		{"every attempt not sent", func(n int, w http.ResponseWriter, r *http.Request) { gatewayDown(w) }, 502, "CLOUD_UNREACHABLE", 3},
		{"every attempt written, none answered", func(n int, w http.ResponseWriter, r *http.Request) { dropConn(w) }, 504, "CLOUD_NO_ANSWER", 3},
		{"the first written and dropped, the rest not sent", func(n int, w http.ResponseWriter, r *http.Request) {
			if n == 1 {
				dropConn(w)
				return
			}
			gatewayDown(w)
		}, 504, "CLOUD_NO_ANSWER", 3},
		{"the first not sent, a later one written and dropped", func(n int, w http.ResponseWriter, r *http.Request) {
			if n == 3 {
				dropConn(w)
				return
			}
			gatewayDown(w)
		}, 504, "CLOUD_NO_ANSWER", 3},
		{"the gateway's 504 counts as written", func(n int, w http.ResponseWriter, r *http.Request) {
			if n == 2 {
				w.Header().Set("Content-Type", "text/html")
				w.WriteHeader(504)
				return
			}
			gatewayDown(w)
		}, 504, "CLOUD_NO_ANSWER", 3},
	} {
		var up *upstream
		up = newUpstream(t, func(w http.ResponseWriter, r *http.Request) { c.fail(up.count(), w, r) })
		p := newProxy(up.srv.URL)
		// A window of 400 ms at 20 ms: room for the third attempt however busy the machine is.
		p.Retry = Retry{Every: 20 * time.Millisecond, Window: 400 * time.Millisecond, Grace: 5 * time.Second}
		rec := doReq(p, keyed("POST", "/api/v1/orders", "k-7", `{"a":1}`))
		if rec.Code != c.wantCode || problemOf(t, rec)["code"] != c.wantBody {
			t.Errorf("%s: %d %s, want %d %s", c.name, rec.Code, rec.Body, c.wantCode, c.wantBody)
		}
		if up.count() < c.attempts {
			t.Errorf("%s: only %d attempts, want at least %d", c.name, up.count(), c.attempts)
		}
	}

	// Nothing listening at all: not sent, every time.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close()
	rec := doReq(newProxy("http://"+addr), keyed("POST", "/api/v1/orders", "k-8", `{"a":1}`))
	if rec.Code != 502 || problemOf(t, rec)["code"] != "CLOUD_UNREACHABLE" {
		t.Errorf("dead cloud: %d %s", rec.Code, rec.Body)
	}
}

// A keyed write is held while the cloud is down and answered when it returns inside the window: the
// page never sees the failure, and the cloud got the request, with its key and body, once it was back.
func TestAKeyedWriteIsHeldAndAnsweredWhenTheCloudReturnsInsideTheWindow(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := ln.Addr().String()
	ln.Close()

	p := newProxy("http://" + addr)
	p.Retry = Retry{Every: 30 * time.Millisecond, Window: 2 * time.Second, Grace: time.Second}
	var mu sync.Mutex
	var seenKey, seenBody string
	started := make(chan *httptest.Server, 1)
	go func() {
		time.Sleep(250 * time.Millisecond)
		l, err := net.Listen("tcp", addr)
		if err != nil {
			started <- nil
			return
		}
		srv := &httptest.Server{Listener: l, Config: &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			b, _ := io.ReadAll(r.Body)
			mu.Lock()
			seenKey, seenBody = r.Header.Get("Idempotency-Key"), string(b)
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			io.WriteString(w, `{"placed":true}`)
		})}}
		srv.Start()
		started <- srv
	}()

	begin := time.Now()
	rec := doReq(p, keyed("POST", "/api/v1/orders/o1/submit", "k-9", `{"quoteVersion":"3"}`))
	took := time.Since(begin)
	if srv := <-started; srv != nil {
		defer srv.Close()
	}
	if rec.Code != 201 || rec.Body.String() != `{"placed":true}` {
		t.Fatalf("answer: %d %s", rec.Code, rec.Body)
	}
	if took < 200*time.Millisecond || took > 10*time.Second {
		t.Errorf("answered after %v, want about the 250 ms the cloud was down", took)
	}
	mu.Lock()
	defer mu.Unlock()
	if seenKey != "k-9" || seenBody != `{"quoteVersion":"3"}` {
		t.Errorf("the cloud saw key %q and body %q", seenKey, seenBody)
	}
}

// The application's own answers to a keyed write are answers, not failures: 409 for a key still in
// progress or used with another body, a 500, a 4xx, a 503 in JSON. Once, and passed on as they are.
func TestAKeyedWriteTheApplicationAnswersIsNotRetried(t *testing.T) {
	for _, c := range []struct {
		status int
		body   string
	}{
		{409, `{"code":"IDEMPOTENCY_IN_PROGRESS"}`},
		{409, `{"code":"IDEMPOTENCY_CONFLICT"}`},
		{400, `{"code":"VALIDATION_FAILED"}`},
		{500, `{"code":"INTERNAL"}`},
		{503, `{"code":"FROM_THE_APP"}`},
	} {
		up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(c.status)
			io.WriteString(w, c.body)
		})
		rec := doReq(newProxy(up.srv.URL), keyed("POST", "/api/v1/orders", "k-10", `{}`))
		if rec.Code != c.status || rec.Body.String() != c.body || up.count() != 1 {
			t.Errorf("%d: %d %s after %d attempts", c.status, rec.Code, rec.Body, up.count())
		}
	}
}

// A page that goes away ends the retries of a keyed write at once, as it does for a read.
func TestRetriesOfAKeyedWriteStopWhenThePageGoesAway(t *testing.T) {
	up := newUpstream(t, func(w http.ResponseWriter, r *http.Request) { gatewayDown(w) })
	p := newProxy(up.srv.URL)
	p.Retry = Retry{Every: 20 * time.Millisecond, Window: time.Minute, Grace: time.Minute}
	done := make(chan struct{})
	front := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.ServeHTTP(w, r)
		close(done)
	}))
	defer front.Close()

	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, "POST", front.URL+"/api/v1/orders", strings.NewReader(`{"a":1}`))
	req.Header.Set("Idempotency-Key", "k-11")
	go func() {
		time.Sleep(150 * time.Millisecond)
		cancel()
	}()
	if resp, err := http.DefaultClient.Do(req); err == nil {
		resp.Body.Close()
		t.Fatal("the page got an answer")
	}
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("the proxy was still at it 15 s after the page went away")
	}
	seen := up.count()
	time.Sleep(150 * time.Millisecond)
	if after := up.count(); after != seen || seen < 1 {
		t.Errorf("%d attempts, then %d: want at least 1 and none after the page left", seen, after)
	}
}

// retryable is the one switch: this is its whole table.
func TestRetryableTable(t *testing.T) {
	p := newProxy("http://example.invalid")
	for _, c := range []struct {
		method, path, key string
		want              bool
	}{
		{"GET", "/api/v1/orders", "", true},
		{"HEAD", "/api/v1/orders", "", true},
		{"GET", "/api/v1/live/stream", "", false},
		{"GET", "/api/v1/live/stream", "k", false},
		{"POST", "/api/v1/orders", "", false},
		{"POST", "/api/v1/orders", "k", true},
		{"POST", "/api/v1/orders/o1/submit", "k", true},
		{"PATCH", "/api/v1/orders/o1", "k", true},
		{"PUT", "/api/v1/orders/o1", "k", true},
		{"DELETE", "/api/v1/orders/o1", "k", true},
		{"POST", "/api/v1/payments", "k", true},
		{"POST", "/api/v1/payments", "", false},
		{"POST", "/api/v1/payments/p1/void", "k", true},
		{"POST", "/api/v1/payments/p1/process", "k", false},
		{"POST", "/api/v1/payments/p1/check-terminal", "k", false},
		{"POST", "/api/v1/payments/p1/correct", "k", false},
		{"POST", "/api/v1/payments/p1/resolve-terminal", "k", false},
		{"POST", "/api/v1/payments/p1/process", "", false},
		// Other routes with a similar last segment are not charge routes.
		{"POST", "/api/v1/orders/process", "k", true},
		{"POST", "/api/v1/orders/p1/process", "k", true},
		{"POST", "/api/v1/payments/process", "k", true},
		{"POST", "/api/v1/payments/p1/process/x", "k", true},
	} {
		req := httptest.NewRequest(c.method, c.path, nil)
		if c.key != "" {
			req.Header.Set("Idempotency-Key", c.key)
		}
		if got := p.retryable(req); got != c.want {
			t.Errorf("%s %s key %q: retryable = %v, want %v", c.method, c.path, c.key, got, c.want)
		}
	}
}
