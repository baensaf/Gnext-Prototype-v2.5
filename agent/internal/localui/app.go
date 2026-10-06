package localui

import (
	"bytes"
	"encoding/json"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// The app: the cloud's own frontend build, served from the agent's disk (agent-protocol §19.7).

// metaName is the name of the tag the agent adds to index.html; the app reads it (§19.9).
const metaName = "gnext-agent"

var headTag = regexp.MustCompile(`(?i)<head(\s[^>]*)?>`)

// agentMeta is the tag's content, in this field order.
type agentMeta struct {
	Version  string `json:"version"`
	CloudURL string `json:"cloud_url"`
	LAN      bool   `json:"lan"`
}

// metaTag renders the tag: JSON in a single-quoted attribute, HTML-escaped.
func metaTag(m agentMeta) string {
	b, _ := json.Marshal(m) // escapes < > & itself
	esc := strings.NewReplacer("&", "&amp;", "'", "&#39;", "<", "&lt;", ">", "&gt;").Replace(string(b))
	return `<meta name="` + metaName + `" content='` + esc + `'>`
}

// injectMeta puts tag right after <head>, once. A page with no <head> gets it at the top.
func injectMeta(index []byte, tag string) []byte {
	loc := headTag.FindIndex(index)
	at := 0
	if loc != nil {
		at = loc[1]
	}
	out := make([]byte, 0, len(index)+len(tag))
	out = append(out, index[:at]...)
	out = append(out, tag...)
	return append(out, index[at:]...)
}

// serveApp answers every path that is not /api/, /uploads/ or /agent/: a file of the current build,
// else its index.html, so the app's own routes work on reload.
func (s *Server) serveApp(lan bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		build := s.currentBuild()
		if build == nil {
			noBuildPage(w, r)
			return
		}
		rel := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if rel != "" && rel != "index.html" {
			if file, _, ok := build.File(rel); ok {
				serveFile(w, r, file, rel)
				return
			}
		}
		tag := metaTag(agentMeta{Version: s.Version, CloudURL: s.Host.State().AppOrigin, LAN: lan})
		body := injectMeta(build.Index(), tag)
		h := w.Header()
		h.Set("Content-Type", "text/html; charset=utf-8")
		h.Set("Cache-Control", "no-cache")
		h.Set("X-Content-Type-Options", "nosniff")
		http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(body))
	}
}

func serveFile(w http.ResponseWriter, r *http.Request, file, rel string) {
	f, err := os.Open(file)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || st.IsDir() {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	h := w.Header()
	h.Set("Content-Type", contentType(rel))
	h.Set("X-Content-Type-Options", "nosniff")
	if strings.HasPrefix(rel, "assets/") {
		h.Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	http.ServeContent(w, r, filepath.Base(file), st.ModTime(), f)
}

// types is what the page needs, spelled out because Windows takes Go's answer from the registry,
// where a stray entry makes .js text/plain and a browser then refuses the script.
var types = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".mjs":         "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".json":        "application/json; charset=utf-8",
	".map":         "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".jpg":         "image/jpeg",
	".jpeg":        "image/jpeg",
	".gif":         "image/gif",
	".webp":        "image/webp",
	".avif":        "image/avif",
	".ico":         "image/x-icon",
	".woff":        "font/woff",
	".woff2":       "font/woff2",
	".ttf":         "font/ttf",
	".otf":         "font/otf",
	".txt":         "text/plain; charset=utf-8",
	".xml":         "application/xml",
	".wasm":        "application/wasm",
}

func contentType(name string) string {
	ext := strings.ToLower(path.Ext(name))
	if t, ok := types[ext]; ok {
		return t
	}
	if t := mime.TypeByExtension(ext); t != "" {
		return t
	}
	return "application/octet-stream"
}

// noBuildPage answers while the agent has no build yet: a PC installed and never online.
func noBuildPage(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	h.Set("Cache-Control", "no-store")
	h.Set("Retry-After", "10")
	w.WriteHeader(http.StatusServiceUnavailable)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write([]byte(noBuildHTML))
}

// noBuildHTML is the Persian page of §19.7. It asks again every ten seconds, so the app opens by
// itself once the first build has been downloaded.
const noBuildHTML = `<!DOCTYPE html><html dir="rtl" lang="fa"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="10">
<title>Gnext</title>
<style>
body { font-family: "Segoe UI", Tahoma, sans-serif; display: flex; align-items: center; justify-content: center;
  min-height: 100vh; margin: 0; background: #f6f7f8; color: #1c252e; }
@media (prefers-color-scheme: dark) { body { background: #141a21; color: #e5e8eb; } }
div { text-align: center; max-width: 30rem; padding: 1rem; line-height: 1.9; }
h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
p { margin: 0; opacity: .75; }
</style></head><body><div>
<h1>جی‌نکست هنوز روی این رایانه بارگیری نشده است</h1>
<p>یک بار این رایانه را به اینترنت وصل کنید. این صفحه خودش باز می‌شود.</p>
</div></body></html>`
