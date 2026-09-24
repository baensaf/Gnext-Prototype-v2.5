package till

import (
	"context"
	"time"
)

// catalog reads the snapshot the till sells from.
func (t *Till) catalog() (*Catalog, error) {
	raw, err := t.Snapshot()
	if err != nil {
		return nil, refuse(CodeNoSnapshot, "هنوز منوی شعبه از سرور دریافت نشده است.")
	}
	return ParseCatalog(raw)
}

// Menu is the branch's catalogue with what can be sold right now (§13.13 `menu`), today's stock
// less what the till itself sold offline.
func (t *Till) Menu() (Menu, error) {
	t.init()
	c, err := t.catalog()
	if err != nil {
		return Menu{}, err
	}
	return c.Menu(t.Now(), t.soldOffline(c, "")), nil
}

// Price checks and prices a set of lines as one order (§12.4, §13.6) without keeping it.
func (t *Till) Price(lines []LineInput) ([]Line, Totals, error) {
	t.init()
	c, err := t.catalog()
	if err != nil {
		return nil, Totals{}, err
	}
	return c.Price(t.Now(), lines, t.soldOffline(c, ""))
}

// HandoverAfter is how long the link must hold before the till hands its unfinished orders over
// on its own (§13.5).
const HandoverAfter = 15 * time.Minute

// Run looks after the orders until ctx ends: the hand-over once the link has held for 15 minutes,
// another try for an ended order the upload did not take, and orders kept past a week.
func (t *Till) Run(ctx context.Context, every time.Duration) {
	t.init()
	if every <= 0 {
		every = 30 * time.Second
	}
	tick := time.NewTicker(every)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		t.tend()
	}
}

func (t *Till) tend() {
	if t.Store == nil {
		return
	}
	if since := t.connectedSince(); since != nil && t.Now().Sub(*since) >= HandoverAfter && t.openOrders() > 0 {
		if _, _, err := t.Handover(); err != nil {
			t.Log.Error("automatic hand-over failed", "err", err)
		}
	}
	t.omu.Lock()
	defer t.omu.Unlock()
	all, err := t.Store.all()
	if err != nil {
		return
	}
	cutoff := t.Now().Add(-Keep)
	for _, o := range all {
		switch {
		case o.State != StateOpen && !o.HandedOver:
			_ = t.handOver(o)
		case o.HandedOver && o.HandedAt != nil && o.HandedAt.Before(cutoff):
			_ = t.Store.delete(o.ID)
		}
	}
}

func (t *Till) connectedSince() *time.Time {
	if t.ConnectedSince == nil {
		return nil
	}
	return t.ConnectedSince()
}
