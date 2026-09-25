//go:build windows

package main

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

// A window of the agent's own: the settings page, or the offline till. Each is one per user; a
// second start finds the first by its title and brings it to the front.
type windowSpec struct {
	title  string
	path   string // on the settings server
	mutex  string
	data   string // WebView2's folder, under %LOCALAPPDATA%\Gnext
	width  uint
	height uint
	// reopen: after an update the window closes and opens again from the new binary, so the
	// old one is not kept in use (§9). Not the till: its page holds the cart being rung up.
	reopen string
}

// windowTitle names the settings window.
const windowTitle = "Gnext Agent — عامل شعبه"

var (
	settingsWindow = windowSpec{title: windowTitle, mutex: `Local\GnextAgentWindow`, data: "agent-window", width: 1120, height: 780, reopen: "open"}
	// The till takes a larger window: it is the register the cashier works at all day.
	tillWindow = windowSpec{title: "صندوق آفلاین — Gnext", path: tillPath, mutex: `Local\GnextTillWindow`, data: "till-window", width: 1366, height: 860}
)

// appIconID is the icon resource go-winres puts in the exe (winres/winres.json).
const appIconID = 1

var (
	procFindWindowW         = user32.NewProc("FindWindowW")
	procShowWindow          = user32.NewProc("ShowWindow")
	procIsIconic            = user32.NewProc("IsIconic")
	procAllowSetForegroundW = user32.NewProc("AllowSetForegroundWindow")
)

// runWindow shows the settings page in its own window, drawn by WebView2 (the Edge engine
// that comes with Windows 10 and 11), so the agent opens like an app rather than a browser
// tab. One window per user: a second call brings the first to the front. Without WebView2 the
// page opens in the browser as before.
func runWindow() int { return showWindow(settingsWindow) }

// runTillWindow shows the offline till (§13.14) the same way, in a window of its own.
func runTillWindow() int { return showWindow(tillWindow) }

func showWindow(spec windowSpec) int {
	runtime.LockOSThread()
	base := "http://" + uiAddr()
	url := base + spec.path
	ensureTray()

	mutex, err := windows.CreateMutex(nil, false, windows.StringToUTF16Ptr(spec.mutex))
	if err != nil {
		if mutex != 0 {
			windows.CloseHandle(mutex)
		}
		raiseWindow(spec.title)
		return 0
	}
	release := sync.OnceFunc(func() { windows.CloseHandle(mutex) })
	defer release()

	data := filepath.Join(os.Getenv("LOCALAPPDATA"), "Gnext", spec.data)
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:  data,
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title: spec.title, Width: spec.width, Height: spec.height, IconId: appIconID, Center: true,
		},
	})
	if w == nil {
		if err := openBrowser(url); err != nil {
			return 1
		}
		return 0
	}
	destroy := sync.OnceFunc(w.Destroy)
	defer destroy()

	// Taken now: once an update has moved this binary aside, the path is the new one's.
	exe, _ := os.Executable()
	var updated atomic.Bool
	if spec.reopen != "" {
		started, _ := os.Stat(exe)
		go func() {
			for {
				time.Sleep(5 * time.Second)
				if st, err := fetchTrayStatus(); err == nil && st.Version != "" && st.Version != version && replaced(exe, started) {
					updated.Store(true)
					w.Dispatch(w.Terminate)
					return
				}
			}
		}()
	}

	if agentAnswers(base) {
		w.Navigate(url)
	} else {
		// The page would be the browser's own error; say what is wrong, and load the page
		// once the agent answers.
		w.SetHtml(waitingPage)
		go func() {
			for !agentAnswers(base) {
				time.Sleep(2 * time.Second)
			}
			w.Dispatch(func() { w.Navigate(url) })
		}()
	}
	w.Run()
	if updated.Load() {
		// Close first: the new window's process finds this one by its mutex and would only
		// bring it to the front.
		destroy()
		release()
		procAllowSetForegroundW.Call(^uintptr(0)) // ASFW_ANY
		_ = exec.Command(exe, spec.reopen).Start()
	}
	return 0
}

func agentAnswers(url string) bool {
	c := http.Client{Timeout: 2 * time.Second}
	resp, err := c.Get(url + "/api/status")
	if err != nil {
		return false
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// raiseWindow brings an open window of the agent's to the front, restoring it if minimised.
func raiseWindow(title string) {
	h, _, _ := procFindWindowW.Call(0, uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(title))))
	if h == 0 {
		return
	}
	if iconic, _, _ := procIsIconic.Call(h); iconic != 0 {
		procShowWindow.Call(h, 9) // SW_RESTORE
	}
	procSetForegroundWindow.Call(h)
}

// startWindow opens the settings window from the tray, as its own process.
func startWindow() { startCommand("open") }

// startTill opens the offline till from the tray, as its own process.
func startTill() { startCommand("till") }

func startCommand(command string) {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	// Let the window take the foreground, which Windows otherwise keeps for the tray.
	procAllowSetForegroundW.Call(^uintptr(0)) // ASFW_ANY
	_ = exec.Command(exe, command).Start()
}

// ensureTray brings the tray icon back when the user quit it and then opened the agent: the
// service starts one only at sign-in, so without this it stays gone until the next one.
func ensureTray() {
	h, err := windows.OpenMutex(windows.SYNCHRONIZE, false, windows.StringToUTF16Ptr(`Local\GnextAgentTray`))
	if err == nil {
		windows.CloseHandle(h) // a tray is running
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	_ = exec.Command(exe, "tray").Start()
}

const waitingPage = `<!DOCTYPE html><html dir="rtl" lang="fa"><head><meta charset="utf-8">
<style>
body { font-family: "Segoe UI", Tahoma, sans-serif; display: flex; align-items: center; justify-content: center;
  height: 100vh; margin: 0; background: #f6f7f8; color: #1c252e; }
@media (prefers-color-scheme: dark) { body { background: #141a21; color: #e5e8eb; } }
div { text-align: center; max-width: 28rem; line-height: 1.8; }
h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
p { margin: 0; opacity: .75; }
</style></head><body><div>
<h1>عامل Gnext در حال اجرا نیست</h1>
<p>سرویس GnextAgent در این رایانه اجرا نمی‌شود یا در حال راه‌اندازی است. این صفحه به محض آماده شدن عامل باز می‌شود.</p>
</div></body></html>`
