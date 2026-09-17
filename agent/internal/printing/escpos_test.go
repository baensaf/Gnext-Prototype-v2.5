package printing

import (
	"bytes"
	"image"
	"image/color"
	"testing"
)

func TestToMonoScalesThresholdsAndTrims(t *testing.T) {
	// 1152 px wide (twice the paper), black bar on rows 10–19, white below.
	src := image.NewGray(image.Rect(0, 0, 1152, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 1152; x++ {
			v := uint8(255)
			if y >= 10 && y < 20 {
				v = 0
			}
			src.SetGray(x, y, color.Gray{Y: v})
		}
	}
	m := ToMono(src, 576)
	if m.Width != 576 {
		t.Fatalf("width = %d", m.Width)
	}
	if m.Height != 10 { // rows 5–9 black at half scale; trailing white trimmed
		t.Fatalf("height = %d, want 10", m.Height)
	}
	row := 72
	if m.Bits[5*row] != 0xFF || m.Bits[0] != 0 {
		t.Fatalf("unexpected bits: row0=%x row5=%x", m.Bits[0], m.Bits[5*row])
	}
}

func TestEncodeRasterBandsAndCuts(t *testing.T) {
	m := &Mono{Width: 576, Height: 300, Bits: make([]byte, 72*300)}
	out := EncodeRaster(m, 2)
	if n := bytes.Count(out, []byte{0x1D, 0x76, 0x30, 0x00}); n != 4 { // 2 bands × 2 copies
		t.Fatalf("GS v 0 blocks = %d, want 4", n)
	}
	if n := bytes.Count(out, []byte{0x1D, 0x56, 0x42, 0x00}); n != 2 {
		t.Fatalf("cuts = %d, want 2", n)
	}
	if !bytes.HasPrefix(out, []byte{0x1B, 0x40, 0x1D, 0x76, 0x30, 0x00, 72, 0, 255, 0}) {
		t.Fatalf("header = % x", out[:10])
	}
}

func TestDotsForPaper(t *testing.T) {
	if DotsForPaper(58) != 384 || DotsForPaper(80) != 576 || DotsForPaper(0) != 576 {
		t.Fatal("wrong dot widths")
	}
}
