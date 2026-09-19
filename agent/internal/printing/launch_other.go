//go:build !windows

package printing

import "context"

func launchBrowser(exe, profileDir string) (context.Context, context.CancelFunc, error) {
	return execBrowser(exe, profileDir)
}
