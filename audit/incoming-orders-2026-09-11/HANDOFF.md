# Incoming Orders: handoff

For a Claude session picking this work up from GitHub. It covers what was agreed, what
slice 1 changed, and what slices 2 to 4 still need.

- Repo: `https://github.com/baensaf/Gnext-Prototype-v2.5`, branch `main`
- Slice 1 commit: `dd8b8de` fix(snappfood): hold incoming orders out of the kitchen until the store accepts them
- Written: 2026-09-11

## Start here

```bash
git pull origin main
cd backend && npx jest            # expect 45 suites, 513 tests, all green (as of dd8b8de)
npx tsc --noEmit -p tsconfig.json # backend typecheck
cd ../starter-vite-ts && npx tsc --noEmit -p tsconfig.json
```

- Dev servers are defined in `.claude/launch.json`: `gnext-api` (NestJS, port 3100) and `gnext-web` (Vite, port 8081).
- Demo credentials come from `backend/src/seed.ts` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`, approver PIN). Don't copy them into docs.
- Backend tests are unit tests with mocked TypeORM repositories (see `backend/test/simulation.spec.ts` and `backend/test/kds.spec.ts`), plus a few Postgres integration specs.

### Working agreements with this user

- **Pause between slices.** Present each slice with its cost, risk and impact, do it, then stop and wait for a go before the next one.
- **Prove a bug before fixing it.** Write the failing test first, then fix. Don't harden beyond what the demo needs; this is a prototype.
- **Other sessions commit to `main` at the same time.** Run `git fetch` before starting, stage only your own files by name (never `git add -A`), and pull/rebase before pushing.
- **Commit messages go through a file.** In PowerShell a message containing `"` breaks `git commit -m`, so write it to a file and use `git commit -F <file>`. Style: conventional prefix, then a plain sentence (`fix(snappfood): ...`), with a body explaining why.
- Never enter the demo password into the app yourself. Verify with tests, or ask the user to click through.

## The design (agreed direction)

The user proposed this flow for aggregator (Snappfood), website and kiosk orders, and agreed to build it in slices:

1. The order arrives and waits **awaiting acceptance**. It does not reach the KDS.
2. The cashier gets a toast ("New Snappfood order — 450,000 Toman") with View / Accept / Reject, plus a sound.
3. The order also sits in a persistent **Incoming Orders** queue, with a badge in the header or sidebar, until someone handles it.
4. The **Notification Center** mirrors the event for history only. It is not the operational queue.
5. The cashier opens the order and sees the customer, items, notes, payment, source and delivery details.
6. **Accept:** confirm the order, send it to the KDS, print kitchen tickets, send the acceptance to the aggregator, and start the prep timer.
7. **Reject:** a reason is required. Tell the aggregator; nothing goes to the kitchen.

Refinements proposed in review. The user approved the slice plan but hasn't signed off on each of these individually, so confirm the ones marked (open) before building them.

- **Approval is a per-channel policy.** Aggregator: manual. Website: manual or auto (open). Kiosk: auto by default, because the customer is standing there and has often already paid.
- **A timeout is required.** Snappfood cancels or penalises a store that doesn't respond in time. The queue shows a countdown and the sound repeats while anything is pending. On expiry, auto-reject or auto-accept per policy and raise an alert. Duration and default expiry action: (open).
- **Accepting is a role permission, not the PIN approval workflow.** The approval engine (`backend/src/modules/approval/`) is for actions beyond a cashier's limits. Putting a PIN on every incoming order would stall a rush. Escalation applies only to rejecting an order that was already accepted, which is effectively a cancellation. Permission name: (open).
- **Accept asks for a prep time.** Default it from settings, with +5 / +10 buttons. Snappfood's accept takes `deliveryTime` (max 70), `riderPickupTime` and `delta`.
- **Reject reasons come from Snappfood's decline-reason list.** For "out of stock", offer to suspend the item on Snappfood (temporary item suspension is in scope).
- **Rejected is its own terminal state, separate from Cancelled.** Rejection rate is a KPI aggregators track.
- **Only one person can accept.** The queue shows on every POS in the branch; the order's `@VersionColumn` stops two cashiers accepting the same order.
- **Accept works locally first.** Confirm and fire to the kitchen straight away, then send the acceptance to the aggregator with retries (the outbox exists: `backend/src/modules/outbox/`). The scope requires the branch to keep running during a cloud outage. One exception: if the aggregator says the customer already cancelled, pull the tickets back.

## What slice 1 did (dd8b8de)

Before this commit, a Snappfood order landed with `status: 'SUBMITTED'`. `KdsService.getKdsTickets` creates tickets for every `SUBMITTED` order whenever the KDS polls, so the kitchen received orders nobody had accepted. Ack and pick also reset orders to `SUBMITTED`.

Changes:

