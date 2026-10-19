// Package chit routes an order's kitchen lines to the branch's printers and lays out each chit
// (agent-protocol §21). It is the agent's copy of what the cloud did until 2.5.0
// (backend print-routing.service.ts and print-queue.service.ts splitByPrinter), with the same
// rules, so a branch prints the same chits whichever side routes them.
package chit

import (
	"fmt"
	"slices"

	"gnext/agent/internal/protocol"
)

// kitchenName labels lines that had nowhere to print.
const kitchenName = "آشپزخانه"

// Chit is one kitchen chit: the printer it goes to and the lines on it.
type Chit struct {
	// Printer is nil for lines that have nowhere to print: the branch has no kitchen printer.
	Printer *protocol.Printer
	Label   string
	Lines   []protocol.ChitLine
	// WholeOrder is a chit with every line, for a printer at the pass.
	WholeOrder bool
	// OtherStations names the other printers the same order went to.
	OtherStations []string
}

type source int

const (
	routed source = iota
	notPrinted
	nowhere
)

// Split groups lines by the printers they print on, keeping the order the lines came in. A line
// sent to two printers is on both chits; a line on the "not printed" list is on none; lines with
// nowhere to print share one chit with no printer. Each printer at the pass gets one more chit with
// every line, and a line routed only to such a printer is on that chit already.
func Split(printers []protocol.Printer, r *protocol.Routing, lines []protocol.ChitLine) []Chit {
	if r == nil {
		r = &protocol.Routing{}
	}
	byID := map[string]*protocol.Printer{}
	for i := range printers {
		byID[printers[i].ID] = &printers[i]
	}
	atPass := map[string]bool{}
	var pass []*protocol.Printer
	for _, id := range r.WholeOrderPrinterIDs {
		if p := byID[id]; p != nil && !atPass[id] {
			atPass[id] = true
			pass = append(pass, p)
		}
	}

	var stations []*Chit
	byPrinter := map[string]*Chit{}
	add := func(p *protocol.Printer, line protocol.ChitLine) {
		key := ""
		if p != nil {
			key = p.ID
		}
		if c := byPrinter[key]; c != nil {
			c.Lines = append(c.Lines, line)
			return
		}
		c := &Chit{Printer: p, Lines: []protocol.ChitLine{line}}
		byPrinter[key] = c
		stations = append(stations, c)
	}

	for _, line := range lines {
		var targets []*protocol.Printer
		src := routed
		if line.Change == "VOID" && line.SentTo != nil {
			// A void goes where the line was first sent, whatever the routing says now.
			if len(*line.SentTo) == 0 {
				continue
			}
			for _, p := range printers {
				if slices.Contains(*line.SentTo, p.ID) {
					targets = append(targets, byID[p.ID])
				}
			}
		} else {
			targets, src = route(printers, byID, r, line)
		}
		if src == notPrinted {
			continue
		}
		var off []*protocol.Printer
		for _, p := range targets {
			if !atPass[p.ID] {
				off = append(off, p)
			}
		}
		if len(off) == 0 && len(targets) > 0 {
			continue // only the pass prints it, on the whole-order chit
		}
		if len(off) == 0 {
			add(nil, line)
			continue
		}
		for _, p := range off {
			add(p, line)
		}
	}

	names := make([]string, len(stations))
	for i, c := range stations {
		names[i] = kitchenName
		if c.Printer != nil {
			names[i] = c.Printer.Name
		}
	}
	out := make([]Chit, 0, len(stations)+len(pass))
	for i, c := range stations {
		c.Label = names[i]
		if len(stations) > 1 {
			c.Label = fmt.Sprintf("%s (%d/%d)", names[i], i+1, len(stations))
		}
		for j, n := range names {
			if j != i {
				c.OtherStations = append(c.OtherStations, n)
			}
		}
		out = append(out, *c)
	}
	for _, p := range pass {
		out = append(out, Chit{Printer: p, Label: p.Name, Lines: lines, WholeOrder: true})
	}
	return out
}

// route is where one line prints: its product's routes, else its category's, else the default
// kitchen printer. A route with no printer is the "not printed" list. A printer out of service
// stays on the list, so its chit fails where it can be seen while the others print.
func route(printers []protocol.Printer, byID map[string]*protocol.Printer, r *protocol.Routing, line protocol.ChitLine) ([]*protocol.Printer, source) {
	var chosen []protocol.Route
	for _, rt := range r.Routes {
		if rt.ProductID != "" && rt.ProductID == line.ProductID {
			chosen = append(chosen, rt)
		}
	}
	if len(chosen) == 0 && line.CategoryID != "" {
		for _, rt := range r.Routes {
			if rt.ProductID == "" && rt.CategoryID == line.CategoryID {
				chosen = append(chosen, rt)
			}
		}
	}
	fallback := func() ([]*protocol.Printer, source) {
		if p := byID[r.KitchenDefaultPrinterID]; p != nil {
			return []*protocol.Printer{p}, routed
		}
		return nil, nowhere
	}
	if len(chosen) == 0 {
		return fallback()
	}
	allEmpty := true
	for _, rt := range chosen {
		if rt.PrinterID != nil {
			allEmpty = false
		}
	}
	if allEmpty {
		return nil, notPrinted
	}
	var out []*protocol.Printer
	for _, p := range printers {
		for _, rt := range chosen {
			if rt.PrinterID != nil && *rt.PrinterID == p.ID {
				out = append(out, byID[p.ID])
				break
			}
		}
	}
	if len(out) == 0 {
		return fallback()
	}
	return out, routed
}
