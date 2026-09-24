//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf16"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32   = windows.NewLazySystemDLL("user32.dll")
	shell32  = windows.NewLazySystemDLL("shell32.dll")
	gdi32    = windows.NewLazySystemDLL("gdi32.dll")
	kernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procRegisterClassExW       = user32.NewProc("RegisterClassExW")
	procCreateWindowExW        = user32.NewProc("CreateWindowExW")
	procDefWindowProcW         = user32.NewProc("DefWindowProcW")
	procDestroyWindow          = user32.NewProc("DestroyWindow")
	procGetMessageW            = user32.NewProc("GetMessageW")
	procTranslateMessage       = user32.NewProc("TranslateMessage")
	procDispatchMessageW       = user32.NewProc("DispatchMessageW")
	procPostMessageW           = user32.NewProc("PostMessageW")
	procPostQuitMessage        = user32.NewProc("PostQuitMessage")
	procCreatePopupMenu        = user32.NewProc("CreatePopupMenu")
	procAppendMenuW            = user32.NewProc("AppendMenuW")
	procTrackPopupMenu         = user32.NewProc("TrackPopupMenu")
	procDestroyMenu            = user32.NewProc("DestroyMenu")
	procSetForegroundWindow    = user32.NewProc("SetForegroundWindow")
	procGetCursorPos           = user32.NewProc("GetCursorPos")
	procCreateIconIndirect     = user32.NewProc("CreateIconIndirect")
	procRegisterWindowMessageW = user32.NewProc("RegisterWindowMessageW")
	procGetSystemMetrics       = user32.NewProc("GetSystemMetrics")
	procSetTimer               = user32.NewProc("SetTimer")
	procKillTimer              = user32.NewProc("KillTimer")
	procSetDpiAwarenessContext = user32.NewProc("SetProcessDpiAwarenessContext")
	procShellNotifyIconW       = shell32.NewProc("Shell_NotifyIconW")
	procCreateDIBSection       = gdi32.NewProc("CreateDIBSection")
	procCreateBitmap           = gdi32.NewProc("CreateBitmap")
	procDeleteObject           = gdi32.NewProc("DeleteObject")
	procGetModuleHandleW       = kernel32.NewProc("GetModuleHandleW")
)

const (
	wmNull        = 0x0000
	wmDestroy     = 0x0002
	wmClose       = 0x0010
	wmContextMenu = 0x007B
	wmTimer       = 0x0113
	wmTray        = 0x8000 + 1 // WM_APP+1: the icon's callback
	wmRefresh     = 0x8000 + 2 // WM_APP+2: a new view or notice is waiting

	ninSelect           = 0x0400
	ninKeySelect        = 0x0401
	ninBalloonUserClick = 0x0405

	nimAdd        = 0
	nimModify     = 1
	nimDelete     = 2
	nimSetVersion = 4
	nifMessage    = 0x01
	nifIcon       = 0x02
	nifTip        = 0x04
	nifInfo       = 0x10
	nifShowTip    = 0x80
	niifUser      = 0x04 // the notice shows our own icon
	niifLargeIcon = 0x20

	mfString    = 0x0000
	mfDisabled  = 0x0002
	mfPopup     = 0x0010
	mfSeparator = 0x0800

	tpmRightButton = 0x0002
	tpmReturnCmd   = 0x0100
	tpmLayoutRTL   = 0x8000

	smCxIcon   = 11
	smCxSmIcon = 49

	cmdOpen      = 1
	cmdHide      = 2
	cmdTill      = 3
	cmdTestPrint = 100 // + the printer's index

	addRetryTimer = 1
)

type wndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   windows.Handle
	Icon       windows.Handle
	Cursor     windows.Handle
	Background windows.Handle
	MenuName   *uint16
	ClassName  *uint16
	IconSm     windows.Handle
}

type winMsg struct {
	Hwnd    windows.HWND
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      struct{ X, Y int32 }
	Private uint32
}

type iconInfo struct {
	Icon     int32
	XHotspot uint32
	YHotspot uint32
	Mask     windows.Handle
	Color    windows.Handle
}

type bitmapInfoHeader struct {
	Size          uint32
	Width         int32
	Height        int32
	Planes        uint16
	BitCount      uint16
	Compression   uint32
	SizeImage     uint32
	XPelsPerMeter int32
	YPelsPerMeter int32
	ClrUsed       uint32
	ClrImportant  uint32
}

