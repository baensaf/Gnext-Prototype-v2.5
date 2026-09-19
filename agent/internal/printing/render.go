package printing

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/chromedp/cdproto/cdp"
	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/cdproto/runtime"
	"github.com/chromedp/chromedp"
)

// Renderer turns the cloud's ticket HTML into an image `widthDots` wide.
type Renderer interface {
	Render(ctx context.Context, html string, widthDots int) (image.Image, error)
}

// cssWidth is the CSS width the cloud lays tickets out for: a 300 px body plus 16 px padding.
const cssWidth = 332

// BrowserRenderer renders HTML in headless Microsoft Edge (installed on every Windows 10/11
// PC), or Chrome if Edge is missing. It shapes Persian text with the system fonts, which is
// why the agent prints images rather than ESC/POS text (§6.2).
//
// Edge refuses to run as LocalSystem (it exits with code 1002 and says nothing), so when the
// agent runs as the Windows service the browser is started in the signed-in user's session
// with its own profile, and ProfileDir is only used when the agent runs as a normal user.
type BrowserRenderer struct {
	ProfileDir string

	mu      sync.Mutex
	browser context.Context
	cancel  context.CancelFunc
}

func (r *BrowserRenderer) Render(ctx context.Context, html string, widthDots int) (image.Image, error) {
	r.mu.Lock() // one tab at a time is plenty for a branch
	defer r.mu.Unlock()
	if err := r.start(); err != nil {
		return nil, err
	}
	tab, cancelTab := chromedp.NewContext(r.browser)
	defer cancelTab()
	tab, cancelTimeout := context.WithTimeout(tab, 30*time.Second)
	defer cancelTimeout()
	stop := context.AfterFunc(ctx, cancelTab)
	defer stop()

	var shot []byte
	err := chromedp.Run(tab,
		chromedp.EmulateViewport(cssWidth, 200, chromedp.EmulateScale(float64(widthDots)/cssWidth)),
		// Paper is white: ignore a dark Windows theme and paint unstyled areas white.
		emulation.SetEmulatedMedia().WithFeatures([]*emulation.MediaFeature{{Name: "prefers-color-scheme", Value: "light"}}),
		emulation.SetDefaultBackgroundColorOverride().WithColor(&cdp.RGBA{R: 255, G: 255, B: 255, A: 1}),
		chromedp.Navigate("about:blank"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			tree, err := page.GetFrameTree().Do(ctx)
			if err != nil {
				return err
			}
			return page.SetDocumentContent(tree.Frame.ID, html).Do(ctx)
		}),
		chromedp.Evaluate(`document.fonts.ready.then(() => true)`, nil, awaitPromise),
		chromedp.FullScreenshot(&shot, 100),
	)
	if err != nil {
		// A dead browser is restarted on the next job.
		r.stopLocked()
		return nil, err
	}
	return png.Decode(bytes.NewReader(shot))
}

func awaitPromise(p *runtime.EvaluateParams) *runtime.EvaluateParams { return p.WithAwaitPromise(true) }

// execBrowser starts the browser as a child of the agent, under the agent's own account.
func execBrowser(exe, profileDir string) (context.Context, context.CancelFunc, error) {
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath(exe),
		chromedp.UserDataDir(profileDir),
		chromedp.NoSandbox,
		chromedp.Flag("hide-scrollbars", true),
		chromedp.Flag("force-color-profile", "srgb"),
	)
	alloc, cancel := chromedp.NewExecAllocator(context.Background(), opts...)
	return alloc, cancel, nil
}

func (r *BrowserRenderer) start() error {
	if r.browser != nil && r.browser.Err() == nil {
		return nil
	}
	exe, err := findBrowser()
	if err != nil {
		return err
	}
	alloc, cancelAlloc, err := launchBrowser(exe, r.ProfileDir)
	if err != nil {
		return fmt.Errorf("start %s: %w", exe, err)
	}
	browser, cancelBrowser := chromedp.NewContext(alloc)
	if err := chromedp.Run(browser); err != nil {
		cancelBrowser()
		cancelAlloc()
		return fmt.Errorf("start %s: %w", exe, err)
	}
	r.browser = browser
	r.cancel = func() { cancelBrowser(); cancelAlloc() }
	return nil
}

// Close stops the browser.
func (r *BrowserRenderer) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.stopLocked()
}

func (r *BrowserRenderer) stopLocked() {
	if r.cancel != nil {
		r.cancel()
	}
	r.browser, r.cancel = nil, nil
}

func findBrowser() (string, error) {
	if p := os.Getenv("GNEXT_AGENT_BROWSER"); p != "" {
		return p, nil
	}
	var candidates []string
	for _, env := range []string{"ProgramFiles(x86)", "ProgramFiles", "LocalAppData"} {
		if base := os.Getenv(env); base != "" {
			candidates = append(candidates,
				filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
				filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe"))
		}
	}
	candidates = append(candidates, "/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/microsoft-edge")
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c, nil
		}
	}
	return "", errors.New("no Microsoft Edge or Chrome found to render tickets")
}
