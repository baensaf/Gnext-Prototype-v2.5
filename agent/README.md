# Gnext branch agent

A Windows service, written in Go, that serves the Gnext cashier app on the branch PC and connects the
branch's printers and card terminals to the Gnext cloud. The wire contract is
[`docs/agent-gateway/agent-protocol.md`](../docs/agent-gateway/agent-protocol.md); section numbers (§) in the
code refer to it. The agent's part in the cashier is §19.

## What it does

### It serves the cashier

Every register of the branch opens one address on the agent and uses the cashier pages of Gnext (POS,
orders, delivery, incoming orders, shift and cash) from there, online or not. Nothing switches. Manager and
head-office pages stay on gnext.top; the app links out to them.

- `http://127.0.0.1:47800/` on the branch PC and `http://<this PC's address>:47801/` for any other
  register on the branch network (a PC, tablet or phone). `/` is the cloud's own web app, cached on
  disk: `index.html` for any path that is not a file, with a `<meta name="gnext-agent">` tag added.
- **The proxy.** `/api/*` and `/uploads/*` go to the cloud with the page's headers, `Cookie` and
  `Set-Cookie` (less `Domain` and `Secure`) passed through, 16 MB bodies, 30 s to answer, and no
  session held by the agent: the sign-in is the normal username and password one, passed through.
  `/api/v1/agent/*` and `/api/v1/agent-releases/*` are refused with `403`. A cloud that does not
  answer is `502 CLOUD_UNREACHABLE`, or `504 CLOUD_NO_ANSWER` for a write that was sent and not answered.
- **Retries** (since 2.2.0, [§19.10](../docs/agent-gateway/agent-protocol.md)): a `GET` or `HEAD` (not
  `/api/v1/live/stream`) that the cloud does not answer is tried again every 2 s, counted from when it
  arrived, with no new attempt after 20 s; each attempt has `min(30 s, time left + 10 s)`. The page waits,
  and gets the cloud's answer if it comes back in time, else `502 CLOUD_UNREACHABLE`. If the page goes away
  the retries stop. The app shows the amber *Reconnecting* bar meanwhile and reads its screens again when
  the cloud is back.
- **Idempotent writes** (since 2.3.0, [§19.11](../docs/agent-gateway/agent-protocol.md)): a write (`POST`,
  `PATCH`, `PUT`, `DELETE`) that carries an `Idempotency-Key` header is retried like a read, also after an
  attempt that was written and never answered: the cloud answers a repeat of the same key and body with
  the first answer, so the work is done once. The register's Place (create, update and submit of the
  order) and its payment's intent send one key per press. The final answer after the window is `504
  CLOUD_NO_ANSWER` if any attempt was written and not answered, else `502 CLOUD_UNREACHABLE`. A write with
  no key is never retried. **Card charges are never retried, key or not**: under `/api/v1/payments/:id/`,
  `process`, `check-terminal`, `correct` and `resolve-terminal` (the path is read decoded, cleaned and
  lower-cased, as the cloud reads it). The key goes to the cloud under a lower-case header name so that
  Go's HTTP client does not repeat the request by itself and hide an attempt that was written.
- **The build** is downloaded from `<server>/build-manifest.json` (or `app_url` in `config.json`, for a
  frontend on another port while developing) every 5 minutes, after each connect and on
  `GET /agent/api/app/refresh`; only files whose SHA-256 it does not hold are fetched, every hash is
  checked, and it switches in one step. The current and the previous build are kept in
  `%ProgramData%\Gnext\Agent\app\`, so a restart with no internet still opens the app. Until the first
  download the app routes answer a Persian *not downloaded yet* page.
- **Status.** `GET /agent/api/status` (both listeners, no sign-in) says whether the agent is connected to
  the cloud (`cloud.connected`, the WebSocket), whether the cloud answers HTTP (`cloud.reachable`, since
  2.2.0) and which build it serves. The agent probes `<server>/health/live` every 3 s (5 s to answer): two
  failures in a row make the cloud unreachable, one success makes it reachable, and a proxied request that
  gets no answer (or any answer) moves it at once. The app's *Reconnecting* bar follows `reachable`.
- **The LAN listener** serves the app only; the settings page and its API exist on `127.0.0.1` alone. The
  service adds the Windows Firewall rule *Gnext* (TCP 47801, private and domain profiles) at start, and the
  installer removes it on uninstall.

### Opening Gnext (since 2.4.0)

- `gnext-agent app` opens `http://127.0.0.1:47800/` in a window of its own, drawn by WebView2 (the Edge
  engine in Windows 10 and 11; in the browser if it is missing). One window per user: opening it again
  brings it to the front. The window keeps a WebView2 folder of its own (`%LOCALAPPDATA%\Gnext\app-window`),
  apart from the settings window's, so the register's terminal id and session cookie stay with it. It is
  never closed and reopened by an agent update, which would drop a sale in progress; it goes on running on
  the old binary, which the updater deletes once it is free.
