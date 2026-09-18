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
- **Payments**: two terminal drivers.
  - `sep` (Saman): the agent runs `saman\gnext-saman-bridge.exe`, a small .NET Framework 4.8
    program around Saman's own PC-POS SDK (`saman-bridge/vendor/SSP1126.PcPos.dll` 1.4.11.2),
    once per operation. The terminal is reached over the LAN (connection `tcp`, by IP; the SDK
    chooses the port) or a COM port (`serial`). Before sending an amount it runs Saman's
    connection test, so a dead link is `FAILED`; anything after the amount is sent that ends
    without a response code is `UNKNOWN`. Response `00` is approved; other codes are declined, or
    cancelled when the description says so. `payment.query` is not supported: Saman's inquiry
    needs the RRN, which an unknown charge does not have. Status is checked every 5 minutes, never
    during a charge.
  - `fake`: amounts ending in `0` are approved, `1` declined, `2` time out (`UNKNOWN`; a later
    *Check terminal* finds them approved), `3` cancelled on the terminal.
- Reports device status every 60 s; checks for updates on start, hourly, and when head office
  publishes a build, then swaps the binary after checking its SHA-256.
- **Settings page** on `http://127.0.0.1:47800` (Start-menu and desktop shortcut *Gnext Agent*,
  or `gnext-agent open`), in Persian: connection status, enrol or re-enrol with a server and a
  code, printers and card terminals with live status, test print, LAN scan for port-9100
  printers, and logs. Anyone at the PC can look and test-print; adding, editing or removing a
  device needs a Gnext sign-in by this branch's manager or head office. Changes are made in
  the cloud (`/api/v1/agent/local`, audited under that user) and pushed back to the agent. The
  page only listens on 127.0.0.1 and refuses other hosts and cross-site writes.
- No offline mode (that is v2).

## Layout

| Path | What |
|---|---|
| `cmd/gnext-agent` | `enrol`, `run`, `open`, `service`, `version`; service wrapper; restarts the agent after enrolment |
| `internal/agent` | WebSocket session, command handling, device probes |
| `internal/journal` | Command/result journal |
| `internal/printing` | Edge renderer, ESC/POS raster, TCP printer |
| `internal/payment` | Terminal driver interface, the `sep` (Saman) and `fake` drivers |
| `saman-bridge` | .NET Framework bridge to Saman's PC-POS SDK (vendor DLLs), built in CI |
| `internal/cloud` | HTTPS calls: enrol, me, releases |
| `internal/localui` | Settings page (embedded HTML/JS) and its local API, LAN scan |
| `internal/update` | Release check, download, verify, swap |
| `internal/store` | `config.json`, `identity.json`, DPAPI |
| `installer/gnext-agent.iss` | Setup wizard (Inno Setup): server, enrolment code, service |

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
3. Run `gnext-agent-setup-<version>.exe` (from the `gnext-agent-windows` artifact of the CI run)
   on the PC. The wizard asks for the server address and the code, checks the code with the
   server before installing, then installs and starts the `GnextAgent` service.

Running a newer setup over an installed agent upgrades it and keeps its enrolment. Uninstall it
from **Settings → Apps**; the data folder `%ProgramData%\Gnext\Agent` (identity, journal, logs)
is kept.

Without the wizard, from an elevated prompt:

```powershell
gnext-agent.exe enrol --server https://<gnext domain> --code XXXX-XXXX
gnext-agent.exe service install
gnext-agent.exe service start
```

Logs: `%ProgramData%\Gnext\Agent\logs\agent.log`.

## Release

Bump `VERSION` and merge. After the deploy, CI uploads that `gnext-agent.exe` to the cloud as
an unpublished release; press **Publish** on the Agents screen to tell online agents to update
(setup: `docs/agent-gateway/HANDOFF.md`, "Agent releases from CI"). Hand
`gnext-agent-setup-<version>.exe`, from the run's `gnext-agent-windows` artifact, to new
branches.