- **New state.** `OrderState` now includes `PENDING_ACCEPTANCE` (`backend/src/entities/OrderHeader.entity.ts`). Its transitions are `PENDING_ACCEPTANCE -> CONFIRMED | CANCELLED` (`ALLOWED_TRANSITIONS` in `backend/src/modules/order/order.service.ts`).
- **Webhook orders** (`SimulationService.handleSnappfoodWebhook`) now land with `channel: 'AGGREGATOR'`, `state` and `status` both `'PENDING_ACCEPTANCE'`. Previously `state` defaulted to `DRAFT` and `channel` to `POS`.
- **Branch resolution** (`SimulationService.resolveWebhookBranch`). The per-branch webhook (`POST /simulated-webhooks/snappfood/:branchCode`) files the order under that branch and refuses an unknown or inactive one with 404. With no branch named (the simulator), it picks the oldest active `RESTAURANT` branch, never an office or commissary.
- **Lifecycle actions** (`triggerSnappfoodAction`, `ackOrder`, `pickOrder`, `acceptOrder`, `rejectOrder`) use three helpers: `markAwaitingAcceptance`, `markAccepted` and `markCancelled`.
  - Ack and pick don't change the order.
  - Modify and recover set it back to awaiting acceptance.
  - Accept sets `state: CONFIRMED`, `status: KITCHEN_PREPARING`.
  - Reject and cancel set `CANCELLED`; deliver sets `COMPLETED`.
- **Orders page** (`starter-vite-ts/src/pages/orders/workflow.tsx`) shows an "Awaiting acceptance" chip, keys `orders.statuses.pendingAcceptance` in `en.json` and `fa.json`.
- **Tests:**
  - `backend/test/simulation.spec.ts`, block "an incoming Snappfood order waits for the store to accept it": webhook channel and state, branch routing, no head-office fallback, ack/pick don't accept.
  - `backend/test/kds.spec.ts`, test "does not send an aggregator order to the kitchen before the store accepts it": a guard on the KDS sweep.

**How accept reaches the kitchen today:** simulator Accept sets `status: KITCHEN_PREPARING`, and the next KDS poll creates tickets through the sweep. That is a stopgap. Slice 2 should fire tickets explicitly.

### State model gotchas

- **`state` and `status` both exist.** `status` is the legacy twin of `state`. The KDS sweep (`kds.service.ts`, `getKdsTickets`) and the readiness roll-up (`checkOrderReadinessRollup`) still read **`status`**, and the sweep's list is `SUBMITTED | CONFIRMED | KITCHEN_PREPARING`. Keep the two in step. Never add `PENDING_ACCEPTANCE` to that list.
- **The KDS sweep is tenant-wide.** It creates tickets for any matching order in the tenant, whatever the branch filter.
- **`OrderService.transitionState` writes the same value to both fields** (`order.status = targetState`), so `POST /api/v1/orders/:id/confirm` already moves a pending order to `CONFIRMED`. It does not generate kitchen tickets or print; only `submitOrder` does that (see around `order.service.ts:587-602`).
- **Cancelling a pending order through the generic endpoint works, but silently.** `resolveOrderEditDecision` in `order-edit-policy.ts` returns FORBID for `PENDING_ACCEPTANCE` via its default branch. But `cancelOrder` leaves FORBID to `transitionState`, which allows `PENDING_ACCEPTANCE -> CANCELLED`. So `POST /api/v1/orders/:id/cancel` does cancel it, without telling Snappfood. Slice 2 should route aggregator rejection through its own endpoint and decide whether the generic cancel should be blocked for aggregator orders.
- **`SimulationController` is `@HeadOfficeOnly()`.** A branch cashier can't call `/api/v1/simulation/...`, so the real accept/reject must live somewhere branch-scoped.

## Code map

| Concern | Where |
|---|---|
| Snappfood webhook, lifecycle, decline reasons (simulated) | `backend/src/modules/simulation/simulation.service.ts`, exported from `simulation.module.ts` |
| Per-branch webhook route | `backend/src/modules/simulation/simulated-webhooks.controller.ts` |
| Simulator UI (generate order, ack/pick/accept/reject buttons) | `starter-vite-ts/src/pages/simulation/simulation-snappfood.tsx`. Sends **no branch** yet. |
| Order states, transitions, submit side effects | `backend/src/entities/OrderHeader.entity.ts`, `backend/src/modules/order/order.service.ts` |
| Order routes (branch-guarded by `@BranchOwned(OrderHeader)`) | `backend/src/modules/order/order.controller.ts` |
| Edit/cancel policy | `backend/src/modules/order/order-edit-policy.ts` |
| Kitchen tickets | `KdsService.generateTicketsForOrder` in `backend/src/modules/kds/kds.service.ts` |
| Printing | `PrintQueueService.enqueueOrderPrintJobs(tenantId, orderId, 'KITCHEN_TICKET', ...)` in `backend/src/modules/printing/print-queue.service.ts` |
| Outbox (for retrying aggregator calls) | `backend/src/modules/outbox/outbox-writer.service.ts` |
| Kiosk orders (auto-accepted: `state` and `status` `SUBMITTED`) | `backend/src/modules/kiosk/kiosk.service.ts` |
| Order-workflow settings page (the `autoAcceptOrders` toggle) | `starter-vite-ts/src/pages/settings/order-workflow.tsx`, saved as setting group `ORDER_WORKFLOW` |
| Branch-aware setting lookup | `pickSettingValue(rows, branchId)` in `backend/src/common/utils/setting-scope.util.ts`. `ORDER_WORKFLOW` is branch-overridable. |
| Notification Center (history) | `starter-vite-ts/src/layouts/components/notifications-drawer/`, backed by `alertsApi` |
| Reason codes | `backend/src/entities/ReasonCode.entity.ts`; `OrderHeader.cancellation_reason_code_id` |

