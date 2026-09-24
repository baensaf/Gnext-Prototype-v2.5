package till

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The tickets in testdata/tickets are what the cloud's PrintRenderService renders for each case
// (backend/test/print-render-parity.spec.ts keeps them so). An offline ticket must be the same page.
func TestTicketsMatchTheCloudRenderer(t *testing.T) {
	dir := filepath.Join("testdata", "tickets")
	raw, err := os.ReadFile(filepath.Join(dir, "cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases map[string]RenderDoc
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	if len(cases) == 0 {
		t.Fatal("no cases")
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			want, err := os.ReadFile(filepath.Join(dir, name+".html"))
			if err != nil {
				t.Fatal(err)
			}
			got := RenderDocument(c)
			if exp := strings.ReplaceAll(string(want), "\r\n", "\n"); got != exp {
				gl, el := strings.Split(got, "\n"), strings.Split(exp, "\n")
				for i := 0; i < len(gl) || i < len(el); i++ {
					var g, e string
					if i < len(gl) {
						g = gl[i]
					}
					if i < len(el) {
						e = el[i]
					}
					if g != e {
						t.Fatalf("line %d differs\n got: %q\nwant: %q", i+1, g, e)
					}
				}
			}
		})
	}
}

func TestAReprintIsMarkedWhereTheOriginalLeftRoom(t *testing.T) {
	html := RenderDocument(RenderDoc{DocumentType: "KITCHEN_TICKET", OrderNumber: "X-1", Items: []RenderItem{{ProductName: "a", Quantity: "1"}}})
	copied := MarkAsReprint(html)
	if !strings.Contains(copied, "چاپ مجدد") || strings.Contains(copied, reprintSlot) {
		t.Fatalf("reprint not marked")
	}
}

func TestJalaliDatesAroundNowruz(t *testing.T) {
	for _, c := range []struct{ gy, gm, gd, jy, jm, jd int }{
		{2026, 3, 20, 1404, 12, 29}, {2026, 3, 21, 1405, 1, 1}, {2025, 3, 21, 1404, 1, 1}, {2024, 3, 19, 1402, 12, 29},
		{2024, 3, 20, 1403, 1, 1}, {2026, 9, 24, 1405, 7, 2}, {2026, 12, 31, 1405, 10, 10},
	} {
		if y, m, d := jalali(c.gy, c.gm, c.gd); y != c.jy || m != c.jm || d != c.jd {
			t.Errorf("%d-%d-%d = %d/%d/%d, want %d/%d/%d", c.gy, c.gm, c.gd, y, m, d, c.jy, c.jm, c.jd)
		}
	}
}
