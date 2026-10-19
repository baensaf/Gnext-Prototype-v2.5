package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"gnext/agent/internal/agent"
	"gnext/agent/internal/localui"
	"gnext/agent/internal/protocol"
)

// queries are the cloud's live questions (agent.query, §20). The cloud's Printers and Branch agent
// screens ask them; they replaced the settings page's own sign-in, device forms, scan and test print.
func (h *host) queries() map[string]agent.QueryFunc {
	return map[string]agent.QueryFunc{
		protocol.QueryScan: func(ctx context.Context, args json.RawMessage) (any, error) {
			var in struct {
				Port int `json:"port"`
			}
			_ = json.Unmarshal(args, &in)
			if in.Port <= 0 || in.Port > 65535 {
				in.Port = 9100
			}
			return map[string]any{"port": in.Port, "found": localui.ScanLAN(ctx, in.Port)}, nil
		},
		protocol.QueryLogs: func(_ context.Context, args json.RawMessage) (any, error) {
			var in struct {
				Lines int `json:"lines"`
			}
			_ = json.Unmarshal(args, &in)
			if in.Lines <= 0 || in.Lines > 2000 {
				in.Lines = 300
			}
			return map[string]any{"lines": localui.Tail(logFile(), in.Lines)}, nil
		},
		protocol.QuerySettings: func(_ context.Context, args json.RawMessage) (any, error) {
			var in struct {
				AppAtSignIn *bool `json:"app_at_sign_in"`
			}
			if len(args) > 0 {
				if err := json.Unmarshal(args, &in); err != nil {
					return nil, fmt.Errorf("settings: %w", err)
				}
			}
			if in.AppAtSignIn != nil {
				if err := h.SetAppAtSignIn(*in.AppAtSignIn); err != nil {
					return nil, err
				}
				h.log.Info("setting changed from the cloud", "app_at_sign_in", *in.AppAtSignIn)
			}
			name, _ := os.Hostname()
			return map[string]any{"app_at_sign_in": h.AppAtSignIn(), "pc_name": name}, nil
		},
		protocol.QueryAppRefresh: func(ctx context.Context, _ json.RawMessage) (any, error) {
			res, err := h.app.Check(ctx)
			if err != nil {
				return nil, err
			}
			return res, nil
		},
	}
}
