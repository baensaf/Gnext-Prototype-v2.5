//go:build windows

package store

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

const cryptprotectLocalMachine = 0x4

func blob(b []byte) *windows.DataBlob {
	if len(b) == 0 {
		return &windows.DataBlob{}
	}
	return &windows.DataBlob{Size: uint32(len(b)), Data: &b[0]}
}

func takeBlob(out *windows.DataBlob) []byte {
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return append([]byte(nil), unsafe.Slice(out.Data, out.Size)...)
}

func protect(plain []byte) ([]byte, error) {
	var out windows.DataBlob
	if err := windows.CryptProtectData(blob(plain), nil, nil, 0, nil, cryptprotectLocalMachine, &out); err != nil {
		return nil, err
	}
	return takeBlob(&out), nil
}

func unprotect(cipher []byte) ([]byte, error) {
	var out windows.DataBlob
	if err := windows.CryptUnprotectData(blob(cipher), nil, nil, 0, nil, cryptprotectLocalMachine, &out); err != nil {
		return nil, err
	}
	return takeBlob(&out), nil
}
