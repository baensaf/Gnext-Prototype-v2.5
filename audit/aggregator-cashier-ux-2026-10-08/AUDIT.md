# Aggregator orders at the till: audit and standard workflow

Written 2026-10-08. Scope: how a cashier handles Snappfood orders today, what goes wrong, and
one workflow every aggregator follows (Snappfood now, Talabat in V6, others later).

Decisions taken before the audit (user, 2026-10-08):

1. Online orders live in a panel **inside the POS screen**; new orders pop up over it.
2. The panel covers the **whole life** of an order: new, preparing, ready, handed over, issues.
3. Accepting is **manual, one tap**, with the branch's prep time preset; auto-accept stays a
   per-branch setting, off by default.
4. Gnext **replaces the Snappfood vendor panel**, so the panel covers everything that panel does.
5. Build all slices after the audit.

## 1. How it works today

Walked on the local app as a Niyayesh cashier with three simulated orders (own delivery, Snapp
Express rider, cash pickup), plus a read of the code.

| Step | Where | What the cashier does |
| --- | --- | --- |
| Order arrives | anywhere | toast with "View", chime every 10 s, red count on a header icon |
| Answer it | **Incoming Orders** page (`/app/orders/incoming`) | opens a drawer, accepts with a prep time or picks a Snappfood reason and rejects |
| Cook it | printed kitchen ticket (KDS is F at Iran Burger) | nothing on screen |
| Ready / hand over | **Orders** page grid | "Complete" for a rider order; own delivery goes through the Dispatch board |
| Problem after accepting | **Orders** page row menu | "Report to Snappfood" (reject 153 + minutes), within 60 min |
| Platform cancels | nowhere | order silently becomes Cancelled |

So one Snappfood order touches three screens (POS, Incoming Orders, Orders), and the cashier
leaves the till for each.

## 2. Findings

Severity: **H** loses or delays orders, **M** slows the cashier or misleads, **L** polish.

| # | Sev | Finding |
| --- | --- | --- |
| A1 | H | Answering an order means leaving the POS. The header badge navigates away from the cart; at ~170 Snappfood orders a day at the busiest branch that is 170 round trips. |
| A2 | H | Orders arrive, chime and count down while no shift is open, but Accept fails with a raw English error ("No shift is open at this branch…"). The cashier only learns it by trying, and the 5-minute limit keeps running. |
| A3 | H | Nothing tells the cashier when Snappfood **cancels an accepted order** (status 54). It turns Cancelled in the grid; the kitchen keeps cooking from the printed ticket. Kitchen tickets are not pulled either. |
| A4 | H | A **cash pickup** Snappfood order can never be closed: the till refuses payment on Snappfood orders, and Complete needs nothing owing. Its only action is "Report to Snappfood". |
| A5 | M | After accepting, the order's main button on the Orders grid is **"Report to Snappfood"** (orange) for own-delivery and pickup orders. The most prominent action is the rarest one. |
| A6 | M | No **Ready** step. With printed tickets (no KDS) nothing moves an online order to Ready, so the cashier cannot see which bags are waiting for a rider. |
| A7 | M | The order drawer dumps Snappfood's raw notes in English: `Customer:`, `Delivery: ZF_EXPRESS`, `Payment: ONLINE`. Who carries the food and whether money is owed should be plain chips. |
| A8 | M | The queue list shows no fulfilment (rider / our courier / pickup) and no payment; the cashier must open each order to know. |
| A9 | M | The rider's status (assigned, at the restaurant, picked up) that Snappfood can send (`bikerName`, `bikerStatusV2`) is dropped. The cashier cannot tell a rider is waiting. |
| A10 | M | The store cannot **pause** Snappfood when the kitchen is swamped. Today that needs the vendor panel. |
| A11 | M | Reject reasons are Snappfood's ids in the UI. Talabat has its own list, so each platform would need its own screen. |
| A12 | M | Snappfood's ack (on receipt) and pick (on open) calls are never made; the annex says the store must make both. |
| A13 | L | Toasts stack in the corner and cover the drawer's header on a narrow window. |
| A14 | L | Late orders (past the promised time) are not flagged anywhere. |
| A15 | L | A system rejection after the time limit only reaches the Notification Center; the cashier never sees that an order was lost. |

Code-level root cause for A11 and the Talabat goal: platform checks are spread through the order
service (`snappfoodOrderCode`, `refuseSnappfoodChange`, `SimulationService.notify*`), as the
aggregator plan (`docs/aggregator-integration-plan.md` on `docs/aggregator-plan`, section 1)
already warned.

## 3. The standard workflow (every platform)

The cashier only ever sees platform-neutral states and actions. Each platform's adapter maps
them to its own calls and declares what it supports, so the panel hides what a platform can't do.

### 3.1 Lanes

| Lane | Orders in it | Main button | Other actions |
| --- | --- | --- | --- |
| **New** | waiting for an answer | **Accept · 20 min** (one tap) | −5 / +5 on the time, **Reject** with a reason |
| **Preparing** | accepted, kitchen has it | **Ready** | Needs more time / Problem (if the platform supports it), reprint, details |
| **Ready** | bagged, waiting for whoever takes it | rider: **Handed to rider**; pickup: **Collected** (takes the money first if owed); own delivery: **Send out** (Dispatch) | details |
| **Issues** (on top, red) | cancelled by the platform after accepting, with platform support, lost to the time limit | **Got it** | details |

