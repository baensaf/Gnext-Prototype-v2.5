package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"gnext/agent/internal/store"
)

// Enrolling again (from the settings page or the installer) changes the server and the identity,
// and leaves the rest of config.json, app_url among it, as it was.
func TestEnrolKeepsAppURLInConfig(t *testing.T) {
	t.Setenv("GNEXT_AGENT_HOME", t.TempDir())
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/agent/enrol":
			_ = json.NewEncoder(w).Encode(map[string]string{
				"agent_id": "a1", "tenant_id": "t1", "branch_id": "b1", "branch_name": "Test",
				"device_key": "gak_test", "ws_url": "ws://x/api/v1/agent/ws",
			})
		case "/api/v1/agent/me":
			_ = json.NewEncoder(w).Encode(map[string]string{"agent_id": "a1", "branch_id": "b1", "status": "ACTIVE"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer cloud.Close()

	if err := os.MkdirAll(store.Home(), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := store.SaveInstallConfig(store.InstallConfig{Server: "https://old.example", AppURL: "http://localhost:4173"}); err != nil {
		t.Fatal(err)
	}
	if _, err := enrolWith(context.Background(), cloud.URL, "ABCD-EFGH"); err != nil {
		t.Fatal(err)
	}
	cfg, err := store.LoadInstallConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Server != cloud.URL || cfg.AppURL != "http://localhost:4173" {
		t.Fatalf("config = %+v, want the new server and the old app_url", cfg)
	}
}
