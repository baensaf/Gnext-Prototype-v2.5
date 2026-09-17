package printing

import (
	"bytes"
	"image"
	"image/color"
)

// DotsForPaper returns the printable width in dots for a paper width (§6.2).
func DotsForPaper(mm int) int {
	if mm > 0 && mm <= 58 {
		return 384
	}
	return 576
}

// ToMono turns an image into a 1-bit bitmap exactly `width` dots wide: it scales down if the
// image is wider, pads with white if narrower, thresholds at mid-grey and trims white rows at
// the bottom. Thresholding (not dithering) keeps small Persian glyphs crisp.
func ToMono(src image.Image, width int) *Mono {
	b := src.Bounds()
	scale := 1.0
	if b.Dx() > width {
		scale = float64(b.Dx()) / float64(width)
	}
	height := int(float64(b.Dy()) / scale)
	m := &Mono{Width: width, Height: height, Bits: make([]byte, ((width+7)/8)*height)}
	offsetX := 0
	if b.Dx() < width {
		offsetX = (width - b.Dx()) / 2
	}
	last := -1
	for y := 0; y < height; y++ {
		sy := b.Min.Y + int(float64(y)*scale)
		for x := 0; x < width; x++ {
			sx := b.Min.X + int(float64(x-offsetX)*scale)
			if x < offsetX || sx >= b.Max.X {
				continue
			}
			if luminanceOnWhite(src.At(sx, sy)) < 0x8000 {
				m.set(x, y)
				last = y
			}
		}
	}
	m.Height = last + 1
	m.Bits = m.Bits[:((width+7)/8)*m.Height]
	return m
}

// luminanceOnWhite is the pixel's brightness (0–0xFFFF) as if drawn on white paper, so a
// transparent screenshot background counts as white, not black.
func luminanceOnWhite(c color.Color) uint32 {
	r, g, b, a := c.RGBA() // premultiplied
	white := 0xFFFF - a
	return (299*(r+white) + 587*(g+white) + 114*(b+white)) / 1000
}

// Mono is a 1-bit image, one bit per dot, MSB first, 1 = black.
type Mono struct {
	Width, Height int
	Bits          []byte
}

func (m *Mono) set(x, y int) {
	row := (m.Width + 7) / 8
	m.Bits[y*row+x/8] |= 0x80 >> (x % 8)
}

// bandRows keeps each GS v 0 block small enough for printers with small buffers.
const bandRows = 255

// EncodeRaster builds the ESC/POS byte stream: init, the image as GS v 0 bands, feed, partial
// cut. copies repeats the whole ticket, each with its own cut.
func EncodeRaster(m *Mono, copies int) []byte {
	var buf bytes.Buffer
	row := (m.Width + 7) / 8
	for c := 0; c < copies; c++ {
		buf.Write([]byte{0x1B, 0x40}) // ESC @
		for y := 0; y < m.Height; y += bandRows {
			h := min(bandRows, m.Height-y)
			buf.Write([]byte{0x1D, 0x76, 0x30, 0x00, byte(row), byte(row >> 8), byte(h), byte(h >> 8)})
			buf.Write(m.Bits[y*row : (y+h)*row])
		}
		buf.Write([]byte{0x1B, 0x64, 0x04})       // ESC d 4: feed 4 lines
		buf.Write([]byte{0x1D, 0x56, 0x42, 0x00}) // GS V 66 0: feed and partial cut
	}
	return buf.Bytes()
}
