package store

import (
	"errors"
	"os"
	"path/filepath"
)

// ErrLocked means another agent already holds the data folder.
var ErrLocked = errors.New("another gnext-agent is already running with this data folder")

func LockPath() string { return filepath.Join(Home(), "agent.lock") }

// Lock takes the data folder for this process, so two agents never share one identity and
// journal. The OS drops the lock when the process exits, even after a crash.
func Lock() (release func(), err error) {
	f, err := os.OpenFile(LockPath(), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := lockFile(f); err != nil {
		f.Close()
		return nil, err
	}
	return func() { f.Close() }, nil
}
