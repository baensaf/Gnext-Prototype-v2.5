//go:build windows

package main

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
	"unsafe"

	"github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

// windowTitle names the settings window; a second `open` finds the first by it.
const windowTitle = "Gnext Agent — عامل شعبه"

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
func runWindow() int {
	runtime.LockOSThread()
	url := "http://" + uiAddr()

	mutex, err := windows.CreateMutex(nil, false, windows.StringToUTF16Ptr(`Local\GnextAgentWindow`))
	if err != nil {
		if mutex != 0 {
			windows.CloseHandle(mutex)
		}
		raiseWindow()
		return 0
	}
	defer windows.CloseHandle(mutex)

	data := filepath.Join(os.Getenv("LOCALAPPDATA"), "Gnext", "agent-window")
	w := webview2.NewWithOptions(webview2.WebViewOptions{
		DataPath:  data,
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title: windowTitle, Width: 1120, Height: 780, IconId: appIconID, Center: true,
		},
	})
	if w == nil {
		if err := openBrowser(url); err != nil {
			return 1
		}
		return 0
	}
	defer w.Destroy()

	if agentAnswers(url) {
		w.Navigate(url)
	} else {
		// The page would be the browser's own error; say what is wrong, and load the page
		// once the agent answers.
		w.SetHtml(waitingPage)
		go func() {
			for !agentAnswers(url) {
				time.Sleep(2 * time.Second)
			}
			w.Dispatch(func() { w.Navigate(url) })
		}()
	}
	w.Run()
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

// raiseWindow brings the open settings window to the front, restoring it if minimised.
func raiseWindow() {
	h, _, _ := procFindWindowW.Call(0, uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(windowTitle))))
	if h == 0 {
		return
	}
	if iconic, _, _ := procIsIconic.Call(h); iconic != 0 {
		procShowWindow.Call(h, 9) // SW_RESTORE
	}
	procSetForegroundWindow.Call(h)
}

// startWindow opens the settings window from the tray, as its own process.
func startWindow() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	// Let the window take the foreground, which Windows otherwise keeps for the tray.
	procAllowSetForegroundW.Call(^uintptr(0)) // ASFW_ANY
	_ = exec.Command(exe, "open").Start()
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
