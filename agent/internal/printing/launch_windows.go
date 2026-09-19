//go:build windows

package printing

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf16"
	"unsafe"

	"github.com/chromedp/chromedp"
	"golang.org/x/sys/windows"
)

func launchBrowser(exe, profileDir string) (context.Context, context.CancelFunc, error) {
	if !runningAsSystem() {
		return execBrowser(exe, profileDir)
	}
	return launchInUserSession(exe)
}

func runningAsSystem() bool {
	u, err := windows.GetCurrentProcessToken().GetTokenUser()
	return err == nil && u.User.Sid.IsWellKnown(windows.WinLocalSystemSid)
}

// launchInUserSession starts headless Edge as the user signed in at the console and connects
// to it over its DevTools port. The browser stays in the agent's job object, so it still ends
// when the agent does.
func launchInUserSession(exe string) (context.Context, context.CancelFunc, error) {
	session := windows.WTSGetActiveConsoleSessionId()
	var token windows.Token
	if session == 0xFFFFFFFF || windows.WTSQueryUserToken(session, &token) != nil {
		return nil, nil, errors.New("no one is signed in to Windows; tickets are drawn in the signed-in user's session")
	}
	defer token.Close()

	env, err := token.Environ(false)
	if err != nil {
		return nil, nil, fmt.Errorf("read the signed-in user's environment: %w", err)
	}
	local := lookupEnv(env, "LOCALAPPDATA")
	if local == "" {
		home, err := token.GetUserProfileDirectory()
		if err != nil {
			return nil, nil, fmt.Errorf("find the signed-in user's profile: %w", err)
		}
		local = filepath.Join(home, "AppData", "Local")
	}
	dir := filepath.Join(local, "Gnext", "agent-browser")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, nil, err
	}
	portFile := filepath.Join(dir, "DevToolsActivePort")
	os.Remove(portFile)

	cmdLine := windows.ComposeCommandLine([]string{exe,
		"--headless", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
		"--disable-sync", "--disable-background-networking", "--disable-default-apps",
		"--disable-breakpad", "--mute-audio", "--hide-scrollbars", "--force-color-profile=srgb",
		"--remote-debugging-port=0", "--user-data-dir=" + dir, "about:blank"})
	si := windows.StartupInfo{
		Desktop:    windows.StringToUTF16Ptr(`winsta0\default`),
		Flags:      windows.STARTF_USESHOWWINDOW,
		ShowWindow: windows.SW_HIDE,
	}
	si.Cb = uint32(unsafe.Sizeof(si))
	var pi windows.ProcessInformation
	if err := windows.CreateProcessAsUser(token, nil, windows.StringToUTF16Ptr(cmdLine), nil, nil, false,
		windows.CREATE_UNICODE_ENVIRONMENT|windows.CREATE_NO_WINDOW, envBlock(env),
		windows.StringToUTF16Ptr(dir), &si, &pi); err != nil {
		return nil, nil, fmt.Errorf("start in the signed-in user's session: %w", err)
	}
	windows.CloseHandle(pi.Thread)
	kill := func() {
		windows.TerminateProcess(pi.Process, 1)
		windows.CloseHandle(pi.Process)
	}

	wsURL, err := waitForDevTools(pi.Process, portFile, 20*time.Second)
	if err != nil {
		kill()
		return nil, nil, err
	}
	alloc, cancelAlloc := chromedp.NewRemoteAllocator(context.Background(), wsURL, chromedp.NoModifyURL)
	return alloc, func() { cancelAlloc(); kill() }, nil
}

// waitForDevTools reads the browser's DevTools address from the file it writes on startup.
func waitForDevTools(proc windows.Handle, portFile string, timeout time.Duration) (string, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if b, err := os.ReadFile(portFile); err == nil {
			if lines := strings.Split(strings.TrimSpace(string(b)), "\n"); len(lines) == 2 {
				return "ws://127.0.0.1:" + strings.TrimSpace(lines[0]) + strings.TrimSpace(lines[1]), nil
			}
		}
		if ev, _ := windows.WaitForSingleObject(proc, 100); ev == windows.WAIT_OBJECT_0 {
			var code uint32
			windows.GetExitCodeProcess(proc, &code)
			return "", fmt.Errorf("browser exited with code %d before it was ready", code)
		}
	}
	return "", errors.New("browser did not start within 20 seconds")
}

func lookupEnv(env []string, key string) string {
	for _, e := range env {
		if k, v, ok := strings.Cut(e, "="); ok && strings.EqualFold(k, key) {
			return v
		}
	}
	return ""
}

// envBlock encodes env as the double-NUL-terminated UTF-16 block CreateProcess takes.
func envBlock(env []string) *uint16 {
	var b []uint16
	for _, e := range env {
		b = append(b, utf16.Encode([]rune(e))...)
		b = append(b, 0)
	}
	b = append(b, 0)
	return &b[0]
}
