package localui

import (
	"net"
	"strconv"
	"strings"
)

// The addresses other registers of the branch reach this PC on (agent-protocol §19.12): the settings
// page shows them and the heartbeat reports them.

// netIface is what the filter needs of a network adapter.
type netIface struct {
	Name     string
	Up       bool
	Loopback bool
	Addrs    []net.Addr
}

// virtualAdapters are name fragments of adapters that are not the branch's network: Hyper-V and WSL
// switches, VM and container hosts, and loopback or Bluetooth pseudo-adapters. Their addresses are
// private too, and a register on the shop's Wi-Fi cannot reach them.
var virtualAdapters = []string{"vethernet", "wsl", "virtualbox", "vmware", "docker", "hyper-v", "loopback", "bluetooth", "npcap"}

func isVirtualAdapter(name string) bool {
	n := strings.ToLower(name)
	for _, v := range virtualAdapters {
		if strings.Contains(n, v) {
			return true
		}
	}
	return false
}

// PrivateIPv4s lists this PC's IPv4 addresses on private networks (10/8, 172.16/12, 192.168/16), in
// the order of its adapters. Adapters that are down, loopback or virtual are left out, and so are
// link-local (169.254) and public addresses.
func PrivateIPv4s() []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return []string{}
	}
	in := make([]netIface, 0, len(ifaces))
	for _, ifc := range ifaces {
		addrs, _ := ifc.Addrs()
		in = append(in, netIface{Name: ifc.Name, Up: ifc.Flags&net.FlagUp != 0, Loopback: ifc.Flags&net.FlagLoopback != 0, Addrs: addrs})
	}
	return privateIPv4s(in)
}

func privateIPv4s(ifaces []netIface) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, ifc := range ifaces {
		if !ifc.Up || ifc.Loopback || isVirtualAdapter(ifc.Name) {
			continue
		}
		for _, a := range ifc.Addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip4 := ip.To4(); ip4 != nil && ip4.IsPrivate() && !seen[ip4.String()] {
				seen[ip4.String()] = true
				out = append(out, ip4.String())
			}
		}
	}
	return out
}

// lanURLs turns the address the LAN listener is bound to into the URLs registers use: a listener on
// every address gets one URL per private address of the PC, one bound to a single address gets that.
// An empty bound address (no LAN listener) gives an empty list.
func lanURLs(bound string, ips []string) []string {
	out := []string{}
	host, port, err := net.SplitHostPort(bound)
	if err != nil {
		return out
	}
	if _, err := strconv.Atoi(port); err != nil {
		return out
	}
	if ip := net.ParseIP(host); host != "" && (ip == nil || !ip.IsUnspecified()) {
		return append(out, "http://"+net.JoinHostPort(host, port)+"/")
	}
	for _, ip := range ips {
		out = append(out, "http://"+net.JoinHostPort(ip, port)+"/")
	}
	return out
}

// LANURLs are the addresses other registers use to reach the app on this PC: empty while the LAN
// listener is not listening (turned off, or its port is taken).
func (s *Server) LANURLs() []string {
	bound, _ := s.lanBound.Load().(string)
	ips := s.Addresses
	if ips == nil {
		ips = PrivateIPv4s
	}
	return lanURLs(bound, ips())
}
