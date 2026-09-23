// Package cloud holds the agent's HTTPS calls: enrol, me, and the release endpoints (§3, §9).
package cloud

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"gnext/agent/internal/protocol"
	"gnext/agent/internal/store"
)

// Client talks to one Gnext server.
type Client struct {
	Server  string // https://app.example.ir
	Key     string // device key; empty for enrol
	Version string
	HTTP    *http.Client
}

// Problem is a non-2xx response (§8.2).
type Problem struct {
	Status     int    `json:"status"`
	Code       string `json:"code"`
	Detail     string `json:"detail"`
	RetryAfter int    `json:"-"`
}

func (p *Problem) Error() string {
	if p.Code != "" {
		return fmt.Sprintf("HTTP %d %s: %s", p.Status, p.Code, p.Detail)
	}
	return fmt.Sprintf("HTTP %d", p.Status)
}

type Machine struct {
	Hostname  string `json:"hostname"`
	OS        string `json:"os"`
	MachineID string `json:"machine_id"`
}

type enrolResponse struct {
	AgentID    string `json:"agent_id"`
	TenantID   string `json:"tenant_id"`
	BranchID   string `json:"branch_id"`
	BranchName string `json:"branch_name"`
	DeviceKey  string `json:"device_key"`
	WSURL      string `json:"ws_url"`
}

// NormalizeCode strips the hyphen and spaces and upper-cases (§3.2).
func NormalizeCode(code string) string {
	return strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(code))
}

// Enrol redeems an enrolment code for a device key.
func (c *Client) Enrol(ctx context.Context, code string, m Machine) (store.Identity, error) {
	body := map[string]any{
		"code":             NormalizeCode(code),
		"agent_version":    c.Version,
		"protocol_version": protocol.Version,
		"machine":          m,
	}
	var out enrolResponse
	if err := c.do(ctx, http.MethodPost, "/api/v1/agent/enrol", body, &out); err != nil {
		return store.Identity{}, err
	}
	return store.Identity{
		AgentID: out.AgentID, TenantID: out.TenantID, BranchID: out.BranchID,
		BranchName: out.BranchName, DeviceKey: out.DeviceKey, WSURL: out.WSURL,
	}, nil
}

type Me struct {
	AgentID  string `json:"agent_id"`
	BranchID string `json:"branch_id"`
	Status   string `json:"status"`
}

func (c *Client) Me(ctx context.Context) (Me, error) {
	var out Me
	err := c.do(ctx, http.MethodGet, "/api/v1/agent/me", nil, &out)
	return out, err
}

type Release struct {
	Version         string `json:"version"`
	URL             string `json:"url"`
	SHA256          string `json:"sha256"`
	Size            int64  `json:"size"`
	MinAgentVersion string `json:"min_agent_version"`
}

// LatestRelease returns nil when nothing is published.
func (c *Client) LatestRelease(ctx context.Context) (*Release, error) {
	var out Release
	if err := c.do(ctx, http.MethodGet, "/api/v1/agent/releases/latest", nil, &out); err != nil {
		return nil, err
	}
	if out.Version == "" {
		return nil, nil
	}
	return &out, nil
}

// Download streams a release file to w.
func (c *Client) Download(ctx context.Context, url string, w io.Writer) error {
	req, err := c.request(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := c.http().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return problem(resp)
	}
	_, err = io.Copy(w, resp.Body)
	return err
}

// ErrNotModified is Snapshot's answer when the agent already holds the current version.
var ErrNotModified = errors.New("branch snapshot not modified")

// Snapshot fetches the branch snapshot (§12.2). held is the version the agent has, or "". The
// transport asks for gzip and unpacks it. Returns ErrNotModified on a 304.
func (c *Client) Snapshot(ctx context.Context, held string) (body []byte, version string, err error) {
	req, err := c.request(ctx, http.MethodGet, "/api/v1/agent/data/snapshot", nil)
	if err != nil {
		return nil, "", err
	}
	if held != "" {
		req.Header.Set("If-None-Match", `"`+held+`"`)
	}
	resp, err := c.http().Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusNotModified:
		return nil, held, ErrNotModified
	case resp.StatusCode != http.StatusOK:
		return nil, "", problem(resp)
	}
	body, err = io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	if err != nil {
		return nil, "", err
	}
	var head struct {
		DataVersion string `json:"data_version"`
	}
	if err := json.Unmarshal(body, &head); err != nil || head.DataVersion == "" {
		return nil, "", fmt.Errorf("branch snapshot without a data_version")
	}
	return body, head.DataVersion, nil
}

// LocalUser is who signed in to the agent's local settings page.
type LocalUser struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Role        string `json:"role"`
}

// sessionHeader carries a signed-in manager's session on local-page calls.
const sessionHeader = "X-Gnext-User-Session"

// LocalLogin signs a manager in for the local page. Only managers of this agent's branch and
// head office succeed.
func (c *Client) LocalLogin(ctx context.Context, username, password string) (string, LocalUser, error) {
	var out struct {
		SessionToken string    `json:"session_token"`
		User         LocalUser `json:"user"`
	}
	err := c.do(ctx, http.MethodPost, "/api/v1/agent/local/login", map[string]string{"username": username, "password": password}, &out)
	return out.SessionToken, out.User, err
}

// Local calls a device-management route under /api/v1/agent/local as the signed-in user.
func (c *Client) Local(ctx context.Context, method, path, session string, in, out any) error {
	return c.doWith(ctx, method, "/api/v1/agent/local"+path, in, out, http.Header{sessionHeader: {session}})
}

func (c *Client) do(ctx context.Context, method, path string, in, out any) error {
	return c.doWith(ctx, method, path, in, out, nil)
}

func (c *Client) doWith(ctx context.Context, method, path string, in, out any, extra http.Header) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := c.request(ctx, method, path, body)
	if err != nil {
		return err
	}
	for k, v := range extra {
		req.Header[k] = v
	}
	resp, err := c.http().Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNoContent {
		return nil
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return problem(resp)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (c *Client) request(ctx context.Context, method, path string, body io.Reader) (*http.Request, error) {
	url := path
	if strings.HasPrefix(path, "/") {
		url = strings.TrimRight(c.Server, "/") + path
	}
	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json; charset=utf-8")
	}
	for k, v := range c.Headers() {
		req.Header[k] = v
	}
	return req, nil
}

// Headers are sent on every call and on the WebSocket upgrade (§3.4).
func (c *Client) Headers() http.Header {
	h := http.Header{}
	h.Set("User-Agent", "gnext-agent/"+c.Version+" (windows)")
	if c.Key != "" {
		h.Set("Authorization", "Bearer "+c.Key)
	}
	return h
}

func (c *Client) http() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 10 * time.Minute}
}

func problem(resp *http.Response) error {
	p := &Problem{Status: resp.StatusCode}
	var body struct {
		Code    string `json:"code"`
		Detail  string `json:"detail"`
		Context struct {
			RetryAfter int `json:"retryAfter"`
		} `json:"context"`
	}
	if b, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10)); err == nil && json.Unmarshal(b, &body) == nil {
		p.Code, p.Detail, p.RetryAfter = body.Code, body.Detail, body.Context.RetryAfter
	}
	return p
}
