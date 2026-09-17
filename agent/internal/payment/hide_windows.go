//go:build windows

package payment

import (
	"os/exec"
	"syscall"
)

// hideWindow keeps the bridge from flashing a console window when the agent runs in a console.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}
