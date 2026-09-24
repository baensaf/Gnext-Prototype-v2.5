package branchdata

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const staffName = "staff.dat"

// StaffUser is one person who may sign in at the offline till (§13.3).
type StaffUser struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
	PINHash     string `json:"pin_hash"`
}

// StaffList is the document the cloud serves.
type StaffList struct {
	StaffVersion string      `json:"staff_version"`
	GeneratedAt  string      `json:"generated_at"`
	Users        []StaffUser `json:"users"`
}

// StaffStatus is what the settings page shows about the list: never who is on it.
type StaffStatus struct {
	StaffVersion string     `json:"staff_version,omitempty"`
	PulledAt     *time.Time `json:"staff_pulled_at,omitempty"`
	Users        int        `json:"staff_users"`
	LastError    string     `json:"staff_last_error,omitempty"`
}

// Staff keeps the staff list on disk, sealed for this machine (DPAPI), since it holds PIN
// hashes. There is no previous copy: a list that cannot be read is fetched again, and offline the
// till then signs nobody in rather than trusting a stale file.
type Staff struct {
	Dir         string
	Fetch       func(ctx context.Context, held string) (body []byte, version string, err error)
	NotModified error
	Seal        func([]byte) ([]byte, error)
	Unseal      func([]byte) ([]byte, error)
	Log         *slog.Logger

	once   sync.Once
	mu     sync.Mutex
	status StaffStatus
}

func (s *Staff) init() {
	s.once.Do(func() {
		if s.Log == nil {
			s.Log = slog.Default()
		}
		if list, err := s.Load(); err == nil {
			if info, err := os.Stat(filepath.Join(s.Dir, staffName)); err == nil {
				at := info.ModTime()
				s.status.PulledAt = &at
			}
			s.status.StaffVersion, s.status.Users = list.StaffVersion, len(list.Users)
		}
	})
}

// Status returns the version held, when it was last confirmed, and how many users it has.
func (s *Staff) Status() StaffStatus {
	s.init()
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

// Load returns the list held. It returns os.ErrNotExist when there is none.
func (s *Staff) Load() (StaffList, error) {
	var list StaffList
	sealed, err := os.ReadFile(filepath.Join(s.Dir, staffName))
	if err != nil {
		return list, err
	}
	plain, err := s.Unseal(sealed)
	if err != nil {
		return list, err
	}
	if err := json.Unmarshal(plain, &list); err != nil {
		return list, err
	}
	if list.StaffVersion == "" {
		return list, errors.New("staff list without a staff_version")
	}
	return list, nil
}

// Pull fetches the list once and stores it if it changed.
func (s *Staff) Pull(ctx context.Context) error {
	s.init()
	held := s.Status().StaffVersion
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	body, version, err := s.Fetch(ctx, held)
	now := time.Now()
	switch {
	case err != nil && s.NotModified != nil && errors.Is(err, s.NotModified):
		s.mu.Lock()
		s.status.PulledAt, s.status.LastError = &now, ""
		s.mu.Unlock()
		return nil
	case err != nil:
		s.setError(err)
		return err
	}
	var list StaffList
	if err := json.Unmarshal(body, &list); err != nil {
		s.setError(err)
		return err
	}
	if err := s.save(body); err != nil {
		s.setError(err)
		return err
	}
	if version != held {
		s.Log.Info("staff list updated", "staff_version", version, "users", len(list.Users))
	}
	s.mu.Lock()
	s.status = StaffStatus{StaffVersion: version, PulledAt: &now, Users: len(list.Users)}
	s.mu.Unlock()
	return nil
}

func (s *Staff) setError(err error) {
	s.mu.Lock()
	s.status.LastError = err.Error()
	s.mu.Unlock()
}

// save seals the list and swaps it in whole; a crash leaves the old file or the new one.
func (s *Staff) save(body []byte) error {
	sealed, err := s.Seal(body)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return err
	}
	path := filepath.Join(s.Dir, staffName)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, sealed, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
