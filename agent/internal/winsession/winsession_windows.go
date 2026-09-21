//go:build windows

package winsession

import (
	"errors"
	"fmt"
	"strings"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ErrNoUser means nobody is signed in to that session.
var ErrNoUser = errors.New("no one is signed in to Windows")

// Console is the session of the user at the PC's own screen and keyboard.
func Console() uint32 { return windows.WTSGetActiveConsoleSessionId() }

// Active lists the sessions with a user signed in: the console and remote desktops.
func Active() []uint32 {
	var infos *windows.WTS_SESSION_INFO
	var n uint32
	if err := windows.WTSEnumerateSessions(0, 0, 1, &infos, &n); err != nil {
		return nil
	}
	defer windows.WTSFreeMemory(uintptr(unsafe.Pointer(infos)))
	var out []uint32
	for _, s := range unsafe.Slice(infos, n) {
		if s.State == windows.WTSActive && s.SessionID != 0 {
			out = append(out, s.SessionID)
		}
	}
	return out
}

// User returns the token and environment of the user signed in to a session. The caller closes
// the token. Only a SYSTEM process may ask.
func User(session uint32) (windows.Token, []string, error) {
	var token windows.Token
	if session == 0xFFFFFFFF || windows.WTSQueryUserToken(session, &token) != nil {
		return 0, nil, ErrNoUser
	}
	env, err := token.Environ(false)
	if err != nil {
		token.Close()
		return 0, nil, fmt.Errorf("read the signed-in user's environment: %w", err)
	}
	return token, env, nil
}

// Start runs argv as the user signed in to a session, without a console window and outside
// the caller's job, so it outlives the service. It does not wait for the process.
func Start(session uint32, argv []string, dir string) error {
	token, env, err := User(session)
	if err != nil {
		return err
	}
	defer token.Close()
	si := windows.StartupInfo{Desktop: windows.StringToUTF16Ptr(`winsta0\default`)}
	si.Cb = uint32(unsafe.Sizeof(si))
	var pi windows.ProcessInformation
	if err := windows.CreateProcessAsUser(token, nil, windows.StringToUTF16Ptr(windows.ComposeCommandLine(argv)), nil, nil, false,
		windows.CREATE_UNICODE_ENVIRONMENT|windows.CREATE_NO_WINDOW|windows.CREATE_BREAKAWAY_FROM_JOB,
		EnvBlock(env), windows.StringToUTF16Ptr(dir), &si, &pi); err != nil {
		return fmt.Errorf("start in session %d: %w", session, err)
	}
	windows.CloseHandle(pi.Thread)
	windows.CloseHandle(pi.Process)
	return nil
}

// LookupEnv finds key in env, ignoring case as Windows does.
func LookupEnv(env []string, key string) string {
	for _, e := range env {
		if k, v, ok := strings.Cut(e, "="); ok && strings.EqualFold(k, key) {
			return v
		}
	}
	return ""
}

// EnvBlock encodes env as the double-NUL-terminated UTF-16 block CreateProcess takes.
func EnvBlock(env []string) *uint16 {
	var b []uint16
	for _, e := range env {
		b = append(b, utf16.Encode([]rune(e))...)
		b = append(b, 0)
	}
	b = append(b, 0)
	return &b[0]
}
