// Package offline keeps the orders the branch took while the cloud was out of reach, and
// uploads them once it is back (§12.4, §12.5). An order stays on disk until the cloud has
// answered for it, and for a week after, for reprints and support.
package offline

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"sort"
	"sync"
	"time"

	bolt "go.etcd.io/bbolt"
)

const (
	// BatchMax and BatchBytes bound one upload (§12.5).
	BatchMax   = 50
	BatchBytes = 1 << 20
	// Keep is how long an answered order stays on disk.
	Keep = 7 * 24 * time.Hour
)

// Order states on disk.
const (
	Pending  = "PENDING"  // waiting for upload
	Uploaded = "UPLOADED" // the cloud answered for it (accepted, duplicate or held)
	Rejected = "REJECTED" // the cloud refused it as malformed; kept for the logs
)

var bucketOrders = []byte("orders")

// Record is one offline order on disk.
type Record struct {
	ID          string          `json:"id"`
	PlacedAt    time.Time       `json:"placed_at"`
	Payload     json.RawMessage `json:"payload"`
	State       string          `json:"state"`
	AddedAt     time.Time       `json:"added_at"`
	AnsweredAt  time.Time       `json:"answered_at,omitempty"`
	Result      string          `json:"result,omitempty"` // ACCEPTED, DUPLICATE, HELD
	OrderNumber string          `json:"order_number,omitempty"`
	Flags       []string        `json:"flags,omitempty"`
	Error       string          `json:"error,omitempty"`
}

// Result is the cloud's answer for one order (§12.5).
type Result struct {
	ID          string   `json:"id"`
	Result      string   `json:"result"`
	OrderNumber string   `json:"order_number"`
	Flags       []string `json:"flags"`
}

// Uploader sends a batch; cloud.Client provides it.
type Uploader interface {
	UploadOrders(ctx context.Context, orders []json.RawMessage) ([]Result, error)
	// IsRefused reports a 400 for the whole batch (§12.5), so the outbox can split it.
	IsRefused(err error) bool
}

// Status is what the agent reports about its backlog (§12.7).
type Status struct {
	PendingOrders   int        `json:"pending_orders"`
	OldestPendingAt *time.Time `json:"oldest_pending_at"`
	LastUploadAt    *time.Time `json:"last_upload_at"`
	LastUploadError *string    `json:"last_upload_error"`
}

// Outbox holds offline orders and uploads them.
type Outbox struct {
	db  *bolt.DB
	Log *slog.Logger

	// Timings, overridable in tests.
	Retry      time.Duration // while orders wait and nothing else wakes the uploader
	BackoffMax time.Duration

	wake chan struct{}
	once sync.Once

	mu         sync.Mutex
	lastUpload *time.Time
	lastError  *string
}

// Open opens the outbox file.
func Open(path string) (*Outbox, error) {
	db, err := bolt.Open(path, 0o600, &bolt.Options{Timeout: 5 * time.Second})
	if err != nil {
		return nil, err
	}
	if err := db.Update(func(tx *bolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists(bucketOrders)
		return err
	}); err != nil {
		db.Close()
		return nil, err
	}
	return &Outbox{db: db}, nil
}

func (o *Outbox) Close() error { return o.db.Close() }

func (o *Outbox) init() {
	o.once.Do(func() {
		o.wake = make(chan struct{}, 1)
		if o.Retry == 0 {
			o.Retry = 30 * time.Second
		}
		if o.BackoffMax == 0 {
			o.BackoffMax = 60 * time.Second
		}
		if o.Log == nil {
			o.Log = slog.Default()
		}
	})
}

// ErrExists is returned by Add for an order id already held.
var ErrExists = errors.New("offline order already held")

// Add keeps an order whose offline life has ended (§12.4), for upload. The payload is the
// order as §12.4 describes it; its id and placed_at are read from it.
func (o *Outbox) Add(payload json.RawMessage) error {
	o.init()
	var head struct {
		ID       string `json:"id"`
		PlacedAt string `json:"placed_at"`
	}
	if err := json.Unmarshal(payload, &head); err != nil {
		return fmt.Errorf("offline order: %w", err)
	}
	placed, err := time.Parse(time.RFC3339Nano, head.PlacedAt)
	if head.ID == "" || err != nil {
		return errors.New("offline order needs an id and placed_at")
	}
	compact := &bytes.Buffer{}
	if err := json.Compact(compact, payload); err != nil {
		return err
	}
	err = o.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(bucketOrders)
		if b.Get([]byte(head.ID)) != nil {
			return ErrExists
		}
		return put(b, Record{ID: head.ID, PlacedAt: placed.UTC(), Payload: compact.Bytes(), State: Pending, AddedAt: time.Now().UTC()})
	})
	if err == nil {
		o.Trigger()
	}
	return err
}

// Trigger wakes the uploader: after a welcome, or when an order is added.
func (o *Outbox) Trigger() {
	o.init()
	select {
	case o.wake <- struct{}{}:
	default:
	}
}

// Get returns the record for an order id.
func (o *Outbox) Get(id string) (Record, bool, error) {
	var r Record
	var found bool
	err := o.db.View(func(tx *bolt.Tx) error {
		raw := tx.Bucket(bucketOrders).Get([]byte(id))
		if raw == nil {
			return nil
		}
		found = true
		return json.Unmarshal(raw, &r)
	})
	return r, found, err
}

// Status reports the backlog for heartbeats and the settings page.
func (o *Outbox) Status() Status {
	o.init()
	pending, _ := o.pending()
	s := Status{PendingOrders: len(pending)}
	if len(pending) > 0 {
		t := pending[0].PlacedAt
		s.OldestPendingAt = &t
	}
	o.mu.Lock()
	s.LastUploadAt, s.LastUploadError = o.lastUpload, o.lastError
	o.mu.Unlock()
	return s
}

