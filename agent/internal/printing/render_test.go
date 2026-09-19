package printing

import (
	"context"
	"image"
	"image/png"
	"os"
	"testing"
	"time"
)

const persianTicket = `<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><style>
body { font-family: Tahoma, sans-serif; width: 300px; margin: 0 auto; padding: 16px; font-size: 13px; }
h1 { font-size: 18px; text-align: center; }
</style></head><body><h1>آشپزخانه – گریل</h1><p>سفارش ۱۰۲۴ · میز ۷</p><p>۲ × همبرگر ویژه</p><p>بدون پیاز</p></body></html>`

// Renders a Persian ticket in a real Edge/Chrome. Skipped where neither is installed.
// Set GNEXT_RENDER_OUT=path.png to look at the 1-bit result.
func TestBrowserRendererPersianTicket(t *testing.T) {
	if _, err := findBrowser(); err != nil {
		t.Skip(err)
	}
	r := &BrowserRenderer{ProfileDir: profileDir(t)}
	defer r.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	img, err := r.Render(ctx, persianTicket, 576)
	if err != nil {
		t.Fatal(err)
	}
	if w := img.Bounds().Dx(); w < 570 || w > 580 {
		t.Fatalf("rendered width = %d, want about 576", w)
	}
	m := ToMono(img, 576)
	black := 0
	for _, b := range m.Bits {
		for ; b != 0; b &= b - 1 {
			black++
		}
	}
	if total := m.Width * m.Height; m.Height < 100 || black < 500 || black > total/4 {
		t.Fatalf("ticket does not look like text: height %d, black dots %d of %d", m.Height, black, total)
	}
	if out := os.Getenv("GNEXT_RENDER_OUT"); out != "" {
		save(t, out, m)
	}
}

// profileDir is a temp browser profile. Unlike t.TempDir, its cleanup waits for the browser's
// helper processes, which can still be writing to it for a moment after the browser exits.
func profileDir(t *testing.T) string {
	dir, err := os.MkdirTemp("", "gnext-render-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for i := 0; i < 20 && os.RemoveAll(dir) != nil; i++ {
			time.Sleep(250 * time.Millisecond)
		}
	})
	return dir
}

func save(t *testing.T, path string, m *Mono) {
	img := image.NewGray(image.Rect(0, 0, m.Width, m.Height))
	row := (m.Width + 7) / 8
	for y := 0; y < m.Height; y++ {
		for x := 0; x < m.Width; x++ {
			if m.Bits[y*row+x/8]&(0x80>>(x%8)) == 0 {
				img.Pix[y*m.Width+x] = 255
			}
		}
	}
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
}
