package till

import (
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// errBadHash is a stored hash the agent cannot read. It never matches.
var errBadHash = errors.New("unreadable PIN hash")

// verifyPIN checks a PIN against the hash the cloud stores (§13.3): argon2 in PHC form,
// `$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>`, base64 without padding.
func verifyPIN(pin, phc string) (bool, error) {
	parts := strings.Split(phc, "$")
	if len(parts) != 6 || parts[0] != "" || parts[2] != "v=19" {
		return false, errBadHash
	}
	var m uint32
	var t uint32
	var p uint8
	// Bounded, so a damaged hash cannot make the agent spend gigabytes on one sign-in.
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &m, &t, &p); err != nil || m == 0 || m > 256<<10 || t == 0 || t > 10 || p == 0 {
		return false, errBadHash
	}
	salt, err1 := b64(parts[4])
	want, err2 := b64(parts[5])
	if err1 != nil || err2 != nil || len(want) == 0 {
		return false, errBadHash
	}
	var got []byte
	switch parts[1] {
	case "argon2id":
		got = argon2.IDKey([]byte(pin), salt, t, m, p, uint32(len(want)))
	case "argon2i":
		got = argon2.Key([]byte(pin), salt, t, m, p, uint32(len(want)))
	default:
		return false, errBadHash
	}
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

func b64(s string) ([]byte, error) {
	return base64.RawStdEncoding.DecodeString(strings.TrimRight(s, "="))
}
