package main

import (
	"bytes"
	_ "embed"
	"image"
	"image/draw"
	"image/png"
	"math"
	"sync"
)

// logoPNG is the Gnext mark (a white G on a green tile), 256×256. The exe's icon is made
// from the same file (winres).
//
//go:embed winres/icon.png
var logoPNG []byte

// trayColours: green ready, amber a warning, red a problem, grey the agent not running.
var trayColours = map[trayLevel][3]uint8{
	levelOK:   {0x22, 0xC5, 0x5E},
	levelWarn: {0xF5, 0x9E, 0x0B},
	levelBad:  {0xEF, 0x44, 0x44},
	levelDown: {0x9C, 0xA3, 0xAF},
}

var logo = sync.OnceValue(func() *image.NRGBA {
	img, err := png.Decode(bytes.NewReader(logoPNG))
	if err != nil {
		return image.NewNRGBA(image.Rect(0, 0, 1, 1))
	}
	out := image.NewNRGBA(img.Bounds())
	draw.Draw(out, out.Bounds(), img, img.Bounds().Min, draw.Src)
	return out
})

// drawTrayIcon draws the Gnext mark at size×size with a status light over its bottom-right
// corner, as BGRA pixels (top row first, straight alpha). The white ring keeps a green
// "ready" light apart from the green tile.
func drawTrayIcon(size int, level trayLevel) []byte {
	px := scaleLogo(size)
	c := trayColours[level]
	s := float64(size)
	cx, cy, r := 0.79*s, 0.79*s, 0.18*s
	ring := r + math.Max(1, 0.06*s)
	const n = 4
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			var inDot, inRing float64
			for sy := 0; sy < n; sy++ {
				for sx := 0; sx < n; sx++ {
					dx := float64(x) + (float64(sx)+0.5)/n - cx
					dy := float64(y) + (float64(sy)+0.5)/n - cy
					d := math.Hypot(dx, dy)
					if d <= r {
						inDot++
					} else if d <= ring {
						inRing++
					}
				}
			}
			if inDot+inRing == 0 {
				continue
			}
			// The ring is white and the dot the status colour, over the logo.
			i := (y*size + x) * 4
			fd, fr := inDot/(n*n), inRing/(n*n)
			under := 1 - fd - fr
			for k, v := range [3]float64{float64(c[2]), float64(c[1]), float64(c[0])} { // BGR
				px[i+k] = uint8(math.Round(float64(px[i+k])*under + v*fd + 255*fr))
			}
			a := float64(px[i+3])/255*under + fd + fr
			px[i+3] = uint8(math.Round(math.Min(a, 1) * 255))
		}
	}
	return px
}

// scaleLogo shrinks the logo to size×size BGRA by averaging each target pixel's area,
// weighting colour by alpha so the transparent background does not darken the edges.
func scaleLogo(size int) []byte {
	src := logo()
	sw, sh := src.Bounds().Dx(), src.Bounds().Dy()
	px := make([]byte, size*size*4)
	for y := 0; y < size; y++ {
		y0, y1 := y*sh/size, max((y+1)*sh/size, y*sh/size+1)
		for x := 0; x < size; x++ {
			x0, x1 := x*sw/size, max((x+1)*sw/size, x*sw/size+1)
			var r, g, b, a, count float64
			for sy := y0; sy < y1; sy++ {
				for sx := x0; sx < x1; sx++ {
					o := src.PixOffset(sx, sy)
					al := float64(src.Pix[o+3])
					r += float64(src.Pix[o]) * al
					g += float64(src.Pix[o+1]) * al
					b += float64(src.Pix[o+2]) * al
					a += al
					count++
				}
			}
			if a == 0 {
				continue
			}
			i := (y*size + x) * 4
			px[i+0] = uint8(b / a)
			px[i+1] = uint8(g / a)
			px[i+2] = uint8(r / a)
			px[i+3] = uint8(a / count)
		}
	}
	return px
}
