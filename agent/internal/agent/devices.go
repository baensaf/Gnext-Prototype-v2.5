package agent

import (
	"context"
	"sort"
	"time"

	"gnext/agent/internal/protocol"
)

// probeLoop checks every configured device each ProbeInterval, and right after a config
// change, and reports changes with device.status (§6.3).
func (a *Agent) probeLoop(ctx context.Context) {
	t := time.NewTicker(a.o.ProbeInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		case <-a.probeCh:
		}
		a.probe(ctx)
	}
}

func (a *Agent) probe(ctx context.Context) {
	cfg := a.cfg.Load()
	now := protocol.Now(time.Now())
	seen := map[string]protocol.DeviceStatus{}

	for _, p := range cfg.Printers {
		st := protocol.DeviceStatus{Kind: "printer", ID: p.ID, CheckedAt: now}
		status, detail := a.o.Printer.Probe(ctx, p)
		st.Status, st.Detail = status, detailPtr(detail)
		seen["printer:"+p.ID] = st
	}
	for _, t := range cfg.Terminals {
		st := protocol.DeviceStatus{Kind: "terminal", ID: t.ID, CheckedAt: now}
		if drv := a.o.NewDriver(t); drv == nil {
			st.Status, st.Detail = protocol.DeviceUnsupported, detailPtr("no driver for this terminal in this agent build")
		} else {
			status, detail := drv.Probe(ctx)
			st.Status, st.Detail = status, detailPtr(detail)
		}
		seen["terminal:"+t.ID] = st
	}

	a.devMu.Lock()
	var changed []protocol.DeviceStatus
	for k, st := range seen {
		// A new detail counts too: a printer can be online with its paper running low.
		if old, ok := a.devices[k]; !ok || old.Status != st.Status || deref(old.Detail) != deref(st.Detail) {
			changed = append(changed, st)
		}
	}
	a.devices = seen
	a.devMu.Unlock()

	if len(changed) > 0 {
		sortDevices(changed)
		a.send(protocol.TypeDeviceStatus, "", protocol.DeviceStatusEvent{Devices: changed})
	}
}

func (a *Agent) deviceList() []protocol.DeviceStatus {
	a.devMu.Lock()
	defer a.devMu.Unlock()
	out := make([]protocol.DeviceStatus, 0, len(a.devices))
	for _, st := range a.devices {
		out = append(out, st)
	}
	sortDevices(out)
	return out
}

func sortDevices(ds []protocol.DeviceStatus) {
	sort.Slice(ds, func(i, j int) bool { return ds[i].Kind+ds[i].ID < ds[j].Kind+ds[j].ID })
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func detailPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
