package cloud

import "testing"

func TestWindowsName(t *testing.T) {
	cases := map[[2]string]string{
		{"Windows 10 Pro", "26200"}:      "Windows 11 Pro",
		{"Windows 10 Pro", "19045"}:      "Windows 10 Pro",
		{"Windows 11 Home", "22631"}:     "Windows 11 Home",
		{"Windows Server 2022", "20348"}: "Windows Server 2022",
	}
	for in, want := range cases {
		if got := WindowsName(in[0], in[1]); got != want {
			t.Errorf("WindowsName(%q, %q) = %q, want %q", in[0], in[1], got, want)
		}
	}
}
