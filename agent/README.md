# Gnext branch agent

A Windows service, written in Go, that connects a branch's printers and card terminals to the
Gnext cloud. The wire contract is [`docs/agent-gateway/agent-protocol.md`](../docs/agent-gateway/agent-protocol.md);
section numbers (§) in the code refer to it.

## What v1 does

- Enrols with a one-time code from head office and keeps the device key encrypted with DPAPI.
- Keeps one WebSocket to the cloud: `hello`/`welcome`, heartbeats, reconnect with backoff,
  stops for good on a revoked or unknown key.
- Journals every command before acking it (`journal.db`, bbolt), so a restart never runs a
  job twice. A charge interrupted by a restart is reported `UNKNOWN`, never charged again.
- **Printing**: renders the cloud's HTML ticket in headless Microsoft Edge, turns it into a
  1-bit image and sends it to a **network printer (raw TCP, port 9100)** with ESC/POS `GS v 0`.
  Persian is shaped by Edge, so no printer code page is involved. `windows` and `serial`
  printer connections are not supported yet.
- **Payments**: the `fake` terminal driver only. Amounts ending in `0` are approved, `1`
  declined, `2` time out (`UNKNOWN`; a later *Check terminal* finds them approved), `3`
  cancelled on the terminal. The Saman (`sep`) driver waits for Saman's integration document.
- Reports device status every 60 s; checks for updates on start, hourly, and when head office
  publishes a build, then swaps the binary after checking its SHA-256.
- No offline mode (that is v2).

## Layout

| Path | What |
|---|---|
| `cmd/gnext-agent` | `enrol`, `run`, `version`; Windows service wrapper |
| `internal/agent` | WebSocket session, command handling, device probes |
| `internal/journal` | Command/result journal |
| `internal/printing` | Edge renderer, ESC/POS raster, TCP printer |
| `internal/payment` | Terminal driver interface and the fake driver |
| `internal/cloud` | HTTPS calls: enrol, me, releases |
| `internal/update` | Release check, download, verify, swap |
| `internal/store` | `config.json`, `identity.json`, DPAPI |
| `scripts/install.ps1` | Installs the service and enrols |

## Develop

```powershell
cd agent
go test ./...
go build -o gnext-agent.exe ./cmd/gnext-agent

# Run in a console against a local backend, with data in a scratch folder:
$env:GNEXT_AGENT_HOME = "$PWD\.dev"
.\gnext-agent.exe enrol --server http://localhost:3100 --code XXXX-XXXX
.\gnext-agent.exe run
```

`GNEXT_AGENT_BROWSER` points the renderer at a specific Edge or Chrome binary.

## Install on a branch PC

1. In Gnext: **Operations → Agents → New enrolment code** for the branch.
2. Set up the devices:
   - **Printers** → *Connection: Network (TCP)*, with the printer's IP and port 9100.
   - **Payments → Devices** → the terminal → *Connect to agent*, driver **fake** for now.
3. Copy `gnext-agent.exe` and `install.ps1` (the `gnext-agent-windows` artifact of the CI run)
   to the PC. In an elevated PowerShell:

   ```powershell
   .\install.ps1 -Server https://<gnext domain> -Code XXXX-XXXX
   ```

Logs: `%ProgramData%\Gnext\Agent\logs\agent.log`. Remove with `uninstall.ps1`.

## Release

Bump `VERSION`, merge, download the `gnext-agent-windows` artifact from the CI run, and upload
`gnext-agent.exe` on the Agents screen with that version. Publishing it tells online agents to
update.
