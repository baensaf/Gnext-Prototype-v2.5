# Order Management & Dispatch audit, 2026-09-23

**Scope:** order to door. That covers the order lifecycle (create, send, edit, cancel, reopen, type
change, search), incoming-order acceptance, the kitchen hand-off, delivery dispatch (board, assign,
reassign, depart, complete, fail, requeue) and COD settlement. Dine-in tables, printing and Moadian
were audited separately and are left out here.

**Yardstick:** could an Iran Burger branch get through a full day of takeaway, own-fleet delivery
and Snappfood orders without a workaround?

**Method:** Pass A read the code: `order.service.ts`, `order-edit-policy.ts`,
`delivery.service.ts`, `kds.service.ts`, `business-day.service.ts`, and the `workflow.tsx`,
`delivery.tsx` and `refunds.tsx` pages. Pass B drove the local API (main at `aead9ff`) as
`manager.downtown`, `cashier.downtown` and HQ, and checked the database after each step.
Walks W1–W8 are listed below. All order numbers are from the local database.

**Output:** this report only. No code was changed.

## Verdict

The order lifecycle is in good shape. The dispatch side is not ready for a pilot. Five problems
would stop a branch or lose money:

1. **The Orders page shows only the newest 50 orders** (OD1). In the local data, 11 of the
   branch's 22 open orders were missing. The Refunds picker has the same limit.
2. **Snappfood orders the store delivers itself can't be dispatched** (OD2). If the customer pays
   cash on delivery, the order also can't be paid, completed or cancelled, so it gets carried over
   at every day close.
3. **Changing an order to Delivery after it has been sent** means it never reaches the delivery
   board (OD3). It stays stuck until someone cancels it.
4. **"Failed" works on any delivery, including one already delivered** (OD4). It reopens a
   completed, paid order and wipes a COD courier's cash debt.
5. **The delivery board reads every delivery the chain has ever had, on every refresh** (OD7).
   It is fast today (13 rows, 53 ms) but will slow down within weeks at pilot volume.

## What works (verified)

| Area | Evidence |
|---|---|
| COD delivery: order stays open after delivery until the courier settles, and settlement expects the cash less the courier's pay | W1: `ORD-…-0001` stays `OUT_FOR_DELIVERY` / `DELIVERED`, outstanding 8,239,000. Sara's preview: cash 8,239,000, pay 400,000, net 7,839,000 |
| Prepaid delivery completes on delivery | W3: `ORD-…-0004` goes to `COMPLETED` on the courier's complete |
| The state matrix refuses skipped steps | W6: `/orders/:id/dispatch` and `/mark-ready` from `CONFIRMED` both return 400 |
| Edit, cancel and reopen authority | `order-edit-policy.ts`: cashier window, approval after prep starts or once money is taken, a paid cancel refunds through the refund module, the kitchen is told to stop, and reopen is limited to the same day with nothing paid |
| Type change away from Delivery while a courier has the order | Refused with `DELIVERY_IN_PROGRESS` (`order.service.ts:1459`) |
| Branch scoping on the board | A cashier sees only their own branch (the `BranchScopeInterceptor` fills `branchId`). A courier from another branch is refused (`COURIER_OTHER_BRANCH`) |
| Kitchen roll-up | Bumping every ticket on the KDS moves the order to `READY` with a history row (`kds.service.ts:536`) |
| Snappfood waiting-order rules | Accept or reject only, cancel refused, and the promise capped per expedition (from the incoming-orders slices; not re-walked) |

## Findings

Severity is measured against the pilot yardstick. **Blocker** means a branch can't finish the
day's work, or money goes missing.

### OD1 · Blocker: the Orders page and the Refunds picker see only the newest 50 orders
- `workflow.tsx:350` and `refunds.tsx:70` call `GET /orders` with no state or limit.
  `order.service.ts:182` defaults to `limit=50`, newest first.
- **W-evidence:** the API returned 50 of the branch's 211 orders, and **11 of 22 open orders**
  were missing. At a branch doing more than 50 orders a day, lunch orders disappear from the
  Open and Waiting tabs by dinner, and a customer returning with a morning order can't be
  refunded from the Refunds screen.
