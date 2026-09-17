//go:build !windows

package cloud

import (
	"os"
	"runtime"
)

func ThisMachine() Machine {
	h, _ := os.Hostname()
	return Machine{Hostname: h, OS: runtime.GOOS, MachineID: "dev"}
}
