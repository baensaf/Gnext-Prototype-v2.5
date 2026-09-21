package main

import (
	"strings"
	"time"

	"gnext/agent/internal/printing"
	"gnext/agent/internal/protocol"
)

// The tray (`gnext-agent tray`) runs in each signed-in user's session, since the service in
// session 0 cannot show anything. It reads the settings page's /api/status every few seconds,
// colours its icon, lists the devices in its menu and pops a notice when something breaks.
// This file holds what it shows; tray_windows.go draws it.

// trayStatus is the part of /api/status the tray reads.
type trayStatus struct {
	Version    string `json:"version"`
	Enrolled   bool   `json:"enrolled"`
	BranchName string `json:"branch_name"`
	Stopped    string `json:"stopped"`
	Agent      *struct {
		Connected  bool                    `json:"connected"`
		BranchName string                  `json:"branch_name"`
		Config     *protocol.Config        `json:"config"`
		Devices    []protocol.DeviceStatus `json:"devices"`
	} `json:"agent"`
}

type trayLevel int

const (
	levelOK trayLevel = iota
	levelWarn
	levelBad
	levelDown // the agent itself is not answering
)

// trayDownAfter is how long the cloud may be away before the tray calls it a problem: a deploy
// or a Wi-Fi hiccup reconnects well within it.
const trayDownAfter = 30 * time.Second

type trayItem struct {
	Key   string // kind:id
	Label string // "چاپگر آشپزخانه"
	Text  string // "کاغذ تمام شده"
	Level trayLevel
}

type trayPrinter struct{ ID, Name string }

type trayView struct {
	Level    trayLevel
	Title    string
	Cloud    string
	Items    []trayItem
	Printers []trayPrinter // for test prints
}

// Tip is the icon's tooltip: the title and the first problem, or that all is well.
func (v trayView) Tip() string {
	line := v.Cloud
	if v.Level == levelOK {
		line = "همه‌چیز آماده است"
	} else if v.Level != levelDown {
		for _, it := range v.Items {
			if it.Level >= levelWarn {
				line = it.Label + ": " + it.Text
				break
			}
		}
	}
	return truncateRunes(v.Title+"\n"+line, 127)
}

type trayNotice struct {
	Title, Text string
	Warn        bool
}

// trayWatch turns successive statuses into views and the notices worth popping up.
type trayWatch struct {
	items     map[string]trayLevel
	downSince time.Time // when the cloud or the agent went away; zero while connected
	downTold  bool
}

func (w *trayWatch) observe(st *trayStatus, err error, now time.Time) (trayView, []trayNotice) {
	v := trayView{Title: "عامل شعبه Gnext"}
	var notes []trayNotice
	connected := false

	switch {
	case err != nil || st == nil:
		v.Level, v.Cloud = levelDown, "عامل Gnext اجرا نمی‌شود"
	case !st.Enrolled:
		v.Level, v.Cloud = levelBad, "این رایانه هنوز به شعبه‌ای وصل نشده است"
	case st.Stopped != "":
		v.Level, v.Cloud = levelBad, "عامل متوقف شده است"
	case st.Agent == nil:
		v.Level, v.Cloud = levelWarn, "عامل در حال راه‌اندازی است"
	case !st.Agent.Connected:
		v.Level, v.Cloud = levelWarn, "در حال اتصال به سرور…"
	default:
		connected = true
		v.Cloud = "به سرور Gnext وصل است"
	}
	if st != nil {
		branch := st.BranchName
		if st.Agent != nil && st.Agent.BranchName != "" {
			branch = st.Agent.BranchName
		}
		if branch != "" {
			v.Title += " — " + branch
		}
	}

	// The cloud: a problem only once it has been away a while, told once, and told when back.
	if connected || (st != nil && (!st.Enrolled || st.Stopped != "")) {
		if w.downTold && connected {
			notes = append(notes, trayNotice{Title: "Gnext", Text: "ارتباط با سرور دوباره برقرار شد."})
		}
		w.downSince, w.downTold = time.Time{}, false
	} else {
		if w.downSince.IsZero() {
			w.downSince = now
		}
		if now.Sub(w.downSince) >= trayDownAfter {
			if v.Level == levelWarn {
				v.Level, v.Cloud = levelBad, "ارتباط با سرور Gnext قطع است"
			}
			if !w.downTold {
				w.downTold = true
				text := "ارتباط با سرور قطع است؛ سفارش‌ها چاپ نمی‌شوند و کارتخوان کار نمی‌کند."
				if v.Level == levelDown {
					text = "عامل Gnext اجرا نمی‌شود؛ سفارش‌ها چاپ نمی‌شوند."
				}
				notes = append(notes, trayNotice{Title: "Gnext", Text: text, Warn: true})
			}
		}
	}

	if st != nil && st.Agent != nil && st.Agent.Config != nil {
		v.Items, v.Printers = trayDevices(st.Agent.Config, st.Agent.Devices)
	}
	items := map[string]trayLevel{}
	for _, it := range v.Items {
		items[it.Key] = it.Level
		v.Level = max(v.Level, it.Level)
		old, known := w.items[it.Key]
		switch {
		case it.Level >= levelWarn && (!known || old < it.Level):
			notes = append(notes, trayNotice{Title: it.Label, Text: it.Text, Warn: true})
		case it.Level == levelOK && known && old == levelBad:
			notes = append(notes, trayNotice{Title: it.Label, Text: "دوباره آماده است."})
		}
	}
	if st != nil && st.Agent != nil { // keep what we knew while the agent is away
		w.items = items
	}
	return v, notes
}

