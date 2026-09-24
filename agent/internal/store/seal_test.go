package store

import (
	"bytes"
	"runtime"
	"testing"
)

func TestSealRoundTripsAndHidesThePlainText(t *testing.T) {
	plain := []byte(`{"pin_hash":"$argon2id$secret"}`)
	sealed, err := Seal(plain)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS == "windows" && bytes.Contains(sealed, []byte("argon2id")) {
		t.Fatal("DPAPI left the plain text visible")
	}
	back, err := Unseal(sealed)
	if err != nil || !bytes.Equal(back, plain) {
		t.Fatalf("Unseal = %q, %v", back, err)
	}
}

func TestUnsealRefusesAPlainFileOnWindows(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("plain sealing is the only kind outside Windows")
	}
	if _, err := Unseal(append([]byte{sealedPlain}, []byte("{}")...)); err == nil {
		t.Fatal("a plain file was accepted as sealed")
	}
}