// notifyIconData is NOTIFYICONDATAW.
type notifyIconData struct {
	Size            uint32
	Wnd             windows.HWND
	ID              uint32
	Flags           uint32
	CallbackMessage uint32
	Icon            windows.Handle
	Tip             [128]uint16
	State           uint32
	StateMask       uint32
	Info            [256]uint16
	Version         uint32
	InfoTitle       [64]uint16
	InfoFlags       uint32
	GUIDItem        windows.GUID
	BalloonIcon     windows.Handle
}

type tray struct {
	hwnd           windows.HWND
	icons          map[trayLevel]windows.Handle
	large          map[trayLevel]windows.Handle // for notices
	taskbarCreated uint32
	added          bool

	mu      sync.Mutex
	view    trayView
	notices []trayNotice
}

// theTray is the one tray of this process, for the window procedure.
var theTray *tray

// runTray shows the tray icon until the user hides it, signs out, or the agent is updated.
func runTray() int {
	runtime.LockOSThread()
	release, ok := trayInstance()
	if !ok {
		return 0
	}
	defer release()

	// Sharp icons on scaled screens; without it Windows stretches a 16-pixel one.
	procSetDpiAwarenessContext.Call(^uintptr(3)) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2

	t := &tray{icons: map[trayLevel]windows.Handle{}, large: map[trayLevel]windows.Handle{}}
	theTray = t
	size, _, _ := procGetSystemMetrics.Call(smCxSmIcon)
	if size == 0 {
		size = 16
	}
	big, _, _ := procGetSystemMetrics.Call(smCxIcon)
	if big == 0 {
		big = 32
	}
	for level := range trayColours {
		t.icons[level] = createIcon(int(size), drawTrayIcon(int(size), level))
		t.large[level] = createIcon(int(big), drawTrayIcon(int(big), level))
	}
	if err := t.createWindow(); err != nil {
		fmt.Fprintln(os.Stderr, "tray:", err)
		return 1
	}
	t.view = trayView{Level: levelDown, Title: "عامل شعبه Gnext", Cloud: "در حال بررسی…"}
	t.add()

	go t.watch()

	var m winMsg
	for {
		r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
	return 0
}

// trayInstance makes sure one tray runs per Windows session. A new binary's tray, started by
// the service right after an update, waits a little for the old one to notice and leave.
func trayInstance() (func(), bool) {
	name := windows.StringToUTF16Ptr(`Local\GnextAgentTray`)
	for range 20 {
		h, err := windows.CreateMutex(nil, false, name)
		if err == nil {
			return func() { windows.CloseHandle(h) }, true
		}
		if h != 0 {
			windows.CloseHandle(h)
		}
		time.Sleep(time.Second)
	}
	return nil, false
}

func (t *tray) createWindow() error {
	inst, _, _ := procGetModuleHandleW.Call(0)
	class := windows.StringToUTF16Ptr("GnextAgentTray")
	wc := wndClassEx{WndProc: syscall.NewCallback(trayWndProc), Instance: windows.Handle(inst), ClassName: class}
	wc.Size = uint32(unsafe.Sizeof(wc))
	if r, _, err := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		return fmt.Errorf("register window class: %w", err)
	}
	// A hidden top-level window: it never shows, but unlike a message-only window it hears
	// Explorer announce a new taskbar, and can own the menu.
	h, _, err := procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(class)), uintptr(unsafe.Pointer(class)), 0,
		0, 0, 0, 0, 0, 0, inst, 0)
	if h == 0 {
		return fmt.Errorf("create window: %w", err)
	}
	t.hwnd = windows.HWND(h)
	msg, _, _ := procRegisterWindowMessageW.Call(uintptr(unsafe.Pointer(windows.StringToUTF16Ptr("TaskbarCreated"))))
	t.taskbarCreated = uint32(msg)
	return nil
}

func trayWndProc(hwnd, msg, wParam, lParam uintptr) uintptr {
	t := theTray
	switch uint32(msg) {
	case wmTray:
		switch uint32(lParam & 0xFFFF) {
		case wmContextMenu:
			t.menu()
		case ninSelect, ninKeySelect, ninBalloonUserClick:
			startWindow()
		}
		return 0
	case wmRefresh:
		t.refresh()
		return 0
	case wmTimer:
		if wParam == addRetryTimer {
			t.add()
		}
		return 0
	case wmClose:
		procDestroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		t.remove()
		procPostQuitMessage.Call(0)
		return 0
	}
	if t != nil && uint32(msg) == t.taskbarCreated && t.taskbarCreated != 0 {
		t.added = false // Explorer restarted and forgot the icon
		t.add()
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, msg, wParam, lParam)
	return r
}

