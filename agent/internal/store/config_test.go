package store

import (
	"os"
	"strings"
	"testing"
)

// config.json may carry app_url, the frontend's address when it is not the server's (§19.7).
func TestInstallConfigAppURLOverridesTheFrontendOriginOnly(t *testing.T) {
	t.Setenv("GNEXT_AGENT_HOME", t.TempDir())
	if err := os.WriteFile(ConfigPath(), []byte(`{"server":"https://gnext.top/","app_url":" http://localhost:4173/ "}`), 0o600); err != nil {
		t.Fatal(err)
	}
	c, err := LoadInstallConfig()
	if err != nil {
		t.Fatal(err)
	}
	if c.Server != "https://gnext.top" || c.AppURL != "http://localhost:4173" || c.AppOrigin() != "http://localhost:4173" {
		t.Fatalf("config = %+v, origin %q", c, c.AppOrigin())
	}

	// Saving keeps it; without it the frontend comes from the server.
	if err := SaveInstallConfig(c); err != nil {
		t.Fatal(err)
	}
	if again, _ := LoadInstallConfig(); again.AppURL != "http://localhost:4173" {
		t.Fatalf("app_url lost on save: %+v", again)
	}
	c.AppURL = ""
	if c.AppOrigin() != "https://gnext.top" {
		t.Fatalf("origin = %q, want the server", c.AppOrigin())
	}
	b, _ := os.ReadFile(ConfigPath())
	if err := SaveInstallConfig(c); err != nil {
		t.Fatal(err)
	}
	if b2, _ := os.ReadFile(ConfigPath()); string(b2) == string(b) {
		t.Fatal("the file was not rewritten")
	}
	if got, _ := os.ReadFile(ConfigPath()); string(got) == "" || strings.Contains(string(got), "app_url") {
		t.Fatalf("an empty app_url is written out: %s", got)
	}
}

func TestAppDirIsUnderTheDataFolder(t *testing.T) {
	home := t.TempDir()
	t.Setenv("GNEXT_AGENT_HOME", home)
	if got, want := AppDir(), home+string(os.PathSeparator)+"app"; got != want {
		t.Fatalf("AppDir = %q, want %q", got, want)
	}
}

// app_at_sign_in is on until config.json says off (§19.12); changing it keeps the rest of the file.
func TestAppAtSignInIsOnByDefaultAndKeepsTheRestOfTheConfig(t *testing.T) {
	t.Setenv("GNEXT_AGENT_HOME", t.TempDir())

	// A PC with no config at all: the setting is on, but with no server there is nothing to open.
	if c, _ := LoadInstallConfig(); !c.OpenAppAtSignIn() {
		t.Fatal("off by default")
	}
	if OpenAppAtSignIn() {
		t.Fatal("an unconfigured PC opens an app it does not have")
	}

	if err := os.WriteFile(ConfigPath(), []byte(`{"server":"https://gnext.top","app_url":"http://localhost:4173"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if !OpenAppAtSignIn() {
		t.Fatal("a configured PC with no setting should open the app")
	}

	if err := SetAppAtSignIn(false); err != nil {
		t.Fatal(err)
	}
	c, err := LoadInstallConfig()
	if err != nil || c.OpenAppAtSignIn() || c.Server != "https://gnext.top" || c.AppURL != "http://localhost:4173" {
		t.Fatalf("after turning it off: %+v, %v", c, err)
	}
	if OpenAppAtSignIn() {
		t.Fatal("still opens after being turned off")
	}
	if err := SetAppAtSignIn(true); err != nil {
		t.Fatal(err)
	}
	if !OpenAppAtSignIn() {
		t.Fatal("does not open after being turned back on")
	}

	// Saving the enrolment (server) keeps the setting.
	_ = SetAppAtSignIn(false)
	c, _ = LoadInstallConfig()
	c.Server = "https://other.example"
	if err := SaveInstallConfig(c); err != nil {
		t.Fatal(err)
	}
	if again, _ := LoadInstallConfig(); again.OpenAppAtSignIn() {
		t.Fatal("saving the server turned the setting back on")
	}
}

// The setting can be made before the PC has a server; the file then has no server, as before.
func TestAppAtSignInCanBeSetOnAPCWithNoConfig(t *testing.T) {
	t.Setenv("GNEXT_AGENT_HOME", t.TempDir())
	if err := SetAppAtSignIn(false); err != nil {
		t.Fatal(err)
	}
	c, err := LoadInstallConfig()
	if err == nil || c.OpenAppAtSignIn() {
		t.Fatalf("config = %+v, err = %v; want no server and the setting off", c, err)
	}
}
