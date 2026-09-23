package offline

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

var errRefused = errors.New("HTTP 400 INVALID_PAYLOAD")

// fakeCloud answers uploads: every order is accepted, except that a batch holding a "bad"
// order is refused whole, as the cloud does with a malformed batch.
type fakeCloud struct {
	mu      sync.Mutex
	fail    error
	silent  bool
	batches [][]string
}

func (f *fakeCloud) UploadOrders(_ context.Context, orders []json.RawMessage) ([]Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var ids []string
	for _, o := range orders {
		var head struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(o, &head)
		ids = append(ids, head.ID)
	}
	f.batches = append(f.batches, ids)
	if f.fail != nil {
		return nil, f.fail
	}
	for _, id := range ids {
		if strings.HasPrefix(id, "bad") {
			return nil, errRefused
		}
	}
	if f.silent {
		return nil, nil
	}
	out := make([]Result, len(ids))
	for i, id := range ids {
		out[i] = Result{ID: id, Result: "ACCEPTED", OrderNumber: "ORD-" + id, Flags: []string{}}
	}
	return out, nil
}

func (f *fakeCloud) IsRefused(err error) bool { return errors.Is(err, errRefused) }

func open(t *testing.T) *Outbox {
	t.Helper()
	o, err := Open(filepath.Join(t.TempDir(), "offline.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { o.Close() })
	o.Log = slog.New(slog.NewTextHandler(io.Discard, nil))
	o.Retry, o.BackoffMax = time.Hour, 20*time.Millisecond
	return o
}

func order(id string, placed time.Time) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"id":%q,"placed_at":%q,"state":"COMPLETED","lines":[]}`, id, placed.UTC().Format(time.RFC3339Nano)))
}

func TestUploadsOldestFirstInBatchesAndRemembersTheAnswer(t *testing.T) {
	o := open(t)
	base := time.Date(2026, 9, 24, 8, 0, 0, 0, time.UTC)
	// Added newest first; uploaded oldest first.
	for i := 59; i >= 0; i-- {
		if err := o.Add(order(fmt.Sprintf("o%02d", i), base.Add(time.Duration(i)*time.Minute))); err != nil {
			t.Fatal(err)
		}
	}
	if s := o.Status(); s.PendingOrders != 60 || !s.OldestPendingAt.Equal(base) {
		t.Fatalf("status before = %+v", s)
	}
	f := &fakeCloud{}
	if err := o.Flush(context.Background(), f); err != nil {
		t.Fatal(err)
	}
	if len(f.batches) != 2 || len(f.batches[0]) != BatchMax || len(f.batches[1]) != 10 {
		t.Fatalf("batches = %d (%d, …), want 50 then 10", len(f.batches), len(f.batches[0]))
	}
	if f.batches[0][0] != "o00" || f.batches[1][9] != "o59" {
		t.Fatalf("order = %s … %s, want oldest first", f.batches[0][0], f.batches[1][9])
	}
	r, found, err := o.Get("o07")
	if err != nil || !found || r.State != Uploaded || r.Result != "ACCEPTED" || r.OrderNumber != "ORD-o07" {
		t.Fatalf("record = %+v, %v, %v", r, found, err)
	}
	if s := o.Status(); s.PendingOrders != 0 || s.OldestPendingAt != nil || s.LastUploadAt == nil || s.LastUploadError != nil {
		t.Fatalf("status after = %+v", s)
	}
	// Nothing waits: nothing is sent.
	if err := o.Flush(context.Background(), f); err != nil || len(f.batches) != 2 {
		t.Fatalf("second flush sent %d batches, err %v", len(f.batches)-2, err)
	}
}

func TestARefusedBatchIsSplitAndOnlyTheBadOrderIsSetAside(t *testing.T) {
	o := open(t)
	base := time.Date(2026, 9, 24, 8, 0, 0, 0, time.UTC)
	for i, id := range []string{"a1", "a2", "bad3", "a4", "a5"} {
		if err := o.Add(order(id, base.Add(time.Duration(i)*time.Minute))); err != nil {
			t.Fatal(err)
		}
	}
	if err := o.Flush(context.Background(), &fakeCloud{}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"a1", "a2", "a4", "a5"} {
		if r, _, _ := o.Get(id); r.State != Uploaded {
			t.Fatalf("%s = %s, want uploaded", id, r.State)
		}
	}
	if r, _, _ := o.Get("bad3"); r.State != Rejected || r.Error == "" {
		t.Fatalf("bad3 = %+v, want rejected with the error", r)
	}
}

func TestAFailedUploadKeepsTheOrdersAndReportsTheError(t *testing.T) {
	o := open(t)
	if err := o.Add(order("o1", time.Now())); err != nil {
		t.Fatal(err)
	}
	f := &fakeCloud{fail: errors.New("dial tcp: no route to host")}
	if err := o.Flush(context.Background(), f); err == nil {
		t.Fatal("want an error")
	}
	s := o.Status()
	if s.PendingOrders != 1 || s.LastUploadError == nil || !strings.Contains(*s.LastUploadError, "no route") {
		t.Fatalf("status = %+v", s)
	}
	f.fail = nil
	if err := o.Flush(context.Background(), f); err != nil {
		t.Fatal(err)
	}
	if s := o.Status(); s.PendingOrders != 0 || s.LastUploadError != nil {
		t.Fatalf("status after the retry = %+v", s)
	}
}

func TestAnAnswerThatSettlesNothingIsAnError(t *testing.T) {
	o := open(t)
	if err := o.Add(order("o1", time.Now())); err != nil {
		t.Fatal(err)
	}
	if err := o.Flush(context.Background(), &fakeCloud{silent: true}); err == nil {
		t.Fatal("want an error when the cloud answers for none of the orders")
	}
	if r, _, _ := o.Get("o1"); r.State != Pending {
		t.Fatalf("o1 = %s, want still pending", r.State)
	}
}

func TestAddRefusesASecondOrderWithTheSameIDAndAnOrderWithoutOne(t *testing.T) {
	o := open(t)
	if err := o.Add(order("o1", time.Now())); err != nil {
		t.Fatal(err)
	}
	if err := o.Add(order("o1", time.Now())); !errors.Is(err, ErrExists) {
		t.Fatalf("second Add = %v, want ErrExists", err)
	}
	if err := o.Add(json.RawMessage(`{"placed_at":"2026-09-24T08:00:00Z"}`)); err == nil {
		t.Fatal("want an error for an order without an id")
	}
}

func TestRunUploadsWhenWokenAndRetriesAFailure(t *testing.T) {
	o := open(t)
	f := &fakeCloud{fail: errors.New("offline")}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go o.Run(ctx, f)

	if err := o.Add(order("o1", time.Now())); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		f.mu.Lock()
		n := len(f.batches)
		f.mu.Unlock()
		if n >= 3 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("uploads = %d, want retries after a failure", n)
		}
		time.Sleep(5 * time.Millisecond)
	}
	f.mu.Lock()
	f.fail = nil
	f.mu.Unlock()
	for o.Status().PendingOrders != 0 {
		if time.Now().After(deadline) {
			t.Fatal("the retry never uploaded the order")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestPruneDropsOnlyOldAnsweredOrders(t *testing.T) {
	o := open(t)
	for _, id := range []string{"old", "new", "waiting"} {
		if err := o.Add(order(id, time.Now())); err != nil {
			t.Fatal(err)
		}
	}
	long := time.Now().Add(-8 * 24 * time.Hour)
	_ = o.answer("old", func(r *Record) { r.State, r.AnsweredAt = Uploaded, long })
	_ = o.answer("new", func(r *Record) { r.State, r.AnsweredAt = Uploaded, time.Now() })
	if err := o.prune(time.Now().Add(-Keep)); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[string]bool{"old": false, "new": true, "waiting": true} {
		if _, found, _ := o.Get(id); found != want {
			t.Fatalf("%s kept = %v, want %v", id, found, want)
		}
	}
}
