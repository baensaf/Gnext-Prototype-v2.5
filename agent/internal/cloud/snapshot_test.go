package cloud

import (
	"compress/gzip"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSnapshotSendsTheVersionHeldAndUnzips(t *testing.T) {
	var gotHeld, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/agent/data/snapshot" {
			http.NotFound(w, r)
			return
		}
		gotHeld, gotAuth = r.Header.Get("If-None-Match"), r.Header.Get("Authorization")
		if gotHeld == `"v2"` {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("ETag", `"v2"`)
		w.Header().Set("Content-Encoding", "gzip")
		zw := gzip.NewWriter(w)
		_, _ = zw.Write([]byte(`{"data_version":"v2","products":[]}`))
		_ = zw.Close()
	}))
	defer srv.Close()
	c := &Client{Server: srv.URL, Key: "gak_test", Version: "1.1.0"}

	body, version, err := c.Snapshot(context.Background(), "v1")
	if err != nil || version != "v2" || string(body) != `{"data_version":"v2","products":[]}` {
		t.Fatalf("Snapshot = %s, %q, %v", body, version, err)
	}
	if gotHeld != `"v1"` || gotAuth != "Bearer gak_test" {
		t.Fatalf("If-None-Match = %q, Authorization = %q", gotHeld, gotAuth)
	}

	if _, version, err := c.Snapshot(context.Background(), "v2"); !errors.Is(err, ErrNotModified) || version != "v2" {
		t.Fatalf("second Snapshot = %q, %v, want ErrNotModified", version, err)
	}
}

func TestSnapshotWithoutAVersionIsRefused(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"products":[]}`))
	}))
	defer srv.Close()
	if _, _, err := (&Client{Server: srv.URL}).Snapshot(context.Background(), ""); err == nil {
		t.Fatal("want an error for a snapshot without data_version")
	}
}
