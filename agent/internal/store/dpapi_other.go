//go:build !windows

package store

import "errors"

// Outside Windows there is no DPAPI; the key is stored in clear text (development only).
func protect([]byte) ([]byte, error) { return nil, nil }

func unprotect([]byte) ([]byte, error) { return nil, errors.New("DPAPI is only available on Windows") }