func (t *tray) data() notifyIconData {
	d := notifyIconData{Wnd: t.hwnd, ID: 1}
	d.Size = uint32(unsafe.Sizeof(d))
	return d
}

// add puts the icon in the notification area, retrying while the taskbar is not up yet (the
// service starts the tray the moment a user signs in).
func (t *tray) add() {
	if t.added {
		return
	}
	t.mu.Lock()
	v := t.view
	t.mu.Unlock()
	d := t.data()
	d.Flags = nifMessage | nifIcon | nifTip | nifShowTip
	d.CallbackMessage = wmTray
	d.Icon = t.icons[v.Level]
	copyUTF16(d.Tip[:], v.Tip())
	if r, _, _ := procShellNotifyIconW.Call(nimAdd, uintptr(unsafe.Pointer(&d))); r == 0 {
		procSetTimer.Call(uintptr(t.hwnd), addRetryTimer, 2000, 0)
		return
	}
	procKillTimer.Call(uintptr(t.hwnd), addRetryTimer)
	d.Version = 4 // NOTIFYICON_VERSION_4
	procShellNotifyIconW.Call(nimSetVersion, uintptr(unsafe.Pointer(&d)))
	t.added = true
	t.refresh()
}

func (t *tray) remove() {
	if !t.added {
		return
	}
	d := t.data()
	procShellNotifyIconW.Call(nimDelete, uintptr(unsafe.Pointer(&d)))
	t.added = false
}

// refresh shows the latest view and pops the waiting notices as one balloon.
func (t *tray) refresh() {
	t.mu.Lock()
	v, notes := t.view, t.notices
	t.notices = nil
	t.mu.Unlock()
	if !t.added {
		return
	}
	d := t.data()
	d.Flags = nifIcon | nifTip | nifShowTip
	d.Icon = t.icons[v.Level]
	copyUTF16(d.Tip[:], v.Tip())
	if len(notes) > 0 {
		d.Flags |= nifInfo
		// Windows 10 and 11 show this as a system notification under the exe's name (its
		// version resource), with the logo and the status light as its picture.
		d.InfoFlags = niifUser | niifLargeIcon
		d.BalloonIcon = t.large[v.Level]
		title, lines := notes[0].Title, make([]string, 0, len(notes))
		for _, n := range notes {
			if len(notes) == 1 {
				lines = append(lines, n.Text)
			} else {
				lines = append(lines, n.Title+": "+n.Text)
			}
		}
		if len(notes) > 1 {
			title = "Gnext"
		}
		copyUTF16(d.InfoTitle[:], title)
		copyUTF16(d.Info[:], strings.Join(lines, "\n"))
	}
	procShellNotifyIconW.Call(nimModify, uintptr(unsafe.Pointer(&d)))
}

func (t *tray) set(v trayView, notes []trayNotice) {
	t.mu.Lock()
	t.view = v
	t.notices = append(t.notices, notes...)
	t.mu.Unlock()
	procPostMessageW.Call(uintptr(t.hwnd), wmRefresh, 0, 0)
}

func (t *tray) notify(n trayNotice) {
	t.mu.Lock()
	v := t.view
	t.mu.Unlock()
	t.set(v, []trayNotice{n})
}

// menu shows the status lines and the actions under the pointer.
func (t *tray) menu() {
	t.mu.Lock()
	v := t.view
	t.mu.Unlock()
	m, _, _ := procCreatePopupMenu.Call()
	if m == 0 {
		return
	}
	defer procDestroyMenu.Call(m) // and its submenu
	item := func(menu uintptr, flags, id uintptr, text string) {
		procAppendMenuW.Call(menu, flags, id, uintptr(unsafe.Pointer(windows.StringToUTF16Ptr(text))))
	}
	item(m, mfString|mfDisabled, 0, v.Title)
	item(m, mfString|mfDisabled, 0, v.Cloud)
	for _, it := range v.Items {
		item(m, mfString|mfDisabled, 0, it.Label+": "+it.Text)
	}
	procAppendMenuW.Call(m, mfSeparator, 0, 0)
	item(m, mfString, cmdOpen, "باز کردن صفحه تنظیمات عامل")
	item(m, mfString, cmdTill, "صندوق آفلاین")
	if len(v.Printers) > 0 {
		sub, _, _ := procCreatePopupMenu.Call()
		for i, p := range v.Printers {
			item(sub, mfString, uintptr(cmdTestPrint+i), p.Name)
		}
		item(m, mfString|mfPopup, sub, "چاپ آزمایشی")
	}
	procAppendMenuW.Call(m, mfSeparator, 0, 0)
	item(m, mfString, cmdHide, "بستن این نماد (تا ورود بعدی به ویندوز)")

	var pt struct{ X, Y int32 }
	procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	procSetForegroundWindow.Call(uintptr(t.hwnd)) // or the menu will not close on a click elsewhere
	cmd, _, _ := procTrackPopupMenu.Call(m, tpmReturnCmd|tpmRightButton|tpmLayoutRTL,
		uintptr(pt.X), uintptr(pt.Y), 0, uintptr(t.hwnd), 0)
	procPostMessageW.Call(uintptr(t.hwnd), wmNull, 0, 0)

	switch {
	case cmd == cmdOpen:
		startWindow()
	case cmd == cmdTill:
		startTill()
	case cmd == cmdHide:
		procPostMessageW.Call(uintptr(t.hwnd), wmClose, 0, 0)
	case cmd >= cmdTestPrint && int(cmd-cmdTestPrint) < len(v.Printers):
		go t.testPrint(v.Printers[cmd-cmdTestPrint])
	}
}

