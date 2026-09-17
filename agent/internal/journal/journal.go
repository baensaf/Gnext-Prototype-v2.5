// Package journal keeps every command and its result on disk (§4.6), so a restart in the
// middle of a job never runs it twice and results survive until the cloud acks them.
package journal

import (
	"encoding/json"
	"errors"
	"sort"
	"time"

	"gnext/agent/internal/protocol"

	bolt "go.etcd.io/bbolt"
)

// Command states.
const (
	Received = "RECEIVED"
	Running  = "RUNNING"
	Done     = "DONE"
)

var (
	bucketCommands = []byte("commands")
	bucketResults  = []byte("results") // result id → command id
)

type Entry struct {
	Command       protocol.Envelope  `json:"command"`
	ReceivedAt    time.Time          `json:"received_at"`
	State         string             `json:"state"`
	Result        *protocol.Envelope `json:"result,omitempty"`
	ResultAcked   bool               `json:"result_acked"`
	ResultAckedAt time.Time          `json:"result_acked_at,omitempty"`
}

type Journal struct{ db *bolt.DB }

func Open(path string) (*Journal, error) {
	db, err := bolt.Open(path, 0o600, &bolt.Options{Timeout: 5 * time.Second})
	if err != nil {
		return nil, err
	}
	err = db.Update(func(tx *bolt.Tx) error {
		for _, b := range [][]byte{bucketCommands, bucketResults} {
			if _, err := tx.CreateBucketIfNotExists(b); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		db.Close()
		return nil, err
	}
	return &Journal{db: db}, nil
}

func (j *Journal) Close() error { return j.db.Close() }

var ErrExists = errors.New("command already journalled")

// Add records a newly received command. It returns ErrExists, with the stored entry, for a
// command id seen before.
func (j *Journal) Add(cmd protocol.Envelope) (Entry, error) {
	var out Entry
	err := j.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(bucketCommands)
		if raw := b.Get([]byte(cmd.ID)); raw != nil {
			if err := json.Unmarshal(raw, &out); err != nil {
				return err
			}
			return ErrExists
		}
		out = Entry{Command: cmd, ReceivedAt: time.Now().UTC(), State: Received}
		return put(b, out)
	})
	return out, err
}

func (j *Journal) Get(cmdID string) (Entry, bool, error) {
	var out Entry
	found := false
	err := j.db.View(func(tx *bolt.Tx) error {
		raw := tx.Bucket(bucketCommands).Get([]byte(cmdID))
		if raw == nil {
			return nil
		}
		found = true
		return json.Unmarshal(raw, &out)
	})
	return out, found, err
}

// MarkRunning is called right before the agent touches the device.
func (j *Journal) MarkRunning(cmdID string) error {
	return j.modify(cmdID, func(e *Entry) { e.State = Running })
}

// SetResult stores the result and ends the command.
func (j *Journal) SetResult(cmdID string, result protocol.Envelope) error {
	return j.db.Update(func(tx *bolt.Tx) error {
		if err := modifyIn(tx, cmdID, func(e *Entry) { e.State = Done; e.Result = &result }); err != nil {
			return err
		}
		return tx.Bucket(bucketResults).Put([]byte(result.ID), []byte(cmdID))
	})
}

// AckResult marks a result as received by the cloud. Unknown ids are ignored.
func (j *Journal) AckResult(resultID string) error {
	return j.db.Update(func(tx *bolt.Tx) error {
		cmdID := tx.Bucket(bucketResults).Get([]byte(resultID))
		if cmdID == nil {
			return nil
		}
		return modifyIn(tx, string(cmdID), func(e *Entry) {
			if !e.ResultAcked {
				e.ResultAcked = true
				e.ResultAckedAt = time.Now().UTC()
			}
		})
	})
}

// UnackedResults returns results the cloud has not acked, oldest command first.
func (j *Journal) UnackedResults() ([]protocol.Envelope, error) {
	var out []protocol.Envelope
	err := j.each(func(e Entry) {
		if e.Result != nil && !e.ResultAcked {
			out = append(out, *e.Result)
		}
	})
	return out, err
}

// Unfinished returns commands that were acked but have no result yet.
func (j *Journal) Unfinished() ([]Entry, error) {
	var out []Entry
	err := j.each(func(e Entry) {
		if e.State != Done {
			out = append(out, e)
		}
	})
	return out, err
}

// Prune deletes entries whose result was acked before cutoff.
func (j *Journal) Prune(cutoff time.Time) error {
	return j.db.Update(func(tx *bolt.Tx) error {
		cmds, results := tx.Bucket(bucketCommands), tx.Bucket(bucketResults)
		var dead []Entry
		err := cmds.ForEach(func(_, v []byte) error {
			var e Entry
			if json.Unmarshal(v, &e) == nil && e.ResultAcked && e.ResultAckedAt.Before(cutoff) {
				dead = append(dead, e)
			}
			return nil
		})
		if err != nil {
			return err
		}
		for _, e := range dead {
			if err := cmds.Delete([]byte(e.Command.ID)); err != nil {
				return err
			}
			if e.Result != nil {
				if err := results.Delete([]byte(e.Result.ID)); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func (j *Journal) each(fn func(Entry)) error {
	var all []Entry
	err := j.db.View(func(tx *bolt.Tx) error {
		return tx.Bucket(bucketCommands).ForEach(func(_, v []byte) error {
			var e Entry
			if err := json.Unmarshal(v, &e); err != nil {
				return err
			}
			all = append(all, e)
			return nil
		})
	})
	if err != nil {
		return err
	}
	sortByReceived(all)
	for _, e := range all {
		fn(e)
	}
	return nil
}

func (j *Journal) modify(cmdID string, fn func(*Entry)) error {
	return j.db.Update(func(tx *bolt.Tx) error { return modifyIn(tx, cmdID, fn) })
}

func modifyIn(tx *bolt.Tx, cmdID string, fn func(*Entry)) error {
	b := tx.Bucket(bucketCommands)
	raw := b.Get([]byte(cmdID))
	if raw == nil {
		return errors.New("journal: unknown command " + cmdID)
	}
	var e Entry
	if err := json.Unmarshal(raw, &e); err != nil {
		return err
	}
	fn(&e)
	return put(b, e)
}

func put(b *bolt.Bucket, e Entry) error {
	raw, err := json.Marshal(e)
	if err != nil {
		return err
	}
	return b.Put([]byte(e.Command.ID), raw)
}

func sortByReceived(es []Entry) {
	sort.SliceStable(es, func(a, b int) bool { return es[a].ReceivedAt.Before(es[b].ReceivedAt) })
}