- The installer puts a Start-menu and desktop shortcut **Gnext** on `gnext-agent.exe app`. The tray menu
  starts with *Open Gnext*, then *Agent settings*.
- **Open at Windows sign-in** is on by default and is switched on the settings page (`app_at_sign_in` in
  `config.json`, written by the agent's service). The service starts the app in a user's session when
  that user signs in, like the tray, and reads the setting at each sign-in. It does not open it at the
  service's own start, which an update restarts, so a register that is open is not pulled to the front
  mid-sale. A PC that was never configured (no server) opens nothing.
- **Registers on this network.** The settings page lists `http://<each private IPv4 address of the
  PC>:47801/` with a copy button, which is what another register types. Adapters that are down, loopback or
  virtual (WSL, Hyper-V, VirtualBox, VMware, Docker) and addresses that are not private are left out. The same
  card shows the build the agent serves and when it was downloaded, with *Download now*
  (`/agent/api/app/refresh`, after a manager sign-in).
- **What the cloud is told.** Every heartbeat carries `app_build_id` (the build served, `null` while there
  is none) and `lan_urls`; the cloud keeps them, and Operations → Branch Agents shows each agent's version,
  whether it has `app.serve`, whether its build is up to date with the cloud's current one, and its
  addresses ([§19.12](../docs/agent-gateway/agent-protocol.md)).

### It drives the branch's devices

- Enrols with a one-time code from head office and keeps the device key encrypted with DPAPI.
- Keeps one WebSocket to the cloud: `hello`/`welcome`, heartbeats, reconnect with backoff, stops for good on
  a revoked or unknown key.
- Journals every command before acking it (`journal.db`, bbolt), so a restart never runs a job twice. A
  charge interrupted by a restart is reported `UNKNOWN`, never charged again.
- **Printing**: renders the cloud's HTML ticket in headless Microsoft Edge, turns it into a 1-bit image and
  sends it to a **network printer (raw TCP, port 9100)** with ESC/POS `GS v 0`. Persian is shaped by Edge,
  so no printer code page is involved. Printers that answer ESC/POS status questions (`DLE EOT`, `GS r`)
  are checked before each ticket and must confirm it printed: paper out, cover open or a fault fails the
  job (`PAPER_OUT`, `COVER_OPEN`, …) instead of reporting a ticket that never came out, and device checks
  report paper running low. `windows` and `serial` printer connections are not supported yet.
- **Payments**: two terminal drivers.
  - `sep` (Saman): the agent runs `saman\gnext-saman-bridge.exe`, a small .NET Framework 4.8 program around
    Saman's own PC-POS SDK (`saman-bridge/vendor/SSP1126.PcPos.dll` 1.4.11.2), once per operation. The
    terminal is reached over the LAN (connection `tcp`, by IP; the SDK chooses the port) or a COM port
    (`serial`). Before sending an amount it runs Saman's connection test, so a dead link is `FAILED`;
    anything after the amount is sent that ends without a response code is `UNKNOWN`. Response `00` is
    approved; other codes are declined, or cancelled when the description says so. `payment.query` is not
    supported: Saman's inquiry needs the RRN, which an unknown charge does not have. Status is checked every
    5 minutes, never during a charge. Since 1.11.5 agent updates keep the bridge current too: each release
    carries the bridge built with it (`gnext-saman-bridge.zip`), and an agent whose `saman\release.sha256`
    does not match it downloads it, checks its SHA-256 and swaps `saman\` between charges (protocol §9.3).
    A PC on 1.11.4 or older takes the bridge right after it updates itself.
  - `fake`: amounts ending in `0` are approved, `1` declined, `2` time out (`UNKNOWN`; a later *Check
    terminal* finds them approved), `3` cancelled on the terminal.
- **Last device config** (`devices.json`): keeps the last printer and terminal list the cloud sent and uses
  it at start until the cloud sends one, so an agent restarted with no internet still reaches its printers
  and terminals.
- Reports device status every 60 s.
- **Update**: checks for a release on start, hourly, and when head office publishes a build, then swaps the
  binary after checking its SHA-256 (an old binary still held by an open window does not block the next
  update, §9; the settings window reopens itself on the new binary; the app window does not, see above) and
  brings `saman\` up to the Saman bridge published with its version (§9.3).

### Its own windows

- **Tray icon** (`gnext-agent tray`): the service starts one in every signed-in user's session, at start
  and at each sign-in. Its colour is the agent's state (green ready, amber a warning such as paper low, red a
  problem, grey agent not running); its menu starts with *Open Gnext* and *Agent settings*, then lists the
  connection and each device, and test-prints; a click opens the settings window. It pops a system
  notification (logo and status light, under the name *Gnext Agent*) when the cloud is away for 30 s or a
  device breaks, and again when they are back. Closing it hides it until the next sign-in. After an update
  the old tray leaves and the service starts the new one.
- **Settings window** (Start-menu and desktop shortcut *Gnext Agent*, the tray, or running the exe): the
  page on `http://127.0.0.1:47800/agent/` in a window of its own, drawn by WebView2 (in the browser if it is
  missing). One window per user. In Persian: connection status, the registers' addresses and the app build,
  open-at-sign-in, enrol or re-enrol with a server and a code, printers and card terminals with live status,
  test print, LAN scan for port-9100 printers, and logs. Anyone at the PC can look and test-print; adding,
  editing or removing a device, *Download now* and the sign-in setting need a Gnext sign-in by this
  branch's manager or head office. Device changes are made in the cloud (`/api/v1/agent/local`, audited
  under that user) and pushed back to the agent. The page and its API (`/agent/api/*`) only exist on
  127.0.0.1, which refuses other hosts and cross-site writes.

