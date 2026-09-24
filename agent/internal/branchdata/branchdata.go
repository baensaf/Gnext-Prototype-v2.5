// Package branchdata keeps the branch snapshot: what the branch sells and at what price, so it
// can go on selling while the cloud is out of reach (§12.2, §12.3).
package branchdata

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand/v2"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// PullInterval is how often the snapshot is checked while nothing announces a change (§12.2).
const PullInterval = 15 * time.Minute

const (
	currentName  = "snapshot.json"
	previousName = "snapshot.prev.json"
)

// Fetcher gets the snapshot from the cloud; cloud.Client provides it. It returns
// cloud.ErrNotModified (matched through NotModified) when held is current.
type Fetcher interface {
	Snapshot(ctx context.Context, held string) (body []byte, version string, err error)
}

// Status is what the agent reports about its copy (§12.7) and shows on the settings page.
type Status struct {
	DataVersion string     `json:"data_version,omitempty"`
	PulledAt    *time.Time `json:"data_pulled_at,omitempty"`
	LastError   string     `json:"last_error,omitempty"`
}

// Keeper holds the snapshot on disk and keeps it current.
type Keeper struct {
	Dir         string
	Fetch       Fetcher
	NotModified error // the Fetcher's "not modified" error
	Log         *slog.Logger
	// Staff, when set, is pulled with every snapshot pull (§13.3).
	Staff *Staff

	// Timings, overridable in tests.
	Interval   time.Duration
	BackoffMax time.Duration

	trigger chan struct{}
	once    sync.Once

	mu     sync.Mutex
	status Status
}

func (k *Keeper) init() {
	k.once.Do(func() {
		k.trigger = make(chan struct{}, 1)
		if k.Interval == 0 {
			k.Interval = PullInterval
		}
		if k.BackoffMax == 0 {
			k.BackoffMax = 60 * time.Second
		}
		if k.Log == nil {
			k.Log = slog.Default()
		}
		if v, at, err := k.stored(); err == nil {
			k.status.DataVersion, k.status.PulledAt = v, &at
		}
	})
}

// Trigger asks for a pull now: after a welcome, or on data.changed.
func (k *Keeper) Trigger() {
	k.init()
	select {
	case k.trigger <- struct{}{}:
	default:
	}
}

// Status returns the version held and when it was last confirmed current.
func (k *Keeper) Status() Status {
	k.init()
	k.mu.Lock()
	defer k.mu.Unlock()
	return k.status
}

// Load returns the snapshot held, falling back to the previous one if the current file is
// missing or damaged. It returns os.ErrNotExist when there is none.
func (k *Keeper) Load() ([]byte, error) {
	for _, name := range []string{currentName, previousName} {
		b, err := os.ReadFile(filepath.Join(k.Dir, name))
		if err == nil && versionOf(b) != "" {
			return b, nil
		}
	}
	return nil, os.ErrNotExist
}

// Run pulls on Trigger and every Interval until ctx ends. A failed pull is retried with backoff
// until it works; the copy already held stays in use meanwhile.
func (k *Keeper) Run(ctx context.Context) {
	k.init()
	timer := time.NewTimer(k.Interval)
	defer timer.Stop()
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return
		case <-k.trigger:
		case <-timer.C:
		}
		err := k.Pull(ctx)
		if k.Staff != nil {
			if serr := k.Staff.Pull(ctx); serr != nil && ctx.Err() == nil {
				k.Log.Warn("staff list pull failed", "err", serr)
				err = errors.Join(err, serr)
			}
		}
		next := k.Interval
		if err != nil && ctx.Err() == nil {
			next = time.Duration(float64(backoff) * (0.8 + 0.4*rand.Float64()))
			backoff = min(backoff*2, k.BackoffMax)
			k.Log.Warn("branch snapshot pull failed", "err", err, "retry_in", next.Round(time.Millisecond))
		} else {
			backoff = time.Second
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(next)
	}
}

// Pull fetches the snapshot once and stores it if it changed.
func (k *Keeper) Pull(ctx context.Context) error {
	k.init()
	held := k.Status().DataVersion
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	body, version, err := k.Fetch.Snapshot(ctx, held)
	now := time.Now()
	switch {
	case err != nil && k.NotModified != nil && errors.Is(err, k.NotModified):
		k.setStatus(held, &now, "")
		return nil
	case err != nil:
		k.mu.Lock()
		k.status.LastError = err.Error()
		k.mu.Unlock()
		return err
	}
	if err := k.save(body); err != nil {
		k.mu.Lock()
		k.status.LastError = err.Error()
		k.mu.Unlock()
		return err
	}
	if version != held {
		k.Log.Info("branch snapshot updated", "data_version", version)
	}
	k.setStatus(version, &now, "")
	return nil
}

func (k *Keeper) setStatus(version string, at *time.Time, lastError string) {
	k.mu.Lock()
	k.status = Status{DataVersion: version, PulledAt: at, LastError: lastError}
	k.mu.Unlock()
}

// save writes the new snapshot beside the current one and swaps them, keeping the old one as
// the previous copy. A crash at any point leaves at least one whole snapshot to Load.
func (k *Keeper) save(body []byte) error {
	if err := os.MkdirAll(k.Dir, 0o700); err != nil {
		return err
	}
	cur := filepath.Join(k.Dir, currentName)
	prev := filepath.Join(k.Dir, previousName)
	tmp := cur + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(body); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if _, err := os.Stat(cur); err == nil {
		if err := os.Rename(cur, prev); err != nil {
			return err
		}
	}
	return os.Rename(tmp, cur)
}

// stored reads the version of the snapshot on disk, and when it was written.
func (k *Keeper) stored() (string, time.Time, error) {
	for _, name := range []string{currentName, previousName} {
		path := filepath.Join(k.Dir, name)
		b, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		if v := versionOf(b); v != "" {
			info, err := os.Stat(path)
			if err != nil {
				return "", time.Time{}, err
			}
			return v, info.ModTime(), nil
		}
	}
	return "", time.Time{}, os.ErrNotExist
}

func versionOf(b []byte) string {
	var head struct {
		DataVersion string `json:"data_version"`
	}
	if json.Unmarshal(b, &head) != nil {
		return ""
	}
	return head.DataVersion
}
