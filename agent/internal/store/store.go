// Package store reads and writes the agent's files under %ProgramData%\Gnext\Agent (§3).
package store

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// Home is the agent's data folder. GNEXT_AGENT_HOME overrides it for development.
func Home() string {
	if h := os.Getenv("GNEXT_AGENT_HOME"); h != "" {
		return h
	}
	pd := os.Getenv("ProgramData")
	if pd == "" {
		pd = os.TempDir()
	}
	return filepath.Join(pd, "Gnext", "Agent")
}

func ConfigPath() string    { return filepath.Join(Home(), "config.json") }
func IdentityPath() string  { return filepath.Join(Home(), "identity.json") }
func JournalPath() string   { return filepath.Join(Home(), "journal.db") }
func UpdatesDir() string    { return filepath.Join(Home(), "updates") }
func LogsDir() string       { return filepath.Join(Home(), "logs") }
func BrowserDir() string    { return filepath.Join(Home(), "browser-profile") }
func BranchDataDir() string { return filepath.Join(Home(), "branch-data") }
func OfflinePath() string   { return filepath.Join(Home(), "offline-orders.db") }

// DevicesPath keeps the last config the cloud sent (§6.1, §13.2): the branch's printers and
// terminal, for an agent restarted while offline.
func DevicesPath() string { return filepath.Join(Home(), "devices.json") }

// CallNumbersPath keeps the last POS call count a heartbeat.ack carried (§13.9).
func CallNumbersPath() string { return filepath.Join(Home(), "call-numbers.json") }

// TillPath keeps which of the branch's tills the offline till sells as (§13.4).
func TillPath() string { return filepath.Join(Home(), "till.json") }

// LoadJSON and SaveJSON read and write one of the agent's files; SaveJSON replaces it whole.
func LoadJSON(path string, v any) error { return readJSON(path, v) }
func SaveJSON(path string, v any) error { return writeJSON(path, v) }

// Seal encrypts data for this machine with DPAPI, for files that hold secrets. Outside
// Windows (development only) it is stored as is, marked so.
func Seal(plain []byte) ([]byte, error) {
	blob, err := protect(plain)
	if err != nil {
		return nil, err
	}
	if blob == nil {
		return append([]byte{sealedPlain}, plain...), nil
	}
	return append([]byte{sealedDPAPI}, blob...), nil
}

// Unseal reverses Seal.
func Unseal(sealed []byte) ([]byte, error) {
	if len(sealed) == 0 {
		return nil, errors.New("sealed data is empty")
	}
	switch sealed[0] {
	case sealedDPAPI:
		return unprotect(sealed[1:])
	case sealedPlain:
		// Windows always seals with DPAPI; a plain file there was not written by the agent.
		if runtime.GOOS == "windows" {
			return nil, errors.New("sealed data is not encrypted")
		}
		return sealed[1:], nil
	}
	return nil, errors.New("sealed data has an unknown format")
}

const (
	sealedDPAPI = 'D'
	sealedPlain = 'P'
)

// InstallConfig is config.json, written by the installer.
type InstallConfig struct {
	Server string `json:"server"`
}

func LoadInstallConfig() (InstallConfig, error) {
	var c InstallConfig
	if err := readJSON(ConfigPath(), &c); err != nil {
		return c, err
	}
	c.Server = strings.TrimRight(c.Server, "/")
	if c.Server == "" {
		return c, fmt.Errorf("%s has no server", ConfigPath())
	}
	return c, nil
}

func SaveInstallConfig(c InstallConfig) error { return writeJSON(ConfigPath(), c) }

// Identity is identity.json, written by enrol. The device key is kept encrypted with DPAPI
// (machine scope) where the platform has it.
type Identity struct {
	AgentID    string `json:"agent_id"`
	TenantID   string `json:"tenant_id"`
	BranchID   string `json:"branch_id"`
	BranchName string `json:"branch_name"`
	WSURL      string `json:"ws_url"`

	DeviceKey          string `json:"device_key,omitempty"`
	DeviceKeyProtected string `json:"device_key_dpapi,omitempty"`
}

var ErrNotEnrolled = errors.New("agent is not enrolled; run: gnext-agent.exe enrol --code XXXX-XXXX")

// LoadIdentity returns the identity with DeviceKey in clear text.
func LoadIdentity() (Identity, error) {
	var id Identity
	if err := readJSON(IdentityPath(), &id); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return id, ErrNotEnrolled
		}
		return id, err
	}
	if id.DeviceKeyProtected != "" {
		blob, err := base64.StdEncoding.DecodeString(id.DeviceKeyProtected)
		if err != nil {
			return id, fmt.Errorf("identity.json: %w", err)
		}
		key, err := unprotect(blob)
		if err != nil {
			return id, fmt.Errorf("identity.json: decrypt device key: %w", err)
		}
		id.DeviceKey = string(key)
		id.DeviceKeyProtected = ""
	}
	if id.DeviceKey == "" {
		return id, ErrNotEnrolled
	}
	return id, nil
}

// SaveIdentity writes identity.json, encrypting the device key when it can.
func SaveIdentity(id Identity) error {
	if blob, err := protect([]byte(id.DeviceKey)); err == nil && blob != nil {
		id.DeviceKeyProtected = base64.StdEncoding.EncodeToString(blob)
		id.DeviceKey = ""
	}
	return writeJSON(IdentityPath(), id)
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

func writeJSON(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