// trayDevices lists the active devices this agent drives, with what their last check found.
func trayDevices(cfg *protocol.Config, devices []protocol.DeviceStatus) ([]trayItem, []trayPrinter) {
	byKey := map[string]protocol.DeviceStatus{}
	for _, d := range devices {
		byKey[d.Kind+":"+d.ID] = d
	}
	var items []trayItem
	var printers []trayPrinter
	add := func(kind, id, label string) {
		d, ok := byKey[kind+":"+id]
		if ok && d.Status == protocol.DeviceUnsupported {
			return // not connected to this agent
		}
		text, level := "در حال بررسی", levelOK
		if ok {
			text, level = deviceText(d)
		}
		items = append(items, trayItem{Key: kind + ":" + id, Label: label, Text: text, Level: level})
	}
	for _, p := range cfg.Printers {
		if !p.Active || p.Connection == nil {
			continue
		}
		name := firstNonEmpty(p.Name, p.Code)
		add("printer", p.ID, "چاپگر "+name)
		if printing.Supported(p) {
			printers = append(printers, trayPrinter{ID: p.ID, Name: name})
		}
	}
	for _, t := range cfg.Terminals {
		if !t.Active || t.Driver == nil {
			continue
		}
		add("terminal", t.ID, "کارتخوان "+firstNonEmpty(t.Name, t.Code))
	}
	return items, printers
}

func deviceText(d protocol.DeviceStatus) (string, trayLevel) {
	detail := ""
	if d.Detail != nil {
		detail = *d.Detail
	}
	switch d.Status {
	case protocol.DeviceOnline:
		if detail == printing.DetailPaperLow {
			return faultText(detail), levelWarn
		}
		return "آماده", levelOK
	case protocol.DeviceError:
		return faultText(detail), levelBad
	case protocol.DeviceOffline:
		return "در دسترس نیست؛ روشن و وصل بودن آن را بررسی کنید", levelBad
	}
	return "در حال بررسی", levelOK
}

// faultText puts a printer fault from a device check or a failed print into Persian.
func faultText(msg string) string {
	for _, f := range []struct{ detail, text string }{
		{printing.DetailPaperOut, "کاغذ تمام شده است"},
		{printing.DetailCoverOpen, "درِ چاپگر باز است"},
		{printing.DetailPaperLow, "کاغذ رو به اتمام است"},
		{printing.DetailOffline, "چاپگر آفلاین است"},
		{printing.DetailError, "چاپگر خطا دارد"},
	} {
		if strings.Contains(msg, f.detail) {
			return f.text
		}
	}
	if msg == "" {
		return "خطا"
	}
	return msg
}

func firstNonEmpty(s ...string) string {
	for _, v := range s {
		if v != "" {
			return v
		}
	}
	return ""
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}