## Offline selling

Agents 1.x kept a branch snapshot, a PIN staff list, an offline order book and a till of their own that
took over when the internet failed. **Agent 2.0.0 removed all of it** (the cloud's side went in the same
step), and at service start the agent deletes what 1.x left on the PC (`branch-data\`,
`offline-orders.db`, `till.json`, `till-orders.db`, `till-devices.json`, `call-numbers.json`) and the old
*Gnext POS* firewall rule. For now a register needs the cloud to sell; the agent holds on to the screen and
retries (see above). Offline features come back later, one at a time, inside the app the agent serves, and
only when the product owner asks: [`agent-protocol.md` §19.14](../docs/agent-gateway/agent-protocol.md#19-the-agent-serves-the-cashier-v3).
§12, §13, §16, §17 and §18 of that file describe what was removed and stay there for history.

## Layout

| Path | What |
|---|---|
| `cmd/gnext-agent` | `enrol`, `run`, `open`, `app`, `tray`, `service`, `version`; service wrapper; restarts the agent after enrolment; the tray icon and its launch (and the app's) per session; the settings and app windows |
| `cmd/gnext-agent/winres` | Icon (the Gnext logo), version details and manifest; CI turns them into a `.syso` with go-winres |
| `internal/agent` | WebSocket session, command handling, device probes |
| `internal/journal` | Command/result journal |
| `internal/printing` | Edge renderer, ESC/POS raster, TCP printer |
| `internal/payment` | Terminal driver interface, the `sep` (Saman) and `fake` drivers |
| `saman-bridge` | .NET Framework bridge to Saman's PC-POS SDK (vendor DLLs), built in CI |
| `internal/cloud` | HTTPS calls: enrol, me, releases, the settings page's device changes |
| `internal/appcache` | The cloud frontend build on disk: manifest, download by hash, atomic switch, two builds kept |
| `internal/localui` | The local web server: the app, the proxy to the cloud (`proxy.go`, `upstream.go`), the settings page (embedded HTML/JS) and its API under `/agent/api/`, the LAN addresses (`lanurls.go`), LAN scan |
| `internal/update` | Release check, download, verify, swap |
| `internal/winsession` | Starts the ticket browser, the tray and the app as the signed-in user |
| `internal/store` | `config.json` (`server`, optional `app_url`, `app_at_sign_in`), `identity.json`, `devices.json`, DPAPI, removal of 1.x's offline files |
| `installer/gnext-agent.iss` | Setup wizard (Inno Setup): server, enrolment code, service, the Gnext and Gnext Agent shortcuts |

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
second agent beside a real one (`gnext-agent app` and `open` follow `GNEXT_AGENT_UI_ADDR`). To serve a
frontend that is not on the cloud's address, add `"app_url": "http://localhost:4173"` to `config.json` in
the data folder (build it with `VITE_SERVER_URL=` empty so the page calls the same origin, then
`npx vite preview --port 4173`).

## Install on a branch PC

1. In Gnext: **Operations → Agents → New enrolment code** for the branch.
2. Set up the devices:
   - **Printers** → *Connection: Network (TCP)*, with the printer's IP and port 9100.
   - **Payments → Devices** → the terminal → *Connect to agent*, driver **fake** for now.
3. Run `gnext-agent-setup-<version>.exe` (from the `gnext-agent-windows` artifact of the CI run)
   on the PC. The wizard asks for the server address and the code, checks the code with the
   server before installing, then installs and starts the `GnextAgent` service. The **Gnext**
   shortcut then opens the cashier app, and it opens by itself at each Windows sign-in.

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