Snappfood status codes used by the simulator: 56 new, 61 acked, 713 picked, 42 accepted, 51 rejected by store, 54 cancelled, 71 extra payment required.

## Remaining slices

### Slice 2: real accept and reject (cost medium, risk medium; the core flow)

The goal is branch-scoped endpoints a cashier can call, which do everything steps 6 and 7 describe.

- **Endpoints.** Add `POST /api/v1/orders/:id/accept` and `POST /api/v1/orders/:id/reject` to `OrdersController`, so they inherit `@BranchOwned`.
  - Accept body: `{ prepMinutes }`.
  - Reject body: `{ reasonId, comment? }`, where `reasonId` is required.
- **Accept:**
  1. Only from `PENDING_ACCEPTANCE`, otherwise 409.
  2. Transition to `CONFIRMED` through `transitionState` so an `OrderStateEvent` is recorded.
  3. Call `generateTicketsForOrder` explicitly.
  4. Enqueue `KITCHEN_TICKET` print jobs.
  5. Tell the aggregator. In the prototype that means calling `SimulationService.acceptOrder(tenantId, orderCode, { deliveryTime, ... })`, where `orderCode` is `order_number` without the `SNP-` prefix. Import `SimulationModule` into `OrderModule`; there's no cycle today.
- **Reject:**
  1. Only from `PENDING_ACCEPTANCE`.
  2. Record the reason and move to a terminal state. Decide between adding `REJECTED` to `OrderState` (recommended above) or `CANCELLED` plus a reason. If you add `REJECTED`, update `ALLOWED_TRANSITIONS`, the frontend labels and chip colours, and check reports that count cancellations.
  3. Call `SimulationService.rejectOrder`.
  4. No tickets, no printing.
- **Use Snappfood's decline reasons.** Serve them to the frontend (the simulator already has `getDeclineReasons()`), or map them to `ReasonCode` rows.
- **Only one accept wins.** Two concurrent accepts should give one success and one 409, relying on the version column or a state check inside the transaction.
- **Tests:**
  - accept fires tickets and prints exactly once;
  - reject fires neither;
  - accept or reject from any other state is refused;
  - the Snappfood call is made with the right code.
- Then decide what the generic `/cancel` does for aggregator orders (see the gotchas above).

### Slice 3: Incoming Orders queue, badge, toast, sound (cost medium, risk low; what the demo shows)

- **Backend list.** Add `GET /api/v1/orders?state=PENDING_ACCEPTANCE` or a dedicated `GET /api/v1/orders/incoming`, scoped to the caller's branch like `getOrders` does with `effectiveBranchId`.
- **Frontend page.** Add an Incoming Orders page under operations, with a header or sidebar badge showing the count.
  - Poll every few seconds; the prototype doesn't need websockets.
  - Clicking a row opens a drawer with the customer, items, notes, payment, source, delivery address and Accept / Reject.
- **Toast.** Show a toast when a new pending order appears; the snackbar component is in `starter-vite-ts/src/components/snackbar/`.
- **Sound.** Repeat the sound while any order is pending, not once per order.
- **Notification Center.** Mirror each arrival there for history.
- **Simulator.** Add a branch picker to `simulation-snappfood.tsx` and send `branch_id`, so the demo can target a branch. The backend already honours `branch_id` and `branch_code`.
- Add i18n keys in both `en.json` and `fa.json`.

### Slice 4: per-channel policy and timeout (cost medium, risk low; can come after the demo)

- **Policy.** Replace or extend `ORDER_WORKFLOW.autoAcceptOrders`, which the settings page saves but **no backend code reads**, with a per-channel policy: aggregator, website, kiosk. Read it with `pickSettingValue(rows, order.branch_id)`.
- **Auto-accept.** When a channel's policy is auto, run the slice 2 accept path at ingest time.
- **Timeout.** Expire orders left in `PENDING_ACCEPTANCE` longer than the configured time. Apply the expiry action, raise an alert, and record who or what acted (`SYSTEM`).

## Known leftovers (not in any slice yet)

- Webhook order items all get `line_number: 1` and a placeholder `product_id` (`00000000-0000-0000-0000-000000000001`). There's no product mapping from Snappfood `vmsFoodId` yet, though the scope lists aggregator product mapping.
- `order_type` is always `AGGREGATOR`; `expeditionType` (DELIVERY / PICKUP ...) isn't mapped.
- The webhook doesn't write an `OrderStateEvent` for the order's creation, so the Orders timeline starts empty for aggregator orders.
- Snappfood orders created before `dd8b8de` still have `status: SUBMITTED` and may already have kitchen tickets. That's demo data and harmless; reseed if it gets in the way.
