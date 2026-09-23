# Agent gateway — handoff

Written 2026-09-17. **v1 (tasks 0–9) is built, merged and deployed**; see [Status](#status-2026-09-17).
The contract is [`agent-protocol.md`](agent-protocol.md). Next: the Go agent, then the
end-to-end test on the branch PC.

## What you are building

The **agent gateway** is the cloud-side endpoint (in `backend`, NestJS) that each branch's
**local agent** connects to. The local agent is a separate Windows program written in **Go**
that runs on the branch PC and bridges the cloud to branch hardware.

Your job: build the gateway, starting with the protocol contract (task 0). The Go agent has
not been started anywhere. The user will decide who builds it after the gateway lands, so
the contract must be complete enough for a different session to build the agent from it
alone.

## Decisions already made (don't re-ask)

| Topic | Decision |
|---|---|
| Gateway | Cloud-side endpoint that branch agents connect to. Not a hardware gateway. |
| Agent | Real build, **Go** (not Rust, as the v1.5 spec said). Windows. **One agent per branch.** |
| v1 | Bridge cloud → branch: **printing** and **POS (card) terminals**. No offline. |
| v2 | Agent handles **orders, printing and payments offline**, and syncs them to the cloud when the internet returns. |
| v3 | Hardens v2 offline. |
| Data direction | Agent gets menu, prices and config **from the cloud**. In v2/v3 the agent sends up **only order data** (orders, payments, print records). Products and prices are never edited on the branch. |
| Transport | Agent opens a **WebSocket** to the cloud (commands, acks, heartbeats); **HTTPS** for bulk data (data pull, sync upload, releases). No inbound ports at the branch. |
| Identity | HQ creates a **one-time enrolment code** per branch → agent exchanges it for a **device key** → key authenticates every HTTPS and WebSocket call. HQ can revoke it. Same spirit as the device-bound terminal. |
| Updates | Keep simple: agent checks the VPS on start and hourly, downloads the new `.exe`, verifies **SHA-256**, swaps and restarts via the Windows service manager. No code signing yet. |
| Simulator | The in-process simulator (`backend/src/modules/simulation`, `offline-sync`) **is removed once the real agent lands**. Until then, branches without an online agent fall back to it. |
| Testing | There is a **real branch PC with a printer and POS terminal** for end-to-end testing. Automated tests use a fake agent client in Jest. |
| Agent code location | Undecided. Recommendation: `agent/` folder in this repo with its own CI job building the `.exe`. |

## Task list

Ordered by dependency. Cost = token cost, Risk = implementation risk.

| # | Task | Cost | Risk | Importance |
|---|---|---|---|---|
| **v1** |||||
| 0 | **Protocol contract** `docs/agent-gateway/agent-protocol.md`: enrolment, auth, message envelope (id, type, payload, ack), message types, error codes, version handshake, print/payment result reporting, release check. Written for someone building the Go agent with no other context. | Med | Low | Critical — blocks everything |
| 1 | **Agent registry**: `Agent` entity + migration (branch, device key hash, status, version, last seen); HQ screen to create enrolment codes, list and revoke agents. | Med | Low | High |
| 2 | **Enrolment + auth**: `POST /agent/enrol` → device key; guard for HTTPS and WebSocket; revocation disconnects immediately. | Med | Med | High |
| 3 | **WebSocket gateway**: add `@nestjs/websockets` (backend has none today); handshake with version check, heartbeats, online/offline, branch → connection map. | High | **High** | Critical |
| 4 | **Command delivery**: persisted commands (sent/acked/done/failed), retry until ack, replay on reconnect. Build on the existing `outbox` module. | High | Med | Critical |
| 5 | **Printing via agent**: `printing/print-queue.service.ts` routes to the agent when the branch has one online, else the simulator. Agent results update `PrintAttempt`. | Med | Med | High |
| 6 | **Card payments via agent**: cloud asks agent to charge the terminal; record approved/declined/timeout. | High | **High** | Critical |
| 7 | **Agent health screen**: online/offline, version, last seen, recent commands; alert on disconnect (`OperationalAlert`). | Low | Low | Med |
| 8 | **Releases**: `GET /agent/releases/latest` → version, URL, SHA-256; VPS path for the `.exe`. | Low | Low | Med |
| 9 | **Test harness**: fake agent client in Jest — enrol → connect → print → pay. | Med | Low | High |
| ✂️ **Recommended v1 cut line**, then end-to-end on the real branch PC |||||
| **v2** |||||
| 10 | **Branch data pull**: paged, versioned download of menu, prices, tax, printers, terminals. | Med | Med | High |
| 11 | **Offline upload**: `POST /agent/sync/orders`, batches with agent-generated IDs (idempotent). Backend recomputes totals from the price snapshot the agent used. | High | **High** | Critical |
| 12 | **Conflict rules**: price changed while offline, item deleted, shift closed in cloud → accept the order, flag the difference, never silently rewrite. | High | High | High |
| 13 | **Sync status**: last sync, backlog, failed items with manual retry. | Low | Low | Med |
| 14 | **Remove simulator** agent paths and UI. | Med | Med | Med |
| **v3** |||||
| 15 | Replay protection, back-pressure, large backlogs, batch signing, key rotation, resumable sync. | High | Med | Pre-pilot |

Most of the cost sits in tasks 3, 4, 6, 11, 12.

## Traps

- **Task 3 — reverse proxy.** The VPS proxy must allow WebSocket upgrades on the agent path.
  Otherwise a deploy passes its health check and no agent can connect. See `deploy/` and
  `.github/workflows/ci-cd.yml`.
- **Task 6 — payment timeouts.** A timed-out charge must stay **unknown** until the terminal
  is queried. Never auto-mark it failed; the customer may already be charged.
- **Task 14 — shared simulator code.** Kiosk and Snappfood simulators may share code with the
  agent simulator. Separate them before deleting.
- **Prototype scope.** This is a prototype; don't harden past what v1 needs. v3 items stay out
  of v1.
- **Locales.** Any new UI strings go into both `starter-vite-ts/src/locales/en.json` and
  `fa.json` with identical keys, or `r27-e2e.spec.ts` fails and blocks deploys.

## Status (2026-09-17)

| # | Task | PR | Where |
|---|---|---|---|
| 0 | Protocol contract | #31 | `docs/agent-gateway/agent-protocol.md` |
| 1 | Agent registry + HQ screen | #32 | `agent`, `agent_enrolment_code`; `/app/operations/agents` |
| 2 | Enrolment + device-key auth | #33 | `POST /api/v1/agent/enrol`, `AgentAuthGuard`, `GET /api/v1/agent/me` |
| 3 | WebSocket gateway | #34 | `agent-ws.server.ts`, `agent-connection.ts` (`ws` package, not `@nestjs/websockets`) |
| 4 | Command delivery | #35 | `agent_command`, `AgentCommandsService` (own table, not the outbox) |
| 5 | Printing via agent | #36 | `printer.agent_connection`, `AgentPrintingService` |
| 6 | Card payments via agent | #37 | `payment_device.agent_connection/agent_driver`, `AgentPaymentsService` |
| 7 | Health screen + offline alerts | #38 | `AgentHealthService`, drawer on the Agents screen |
| 8 | Releases | #39 | `agent_release`, `/api/v1/agent-releases`, `/api/v1/agent/releases/*` |
| 9 | Test harness | this PR | `backend/test/utils/fake-agent.ts`, `agent-journey-postgres.spec.ts` |

All modules live in `backend/src/modules/agent-gateway`, except printing and payments, which
live in their own modules.

### Decisions taken while building (beyond the table above)

- **A device with an agent connection always goes through the agent.** If the agent is
  offline, its jobs wait (print 30 min, charge 60 s) and then fail with an alert. A device
  without a connection stays on the simulator. There is no silent fallback to the simulator.
- **Card payments.** A charge is failed only when the cloud knows it never reached the
  terminal. Otherwise the payment stays `PROCESSING` with `needs_terminal_check` until
  `payment.query` answers or a manager resolves it by hand (Checkout → *Check terminal* /
  *Resolve*).
- **One terminal per branch in v1** (the first by code that the agent drives), unless the
  payment intent names a device.
- **Presence is in memory.** `AgentSessionsService`, the delivery loop and the automatic query
  timers assume a single backend container. That is the case today.

### Before the end-to-end test on the branch PC (for the user)

1. **Arvan:** enable WebSocket for the domain (idle timeout above 20 s), and allow request
   bodies up to 64 MB on `/api/v1/agent-releases`.
2. **VPS `.env`:** set `AGENT_PUBLIC_URL=https://<public domain>`. Without it, `ws_url` is
   derived from the request host.
3. **VPS deploy script:** copy `deploy/deploy.sh` over `~/gnext-deploy/deploy.sh`. The new
   copy fails a deploy whose nginx does not pass WebSocket upgrades (it expects a 401 from
   `/api/v1/agent/ws`).
4. **Configure the branch in the app:**
   - Printer → *Connection: Network (TCP)*, with its IP and port 9100.
   - Payments → Devices → the Saman terminal → *Connect to agent*, with its IP, port and
     protocol *Saman (SEP)*.
   - Agents → *New enrolment code*.
5. **Build the Go agent** from the contract. Check it against `fake-agent.ts`, which behaves
   the way the contract requires, and the conformance list in contract §13.

### Agent releases from CI

After a deploy of `main`, the `agent-release` job uploads the `gnext-agent.exe` that run built,
unpublished. To ship an agent change: bump `agent/VERSION` in the PR, merge, then press
**Publish** on the Branch Agents screen. Nobody downloads or uploads a file by hand.

One-time setup (until it is done the job warns and skips):

1. Make a token: `openssl rand -hex 32`.
2. VPS `~/gnext-deploy/.env`: `AGENT_RELEASE_CI_TOKEN=<token>`, then redeploy (Actions → CI/CD
   → Run workflow) so the backend picks it up.
3. GitHub → Settings → Secrets and variables → Actions: repository secret
   `AGENT_RELEASE_TOKEN` = the same token.

The build is reproducible (`-trimpath -buildvcs=false`), so the job's warning that a version is
already uploaded "with a different build" means the agent changed without a version bump.

### Still open

- ~~Who builds the Go agent~~ Built in `agent/` (see `agent/README.md`), with an `agent` CI
  job that tests it and uploads `gnext-agent.exe`. v1 prints to TCP/9100 printers (HTML
  rendered in headless Edge, sent as an ESC/POS raster) and charges through the `fake`
  terminal driver. `backend/test/agent-go-binary-postgres.spec.ts` runs this journey against
  the real binary when `GNEXT_AGENT_BIN` is set. Still to do: the `sep` driver (needs Saman's
  integration document), `windows`/`serial` printers, the test on the branch PC.
- Whether Saman's protocol can query a past transaction (contract §14). Until that is known,
  unconfirmed charges are resolved by hand.

## v2 plan (2026-09-23)

The user chose to build tasks 10–14 first and the offline POS after them. The contract for
10–13 is [§12 of `agent-protocol.md`](agent-protocol.md#12-branch-data-and-offline-sync-v2),
agreed and merged (#105), as task 0 was.

| # | Task | Cost | Risk | Importance |
|---|---|---|---|---|
| 10 | **Branch snapshot**: `GET /agent/data/snapshot` (ETag, served versions kept 30 days), `data.changed` push, agent keeps the copy | Med | Med | High |
| 11 | **Offline order upload**: `POST /agent/sync/orders`, each order saved as received, then booked with its agent id; agent outbox and uploader | High | **High** | Critical |
| 12 | **Conflict rules** (§12.6): book what the branch sold, flag `PRICE_CHANGED`, `ITEM_REMOVED`, `SHIFT_CLOSED`, `DAY_CLOSED`, `STOCK_NEGATIVE`; hold `TOTAL_MISMATCH`, `PRICE_MISMATCH` | High | High | High |
| 13 | **Sync status**: `sync` in heartbeats, Agents screen warnings, uploaded orders with *Mark reviewed* and *Retry* | Low | Low | Med |
| 14 | **Remove the fake offline sync** (see below) | Low | Low | Low |
| ✂️ **Then the offline POS** (its own contract section and PR first) |||||

Until the offline POS exists, nothing at a branch makes offline orders. The agent's half of
task 11 is tested with orders the tests make; the cloud's half with `fake-agent.ts`.

**Task 14 is narrower than the table above said.** `backend/src/modules/simulation` is the
Snappfood and Tara mock that the demo uses, and the print and payment simulator is what every
branch without an agent prints and charges through. Both stay. What goes is the fake offline
sync that task 13 replaces: `backend/src/modules/offline-sync` (`/api/v1/sync/*`), the
*Simulation → Offline sync* page and its tile in the simulation centre, and its tables.
`sync_conflict_record` and `sync_category_log` have no other reader. `offline_queue_item` is read by
`reports.service.ts` and `branch_status_snapshot` by `tenant.service.ts`; those reads move to the
new sync data or go, before the tables are dropped.

Decisions in §12, confirmed by the user on 2026-09-24:

1. The snapshot is one document per branch, fetched whole when it changes. No paging, no deltas.
2. It carries no users, PINs, customers, coupons or discounts. Offline sign-in is left to the
   offline POS step.
3. An offline order is uploaded once, when it is completed, cancelled, or still open when the
   link returns. After that it lives in the cloud.
4. The cloud never refuses a sale that was made. It books it at the price charged and flags
   differences; it holds (does not book) only orders whose own numbers do not add up, or that
   charged a price the cloud never gave the till.
5. No coupons or discounts offline, and shifts are neither opened nor closed offline.
6. Offline orders are not sent to the kitchen again on upload.

### v2 status (2026-09-24)

| # | Task | PR | Where |
|---|---|---|---|
| — | Contract §12 | #105 | `agent-protocol.md` §12 |
| 10 | Branch snapshot, agent 1.1.0 | #106 | `backend/src/modules/agent-data` (`AgentDataService`, `AgentDataChangesService`), migration 073; `agent/internal/branchdata` |
| 11–12 | Offline order upload and conflict rules, agent 1.2.0 | #107 | `AgentSyncService`, `agent_sync_order`, `order_header.source`, migration 074; `agent/internal/offline` |
| 13 | Sync status and the Offline orders card | #108 | heartbeat `sync` in `agent-connection.ts`, `syncWarnings`, `/api/v1/agent-sync/orders`, `agent-sync-orders-card.tsx` |
| 14 | Fake offline sync removed | #109 | module, page, tile, `GET /branches/:id/status` and four tables gone (migration 075) |

Press **Publish** on agent 1.2.0 in Branch Agents so branch PCs pick up `data.pull` and
`sync.orders`.

Left for the offline POS step; the task list, decisions to ask and traps are in
[`HANDOFF-offline-pos.md`](HANDOFF-offline-pos.md):

- The till screen, served by the agent on the branch LAN, that sells from `branch-datasnapshot.json`
  and hands finished orders to `offline.Outbox.Add`.
- Offline sign-in (the snapshot has no users or PINs; decide how a cashier proves who they are).
- Rendering tickets on the agent (today the cloud renders the HTML), and charging the terminal
  without a cloud command.
- On upload: marking tables occupied for an `OPEN` dine-in order, a delivery record for a delivery
  order, and option group names on the lines.
- Real-binary check of the upload path: nothing produces offline orders until the till exists.

## How to start

1. Read `CLAUDE.md` (worktree per task, PRs only, what CI runs).
2. Skim `Gnext-Prototype-v1.5-Build-Specification.md` (search "local agent") and
   `Phase 1-- HAMI Replacement Scope_rev3.md` §17–18 for background. Where they conflict with
   the decisions above, the decisions above win.
3. Look at the modules you will touch: `backend/src/modules/printing`, `payment`, `outbox`,
   `simulation`, `offline-sync`.
4. Do **task 0** first, open it as its own PR, and show the user the contract before
   building tasks 1–9.
5. Pause for the user after the v1 cut line.
