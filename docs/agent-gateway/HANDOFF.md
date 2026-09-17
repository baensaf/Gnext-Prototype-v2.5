# Agent gateway — handoff

Written 2026-09-17. Task 0 (the protocol contract) is in [`agent-protocol.md`](agent-protocol.md); nothing else is built yet.

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
