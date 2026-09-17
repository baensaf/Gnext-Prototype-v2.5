package localui

import (
	"context"
	"net"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Found is a host on the LAN that accepted a connection on the scanned port.
type Found struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

// crowded is how many answers make a network look like a virtual switch or a proxy that
// accepts every connection, rather than a LAN with a few printers.
const crowded = 32

// ScanLAN tries port on every address of each private IPv4 /24 this PC is on (at most three
// physical networks), and returns the ones that answer. Network printers listen on 9100.
func ScanLAN(ctx context.Context, port int) []Found {
	found := []Found{}
	for _, n := range localNetworks() {
		hits := scanNetwork(ctx, n, port)
		if len(hits) < crowded {
			found = append(found, hits...)
		}
	}
	sort.Slice(found, func(i, j int) bool { return ipLess(found[i].Host, found[j].Host) })
	return found
}

func scanNetwork(ctx context.Context, n network, port int) []Found {
	var (
		mu    sync.Mutex
		found []Found
		wg    sync.WaitGroup
		slots = make(chan struct{}, 128)
	)
	dialer := net.Dialer{Timeout: 400 * time.Millisecond}
	base := n.IP.To4()
	for i := 1; i < 255 && ctx.Err() == nil; i++ {
		ip := net.IPv4(base[0], base[1], base[2], byte(i)).To4()
		if ip.Equal(n.Self) {
			continue
		}
		wg.Add(1)
		slots <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-slots }()
			conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(ip.String(), strconv.Itoa(port)))
			if err != nil {
				return
			}
			conn.Close()
			mu.Lock()
			found = append(found, Found{Host: ip.String(), Port: port})
			mu.Unlock()
		}()
	}
	wg.Wait()
	return found
}

func ipLess(a, b string) bool {
	x, y := net.ParseIP(a).To4(), net.ParseIP(b).To4()
	for k := range 4 {
		if x[k] != y[k] {
			return x[k] < y[k]
		}
	}
	return false
}

type network struct {
	IP   net.IP // the /24 base
	Self net.IP
}

// virtualAdapter matches adapters a branch printer is never behind (Hyper-V, WSL, VPNs, VMs).
func virtualAdapter(name string) bool {
	name = strings.ToLower(name)
	for _, v := range []string{"vethernet", "wsl", "hyper-v", "virtualbox", "vmware", "docker", "loopback", "tailscale", "zerotier", "vpn"} {
		if strings.Contains(name, v) {
			return true
		}
	}
	return false
}

func localNetworks() []network {
	var out []network
	seen := map[string]bool{}
	ifaces, _ := net.Interfaces()
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 || virtualAdapter(iface.Name) {
			continue
		}
		addrs, _ := iface.Addrs()
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipnet.IP.To4()
			if ip == nil || !ip.IsPrivate() {
				continue
			}
			base := net.IPv4(ip[0], ip[1], ip[2], 0).To4()
			if seen[base.String()] {
				continue
			}
			seen[base.String()] = true
			out = append(out, network{IP: base, Self: ip})
			if len(out) == 3 {
				return out
			}
		}
	}
	return out
}
