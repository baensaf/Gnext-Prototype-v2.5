//go:build !windows

package payment

import "os/exec"

func hideWindow(*exec.Cmd) {}
