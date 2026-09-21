package main

import "math"

// trayColours: green ready, amber a warning, red a problem, grey the agent not running.
var trayColours = map[trayLevel][3]uint8{
	levelOK:   {0x16, 0xA3, 0x4A},
	levelWarn: {0xD9, 0x77, 0x06},
	levelBad:  {0xDC, 0x26, 0x26},
	levelDown: {0x6B, 0x72, 0x80},
}

// drawTrayIcon draws a small receipt printer whose body has the level's colour, as size×size
// BGRA pixels (top row first, straight alpha), sampled 4×4 per pixel for smooth edges.
func drawTrayIcon(size int, level trayLevel) []byte {
	body := trayColours[level]
	ink := [3]uint8{0x1F, 0x29, 0x37}
	white := [3]uint8{0xFF, 0xFF, 0xFF}
	// Shapes on a 16×16 grid, painted in order: x0, y0, x1, y1, corner radius, colour.
	shapes := []struct {
		x0, y0, x1, y1, r float64
		c                 [3]uint8
	}{
		{3.5, 0.5, 12.5, 6, 0, ink}, // paper going in, outlined
		{4.5, 1.5, 11.5, 6, 0, white},
		{0.5, 5, 15.5, 12, 2, body},   // the printer
		{3, 9.2, 13, 10.4, 0, ink},    // the slot
		{3.5, 10, 12.5, 15.5, 0, ink}, // the ticket coming out
		{4.5, 10.4, 11.5, 14.5, 0, white},
		{6, 12, 10, 12.8, 0, ink}, // a line on it
	}
	px := make([]byte, size*size*4)
	scale := 16 / float64(size)
	const n = 4
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			var r, g, b, a float64
			for sy := 0; sy < n; sy++ {
				for sx := 0; sx < n; sx++ {
					gx := (float64(x) + (float64(sx)+0.5)/n) * scale
					gy := (float64(y) + (float64(sy)+0.5)/n) * scale
					var c [3]uint8
					hit := false
					for _, s := range shapes {
						if inRoundRect(gx, gy, s.x0, s.y0, s.x1, s.y1, s.r) {
							c, hit = s.c, true
						}
					}
					if hit {
						r, g, b, a = r+float64(c[0]), g+float64(c[1]), b+float64(c[2]), a+1
					}
				}
			}
			if a == 0 {
				continue
			}
			i := (y*size + x) * 4
			px[i+0] = uint8(b / a)
			px[i+1] = uint8(g / a)
			px[i+2] = uint8(r / a)
			px[i+3] = uint8(math.Round(a / (n * n) * 255))
		}
	}
	return px
}

func inRoundRect(x, y, x0, y0, x1, y1, r float64) bool {
	if x < x0 || x > x1 || y < y0 || y > y1 {
		return false
	}
	cx := math.Max(x0+r, math.Min(x, x1-r))
	cy := math.Max(y0+r, math.Min(y, y1-r))
	return (x-cx)*(x-cx)+(y-cy)*(y-cy) <= r*r
}
