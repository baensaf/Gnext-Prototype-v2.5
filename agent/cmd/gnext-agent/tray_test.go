package main

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"gnext/agent/internal/printing"
	"gnext/agent/internal/protocol"
)

func status(t *testing.T, connected bool, devices ...protocol.DeviceStatus) *trayStatus {
	t.Helper()
	raw := map[string]any{
		"version": "1.0.8", "enrolled": true, "branch_name": "Iranburger Vanak",
		"agent": map[string]any{
			"connected": connected,
			"config": protocol.Config{
				Printers: []protocol.Printer{
					{ID: "p1", Name: "Kitchen", Active: true, Connection: &protocol.Connection{Kind: "tcp", Host: "10.0.0.5", Port: []byte("9100")}},
					{ID: "p2", Name: "Simulated", Active: true}, // not connected to the agent
				},
			},
			"devices": devices,
		},
	}
	b, _ := json.Marshal(raw)
	var st trayStatus
	if err := json.Unmarshal(b, &st); err != nil {
		t.Fatal(err)
	}
	return &st
}

func printerStatus(status, detail string) protocol.DeviceStatus {
	d := protocol.DeviceStatus{Kind: "printer", ID: "p1", Status: status}
	if detail != "" {
		d.Detail = &detail
	}
	return d
}

func TestTrayAllGood(t *testing.T) {
	w := &trayWatch{}
	v, notes := w.observe(status(t, true, printerStatus(protocol.DeviceOnline, "")), nil, time.Now())
	if v.Level != levelOK || len(notes) != 0 {
		t.Fatalf("level %d, notes %v", v.Level, notes)
	}
	if !strings.Contains(v.Title, "Iranburger Vanak") || len(v.Items) != 1 || len(v.Printers) != 1 {
		t.Fatalf("view %+v", v)
	}
}

func TestTrayTellsPaperOutOnceAndWhenFixed(t *testing.T) {
	w := &trayWatch{}
	now := time.Now()
	w.observe(status(t, true, printerStatus(protocol.DeviceOnline, "")), nil, now)

	v, notes := w.observe(status(t, true, printerStatus(protocol.DeviceError, printing.DetailPaperOut)), nil, now)
	if v.Level != levelBad || len(notes) != 1 || !notes[0].Warn || notes[0].Text != "کاغذ تمام شده است" {
		t.Fatalf("level %d, notes %+v", v.Level, notes)
	}
	if _, notes = w.observe(status(t, true, printerStatus(protocol.DeviceError, printing.DetailPaperOut)), nil, now); len(notes) != 0 {
		t.Fatalf("told again: %+v", notes)
	}
	v, notes = w.observe(status(t, true, printerStatus(protocol.DeviceOnline, "")), nil, now)
	if v.Level != levelOK || len(notes) != 1 || notes[0].Warn {
		t.Fatalf("level %d, notes %+v", v.Level, notes)
	}
}

func TestTrayPaperLowIsAWarning(t *testing.T) {
	w := &trayWatch{}
	v, notes := w.observe(status(t, true, printerStatus(protocol.DeviceOnline, printing.DetailPaperLow)), nil, time.Now())
	if v.Level != levelWarn || len(notes) != 1 {
		t.Fatalf("level %d, notes %+v", v.Level, notes)
	}
}

func TestTrayWaitsBeforeCallingTheCloudDown(t *testing.T) {
	w := &trayWatch{}
	now := time.Now()
	w.observe(status(t, true), nil, now)
	v, notes := w.observe(status(t, false), nil, now.Add(time.Second))
	if v.Level != levelWarn || len(notes) != 0 {
		t.Fatalf("a short drop: level %d, notes %+v", v.Level, notes)
	}
	v, notes = w.observe(status(t, false), nil, now.Add(trayDownAfter+2*time.Second))
	if v.Level != levelBad || len(notes) != 1 {
		t.Fatalf("a long drop: level %d, notes %+v", v.Level, notes)
	}
	_, notes = w.observe(status(t, true), nil, now.Add(trayDownAfter+5*time.Second))
	if len(notes) != 1 || notes[0].Warn {
		t.Fatalf("back: notes %+v", notes)
	}
}

func TestTrayAgentNotRunning(t *testing.T) {
	w := &trayWatch{}
	v, _ := w.observe(nil, errors.New("connection refused"), time.Now())
	if v.Level != levelDown {
		t.Fatalf("level %d", v.Level)
	}
	if tip := v.Tip(); !strings.Contains(tip, "اجرا نمی‌شود") || len([]rune(tip)) > 127 {
		t.Fatalf("tip %q", tip)
	}
}

func TestDrawTrayIcon(t *testing.T) {
	for _, size := range []int{16, 20, 24, 32} {
		px := drawTrayIcon(size, levelBad)
		if len(px) != size*size*4 {
			t.Fatalf("size %d: %d bytes", size, len(px))
		}
		// The middle of the status light is solid red (BGRA).
		i := (size*70/100*size + size*74/100) * 4
		if px[i+2] != 0xEF || px[i+1] != 0x44 || px[i+3] != 0xFF {
			t.Fatalf("size %d: light pixel %v", size, px[i:i+4])
		}
		// The logo is drawn: its left arch is opaque.
		if j := (size*40/100*size + size*30/100) * 4; drawTrayIcon(size, levelOK)[j+3] < 200 {
			t.Fatalf("size %d: no logo", size)
		}
	}
}
