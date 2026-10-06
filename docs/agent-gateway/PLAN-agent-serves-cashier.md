# Plan: the branch agent serves the cashier

Written 2026-10-06 by the lead session, for Sonnet workers. One slice per worker, in order.
The lead audits each slice, opens its PR, waits for CI and merges it before the next slice
starts.

## Why

The offline till (agent-protocol §13–§18) switched the cashier between two worlds: the cloud,
and a reduced till on the agent. A short internet interruption moved the cart, dropped
delivery, customers and discounts, and asked for the PIN again. The cashier also still had to
go to gnext.top for orders, delivery, incoming orders and shift close: two screens.

The new direction, decided by the product owner on 2026-10-06:

1. **The agent always serves the cashier.** Every register opens one address on the agent and
   uses the cashier pages from there, online or not. Nothing switches.
2. **First versions only proxy.** The agent passes every API call to the cloud. Offline
   features come back later, one at a time, inside this same app.
3. **Cashier pages only.** POS, orders, delivery, incoming orders, shift and cash. Manager and
   head-office pages stay on gnext.top; the agent-served app links out to them.
4. **The page is the cloud's own build, cached.** The agent downloads the cloud's current
   frontend build after each deploy, serves it from disk, and keeps the previous one. Same
   version as the cloud; still opens after a reboot with no internet.
5. **Normal sign-in, passed through.** The same username and password screen as gnext.top.
   No PIN sign-in on the agent for now.
6. **Interruptions: hold and retry.** The screen stays as it is with a *Reconnecting* bar. The
   agent retries reads; writes are retried only when they carry an idempotency key. Card
   charges are never retried.
7. **The offline selling built so far is removed**, all of it: till, PIN staff list, pairing,
   automatic switch, branch snapshot, offline upload and conflict rules, offline Snappfood
   matching. Offline will be rebuilt later on the new base.

## Shape of the result

```
register browser ── http://127.0.0.1:47800/        (branch PC)
                 └─ http://<branch-pc-ip>:47801/   (any other register on the LAN)
                          │
                    gnext-agent (Go)
                    ├─ /             cached cloud frontend build (SPA fallback to index.html,
                    │                with <meta name="gnext-agent" …> injected)
                    ├─ /api/*        proxied to the cloud, headers passed through
                    ├─ /uploads/*    proxied to the cloud
                    ├─ /agent/       the agent's own settings page (loopback listener only)
                    └─ /agent/api/*  the settings page's API, and /agent/api/status for the app
                          │
                    https://gnext.top  (frontend origin = API origin in production)
```

- Auth today is a bearer token in `sessionStorage` (`starter-vite-ts/src/api/httpClient.ts`),
  CSRF token in memory, `X-Terminal-Id` from `localStorage`. All three are page-side. The
  login also sets the cookie `gnext_session` (host-only, `HttpOnly`, `SameSite=Lax`), which the
  live-update `EventSource` needs because it cannot send a header. So the proxy passes headers
  and `Cookie` through, and passes `Set-Cookie` back with its `Domain=` and `Secure` attributes
  removed (the agent is plain http on another host). The agent holds no session.
- Production builds use `VITE_SERVER_URL=""` (same origin), so a cached build already calls
  `/api/...` on whatever served it: the agent.
- Printing and card terminals do not change: the cloud still drives them over the agent's
  WebSocket.

## Rules for every slice

- Worktree: the lead gives you the path and branch. Work only there. Never edit
  `D:\VibeCode\ClaudeCode\Gnext-Prototype-v2.5` (the main checkout).
- Commit locally; do not push, open a PR or merge. End commit messages with
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Use `git commit -F <file>` for
  messages with quotes (PowerShell breaks `-m "..."`).
- Before reporting, run what CI runs for every part you touched:
  - backend: `npm run typecheck` and `npx jest` (the whole suite, Postgres specs included;
    `backend/.env` must be present: copy it from the main checkout, delete the copy before you
    finish). Run `npm run migration:run` first if you added a migration.
  - frontend: `npm run lint` and `npm run build` in `starter-vite-ts`.
  - agent: from **PowerShell**, not Git Bash (the Edge render test fails under Git Bash):
    `$env:PATH="$env:LOCALAPPDATA\Programs\go\bin;$env:PATH"; go vet ./... ; go test ./...` in
    `agent`. Go modules from Iran need `$env:GOPROXY="https://goproxy.io,direct"`.
