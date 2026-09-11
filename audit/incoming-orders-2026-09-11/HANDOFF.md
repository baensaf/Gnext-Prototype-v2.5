# Incoming Orders: handoff

For a Claude session picking this work up from GitHub. It covers what was agreed, what
each slice changed, and what is still open. All four planned slices are done.

- Repo: `https://github.com/baensaf/Gnext-Prototype-v2.5`, branch `main`
- Slices: 1 `dd8b8de`, 2 `caee4c3`, 3 `6e164f2`, 4 `8fae888`
- Written: 2026-09-11. Updated the same day after slices 2 to 4 landed.

## Start here

```bash
git pull origin main
cd backend && npx jest            # expect 48 suites, 547 tests, all green
npx tsc --noEmit -p tsconfig.json # backend typecheck
cd ../starter-vite-ts && npx tsc --noEmit -p tsconfig.json
```

- Dev servers are defined in `.claude/launch.json`: `gnext-api` (NestJS, port 3100) and `gnext-web` (Vite, port 8081).
- Demo credentials come from `backend/src/seed.ts` (`ADMIN_USERNAME` / `ADMIN_PASSWORD`, approver PIN). Don't copy them into docs.
- **Check which database you are about to touch before running migrations or the seed.** `src/scripts/migration-fresh.ts` sets `DB_PORT` to `5432` before dotenv loads, so a `DB_PORT` in `backend/.env` is ignored by `npm run migration:run:fresh`. Set the `DB_*` variables in the shell instead.
- Backend tests are unit tests with mocked TypeORM repositories, plus a few Postgres integration specs. The frontend has no unit tests: check it with `tsc`, `eslint` on the files you touched, and `npm run i18n:check`.

### Working agreements with this user

- **Keep updates short and in plain language.** Long technical reports confused them. Say what changed, whether it works, and what they need to do, if anything.
- **Pause between slices.** Present each piece of work, do it, then stop and wait for a go before the next one.
- **Ask before committing.** The user approves each commit and push.
- **Prove a bug before fixing it.** Write the failing test first, then fix. Don't harden beyond what the demo needs; this is a prototype.
- **Other sessions may commit to `main` at the same time.** Run `git fetch` before starting, stage only your own files by name (never `git add -A`), and pull/rebase before pushing.
- **Commit messages go through a file.** In PowerShell a message containing `"` breaks `git commit -m`, so write it to a file and use `git commit -F <file>`. Style: conventional prefix, then a plain sentence (`fix(snappfood): ...`), with a body explaining why.
- Never enter the demo password into the app yourself. Verify with tests, or ask the user to click through.

## The design and what was decided

The flow for aggregator (Snappfood), website and kiosk orders:

1. The order arrives and waits **awaiting acceptance** (`PENDING_ACCEPTANCE`). It does not reach the KDS.
2. The cashier gets a toast with a View link, plus a chime that repeats while anything is waiting.
3. The order sits in the **Incoming Orders** queue (`/app/orders/incoming`), with a count in the header and sidebar, until it is answered.
4. The **Notification Center** records each arrival (`INCOMING_ORDER`) and each expiry (`INCOMING_ORDER_EXPIRED`), for history only.
5. The cashier opens the order and sees the customer, items, notes, payment, source and time left.
6. **Accept:** confirm, send to the KDS, print kitchen tickets, tell the aggregator. The prep time defaults from settings.
7. **Reject:** a Snappfood decline reason is required. Tell the aggregator; nothing goes to the kitchen.

Where each refinement from the original review stands:

