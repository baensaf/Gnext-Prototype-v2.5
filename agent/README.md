# Gnext branch agent

A Windows service, written in Go, that connects a branch's printers and card terminals to the
Gnext cloud. The wire contract is [`docs/agent-gateway/agent-protocol.md`](../docs/agent-gateway/agent-protocol.md);
section numbers (§) in the code refer to it.

## What it does

- Enrols with a one-time code from head office and keeps the device key encrypted with DPAPI.
- Keeps one WebSocket to the cloud: `hello`/`welcome`, heartbeats, reconnect with backoff,
  stops for good on a revoked or unknown key.
- Journals every command before acking it (`journal.db`, bbolt), so a restart never runs a
  job twice. A charge interrupted by a restart is reported `UNKNOWN`, never charged again.
- **Printing**: renders the cloud's HTML ticket in headless Microsoft Edge, turns it into a
  1-bit image and sends it to a **network printer (raw TCP, port 9100)** with ESC/POS `GS v 0`.
  Persian is shaped by Edge, so no printer code page is involved. Printers that answer
  ESC/POS status questions (`DLE EOT`, `GS r`) are checked before each ticket and must confirm
  it printed: paper out, cover open or a fault fails the job (`PAPER_OUT`, `COVER_OPEN`, …)
  instead of reporting a ticket that never came out, and device checks report paper running
  low. `windows` and `serial` printer connections are not supported yet.
- **Tray icon** (`gnext-agent tray`): the service starts one in every signed-in user's
  session, at start and at each sign-in. Its colour is the agent's state (green ready, amber
  a warning such as paper low, red a problem, grey agent not running); its menu lists the
  connection and each device, opens the settings window and test-prints; a click opens the
  window. It pops a system notification (logo and status light, under the name *Gnext Agent*)
  when the cloud is away for 30 s or a device breaks, and again when they are back. Closing it
  hides it until the next sign-in. After an update the old tray leaves and the service starts
  the new one.
