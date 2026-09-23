// Package store reads and writes the agent's files under %ProgramData%\Gnext\Agent (§3).
package store

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
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