| Refinement | Status |
|---|---|
| Approval is a per-channel policy | **Built** (slice 4). Agreed defaults: Snappfood and website wait for staff, kiosk is accepted automatically. |
| A timeout is required | **Built** (slice 4). Agreed: 5 minutes, then reject and alert managers. Configurable per branch. |
| Accepting is a role permission, not the PIN workflow | **Not built.** Anyone who can open the queue can accept. The permission name is still open. |
| Accept asks for a prep time | **Built.** Defaults from settings (20 min), +5 / +10, maximum 70 (Snappfood's cap). |
| Reject reasons come from Snappfood's list | **Built** with the simulator's three reasons. "Out of stock, suspend the item on Snappfood" is **not built**. |
| Rejected is its own terminal state | **Built.** `REJECTED`, separate from `CANCELLED`. |
| Only one person can accept | **Built.** Accept and reject lock the row; the second till gets 409. |
| Accept works locally first | **Built.** The aggregator notice is best effort: a failure is swallowed and there is **no outbox retry yet**. Pulling tickets back when the customer already cancelled is **not built**. |

## What each slice did

**Slice 1 (`dd8b8de`).** New `PENDING_ACCEPTANCE` state. Snappfood webhook orders land with `channel: 'AGGREGATOR'` and both `state` and `status` pending, filed under the addressed branch (per-branch webhook `POST /simulated-webhooks/snappfood/:branchCode`) or the oldest active restaurant. Ack and pick no longer move the order.

**Slice 2 (`caee4c3`).** `POST /api/v1/orders/:id/accept { prepMinutes }` and `POST /api/v1/orders/:id/reject { reasonId, comment? }`, plus `GET /api/v1/orders/decline-reasons`. Accept goes through `transitionState` (action `ACCEPT`), fires kitchen tickets, enqueues one `KITCHEN_TICKET` print, then calls `SimulationService.notifyAccepted`. Reject moves to `REJECTED` and calls `notifyRejected`. The simulator's own accept/reject buttons now call the same notify methods and then move the order.

**Slice 3 (`6e164f2`).** Incoming Orders page, header badge, sidebar count, toast and chime, all fed by one `IncomingOrdersProvider` that polls every 5 s. The simulator gained a branch picker. The webhook now keeps the customer, phone, address, delivery type, payment type and note in `notes`, turns Snappfood `products` into numbered order lines, and writes the Notification Center entry.

**Slice 4 (`8fae888`).** Policy stored as `incomingOrders` inside the branch-overridable `ORDER_WORKFLOW` setting, edited on Settings > Order Workflow (it replaced an `autoAcceptOrders` switch that nothing read). `IncomingOrderPolicyService` accepts on arrival when a channel is `AUTO`, and every 15 s answers orders past their limit through `OrderService.rejectUnanswered` (a SYSTEM rejection) or accept. Kiosk orders land pending when a branch sets kiosk to manual. `GET /api/v1/orders/incoming-policy` feeds the queue's countdown and default prep time.

**Follow-up.** Orders awaiting acceptance no longer count as revenue: `PENDING_ACCEPTANCE` joined `NON_REVENUE_ORDER_STATES`, which the sales reports and the business-day close share.

## State model gotchas

- **`state` and `status` both exist.** `status` is the legacy twin of `state`. The KDS sweep (`kds.service.ts`, `getKdsTickets`) still reads **`status`**, and its list is `SUBMITTED | CONFIRMED | KITCHEN_PREPARING`. Never add `PENDING_ACCEPTANCE` to that list. Accept fires tickets explicitly; `generateTicketsForOrder` is idempotent per station and item, so the sweep picking the order up as well does no harm.
- **A pending order only moves through accept, reject or the time limit.** The generic `/confirm` and `/cancel` refuse it with 409 `ORDER_AWAITING_ACCEPTANCE`. The one exception is Snappfood cancelling on the customer's side (simulator status 54), which still sets `CANCELLED` directly in `SimulationService`.
- **`REJECTED` is terminal** (no transitions out) and is not revenue. `NON_REVENUE_ORDER_STATES` is `CANCELLED, REJECTED, DRAFT, PENDING_ACCEPTANCE`, and the revenue filter excludes an order only when both `state` and `status` are in it.
- **Order and simulation modules import each other through `forwardRef`.** Orders notify Snappfood; the webhook applies the acceptance policy. `OrderService` injects `SimulationService`, `SimulationService` injects `IncomingOrderPolicyService`, and `IncomingOrderPolicyService` injects `OrderService`, all with `@Inject(forwardRef(...))`. Drop one and Nest fails at startup, which unit tests do not catch; start the backend to check.
- **The time-limit timer** starts in `onApplicationBootstrap` and is skipped when `NODE_ENV=test`. Tests call `expireOverdue(now)` directly.
- **`ts-node-dev` can keep a stale compiled file** after many quick edits and keep reporting a compile error that `tsc` no longer shows. Restart the dev server.
- **Aggregator customer details live in `notes`.** An aggregator order has no customer or address columns yet.
- **The simulator is head office only** (`SimulationController` is `@HeadOfficeOnly()`), while the queue only shows inside a restaurant branch. To see a toast arrive, watch the queue in a second browser signed in as a branch manager while head office sends orders.

## Code map

| Concern | Where |
|---|---|
| Snappfood webhook, notify methods, decline reasons (simulated) | `backend/src/modules/simulation/simulation.service.ts` |
| Per-branch webhook route | `backend/src/modules/simulation/simulated-webhooks.controller.ts` |
| Simulator UI (branch picker, generate order, lifecycle buttons) | `starter-vite-ts/src/pages/simulation/simulation-snappfood.tsx` |
| Order states, transitions, accept/reject/rejectUnanswered | `backend/src/entities/OrderHeader.entity.ts`, `backend/src/modules/order/order.service.ts` |
| Order routes, including accept, reject, decline-reasons, incoming-policy | `backend/src/modules/order/order.controller.ts` |
| Policy defaults and parsing | `backend/src/common/utils/incoming-order-policy.util.ts` |
| Accept on arrival, time-limit sweep | `backend/src/modules/order/incoming-order-policy.service.ts` |
| Kiosk orders and their policy | `backend/src/modules/kiosk/kiosk.service.ts` |
| Revenue exclusion shared by reports and day close | `backend/src/common/utils/business-date.util.ts` |
| Queue page and drawer | `starter-vite-ts/src/pages/orders/incoming.tsx` |
| Polling, toast, chime, policy for the UI | `starter-vite-ts/src/contexts/incoming-orders-context.tsx` |
| Header badge | `starter-vite-ts/src/layouts/components/incoming-orders-button.tsx` |
| Policy settings | `starter-vite-ts/src/pages/settings/order-workflow.tsx` |
| Who can reach the page | `starter-vite-ts/src/config/role-access.ts` (cashier via `/app/orders`; hidden at head office) |

Snappfood status codes used by the simulator: 56 new, 61 acked, 713 picked, 42 accepted, 51 rejected by store, 54 cancelled, 71 extra payment required.

## Still open

- A role permission for accepting and rejecting (name not decided).
- Rejecting for "out of stock" should offer to suspend the item on Snappfood.
- Retrying a failed aggregator notice through the outbox (`backend/src/modules/outbox/`).
- Pulling kitchen tickets back when the aggregator says the customer already cancelled.
- There is no website order intake yet; the `ONLINE` policy is stored but nothing uses it.
- Product mapping from Snappfood `vmsFoodId`: lines keep the dish names but carry a placeholder `product_id`.
- `expeditionType` (DELIVERY / PICKUP ...) is recorded in `notes` but not mapped to `order_type`.
- The webhook doesn't write an `OrderStateEvent` for the order's creation, so the Orders timeline starts at the answer.
- Slices 3 and 4 were typechecked and linted but not clicked through by Claude; the user tests the screens.
