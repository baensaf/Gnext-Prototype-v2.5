package cloud

import "strconv"

// WindowsName corrects ProductName, which still says "Windows 10" on Windows 11. Build 22000 is
// the first Windows 11 build.
func WindowsName(productName, build string) string {
	if n, err := strconv.Atoi(build); err == nil && n >= 22000 && len(productName) >= 10 && productName[:10] == "Windows 10" {
		return "Windows 11" + productName[10:]
	}
	return productName
}