var trayHTTP = &http.Client{Timeout: 3 * time.Second}

// watch polls the agent. When the agent on disk is replaced by an update and the running agent
// reports the new version, this tray leaves: the service starts the new binary's tray.
func (t *tray) watch() {
	exe, _ := os.Executable()
	started, _ := os.Stat(exe)
	w := &trayWatch{}
	for {
		st, err := fetchTrayStatus()
		v, notes := w.observe(st, err, time.Now())
		t.set(v, notes)
		if err == nil && st.Version != "" && st.Version != version && replaced(exe, started) {
			procPostMessageW.Call(uintptr(t.hwnd), wmClose, 0, 0)
			return
		}
		time.Sleep(3 * time.Second)
	}
}

func replaced(exe string, was os.FileInfo) bool {
	now, err := os.Stat(exe)
	return err == nil && was != nil && (!now.ModTime().Equal(was.ModTime()) || now.Size() != was.Size())
}

func fetchTrayStatus() (*trayStatus, error) {
	resp, err := trayHTTP.Get("http://" + uiAddr() + "/api/status")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	var st trayStatus
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&st); err != nil {
		return nil, err
	}
	return &st, nil
}

func (t *tray) testPrint(p trayPrinter) {
	req, _ := http.NewRequest(http.MethodPost, "http://"+uiAddr()+"/api/printers/"+p.ID+"/test", strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Gnext-Local", "1")
	client := &http.Client{Timeout: 100 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.notify(trayNotice{Title: "چاپگر " + p.Name, Text: "چاپ آزمایشی انجام نشد: عامل پاسخ نداد.", Warn: true})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		t.notify(trayNotice{Title: "چاپگر " + p.Name, Text: "چاپ آزمایشی چاپ شد."})
		return
	}
	var out struct{ Detail string }
	_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&out)
	t.notify(trayNotice{Title: "چاپگر " + p.Name, Text: "چاپ آزمایشی انجام نشد: " + faultText(out.Detail), Warn: true})
}

// createIcon makes an icon from size×size BGRA pixels with their own transparency.
func createIcon(size int, px []byte) windows.Handle {
	bi := bitmapInfoHeader{Width: int32(size), Height: -int32(size), Planes: 1, BitCount: 32}
	bi.Size = uint32(unsafe.Sizeof(bi))
	var bits unsafe.Pointer
	color, _, _ := procCreateDIBSection.Call(0, uintptr(unsafe.Pointer(&bi)), 0, uintptr(unsafe.Pointer(&bits)), 0, 0)
	if color == 0 || bits == nil {
		return 0
	}
	defer procDeleteObject.Call(color)
	copy(unsafe.Slice((*byte)(bits), len(px)), px)
	mask := make([]byte, (size+15)/16*2*size) // all zero: the alpha channel decides
	maskBmp, _, _ := procCreateBitmap.Call(uintptr(size), uintptr(size), 1, 1, uintptr(unsafe.Pointer(&mask[0])))
	defer procDeleteObject.Call(maskBmp)
	ii := iconInfo{Icon: 1, Mask: windows.Handle(maskBmp), Color: windows.Handle(color)}
	h, _, _ := procCreateIconIndirect.Call(uintptr(unsafe.Pointer(&ii)))
	return windows.Handle(h)
}

// copyUTF16 copies s into a fixed NUL-terminated buffer, cutting it to fit.
func copyUTF16(dst []uint16, s string) {
	u := utf16.Encode([]rune(s))
	if len(u) > len(dst)-1 {
		u = u[:len(dst)-1]
	}
	n := copy(dst, u)
	dst[n] = 0
}