Done orders leave the panel; a footer shows today's count and links to the Orders page.

Every card shows: platform mark, the code staff read out, **who carries it** (platform rider /
our courier / customer pickup), **money** (paid online / collect X), items, customer first
name, and one timer: time left to answer (New) or time to the promise (Preparing, Ready; red
once late). A rider's name and "at the restaurant" show when the platform sends them.

### 3.2 Arrival

- On the POS: a card pops over the menu with the order and **Accept · 20 min** / **Open**; the
  chime repeats until it is answered. The panel tab shows the count.
- Elsewhere: the toast and header badge stay; the badge opens the POS panel.
- No shift open: the New lane says so with an **Open shift** button, and Accept is disabled.

### 3.3 Platform-neutral contract

Internal states: `NEW → ACCEPTED/REJECTED → PREPARING → READY → HANDED_OVER`, `CANCELLED` from any
open state. Internal reject reasons: too busy, item unavailable, no courier, delivery fee,
closed, other; each adapter maps them to its codes and leaves out the ones it can't send.

| Capability | Snappfood (annex 4.3.0) | Talabat (V6) |
| --- | --- | --- |
| acknowledge on receipt / on open | ack / pick | — |
| accept with time | deliveryTime or riderPickupTime | acceptanceTime |
| reject reasons | 113, 153, 154 (139 = items unavailable) | reason enum |
| more time after accepting | no: "needs a call" (reject 153 + minutes) within 60 min | adjust-preparation-time |
| ready | not sent | preparation-completed |
| handed over | not sent (rider PICKED arrives instead) | order_picked_up |
| rider status | bikerName / bikerStatusV2 | courier arrived |
| pause | all menus off via menu_toggle, back on at the end | availability CLOSED_UNTIL |

## 4. Slices

| # | Slice | Fixes |
| --- | --- | --- |
| S1 | **Channel adapter** in the backend: one interface, capability flags, internal reject reasons, Snappfood adapter (ack, pick, accept, reject, report). Order service calls the adapter, never Snappfood by name. Online board endpoint with lanes worked out on the server. | A11, A12, groundwork |
| S2 | **Online panel in the POS**: Menu / Online tab, lanes, cards, one-tap accept, reject sheet, pop-up on arrival, shift gate, badge opens the panel. Incoming Orders page shows the same board full width. | A1, A2, A7, A8, A13 |
| S3 | **Lifecycle**: Ready, Handed over, Collected (with payment for cash pickup), Send out, rider status from the webhook (PICKED closes the order), platform cancel pulls kitchen tickets and raises an Issue, time-limit rejection raises an Issue, late flag. Orders grid primary action fixed. Simulator buttons for rider status. | A3, A4, A5, A6, A9, A14, A15 |
| S4 | **Pause a platform** from the panel: busy 15/30/60 min, closed for today, resume; Snappfood adapter toggles its menus. Items off on this platform from the panel. | A10 |

### Status (2026-10-08)

All four slices are built on `feat/aggregator-cashier-ux` and were clicked through on the local
app as a Valiasr cashier: pop-up accept, Online tab, Ready, rider at the restaurant, rider PICKED
closing the order, Snappfood cancelling an accepted order (Issue card, toast, kitchen STOP chit),
cash pickup paid at the till and handed over, reject with a reason, pause and resume.

| Finding | Where it was fixed |
| --- | --- |
| A1, A7, A8, A13 | POS Online tab + pop-up (`components/online-orders/`), Incoming page shows the same board |
| A2 | shift gate on the board, pop-up and POS gate; `NO_OPEN_SHIFT` in plain words |
| A3 | `stopKitchenForPlatformCancel` + `PLATFORM_CANCELLED` alert |
| A4 | till takes payment for a platform pickup order; Collected opens the pay form first |
| A5 | Orders grid: report is never the main button; it opens the order's card |
| A6 | `POST /orders/:id/online/ready` |
| A9 | rider name/status from the webhook; PICKED completes the order |
| A10 | `POST /orders/online-pause`; Snappfood adapter switches its menus off; simulator refuses orders while paused |
| A11 | store-worded reasons, mapped by the adapter |
| A12 | ack on receipt, pick when a cashier opens the order |
| A14 | Late chip on the card |
| A15 | `TIMED_OUT` alert on the board |

Adding Talabat: write `channels/talabat.adapter.ts` (capabilities: adjustTime, notifiesReady,
notifiesHandover), return it from `channelFor`, add `TALABAT` to `ONLINE_PLATFORMS` and its name
under `online.platform` in both locale files. The panel needs no change.

## 5. Open questions for Iran Burger / Snappfood

- Does Snappfood let a vendor close temporarily through the API, or only by menu toggles?
- Is rider status (`bikerStatusV2`) enabled on Iran Burger's Snappfood account? The annex says it
  is off by default and has to be requested.
- Status 71 (customer must pay extra after a support change) is not handled; the order just waits.
