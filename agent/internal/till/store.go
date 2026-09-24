package till

import (
	"encoding/json"
	"errors"
	"strconv"
	"time"

	bolt "go.etcd.io/bbolt"
)

var (
	bucketOrders = []byte("orders")
	bucketCalls  = []byte("call-counts")
)

// Store keeps the till's orders on disk (bbolt), so an open order survives a restart (§13.6),
// and the POS call count it has handed out per business date.
type Store struct {
	db *bolt.DB
}

// OpenStore opens the order file. The agent process owns it for as long as it runs.
func OpenStore(path string) (*Store, error) {
	db, err := bolt.Open(path, 0o600, &bolt.Options{Timeout: 5 * time.Second})
	if err != nil {
		return nil, err
	}
	if err := db.Update(func(tx *bolt.Tx) error {
		for _, b := range [][]byte{bucketOrders, bucketCalls} {
			if _, err := tx.CreateBucketIfNotExists(b); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		db.Close()
		return nil, err
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

var errNoOrder = errors.New("no such order")

func (s *Store) put(o *Order) error {
	raw, err := json.Marshal(o)
	if err != nil {
		return err
	}
	return s.db.Update(func(tx *bolt.Tx) error { return tx.Bucket(bucketOrders).Put([]byte(o.ID), raw) })
}

func (s *Store) get(id string) (*Order, error) {
	var o *Order
	err := s.db.View(func(tx *bolt.Tx) error {
		raw := tx.Bucket(bucketOrders).Get([]byte(id))
		if raw == nil {
			return errNoOrder
		}
		o = &Order{}
		return json.Unmarshal(raw, o)
	})
	return o, err
}

func (s *Store) delete(id string) error {
	return s.db.Update(func(tx *bolt.Tx) error { return tx.Bucket(bucketOrders).Delete([]byte(id)) })
}

// all returns every order held, oldest first.
func (s *Store) all() ([]*Order, error) {
	var out []*Order
	err := s.db.View(func(tx *bolt.Tx) error {
		return tx.Bucket(bucketOrders).ForEach(func(_, v []byte) error {
			o := &Order{}
			if json.Unmarshal(v, o) == nil {
				out = append(out, o)
			}
			return nil
		})
	})
	sortOrders(out)
	return out, err
}

// nextCall draws the next POS count for a business date: one more than the highest of what the
// till drew before and `floor`, what the cloud is known to have drawn (§13.9).
func (s *Store) nextCall(date string, floor int) (int, error) {
	var n int
	err := s.db.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket(bucketCalls)
		held, _ := strconv.Atoi(string(b.Get([]byte(date))))
		n = max(held, floor) + 1
		return b.Put([]byte(date), []byte(strconv.Itoa(n)))
	})
	return n, err
}
