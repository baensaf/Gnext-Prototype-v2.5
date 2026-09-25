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
    during a charge.
  - `fake`: amounts ending in `0` are approved, `1` declined, `2` time out (`UNKNOWN`; a later
    *Check terminal* finds them approved), `3` cancelled on the terminal.
- **Branch snapshot** (§12.2): keeps a copy of what the branch sells, at its prices, in
  `branch-datasnapshot.json` (the one before it in `snapshot.prev.json`), for the offline till
  to come. It is fetched after every connect, when the cloud sends `data.changed`, and every
  15 minutes, with the version held in `If-None-Match` so an unchanged copy costs a `304`. A
  failed fetch keeps the copy it has and tries again with backoff.
- **Offline orders** (§12.4, §12.5): keeps the orders the branch took while offline in
  `offline-orders.db` and uploads them, oldest first and 50 at a time, after every connect and
  whenever one is added. The cloud answers for each (accepted, already had it, or held for head
  office); a batch it refuses as malformed is split so only the bad order is set aside. Answered
  orders stay a week. Heartbeats carry the snapshot version and the backlog (§12.7). Nothing adds
  orders yet: the offline till that does comes next.
- **For the offline till** (§13, agent 1.3.0): advertises `pos.offline`, and keeps
  - the staff list (who may sign in, with PIN hashes) in `branch-data\staff.dat`, sealed with
    DPAPI for this machine, pulled with every snapshot pull;
  - the last printer and terminal config from the cloud in `devices.json`, used at start until
    the cloud sends one, so an agent restarted offline still reaches its devices;
  - the POS call count from the last `heartbeat.ack` in `call-numbers.json`.

  Since 1.4.0 (`internal/till`): the till the agent sells as, chosen on the settings page (card
  *صندوق آفلاین*) by a signed-in manager or, offline, by an approver's PIN, kept in `till.json`;
  sign-in by name and PIN checked here against the staff list (argon2, as the cloud stores it),
  five wrong PINs lock that user for 15 minutes; one session at a time, ended after the tenant's
  auto-logout time. Local API under `/api/till/*` (§13.13). Heartbeats carry `till` with the
  bound till and the mode.

  Since 1.5.0: the till screen at `http://127.0.0.1:47800/till` (Persian, right to left): pick a
  name and type the PIN, then categories and products, sizes and add-ons, the order with its type
  and table, and the totals. Availability (stops, selling windows on the branch clock, today's
  stock), add-on rules, the per-order limit and the money (§12.4) are worked out here from the
  snapshot (`till.Catalog`); the page shows what the agent says.

  Since 1.6.0: orders live on the agent, in `till-orders.db` (bbolt), and survive a restart. An
  order is started on the bound till's open shift; lines keep the price they were charged;
  *Send to kitchen* gives it the next number in the day's POS range, carrying on from the
  snapshot, the last `heartbeat.ack` and the till's own count; voiding a sent line or cancelling
  follows the cloud's edit windows, with an approver's PIN after them and never with money on
  the order. A finished or cancelled order goes to the upload at once. When the link returns the
  till starts nothing new (`HANDOVER`); after 15 minutes connected, or on *Hand over*, unsent
  carts are dropped and the rest go up as `OPEN`. The till's own sales count against today's
  stock.

  Since 1.7.0: the till screen at `http://127.0.0.1:47800/till/` is the web POS's own register
  (`starter-vite-ts/src/pages/pos/order.tsx`), built with `npm run build:till` into
  `internal/localui/tillui` and embedded; CI builds it before the agent. It reads and writes
  through the local API (`src/till/agent-source.ts`) and places a whole cart at once
  (`/api/till/orders/place`). What the till cannot do offline (delivery, customers, discounts,
  parked orders, 86, shift open/close) stays on screen, disabled. A Go build without the screen
  serves `tillui/NOT-BUILT.html` instead.

  Since 1.8.0: paying offline. Cash takes what was handed over and gives the change. A card is
  charged on the bound till's terminal through the same driver and queue as a cloud charge
  (`Agent.ChargeLocal`), written to `till-orders.db` as `RUNNING` first: a restart turns it
  `UNKNOWN` and never charges it again, and an unknown charge counts as paid. A takeaway paid in
  full finishes; the header's *Open orders* lists what is still open, to pay, finish or cancel
  (with an approver's PIN after the window).

  Since 1.9.0: printing offline. Tickets are rendered on the agent by a port of the cloud's
  renderer (`internal/till/render.go`, held to the cloud's pages in `testdata/tickets`) and
  printed on the configured printers through the same queue as cloud jobs (`Agent.PrintLocal`).
  Kitchen chits split by station from the snapshot's routes, with the cloud's labels and copies;
  voids and cancels print change chits; the receipt prints when the order is paid; a guest bill
  and copies on request. A ticket that fails stays on the order, shown under *Open orders* with
  *Reprint*, to its printer or another.

  Since 1.10.0: `gnext-agent till` opens the till in a window of its own, from the tray menu
  (*صندوق آفلاین*), the Start menu and desktop (*Gnext Offline Till*) or the settings page. The web
  POS shows a banner with a link to it once the cloud has not answered for 30 seconds.

  Since 1.11.0 (§16): the till sells online too, and is the branch PC's register all the time.
  Signing in by PIN also gets the cashier a cloud session (`pos.till`, `POST
  /api/v1/agent/local/pin-login`), which the agent keeps and the page never sees. The page's
  cloud calls go to `/api/v1/*` on the agent, which passes them on with that session, its CSRF
  token and the bound till (`internal/localui/cloud.go`); the till session rides in a header or
  the `gnext_till` cookie, for Server-Sent Events. The till sells through the cloud while it is
  reachable (`till.Reachable`: the WebSocket session has lasted 10 s and no proxied request found
  the cloud gone in the last 30 s) and through the agent otherwise; with the link back and no
  cloud session it asks for the PIN once (`POST /api/till/cloud-login`).

  Since 1.11.1 (§16.6, §16.7): switching carries the cart. The page keeps the unplaced cart and
  starts the register on the other side from it: toward the agent a delivery becomes takeaway and
  each line is checked by `/api/till/price`, a refused one stays marked for the cashier to take
  off; toward the cloud it goes as it is. A place the cloud never answered is held, marked *may
  already be in the kitchen*, and sent offline only once the cashier confirms; back on the cloud
  the till looks the draft up and drops the cart if the kitchen has it. The till says each switch,
  and how many offline orders are still being sent. The agent reads the call number off each
  order the till places online, so offline numbering never repeats one.
- Reports device status every 60 s; checks for updates on start, hourly, and when head office
  publishes a build, then swaps the binary after checking its SHA-256. Since 1.10.2 an old
  binary still held by an open window no longer blocks the next update (§9), and the settings
  window reopens itself on the new binary.
- **Settings window** (Start-menu and desktop shortcut *Gnext Agent*, the tray, or running the
  exe): the page on `http://127.0.0.1:47800` in a window of its own, drawn by WebView2, the Edge
  engine in Windows 10 and 11 (in the browser if it is missing). One window per user; opening it
  again brings it to the front. In Persian: connection status, enrol or re-enrol with a server and a
  code, printers and card terminals with live status, test print, LAN scan for port-9100
  printers, and logs. Anyone at the PC can look and test-print; adding, editing or removing a
  device needs a Gnext sign-in by this branch's manager or head office. Changes are made in
  the cloud (`/api/v1/agent/local`, audited under that user) and pushed back to the agent. The
  page only listens on 127.0.0.1 and refuses other hosts and cross-site writes.
- No offline selling yet: v2 keeps the snapshot and uploads offline orders; the offline till
  that takes them comes after.

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
| `internal/cloud` | HTTPS calls: enrol, me, releases, branch snapshot |
| `internal/branchdata` | Keeps the branch snapshot and the sealed staff list current on disk |
| `internal/offline` | Holds offline orders and uploads them |
| `internal/till` | The offline till: which till the agent sells as, PIN sign-in and lockout, mode |
| `internal/localui` | Settings page (embedded HTML/JS) and its local API, LAN scan; the till screen (`tillui`, built from `starter-vite-ts`) |
| `internal/update` | Release check, download, verify, swap |
| `internal/winsession` | Starts the ticket browser and the tray as the signed-in user |
| `internal/store` | `config.json`, `identity.json`, DPAPI |
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