- **Fix:** have the board ask for open states (plus today's finished orders) with no 50 cap.
  Give Refunds a search by order number or phone instead of a preloaded list.

### OD2 · Blocker, if the pilot delivers Snappfood orders itself: those orders have no dispatch
- The accept flow never creates a `Delivery`, because it is only made in `submitOrder` for
  `order_type = 'DELIVERY'`. Snappfood orders are `AGGREGATOR`, so `createDeliveryForOrder`
  refuses them with `DELIVERY_ORDER_TYPE_REQUIRED` (`delivery.service.ts:681`).
- **W8:** `SNP-SF-8710` (expedition `DELIVERY`, payment `CASH`) was accepted and moved to
  `CONFIRMED` with no delivery record. It is not on the board, and both the create and legacy
  assign routes return 400.
- As a result:
  - no courier can be assigned
  - the courier's trip pay is never priced
  - the ride never reaches courier settlement
  - the address exists only as text in `notes`
- **Cash-on-delivery Snappfood orders are also stuck.** The order keeps an outstanding balance
  (13,662,000 here), but:
  - the till hides Pay for Snappfood orders (`workflow.tsx:277`)
  - Complete needs a zero balance
  - Cancel is refused for Snappfood orders
  - Day close reports the order as `UNPAID` every day, and it can only be carried over.
- **Fix:** when a Snappfood order with expedition `DELIVERY` is accepted, create a `Delivery`
  from the payload address. The zone is optional and pay falls back to the branch pay rule. COD
  then settles through the existing courier-settlement path (F10).
  **Needs your answer first:** does Iran Burger use its own couriers for Snappfood, and does it
  take Snappfood cash orders?

### OD3 · High: an order changed to Delivery after it has been sent never reaches the board
- `changeOrderType` (`order.service.ts:1482`) checks the address and zone but creates no
  `Delivery`. No page calls `POST /delivery/orders/:id`.
- **W5:** `ORD-…-0006` went from takeaway to delivery while `CONFIRMED`. There was no delivery
  record and it was not on the board. The Orders page hides Complete for delivery orders, so
  the only way out is to cancel and ring it up again.
- The same gap affects Delivery → Takeaway → Delivery. The first delivery is marked
  `CANCELLED`, and `createDeliveryForOrder` returns that cancelled record instead of a new one.
- **Fix:** create the delivery inside the type change, or bring a cancelled one back to
  `UNASSIGNED`.

### OD4 · High: Failed has no state check and undoes finished deliveries
- `failDelivery` (`delivery.service.ts:944`) accepts any state. It sets the order to `READY` with
  a plain save, so no history row, outbox event or audit entry is written.
- **W3:** `ORD-…-0004` was paid, delivered and `COMPLETED`, then marked Failed. The order went
  back to `READY` with `completed_at` still set. Ali's pay of 400,000 was zeroed, and a requeue
  put the finished order back on the board.
- **The same step on a delivered COD order** (like W1) sets the courier's expected cash to 0.
  The courier keeps the customer's money and settlement never asks for it.
- **How it happens:** the Fail button is on the En route column. A second screen, or one that
  hasn't refreshed yet, can still show a delivery that was just completed.
- **Fix:** allow Fail only from `ASSIGNED`, `PICKED_UP` or `EN_ROUTE`, and move the order back
  through the transition recorder.

### OD5 · Medium: Requeue has no state check
- `requeueDelivery` (`delivery.service.ts:984`) accepts any state.
- **W4:** requeuing `ORD-…-0005` while it was `EN_ROUTE` cleared the courier. The order stayed
  `OUT_FOR_DELIVERY` with no courier, and Mahdi's attempt was left at `OUT_FOR_DELIVERY` for
  good.
- The UI shows Requeue only on failed deliveries, so today this is reachable only through the
  API.
- **Fix:** allow Requeue only from `FAILED`.

### OD6 · Medium: Reassign leaves the previous courier's attempt open, and is allowed after departure
- **W2:** after reassigning from Sara to Ali and completing, Sara's attempt still reads
  `ASSIGNED`.
- **W2b:** reassigning to Mahdi while Sara was `EN_ROUTE` set the delivery back to `ASSIGNED`
  while the order was `OUT_FOR_DELIVERY`. Sara's attempt was left at `OUT_FOR_DELIVERY`.
- Money isn't affected, because settlement only reads delivered, failed and returned attempts.
  But courier history shows jobs that were never finished, and the board no longer matches where
  the food actually is.
- **Fix:** close the previous attempt as `REASSIGNED` (no pay, nothing to settle), and refuse to
  reassign once the delivery has left. The user fails it first, then requeues.

### OD7 · Medium now, Blocker within weeks: the delivery board query doesn't scale
- `getDeliveries` (`delivery.service.ts:998`) loads every delivery the tenant has ever had.
  For each one it:
  - runs 3 more queries (order, courier, zone)
  - saves a correction when the delivery and order disagree, even though this is a GET
- The board page reloads on every delivery SSE event (`delivery.tsx:192`), and its History
  column renders every finished delivery ever.
- **At pilot volume** (4 branches × about 150 deliveries a day), a month of data means about
  50,000 queries per refresh, on every open board.
- **Fix:** return only active deliveries plus today's finished ones, read them with one joined
  query, and move the correction out of the read path.

### OD8 · Medium: dispatch cards lack what a dispatcher needs
- `customer_name` is read from a field that `OrderHeader` doesn't have, so every card falls back
  to "Customer" (`delivery.service.ts:1019`).
- The cards show no address, customer phone or call number. Nothing shows how long the order
  has waited against the zone's `estimated_minutes`, or against the promised time on Snappfood
  orders.
- Today the dispatcher has to rely on the printed courier slip.
- **Fix:** add the customer name and phone, the address text, the call number and minutes since
  sending (red once past the zone estimate).

### OD9 · Low: order search can't find an order by the customer
- `?q=` matches only the order number and notes (`order.service.ts:177`). Searching the phone
  number `09351112233` found nothing.
- A "where's my order?" phone call means scrolling through the list.
- **Fix:** also match the customer's mobile, name and the call number.

### OD10 · Info: couriers can leave before the kitchen is done
- **W7:** Depart moved a `CONFIRMED` order straight to `OUT_FOR_DELIVERY`, which the order state
  matrix doesn't allow. The delivery service writes the state itself.
- This is needed at branches that print tickets and have no KDS, where orders never reach
  `READY`.
- **Recommendation:** leave it as is. At most, show a "kitchen not done" warning on the card at
  KDS branches.

## Ranked plan

The items are ordered so that the ones sharing a file ship together.

| # | Item | Token cost | Risk | Impact | Notes |
|---|---|---|---|---|---|
| 1 | OD1: the Orders page asks for open orders with no 50 cap; Refunds gets a search | Low | Low | **Major** | Touches only `getOrders` params and two pages |
| 2 | OD4 + OD5 + OD6: state checks on Fail, Requeue and Reassign; Fail uses the recorder; the old attempt is closed | Low | Low | **Major** (money) | One PR in `delivery.service.ts`, plus specs |
| 3 | OD3: the type change creates or revives the delivery | Low | Low | **Major** | Reuse the `createDeliveryForOrder` checks |
| 4 | OD8: dispatch cards show the customer, phone, address, call number and age | Low | Low | Medium | Join in the board query, so it pairs with #5 |
| 5 | OD7: the board reads active and today's deliveries in one joined query, with no writes | Medium | Low–Med | Medium → Major | The reconcile-on-read path has to move to where orders cancel or complete |
| 6 | OD2: Snappfood own-delivery gets a `Delivery` on accept, with COD through courier settlement | Medium | **Medium** | **Major**, if it applies | Needs your answer. Pay rule without a zone; the address is text only |
| — | **Recommended cut line** | | | | Items 1–5 always. Item 6 if the pilot delivers Snappfood orders itself |
| 7 | OD9: search by phone, name and call number | Low | Low | Minor | |
| 8 | OD10: "kitchen not done" warning at KDS branches | Low | Medium | Minor | Blocking it would break print-only branches. I recommend against |

Most of the cost is in items 5 and 6. Watch for one trap in item 5: the board's reconcile-on-read
is currently what marks a delivery `CANCELLED` when its order is cancelled. Removing it without
moving that step to `cancelOrder` would leave cancelled orders on the board.

## Walk log (local, 2026-09-23)

| Walk | Steps | Result |
|---|---|---|
| W1 | COD delivery: submit → assign Sara → depart → complete | Worked as designed. Order open until settlement |
| W2 | Assign Sara → reassign Ali → depart → complete | Sara's attempt left `ASSIGNED` (OD6) |
| W2b | Assign Sara → depart → assign Mahdi | Delivery back to `ASSIGNED`, Sara's attempt left `OUT_FOR_DELIVERY` (OD6) |
| W3 | Prepaid → deliver → Fail → Requeue | Completed order reopened to `READY`, pay zeroed, back on the board (OD4) |
| W4 | Depart → Requeue | Courier cleared while the order is out, attempt orphaned (OD5) |
| W5 | Takeaway → Delivery after send | No delivery record, not on the board (OD3) |
| W6 | `/dispatch`, `/mark-ready` from `CONFIRMED` | Refused (correct) |
| W7 | Depart while `CONFIRMED` | Allowed, bypasses the matrix (OD10) |
| W8 | Snappfood own delivery, cash, accept | No delivery, can't create one, balance can't be collected (OD2) |
| — | `GET /orders`, board payload, search by phone | 50 of 211 orders, 11 of 22 open missing (OD1); `customer_name` = "Customer" (OD8); phone search finds 0 (OD9) |

## Not covered

- The dine-in table flows (HAMI audit F11), the KDS screen UI, printing (PRs #84–#86) and Moadian.
- Pass B drove the API, not the browser. The UI claims above come from reading the page code
  (`workflow.tsx`, `delivery.tsx`, `refunds.tsx`).
- Incoming-order acceptance was not walked again. It was built and tested in the 2026-09-11
  slices.
