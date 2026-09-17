//go:build windows

package cloud

import (
	"fmt"
	"os"

	"golang.org/x/sys/windows/registry"
)

// ThisMachine describes the PC for HQ (§3.3). machine_id is informational, not a secret.
func ThisMachine() Machine {
	m := Machine{OS: "Windows"}
	m.Hostname, _ = os.Hostname()
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE); err == nil {
		name, _, _ := k.GetStringValue("ProductName")
		build, _, _ := k.GetStringValue("CurrentBuildNumber")
		major, _, _ := k.GetIntegerValue("CurrentMajorVersionNumber")
		minor, _, _ := k.GetIntegerValue("CurrentMinorVersionNumber")
		k.Close()
		m.OS = fmt.Sprintf("%s %d.%d.%s", name, major, minor, build)
	}
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Cryptography`, registry.QUERY_VALUE|registry.WOW64_64KEY); err == nil {
		m.MachineID, _, _ = k.GetStringValue("MachineGuid")
		k.Close()
	}
	return m
}