- **Payments**: two terminal drivers.
  - `sep` (Saman): the agent runs `saman\gnext-saman-bridge.exe`, a small .NET Framework 4.8
    program around Saman's own PC-POS SDK (`saman-bridge/vendor/SSP1126.PcPos.dll` 1.4.11.2),
    once per operation. The terminal is reached over the LAN (connection `tcp`, by IP; the SDK
    chooses the port) or a COM port (`serial`). Before sending an amount it runs Saman's
    connection test, so a dead link is `FAILED`; anything after the amount is sent that ends
    without a response code is `UNKNOWN`. Response `00` is approved; other codes are declined, or
    cancelled when the description says so. `payment.query` is not supported: Saman's inquiry
    needs the RRN, which an unknown charge does not have. Status is checked every 5 minutes, never
    during a charge. Since 1.11.5 agent updates keep the bridge current too: each release carries
    the bridge built with it (`gnext-saman-bridge.zip`), and an agent whose `saman\release.sha256`
    does not match it downloads it, checks its SHA-256 and swaps `saman\` between charges
    (protocol §9.3). A PC on 1.11.4 or older takes the bridge right after it updates itself.
  - `fake`: amounts ending in `0` are approved, `1` declined, `2` time out (`UNKNOWN`; a later
    *Check terminal* finds them approved), `3` cancelled on the terminal.
- **Last device config** (`devices.json`): keeps the last printer and terminal list the cloud
  sent and uses it at start until the cloud sends one, so an agent restarted with no internet
  still reaches its printers and terminals.
- Reports device status every 60 s; checks for updates on start, hourly, and when head office
  publishes a build, then swaps the binary after checking its SHA-256. Since 1.10.2 an old
  binary still held by an open window no longer blocks the next update (§9), and the settings
  window reopens itself on the new binary. Since 1.11.5 it also brings `saman\` up to the
  Saman bridge published with its version (§9.3).
- **The app** (since 2.1.0, `app.serve`; [§19](../docs/agent-gateway/agent-protocol.md#19-the-agent-serves-the-cashier-v3)):
  the agent serves the cloud's own web app from disk and passes every API call to the cloud.
  - `http://127.0.0.1:47800/` on the branch PC and `http://<this PC's address>:47801/` for any
    other register on the branch network. `/` is the cached frontend build (`index.html` for any
    path that is not a file, with a `<meta name="gnext-agent">` tag added); `/api/*` and
    `/uploads/*` go to the cloud with the page's headers, `Cookie` and `Set-Cookie` (less
    `Domain` and `Secure`) passed through, 16 MB bodies, 30 s to answer, and no session held by
    the agent. `/api/v1/agent/*` and `/api/v1/agent-releases/*` are refused with `403`. A cloud
    that does not answer is `502 CLOUD_UNREACHABLE`, or `504 CLOUD_NO_ANSWER` for a write that
    was sent and not answered. No retries yet.
  - **The build** is downloaded from `<server>/build-manifest.json` (or `app_url` in
    `config.json`, for a frontend on another port while developing) every 5 minutes, after each
    connect and on `GET /agent/api/app/refresh`; only files whose SHA-256 it does not hold are
    fetched, every hash is checked, and it switches in one step. The current and the previous
    build are kept in `%ProgramData%\Gnext\Agent\app\`, so a restart with no internet still opens
    the app. Until the first download the app routes answer a Persian *not downloaded yet* page.
  - `GET /agent/api/status` (both listeners, no sign-in) says whether the agent is connected to
    the cloud and which build it serves.
  - The LAN listener serves the app only; the settings page and its API exist on `127.0.0.1`
    alone. The service adds the Windows Firewall rule *Gnext* (TCP 47801, private and domain
    profiles) at start, and the installer removes it on uninstall.
- **Settings window** (Start-menu and desktop shortcut *Gnext Agent*, the tray, or running the
  exe): the page on `http://127.0.0.1:47800/agent/` in a window of its own, drawn by WebView2, the Edge
  engine in Windows 10 and 11 (in the browser if it is missing). One window per user; opening it
  again brings it to the front. In Persian: connection status, enrol or re-enrol with a server and a
  code, printers and card terminals with live status, test print, LAN scan for port-9100
  printers, and logs. Anyone at the PC can look and test-print; adding, editing or removing a
  device needs a Gnext sign-in by this branch's manager or head office. Changes are made in
  the cloud (`/api/v1/agent/local`, audited under that user) and pushed back to the agent. The
  page and its API (`/agent/api/*`) only exist on 127.0.0.1, which refuses other hosts and
  cross-site writes.

## Version 2.0.0 removed the offline till

Agents 1.x also kept a branch snapshot, a PIN staff list, an offline order book with its upload,
and a till (Gnext POS) on `127.0.0.1:47800/till/`, with pairing of other devices on the LAN, that
took over from the cloud's web POS when the internet failed. **Agent 2.0.0 removes all of it**:
the till and its window, the tray's till item, open-at-sign-in of the till, the *Gnext POS*
shortcuts, the pairing and LAN listener (TCP 47801), the snapshot and staff pull,
`data.changed`, the offline upload and its conflict rules, offline Snappfood matching, and the
call numbers kept by the agent. The capabilities `data.pull`, `sync.orders`, `pos.offline`,
`pos.till` and `pos.lan` (`pos.snappfood` was specified but this agent never advertised it) and
the `till` and `sync` blocks of the heartbeat go with them. Agent 2.0.0 advertises `print.html`,
`payment.charge` and `payment.query` only; 2.1.0 adds `app.serve`.