// Run uploads through up whenever it is woken and orders wait, one batch at a time, until ctx
// ends. A failed upload is retried with backoff; the orders stay on disk meanwhile.
func (o *Outbox) Run(ctx context.Context, up Uploader) {
	o.init()
	o.Trigger()
	backoff := time.Second
	prune := time.NewTicker(6 * time.Hour)
	defer prune.Stop()
	_ = o.prune(time.Now().Add(-Keep))
	for {
		wait := o.Retry
		err := o.Flush(ctx, up)
		switch {
		case ctx.Err() != nil:
			return
		case err != nil:
			wait = time.Duration(float64(backoff) * (0.8 + 0.4*rand.Float64()))
			backoff = min(backoff*2, o.BackoffMax)
			o.Log.Warn("offline order upload failed", "err", err, "retry_in", wait.Round(time.Millisecond))
		default:
			backoff = time.Second
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-o.wake:
		case <-timer.C:
		case <-prune.C:
			_ = o.prune(time.Now().Add(-Keep))
		}
		timer.Stop()
	}
}

// Flush uploads every waiting order, oldest first, in batches.
func (o *Outbox) Flush(ctx context.Context, up Uploader) error {
	o.init()
	for {
		pending, err := o.pending()
		if err != nil || len(pending) == 0 {
			return err
		}
		done, err := o.send(ctx, up, batch(pending))
		if err != nil {
			return err
		}
		if done == 0 {
			return errors.New("the cloud answered for none of the orders sent")
		}
	}
}

// send uploads one batch and returns how many orders it settled. A batch the cloud refuses as
// malformed is split until the bad order is alone; that one is set aside, and the rest go up.
func (o *Outbox) send(ctx context.Context, up Uploader, recs []Record) (int, error) {
	payloads := make([]json.RawMessage, len(recs))
	for i, r := range recs {
		payloads[i] = r.Payload
	}
	callCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	results, err := up.UploadOrders(callCtx, payloads)
	cancel()
	now := time.Now().UTC()
	switch {
	case err != nil && up.IsRefused(err):
		if len(recs) == 1 {
			o.Log.Error("the cloud refused an offline order; kept for the logs", "order", recs[0].ID, "err", err)
			return 1, o.answer(recs[0].ID, func(r *Record) { r.State, r.AnsweredAt, r.Error = Rejected, now, err.Error() })
		}
		half := len(recs) / 2
		first, err := o.send(ctx, up, recs[:half])
		if err != nil {
			return first, err
		}
		second, err := o.send(ctx, up, recs[half:])
		return first + second, err
	case err != nil:
		msg := err.Error()
		o.mu.Lock()
		o.lastError = &msg
		o.mu.Unlock()
		return 0, err
	}
	o.mu.Lock()
	o.lastUpload, o.lastError = &now, nil
	o.mu.Unlock()
	answered := map[string]Result{}
	for _, res := range results {
		answered[res.ID] = res
	}
	done := 0
	for _, r := range recs {
		res, ok := answered[r.ID]
		if !ok {
			continue // not answered: it stays pending and goes in the next batch
		}
		done++
		if res.Result == "HELD" || len(res.Flags) > 0 {
			o.Log.Warn("offline order needs a look at head office", "order", r.ID, "result", res.Result, "flags", res.Flags)
		}
		if err := o.answer(r.ID, func(rec *Record) {
			rec.State, rec.AnsweredAt, rec.Result, rec.OrderNumber, rec.Flags = Uploaded, now, res.Result, res.OrderNumber, res.Flags
		}); err != nil {
			return done, err
		}
	}
	return done, nil
}

func (o *Outbox) answer(id string, fn func(*Record)) error {
	return o.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(bucketOrders)
		raw := b.Get([]byte(id))
		if raw == nil {
			return nil
		}
		var r Record
		if err := json.Unmarshal(raw, &r); err != nil {
			return err
		}
		fn(&r)
		return put(b, r)
	})
}

// pending returns the waiting orders, oldest placed first.
func (o *Outbox) pending() ([]Record, error) {
	var out []Record
	err := o.db.View(func(tx *bolt.Tx) error {
		return tx.Bucket(bucketOrders).ForEach(func(_, v []byte) error {
			var r Record
			if err := json.Unmarshal(v, &r); err != nil {
				return nil
			}
			if r.State == Pending {
				out = append(out, r)
			}
			return nil
		})
	})
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].PlacedAt.Equal(out[j].PlacedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].PlacedAt.Before(out[j].PlacedAt)
	})
	return out, err
}

// batch takes the oldest orders that fit one upload. A single order over the size limit still
// goes alone; the cloud refuses it and it is set aside.
func batch(pending []Record) []Record {
	size := 0
	for i, r := range pending {
		size += len(r.Payload) + 1
		if i == BatchMax || (i > 0 && size > BatchBytes) {
			return pending[:i]
		}
	}
	return pending
}

func (o *Outbox) prune(cutoff time.Time) error {
	return o.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(bucketOrders)
		var drop [][]byte
		_ = b.ForEach(func(k, v []byte) error {
			var r Record
			if json.Unmarshal(v, &r) == nil && r.State != Pending && !r.AnsweredAt.IsZero() && r.AnsweredAt.Before(cutoff) {
				drop = append(drop, append([]byte(nil), k...))
			}
			return nil
		})
		for _, k := range drop {
			if err := b.Delete(k); err != nil {
				return err
			}
		}
		return nil
	})
}

func put(b *bolt.Bucket, r Record) error {
	raw, err := json.Marshal(r)
	if err != nil {
		return err
	}
	return b.Put([]byte(r.ID), raw)
}
