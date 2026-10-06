package store

import (
	"os"
	"path/filepath"
)

// legacyOfflineData is what agents 1.x kept for the offline till: the branch snapshot and staff
// list, the offline order book, the till's choice, orders and paired devices, and the call
// count. Agent 2.0.0 removed the offline till (agent-protocol §19.2) and nothing reads these.
var legacyOfflineData = []string{
	"branch-data",
	"offline-orders.db",
	"till.json",
	"till-orders.db",
	"till-devices.json",
	"call-numbers.json",
}

// RemoveLegacyOfflineData deletes the files of the removed offline till from the data folder,
// once, at service start (§19.2), and returns what it removed. A file already gone is not an
// error; one that cannot be removed is left and reported in failed, so the caller can log it.
// `devices.json` (the last printer and terminal config) is not on the list and stays.
func RemoveLegacyOfflineData() (removed []string, failed map[string]error) {
	home := Home()
	for _, name := range legacyOfflineData {
		// A half-written file from an interrupted save carries the suffix writeJSON uses.
		for _, n := range []string{name, name + ".tmp"} {
			path := filepath.Join(home, n)
			if _, err := os.Lstat(path); err != nil {
				continue
			}
			if err := os.RemoveAll(path); err != nil {
				if failed == nil {
					failed = map[string]error{}
				}
				failed[n] = err
				continue
			}
			removed = append(removed, n)
		}
	}
	return removed, failed
}