- `node_modules`: link the main checkout's with
  `New-Item -ItemType Junction -Path <wt>\backend\node_modules -Target D:\VibeCode\ClaudeCode\Gnext-Prototype-v2.5\backend\node_modules`
  (same for `starter-vite-ts`). Remove junctions with `cmd /c rmdir <path>` only, never
  `Remove-Item -Recurse`. If you run `npm ci`, revert `starter-vite-ts/yarn.lock` before
  committing.
- `starter-vite-ts/src/locales/en.json` and `fa.json` must keep exactly the same keys. Removing
  a key from one means removing it from the other. Check with `node scripts/check-i18n.js` if it
  covers it, else compare key sets yourself.
- Do not run `npx prettier` on backend files (the repo is not prettier-clean; it rewrites whole
  files).
- Bump `agent/VERSION` in every slice that changes the agent (see each slice). CI publishes a
  release only for a new version, unpublished until head office presses Publish.
- Persian copy: plain, short, the way the existing UI talks. Every new user-facing string gets
  an `en` and a `fa` value.
- Docs follow the code: when a slice changes behaviour, update `agent/README.md` and the
  protocol section it touches in the same slice.

---

## S0 — Contract (docs only)

Branch `docs/agent-serves-cashier` (this plan is already on it).

1. `docs/agent-gateway/agent-protocol.md`:
   - New **§19 The agent serves the cashier (v3)**, written from this plan: decisions, the two
     listeners, routes, the proxy rules (S3), the frontend cache and `build-manifest.json`
     (S3), agent mode in the app (S4), reconnecting and retries (S5), idempotency (S6),
     capability `app.serve`.
   - At the top of §12, §13, §16, §17 and §18 add one line: *Removed 2026-10-06 (§19). Kept for
     history; nothing here is built any more.* Do not delete their text.
   - §1 *What the agent does*: point to §19.
2. `docs/agent-gateway/HANDOFF.md`: a short *v3 direction* entry linking this plan.
3. No code.

Check: Markdown renders (headings, tables); links resolve.

---

## S1 — Remove offline selling from the agent

Branch `refactor/agent-remove-offline`. Agent `VERSION` → `2.0.0`.

Remove:
- `agent/internal/till/` (all), `agent/internal/offline/`, `agent/internal/branchdata/`.
- `agent/internal/localui/till.go`, `till_orders.go`, `till_test.go`, `tillui/`, `cloud.go`
  and `cloud_test.go` (the till-coupled proxy; S3 writes a new, simpler one), and the pairing
  parts of `lan.go`/`lan_test.go`. Delete `lan.go` entirely if nothing but the till uses it;
  S3 brings the LAN listener back.
- In `agent/internal/cloud/cloud.go`: snapshot pull, staff list pull, offline upload, PIN
  login/logout calls.
- In `agent/internal/agent/agent.go`: `ChargeLocal`, `PrintLocal`, the till/snapshot/backlog
  fields in heartbeats, call-number keeping (`call-numbers.json`), `data.changed` handling.
  Keep `devices.json` (last printer/terminal config, used when restarted with no cloud): it is
  useful on its own.
- In `agent/internal/protocol/protocol.go`: capabilities `data.pull`, `sync.orders`,
  `pos.offline`, `pos.till`, `pos.lan`, `pos.snappfood`, and the message fields only they use. Keep
  `print.html`, `payment.charge`, `payment.query`.
- `agent/cmd/gnext-agent`: the `till` command, the tray's till menu item, open-at-sign-in of
  the till, firewall rule handling for 47801 (S3/S7 bring a new one back). At service start, delete the old *Gnext POS* firewall rule that
  agents 1.x and the old installer added: `netsh advfirewall firewall delete rule name="Gnext POS"`
  (ignore "no rules match").
- `agent/installer/gnext-agent.iss`: the *Gnext POS* shortcuts (leave the `[InstallDelete]`
  lines that remove old shortcuts, and add the *Gnext POS* ones to them).
- `.github/workflows/ci-cd.yml`: the *Build the offline till screen* step and its `test -f`.
- Settings page (`agent/internal/localui/static`): the *صندوق جی‌نکست* card, pairing UI, and
  anything that calls a removed route.