At service start the agent deletes what 1.x left on the PC (`branch-data\`, `offline-orders.db`,
`till.json`, `till-orders.db`, `till-devices.json`, `call-numbers.json`) and the *Gnext POS*
firewall rule, and logs what it removed. `devices.json` stays.

Why, and what comes next (the agent serving the cashier the cloud's own app, with offline
features returning one at a time inside it): [`agent-protocol.md` §19](../docs/agent-gateway/agent-protocol.md#19-the-agent-serves-the-cashier-v3).
§12, §13, §16, §17 and §18 of that file describe what was removed and stay there for history.
Version 2.1.0 is its first step (a LAN listener on TCP 47801 is back, for the app only); the rest of this
README is rewritten in a later slice.

## Layout

| Path | What |
|---|---|
| `cmd/gnext-agent` | `enrol`, `run`, `open`, `tray`, `service`, `version`; service wrapper; restarts the agent after enrolment; the tray icon and its launch per session; the settings window |
| `cmd/gnext-agent/winres` | Icon (the Gnext logo), version details and manifest; CI turns them into a `.syso` with go-winres |
| `internal/agent` | WebSocket session, command handling, device probes |
| `internal/journal` | Command/result journal |
| `internal/printing` | Edge renderer, ESC/POS raster, TCP printer |
| `internal/payment` | Terminal driver interface, the `sep` (Saman) and `fake` drivers |
| `saman-bridge` | .NET Framework bridge to Saman's PC-POS SDK (vendor DLLs), built in CI |
| `internal/cloud` | HTTPS calls: enrol, me, releases, the settings page's device changes |
| `internal/appcache` | The cloud frontend build on disk: manifest, download by hash, atomic switch, two builds kept |
| `internal/localui` | The local web server: the app, the proxy to the cloud (`proxy.go`, `upstream.go`), the settings page (embedded HTML/JS) and its API under `/agent/api/`, LAN scan |
| `internal/update` | Release check, download, verify, swap |
| `internal/winsession` | Starts the ticket browser and the tray as the signed-in user |
| `internal/store` | `config.json` (`server`, optional `app_url`), `identity.json`, `devices.json`, DPAPI, removal of 1.x's offline files |
| `installer/gnext-agent.iss` | Setup wizard (Inno Setup): server, enrolment code, service |

## Develop

```powershell
cd agent
go test ./...
go build -o gnext-agent.exe ./cmd/gnext-agent   # a console build, handy for `run`

# What CI ships: the icon and version details, and a windowed program (no console window;
# commands typed in a terminal still print there):
(cd cmd/gnext-agent; go run github.com/tc-hib/go-winres@v0.3.3 make --arch amd64 --product-version=1.0.10 --file-version=1.0.10)
go build -ldflags "-H windowsgui" -o gnext-agent.exe ./cmd/gnext-agent

# Run in a console against a local backend, with data in a scratch folder:
$env:GNEXT_AGENT_HOME = "$PWD\.dev"
.\gnext-agent.exe enrol --server http://localhost:3100 --code XXXX-XXXX
.\gnext-agent.exe run
```

`GNEXT_AGENT_BROWSER` points the renderer at a specific Edge or Chrome binary.

For the app: `GNEXT_AGENT_UI_ADDR` moves the loopback listener (default `127.0.0.1:47800`) and
`GNEXT_AGENT_LAN_ADDR` the network one (default `0.0.0.0:47801`; `off` turns it off), for running a
second agent beside a real one. To serve a frontend that is not on the cloud's address, add
`"app_url": "http://localhost:4173"` to `config.json` in the data folder (build it with
`VITE_SERVER_URL=` empty so the page calls the same origin, then `npx vite preview --port 4173`).

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

Bump `VERSION` and merge; a change to `saman-bridge` alone needs the bump too. After the deploy,
CI uploads that `gnext-agent.exe`, its setup wizard and `gnext-saman-bridge.zip` to the cloud as
an unpublished release; press **Publish** on the Agents screen to tell online agents to update
(setup: `docs/agent-gateway/HANDOFF.md`, "Agent releases from CI"). Hand
`gnext-agent-setup-<version>.exe`, from the run's `gnext-agent-windows` artifact, to new
branches.
