# Order Management & Dispatch audit, 2026-09-23

**Scope:** order to door. That covers the order lifecycle (create, send, edit, cancel, reopen, type
change, search, refund lookup, export), incoming-order acceptance, the kitchen hand-off, delivery
dispatch (board, assign, reassign, depart, complete, fail, requeue) and COD settlement. Dine-in
tables, printing and Moadian were audited separately and are left out here.

**Yardstick:** could an Iran Burger branch get through a full day of takeaway, own-fleet delivery
and Snappfood orders without a workaround?

**Method:**
- **Pass A** read the code: `order.service.ts`, `order-list.ts`, `order-edit-policy.ts`,
  `delivery.service.ts`, `kds.service.ts` and `business-day.service.ts`, plus the `workflow.tsx`,
  `delivery.tsx` and `refunds.tsx` pages.
- **Pass B** drove the local API as `manager.downtown`, `cashier.downtown` and HQ, and checked
  the database after each step.

**Output:** this report only. No code was changed.

**Two passes on the same day:**

| Pass | main at | What changed since the pass before |
|---|---|---|
| First | `aead9ff` | — |
| **Second (this version)** | `415aadb` | The server-side Orders Directory (`7399183`, `86571d5`; PR #93) replaced the Kanban. It fixed OD1 and most of OD9, and added OD11 and OD12. The delivery, KDS and Snappfood code is unchanged, and walks W1–W8 were re-run with the same results. |

All order numbers are from the local database.

## Status at a glance

| ID | Finding | Severity | Status on `415aadb` |
|---|---|---|---|
| OD1 | Orders page and Refunds loaded only the newest 50 orders | Blocker | **Fixed** by the Orders Directory |
| OD2 | Snappfood orders the store delivers itself have no dispatch; cash ones are stuck | Blocker (if it applies) | Open |
| OD3 | An order changed to Delivery after sending never reaches the board | High | Open |
| OD4 | Failed works on finished deliveries, reopening paid orders and wiping COD debt | High | Open |
| OD5 | Requeue has no state check | Medium | Open |
| OD6 | Reassign leaves the old attempt open and is allowed after departure | Medium | Open |
| OD7 | The delivery board reads every delivery ever, with N+1 queries, on every refresh | Medium → Blocker | Open |
| OD8 | Dispatch cards show no customer, address, phone or age | Medium | Open (the Orders list now has these fields; the delivery board doesn't) |
| OD9 | Order search can't find an order by the customer | Low | **Mostly fixed**. A `09…` phone number misses customers saved as `+98…` |
| OD10 | A courier can leave before the kitchen is done | Info | Unchanged, by design |
| **OD11** | **The Orders page opens on "today", hiding open orders from earlier days** | **High** | **New** |
| **OD12** | **Any cashier can export the branch's whole order book, with customer mobiles** | Low | **New** |

## Verdict

The order lifecycle and the new Orders Directory are in good shape. Dispatch is still not ready
for a pilot. Five problems would stop a branch or lose money:

1. **Snappfood orders the store delivers itself can't be dispatched** (OD2). Cash ones can't be
   paid, completed or cancelled, so they get carried over at every day close.
2. **An order changed to Delivery after it is sent never reaches the delivery board** (OD3).
3. **"Failed" works on a delivery that was already delivered** (OD4). It reopens a completed,
   paid order and wipes a COD courier's cash debt.
4. **The delivery board reads every delivery the chain has ever had, on every refresh** (OD7).
5. **The Orders page opens on "today"** (OD11). 14 of the branch's 23 open orders were hidden:
   carried-over and COD orders, and anything placed before midnight on a late shift.

## What works (verified)

| Area | Evidence |
|---|---|
| The Orders Directory covers the whole book | `group=OPEN` returns all 23 open orders (the database has 23). Tab counts add up to All (211). Pages don't overlap. List, counts and search together take 105 ms |
| Search | By name, product, call number, `+98…`/`9…` mobile, and Persian digits (normalised) |
| Refunds lookup | Server-side search over paid orders (`paid=1`) instead of the newest 50 |
| List rows | Each row carries the customer's name and mobile, zone, delivery state, courier and address |
| Branch scoping of list and export | A cashier asking for another branch gets only their own |
| COD delivery | The order stays open after delivery until the courier settles. Settlement expects the cash less the courier's pay (W1: preview cash 8,239,000, pay 400,000, net 7,839,000) |
| Prepaid delivery | Completes on delivery (W3, up to the Fail step) |
| The state matrix refuses skipped steps | W6: `/orders/:id/dispatch` and `/mark-ready` from `CONFIRMED` both return 400 |
| Edit, cancel and reopen authority | `order-edit-policy.ts`: cashier window, approval after prep starts or once money is taken, a paid cancel refunds, the kitchen is told to stop, and reopen is limited to the same day with nothing paid |
| Type change away from Delivery while a courier has the order | Refused with `DELIVERY_IN_PROGRESS` (`order.service.ts:1668`) |
| Branch scoping on the board | A cashier sees only their own branch. A courier from another branch is refused (`COURIER_OTHER_BRANCH`) |
| Kitchen roll-up | Bumping every ticket moves the order to `READY` with a history row (`kds.service.ts:536`) |

## Findings

Severity is measured against the pilot yardstick. **Blocker** means a branch can't finish the
day's work, or money goes missing.

### OD1 · Fixed: the Orders page and the Refunds picker saw only the newest 50 orders
- **First pass:** `GET /orders` defaulted to `limit=50`, and both pages filtered in the browser.
  11 of 22 open orders were missing.
- **Second pass:** paging, tab counts and search now all run on the server (`order-list.ts`).
  Refunds searches `paid=1`, and the Open tab over all dates returned 23 of 23.
- The date range the page opens on is a separate problem; see OD11.

### OD11 · High (new): the Orders page opens on "today" and hides open orders from earlier days
- `workflow.tsx:235` defaults the range to `today`. `rangeBounds` turns that into a `placed_at`
  window from Tehran midnight to midnight, and the Open, Waiting and Held tabs obey it like every
  other tab.
- **Evidence:** the Open tab showed 9 orders. **14 of 23 open orders were hidden**, including:
  - a Snappfood order from yesterday (`SNP-SF-7545`)
  - a dine-in check from yesterday (`ORD-20260922-0007`)
  - two pickups from 16 September
- **Carried-over orders are exactly the ones that disappear:**
  - COD deliveries waiting for the courier to settle
  - orders carried past day close
  - anything placed before midnight on a late shift, which drops off at 00:00 while the business
    day is still running
- **Fix:** the Open, Waiting and Held tabs ignore the date range, since an open order is current
  whenever it was placed. The finished tabs keep "today". Low cost and low risk.

### OD2 · Blocker, if the pilot delivers Snappfood orders itself: those orders have no dispatch
- **Re-confirmed on `415aadb`** with `SNP-SF-3556` (own delivery, cash, 28,704,000 outstanding):
  it was accepted and moved to `CONFIRMED` with no delivery record.
- The accept flow never creates a `Delivery`, because one is only made in `submitOrder` for
  `order_type = 'DELIVERY'`. Snappfood orders are `AGGREGATOR`, and `createDeliveryForOrder`
  refuses them with `DELIVERY_ORDER_TYPE_REQUIRED` (`delivery.service.ts:681`).
- As a result:
  - no courier can be assigned
  - the courier's trip pay is never priced
  - the ride never reaches courier settlement
- **Cash-on-delivery Snappfood orders are also stuck.** The order keeps its balance, but:
  - the page hides Pay for Snappfood orders
  - Complete needs a zero balance
  - Cancel is refused for Snappfood orders
  - Day close reports the order as `UNPAID` every day, and it can only be carried over.
- **Fix:** when a Snappfood order with expedition `DELIVERY` is accepted, create a `Delivery`
  from the payload address. The zone is optional and pay falls back to the branch pay rule. COD
  then settles through the existing courier-settlement path (F10).
- **Needs your answer first:** does Iran Burger use its own couriers for Snappfood, and does it
  take Snappfood cash orders?

### OD3 · High: an order changed to Delivery after it has been sent never reaches the board
- `changeOrderType` (`order.service.ts:1688`) checks the address and zone but creates no
  `Delivery`, and no page calls `POST /delivery/orders/:id`.
- **Re-confirmed** with `ORD-…-0014`: no delivery record and not on the board. The page hides
  Complete for delivery orders, so the only way out is to cancel and ring it up again.
- The same gap affects Delivery → Takeaway → Delivery. The first delivery is marked
  `CANCELLED`, and `createDeliveryForOrder` returns that cancelled record instead of a new one.
- **Fix:** create the delivery inside the type change, or bring a cancelled one back to
  `UNASSIGNED`.

### OD4 · High: Failed has no state check and undoes finished deliveries
- `failDelivery` (`delivery.service.ts:944`) accepts any state. It sets the order to `READY` with
  a plain save, so no history row, outbox event or audit entry is written.
- **Re-confirmed** with `ORD-…-0012`: it was paid, delivered and `COMPLETED`. After Failed it is
  `READY` with `completed_at` still set, the courier's pay is zeroed, and a requeue puts it back
  on the board.
- **On a delivered COD order**, the same step sets the courier's expected cash to 0. The courier
  keeps the customer's money.
- **How it happens:** a second screen, or one that hasn't refreshed yet, can still show the Fail
  button on a delivery that was just completed.
- **Fix:** allow Fail only from `ASSIGNED`, `PICKED_UP` or `EN_ROUTE`, and move the order back
  through the transition recorder.

### OD5 · Medium: Requeue has no state check
- **Re-confirmed** with `ORD-…-0013`: requeuing while `EN_ROUTE` cleared the courier. The order
  stayed `OUT_FOR_DELIVERY`, and Mahdi's attempt was left at `OUT_FOR_DELIVERY` for good.
- The UI offers Requeue only on failed deliveries, so today this is reachable only through the
  API.
- **Fix:** allow Requeue only from `FAILED`.

### OD6 · Medium: Reassign leaves the previous courier's attempt open, and is allowed after departure
- **Re-confirmed:**
  - `ORD-…-0010`: Sara's attempt is left `ASSIGNED` after Ali delivered.
  - `ORD-…-0011`: reassigning while en route set the delivery back to `ASSIGNED` while the order
    was `OUT_FOR_DELIVERY`, and Sara's attempt was left at `OUT_FOR_DELIVERY`.
- Money isn't affected, because settlement only reads delivered, failed and returned attempts.
  But courier history shows jobs that were never finished.
- **Fix:** close the previous attempt as `REASSIGNED`, and refuse to reassign once the delivery
  has left.

### OD7 · Medium now, Blocker within weeks: the delivery board query doesn't scale
- `getDeliveries` (`delivery.service.ts:998`) loads every delivery the tenant has ever had. For
  each one it:
  - runs 3 more queries
  - saves a correction when the delivery and order disagree, even though this is a GET
- The board reloads on every delivery SSE event, and its History column renders every finished
  delivery ever.
- **At pilot volume** (4 branches × about 150 deliveries a day), a month of data means about
  50,000 queries per refresh, on every open board.
- **The Orders Directory already does this properly:** `withListContext` fetches a page with one
  batched lookup per table, which is the pattern to copy.
- **Fix:** return only active deliveries plus today's finished ones, read them in one joined
  query, and move the correction out of the read path.

### OD8 · Medium: dispatch cards lack what a dispatcher needs
- The board's `customer_name` is read from a field that `OrderHeader` doesn't have, so every card
  shows "Customer" (`delivery.service.ts:1019`).
- The cards show no address, customer phone, call number, or how long the order has waited
  against the zone's `estimated_minutes`.
- The Orders list now builds the customer name, mobile and address for every row
  (`withListContext`). The board can reuse that.

### OD9 · Low, mostly fixed: a `09…` phone number doesn't find `+98…` customers
- Search now matches the customer's name, mobile and phone, the product, the table and the call
  number, and it normalises Persian digits (`order-list.ts:116`).
- **The gap:** mobiles are stored in mixed formats (5 `+98…`, 3 `09…` in the local data), and
  Snappfood saves `+98…`. For customer `+989351112233`:

  | Search text | Orders found |
  |---|---|
  | `+989351112233` | 2 |
  | `9351112233` | 2 |
  | `09351112233` | **0** |
  | `۰۹۳۵۱۱۱۲۲۳۳` | **0** |

  `09…` is how staff type a number.
- **Fix:** run the search text through `normalizePhone` (in `customer.service.ts`) and match
  both forms.

### OD10 · Info: couriers can leave before the kitchen is done
- Depart moves a `CONFIRMED` order straight to `OUT_FOR_DELIVERY`, bypassing the state matrix.
- Branches that print tickets and have no KDS need this.
- **Recommendation:** leave it as is. At most, show a warning at KDS branches.

### OD12 · Low (new): any cashier can export the branch's order book, with customer mobiles
- `GET /orders/export` (`order.controller.ts:58`) has no role check, and the Export button
  (`workflow.tsx:1140`) is shown to every role.
- A cashier downloaded all 211 of the branch's orders as CSV, including customer names and
  mobiles. The limit is 5,000 rows.
- The service comment says the export is "for head office".
- **Fix:** restrict the route and the button to manager and above. **Your call** whether
  cashiers should have it.

## Ranked plan

| # | Item | Token cost | Risk | Impact | Notes |
|---|---|---|---|---|---|
| 1 | OD11: Open, Waiting and Held ignore the date range | Low | Low | **Major** | A few lines in `workflow.tsx`, or in `applyOrderFilters` for those groups |
| 2 | OD4 + OD5 + OD6: state checks on Fail, Requeue and Reassign; Fail uses the recorder; the old attempt is closed | Low | Low | **Major** (money) | One PR in `delivery.service.ts`, plus specs |
| 3 | OD3: the type change creates or revives the delivery | Low | Low | **Major** | Reuse the `createDeliveryForOrder` checks |
| 4 | OD7 + OD8: the board reads active and today's deliveries in one query, with customer, phone, address, call number and age | Medium | Low–Med | Medium → Major | Copy `withListContext`. Move reconcile-on-read into `cancelOrder` first (see the trap below) |
| 5 | OD2: Snappfood own-delivery gets a `Delivery` on accept, with COD through courier settlement | Medium | **Medium** | **Major**, if it applies | Needs your answer. Pay rule without a zone; the address is text only |
| — | **Recommended cut line** | | | | Items 1–4 always. Item 5 if the pilot delivers Snappfood orders itself |
| 6 | OD9: `09…` phone search via `normalizePhone` | Low | Low | Minor | Could ride along with item 1 |
| 7 | OD12: export limited to manager and above | Low | Low | Minor | Your call |
| 8 | OD10: "kitchen not done" warning at KDS branches | Low | Medium | Minor | I recommend against |

**Trap in item 4:** the board's reconcile-on-read is currently the only thing that marks a
delivery `CANCELLED` when its order is cancelled. Neither `cancelOrder` nor the refund module
touches `delivery`. Removing it without moving that step would leave cancelled orders on the board.

## Walk log (local, 2026-09-23)

| Walk | Steps | First pass | Second pass (`415aadb`) |
|---|---|---|---|
| W1 | COD: submit → assign → depart → complete | Works as designed (`-0001`) | Same (`-0009`) |
| W2 | Assign Sara → reassign Ali → complete | Sara left `ASSIGNED` (OD6) | Same (`-0010`) |
| W2b | Depart → reassign | Delivery back to `ASSIGNED`, Sara's attempt orphaned (OD6) | Same (`-0011`) |
| W3 | Prepaid → deliver → Fail → Requeue | Completed order reopened to `READY` (OD4) | Same (`-0012`) |
| W4 | Depart → Requeue | Courier cleared while the order is out (OD5) | Same (`-0013`) |
| W5 | Takeaway → Delivery after send | No delivery record (OD3) | Same (`-0014`) |
| W6 | `/dispatch`, `/mark-ready` from `CONFIRMED` | Refused (correct) | Same |
| W7 | Depart while `CONFIRMED` | Allowed (OD10) | Same |
| W8 | Snappfood own delivery, cash, accept | No delivery (OD2) | Same (`SNP-SF-3556`) |
| W9 | Order list: Open tab, default range | 50 of 211 orders, 11 of 22 open missing (OD1) | 23 of 23 over all dates, but the default "today" shows only 9 (OD11) |
| W10 | Search by phone, name, product, call number | Phone found 0 (OD9) | All found, except `09…` against `+98…` (OD9) |
| W11 | Refunds lookup, export, scoping | — | Server-side `paid=1` search works. A cashier can export all 211 rows (OD12). No cross-branch leak |

## Not covered

- The dine-in table flows (HAMI audit F11), the KDS screen UI, printing (PRs #84–#86) and Moadian.
- Pass B drove the API, not the browser. The UI claims come from reading the page code
  (`workflow.tsx`, `delivery.tsx`, `refunds.tsx`).
- The layout of the Orders Directory was reviewed separately in
  `audit/orders-directory-ia-2026-09-23/`.
- Incoming-order acceptance was not walked again. It was built and tested in the 2026-09-11
  slices.