- The data files the agent left on PCs (`branch-data\`, `offline-orders.db`, `till.json`,
  `till-orders.db`, `till-devices.json`, `call-numbers.json`): delete them once at service
  start if present, logging what was removed.

Keep: enrolment, WebSocket session, journal, printing, payments (`sep`, `fake`), update and
bridge update, tray, settings page and its manager sign-in, LAN scan, `devices.json`.

Checks: `go vet ./...`, `go test ./...` from PowerShell, `go build ./cmd/gnext-agent`. Also
grep the agent for `till`, `offline`, `snapshot`, `staff`, `pairing`, `branchdata` and explain
every remaining hit in the report.

---

## S2 — Remove offline selling from the cloud and the web app

Branch `refactor/cloud-remove-offline`. No agent change.

Backend, remove:
- `backend/src/modules/agent-data/` (snapshot, sync, sync admin, change notices) and its
  registration in `app.module.ts`.
- `agent-local`: `POST /api/v1/agent/local/pin-login`, the staff list route, and their service
  code (keep `login`, `logout`, printers, terminals: the settings page uses them).
- `GET /api/v1/terminals/{id}/agent-till` and the heartbeat `till` handling behind it.
- `offline_ready` in `GET /api/v1/agents` (`agent-health.service.ts`,
  `agent-registry.controller.ts`, `agent-connection.ts`).
- Snappfood offline matching (§17): `aggregator_match` logic and the *missed while offline*
  list.
- `AgentSyncOrder` entity and its uses (`simulation.module.ts`, `simulation.service.ts`).
- `ORDER source=AGENT_OFFLINE`: remove the code that creates it; leave the enum value if
  dropping it would need a data migration, and say so.
- Do **not** touch `AGENT_OFFLINE` in `payment/agent-payments.service.ts`: that is the error
  code for an agent that is not connected, unrelated.

Backend, add one migration (next free number after the highest in `src/migrations`):
- drop table `agent_sync_order`;
- drop every `trg_agent_data_notify` trigger and the `gnext_agent_data_notify_*` functions
  (migrations 073, 076, 078 list the tables);
- drop `order_header.aggregator_match` and `aggregator_match_at` and their index;
- drop anything else migrations 073/074/076/078 created only for offline;
- `down()` may be a no-op with a comment.
Do not edit old migrations.

Backend tests: delete `agent-data-postgres.spec.ts`, `agent-sync-postgres.spec.ts`,
`agent-snappfood-offline-postgres.spec.ts`, `agent-till-served.spec.ts`; edit
`agent-local-postgres.spec.ts`, `agent-health-postgres.spec.ts`, `agent-journey-postgres.spec.ts`,
`utils/snappfood-intake-mocks.ts` to drop only the offline parts.

Frontend, remove:
- `starter-vite-ts/src/till/`, `till.html`, `vite.till.config.ts`, `scripts/build-till.mjs`,
  the `build:till` and `dev:till` scripts in `package.json`.
- `src/pages/pos/offline-till-banner.tsx` and its use in `order.tsx`.
- `src/contexts/pos-source.tsx`: collapse to the cloud only. `order.tsx`, `CheckoutModal`,
  `ApprovalModal`, `pos-shift`, `register-notice`, `pos-stop-dialog` call the cloud API
  directly again, the way they did before P4b-1 (#120); `PosFeatureGate` goes (23 uses: every
  gated control simply renders). The cart-carry code (§16.6: `carry`, refused-line marks,
  *may already be in the kitchen*) goes. **This is the riskiest edit in the plan**: keep the POS
  behaving exactly as the web POS does today. Read `git show` of #120's merge for what the
  layer replaced.
- `src/pages/operations/agents.tsx`: *ready to sell offline*, the *Offline orders* card, sync
  status. `src/api/agentsApi.ts`: their calls and types.
- `src/config/version-labels.ts`: `pos.offlineTill` and other offline entries.
- Locale keys used only by removed code, from **both** `en.json` and `fa.json`.
- Keep `src/utils/cloud-reachability.ts` and its calls in `httpClient.ts`: S5 reuses them.

Checks: backend typecheck + full jest; `npm run migration:run` on the local DB then
`npm run migration:revert` is **not** required; frontend lint + build. Grep backend and
frontend for `till`, `agent-data`, `AgentSync`, `pin-login`, `offline_ready`,
`aggregator_match`, `pos-source`, `PosFeatureGate`, `offlineTill` and explain every remaining
hit. Then open the web POS in a browser is the lead's job; describe in the report which POS
flows you exercised by reading code paths (place order, pay cash, pay card, park, resume,
delivery order, discount, customer).

---

## S3 — The agent serves the cloud's frontend and proxies the API

Branch `feat/agent-serves-app`. Agent `VERSION` → `2.1.0`. Capability `app.serve`.

### 3a. Frontend build manifest (starter-vite-ts)

- A small Vite plugin or post-build script writes `dist/build-manifest.json`:
  `{ "build_id": "<sha256 of the sorted file list+hashes, first 16 hex>", "built_at": "...",
  "files": [{ "path": "index.html", "sha256": "…", "size": 1234 }, …] }` covering every file
  in `dist` except the manifest itself. `npm run build` produces it.
- `starter-vite-ts/nginx.conf`: serve `/build-manifest.json` and `/index.html` with
  `Cache-Control: no-cache`. Hashed `assets/*` keep their long cache.

### 3b. Agent: app cache (`agent/internal/appcache`, new)

- Frontend origin = the agent's `server` (production serves frontend and API from one host).
  Add an optional `app_url` to the agent config (`internal/store`) that overrides it, for local
  development where the frontend is `vite preview` on another port.
- Every 5 minutes, after each WebSocket connect, and on `GET /agent/api/app/refresh` (manager
  session), fetch `<app_url>/build-manifest.json`. If `build_id` differs from the current one,
  download every file whose `sha256` is not already in the local content store, verify the
  hash, then write the new build to `<data>\app\<build_id>\` and switch to it atomically
  (`<data>\app\current.json`). Keep the current and the previous build; delete older ones.
- Files are deduplicated by hash across builds (copy or hard-link from the previous build), so
  a deploy that changes three chunks downloads three chunks.
- A failed download keeps the current build and retries with backoff. No build at all yet
  (fresh install, never online): the app route answers a small Persian page *Gnext has not
  been downloaded to this PC yet; connect it to the internet once.*
- Log each switch: old id, new id, files fetched, bytes. Record when the build was switched to
  (`downloaded_at`) in `current.json`.

### 3c. Agent: routes (`agent/internal/localui`)

- Settings page moves from `/` to `/agent/`, its API from `/api/*` to `/agent/api/*`. Update
  `static/app.js`, the WebView window and `gnext-agent open` URL, tray links, tests.
- App, on both listeners:
  - `GET /` and any path that is not `/api/`, `/uploads/`, `/agent/`: a file from the current
    build if it exists, else `index.html` (SPA fallback). `index.html` gets, right after
    `<head>`, `<meta name="gnext-agent" content='{"version":"<agent version>","cloud_url":"https://gnext.top","lan":false}'>`
    (JSON, HTML-escaped; `version` is the running agent's; `cloud_url` is the frontend origin,
    a string: `app_url` if set, else `server`; the API target is always `server`; `lan` true on
    the LAN listener).
    `index.html` is `no-cache`; `assets/*` are `immutable` with a year's max-age.
  - `/api/*` and `/uploads/*`, every method: proxied to the cloud's same path and query.
    Request headers passed through except hop-by-hop ones and `Host`; add `X-Forwarded-For`
    (the register's address) and `X-Forwarded-Proto: http`; set `User-Agent` to the page's own
    plus ` gnext-agent/<version>`. Body limit 16 MB (photo uploads). Response: status, headers
    (less hop-by-hop) and body, streamed. Timeout 30 s, except `/api/v1/live/stream` which is
    streamed and flushed with no timeout. No redirects followed. `Cookie` is passed through;
    `Set-Cookie` comes back with its `Domain=` and `Secure` attributes removed.
  - Failures, answered with the app's problem JSON shape (the table is in §19.10; S3 builds the
    first row, and the `504` row without retries):
    - request not sent (dial, DNS, TLS refused, connection reset before the request was
      written) or the cloud's gateway answers `502`/`503`: `502`, `code: "CLOUD_UNREACHABLE"`,
      any method;
    - request written but no answer within the timeout, or the gateway answers `504`: writes
      get `504`, `code: "CLOUD_NO_ANSWER"` (the write may have happened); reads get `502`
      `CLOUD_UNREACHABLE`. S5 only adds retries.
  - `/api/v1/agent/*` and `/api/v1/agent-releases/*` are **not** proxied: `403`.
- Listeners:
  - loopback `127.0.0.1:47800`: app + settings page. Refuse a foreign `Host` (keep the
    existing DNS-rebinding guard).
  - LAN `0.0.0.0:47801`: app only (no `/agent/` except `/agent/api/status`). Any `Host`. On by
    default; the service adds the Windows firewall rule *Gnext* for TCP 47801 (private and
    domain profiles) at start, and the installer removes it on uninstall.
- `GET /agent/api/status` (both listeners, no auth): `{ "version", "cloud": { "connected":
  bool, "since": time } , "app": { "build_id", "built_at", "downloaded_at" } }`. `connected` is the WebSocket
  session state.

### 3d. Tests

- Go: proxy passes headers and body both ways; drops hop headers; passes `Cookie` and strips
  `Domain=` and `Secure` from `Set-Cookie`; `CLOUD_UNREACHABLE` on a dead upstream;
  `CLOUD_NO_ANSWER` for a write the cloud never answered, `CLOUD_UNREACHABLE` for a read; SSE is flushed event by event; `/api/v1/agent/*` refused; SPA fallback; meta
  injected once; app cache downloads only missing hashes, rejects a bad hash, switches
  atomically, keeps two builds; LAN listener refuses `/agent/` except status.
- Manual, written in the report: build the frontend (`npm run build`, then
  `npx vite preview --port 4173`), run the local backend, run the agent in a console
  (`gnext-agent run`) enrolled against the local backend with `app_url` set to
  `http://localhost:4173`, open `http://127.0.0.1:47800/`, confirm the login page loads and
  `/api/v1/health` (or any GET) comes back through the agent. Signing in is the lead's job.

---

## S4 — Agent mode in the web app

Branch `feat/app-agent-mode`. Frontend only.

- `src/utils/agent-mode.ts`: reads the `gnext-agent` meta once; exports `agentMode` (`null`
  outside the agent, else `{ version, cloud_url, lan }`).
- Routes in agent mode: allow only the cashier set: POS (`/app/pos`), orders directory and
  order detail, delivery hub, incoming orders, shift/cash pages the cashier role already sees,
  the profile/sign-out drawer, and the login page. Read the router (`src/routes/sections`) and
  the cashier role's nav to build the list; put it in one array with a comment. Any other
  route renders a small page: *This page opens on gnext.top* with a button to
  `<cloud_url><same path>` in a new tab.
- Nav in agent mode shows only the allowed items, plus one *Open Gnext* link to `cloud_url`.
- After sign-in in agent mode, land on POS.
- A small chip in the header in agent mode: *Branch PC* (or *Register on the branch network*
  when `lan`), with the agent version in its tooltip.
- Nothing changes outside agent mode. Lint + build. Add a unit test for the route allow-list
  if the frontend has a test runner; otherwise say so.

---

## S5 — Interruptions: reconnecting bar and read retries

Branch `feat/agent-reconnect`. Agent `VERSION` → `2.2.0`; frontend.

Agent:
- S3 already maps failures to answers (§19.10). S5 only adds retries.
- For `GET`/`HEAD` (not the live stream): every failure in that table (not sent, written with no
  answer, gateway `502`/`503`/`504`) is retried. The window is counted from when the request
  arrived at the agent: an attempt every 2 s, no new attempt after 20 s, and each attempt has
  its own timeout of min(30 s, time left + 10 s). Then `502 CLOUD_UNREACHABLE`. If the client
  goes away, stop.
- Writes: no retry yet (S6); the answers stay as in S3.

Frontend (agent mode only, unless noted):
- Reachability = the agent's `/agent/api/status` `cloud.connected`, polled every 3 s, combined
  with `cloud-reachability.ts` (requests that got no answer). Outside agent mode keep today's
  behaviour.
- When unreachable for more than 2 s: a thin amber bar at the top, *Reconnecting to Gnext…
  your screen and cart are kept* (fa: *در حال اتصال دوباره به جی‌نکست… صفحه و سبد خرید سر
  جایش است*). After 2 minutes: *No internet. Orders can't be sent until it is back.* No toast
  per failed request while the bar shows (suppress `NETWORK_ERROR`/`CLOUD_UNREACHABLE`
  toasts).
- When it comes back: the bar turns green for 3 s (*Connected again*) and the app refetches
  what is on screen: dispatch a `gnext:cloud-back` window event and make the POS (menu, shift,
  open orders), orders directory, delivery hub and incoming orders listen to it. The live
  stream reconnects on its own; check it does.
- A write that failed with `CLOUD_UNREACHABLE` shows a clear inline message where the button
  was pressed (*Not sent. Try again when connected.*); with `CLOUD_NO_ANSWER`: *We couldn't
  confirm this was saved. Check the order before trying again.* The cart is never cleared on
  either.

Tests: Go tests for the retry window and the client going away. Manual (report): with the
local stack from S3, stop the backend for 10 s and for 3 minutes while on the POS with items in
the cart; describe what showed and that the cart survived.

---

## S6 — Safe write retries with idempotency keys

Branch `feat/idempotent-writes`. Agent `VERSION` → `2.3.0`; backend; frontend.

- Backend: the `IdempotencyInterceptor` and `@RequireIdempotency(scope)` decorator exist
  (`backend/src/common`) but no route uses them. Put it on: order submit (place), cash
  payment, order create (draft), and the add-lines/quote call the POS makes on *Place* if it
  writes. Read the interceptor first: a missing key must stay allowed (other clients don't
  send one) unless the decorator makes it mandatory; if it is mandatory, add an optional mode.
  Same key + same body replays the first answer; same key + different body is `409`.
- Frontend: those calls send `Idempotency-Key`, one UUID per user action, reused on the app's
  own retry of that action. Generate it without `crypto.randomUUID` when that's missing (the
  LAN listener is plain http, not a secure context; reuse `generateCorrelationId`'s fallback).
- Agent: a non-GET request **with** `Idempotency-Key` is retried like a GET (S5), also after
  a written-but-unanswered attempt. The final answer is `504 CLOUD_NO_ANSWER` if any attempt
  was written and unanswered, else `502 CLOUD_UNREACHABLE`. Without the key: unchanged.
- Card charges: never retried by the agent, key or not. Exclude by path every route in
  `payment.controller.ts` that starts or checks a terminal charge (`POST /api/v1/payments/:id/process`,
  `POST /api/v1/payments/:id/check-terminal`, and any other you find), and list them in §19.11.

Tests: backend Postgres spec: the same submit twice with one key gives one order, one ticket,
one kitchen print job; a different body with the same key is `409`. Go test: keyed POST
retried after an upstream drop mid-request; unkeyed POST not retried; card path never retried.

---

## S7 — Shortcuts, window, Branch Agents page

Branch `feat/agent-app-shortcuts`. Agent (`VERSION` → `2.4.0`); backend; frontend.

- `gnext-agent app` opens `http://127.0.0.1:47800/` in the WebView2 window (browser
  fallback), the way `open` opens the settings page. Installer: Start-menu and desktop
  shortcut *Gnext* → `gnext-agent.exe app`. Tray: *Open Gnext* (first item) and *Agent
  settings*.
- Open at Windows sign-in, on by default, setting on the settings page (`app_at_sign_in` in
  the agent's existing `config.json`, through `internal/store`). Not at service start.
- Settings page: a card *Registers on this network* showing `http://<each LAN IPv4>:47801/`
  with a copy button, and the current app build id and when it was downloaded, with
  *Download now* (S3's refresh).
- Operations → Branch Agents (web): per agent, the agent version, `app.serve` yes/no, the app
  build id it serves vs the cloud's current one (*up to date* / *behind*), and its LAN address.
  The agent reports `app_build_id` and `lan_urls` in the heartbeat (the fields are in §19.12).
  Backend: store both from the heartbeat and return them in `GET /api/v1/agents`. The page
  learns the cloud's current build by fetching its own `/build-manifest.json`.
- `agent/README.md`: rewrite *What it does* for v3; drop the offline sections.

Checks: all three stacks; backend: a test that a heartbeat's fields show in `GET /api/v1/agents`. Installer change: `iscc` is not on this PC (CI builds it); say what
you changed and that CI will build it.

---

## After S7 (the lead)

- End-to-end on the dev PC with the real binary: install, sign in, sell, pull the network for
  10 s and 3 min, open from a second device on the LAN.
- Update the memory notes (`gnext-local-agent`) and this plan's status.
- Offline features, one at a time, later and only when the product owner asks: queue *Place*
  and print the kitchen ticket locally → menu from the agent → cash offline → sign-in offline →
  card offline.

## Status

| Slice | PR | State |
|---|---|---|
| S0 | | |
| S1 | | |
| S2 | | |
| S3 | | |
| S4 | | |
| S5 | | |
| S6 | | |
| S7 | | |
