# Pass B — Live Workflow Walk

Date: 2026-09-16 · Stack: local (postgres container, API :3100, web :8081), seeded demo tenant
Signed in as System Administrator, branch Downtown Express, terminal TERM-02.

Every finding below was reproduced in the running app, then confirmed in the database
or in the source. Nothing here is inferred from a code read alone.

---

## Flows walked

| # | Flow | Result |
|---|---|---|
| 1 | Bind device to terminal → POS gate | ✅ works |
| 2 | Open shift with opening float | ✅ works |
| 3 | Add item → place order → card payment → receipt | ✅ works |
| 4 | Order fans out to KDS ticket + print jobs | ⚠️ partial — see F3 |
| 5 | Manual cashier discount over limit → PIN escalation | ❌ **F1 — money bug** |
| 6 | Coupon discount | ✅ correct, including tax base |
| 7 | Cancel a paid order → PIN → refund | ✅ correct |
| 8 | Blind shift close with a cash variance | ⚠️ works, but see F6 |
| 9 | Run a report over live data | ⚠️ works, but see F2, F5, F14 |
| 10 | Cash-on-delivery: order → courier check-in → assign → depart → deliver → settle short → approve → close | ❌ **F10 — money bug** |
| 11 | Snappfood webhook → incoming screen → accept with prep time | ⚠️ flow works, money wrong — F13 |
| 12 | Dine-in: two tables → move table → split a check → merge tables | ❌ **F11 — merge loses a bill** |
| 13 | Kiosk: eat-in → add item → pay | ❌ **F12** |
| 14 | Credit sale within limit, then a second sale over the limit | ✅ works (minor, F15) |
| 15 | Moadian: refuse unpaid/uncompleted, issue for a completed discounted order | ⚠️ guards right, invoice wrong — F1 addendum |

All flows in the plan are now walked. Rows 10–15 were added in a second pass the same day,
driven through the same HTTP API the screens call and checked against the database;
the incoming-orders screen, the Snappfood simulator and the kiosk were driven in the browser.

---

## Findings

### F1 — BLOCKER · Manual cashier discount is recorded but never deducted

**Repro:** POS → add Special House Burger (250,000) → Discount → 30% → over the cashier
limit → manager PIN 2468 → "Manager authorization granted" → cart shows discount
−75,000 and payable 197,500 → Place Order.

**What happens:** the placed order demands **272,500** — full price. The cart figure
197,500 was never real.

```
ORD-20260916-0002
subtotal        250,000
discount_total   75,000   <- recorded
tax_total        22,500   <- 9% of the UNDISCOUNTED 250,000
grand_total     272,500   <- subtotal + tax; discount never subtracted
due_amount      272,500
```

**Cause:** `backend/src/modules/discounts/discount-evaluation.service.ts:252`. The manual
discount branch adds to the order-level `discountTotal` but — unlike the coupon branch
(line 327) and the customer-discount branch (line 367) — it never writes
`lineItems[i].discountTotal`. The grand total is built at lines 390–403 by summing
`line.subtotal − line.discountTotal` per line, so a discount that never reached a line
never reaches the total, and never reduces the tax base either.

**Consequences, all at once:**
- The customer is charged the full amount after staff promised a discount.
- The manual-discounts report shows money given away that never was.
- Sales totals will not reconcile against payments on any day a manual discount was used.
- The overstated tax flows into the Moadian e-invoice.

**Scope:** manual percentage and manual fixed-price deduction only. **Coupons are correct** —
verified live: coupon VERIFY048 on the same 250,000 item gave subtotal 250,000,
VAT 20,700 (9% of the discounted 230,000 ✓), discount −20,000, payable 250,700.

This is the exact feature the entire PIN-escalation apparatus exists to protect.

**Addendum — it reaches the tax office.** After paying 272,500 for ORD-20260916-0002 and
completing it, the Moadian invoice queued for it reads `tprdis 250,000`, `tdis 75,000`,
`tadis 175,000`, `tvam 22,750`, `tbill 197,750`. So three documents disagree about one sale:
the customer paid **272,500**, the receipt shows VAT **22,500**, and the tax invoice declares
a bill of **197,750** with VAT **22,750**. The VAT rate on the invoice is **13%** —
`common/utils/moadian.util.ts:176` back-derives `vra` from `taxTotal / taxable`
(22,500 / 175,000), and the catalog rate is 9%. An e-invoice with an unexplained rate that
contradicts the payment is exactly what the tax office rejects or audits.

---

### F2 — BLOCKER · No Jalali calendar anywhere in the product

Every date in the app renders Gregorian: the order drawer reads "9/16/2026", the reports
date pickers are `mm/dd/yyyy` US format, the dashboard and shift statements likewise.

There is **no Jalali support at all** — no `jalali` / `jalaali` / `shamsi` / `persian-date`
dependency in either `package.json`, and no match for those terms anywhere in
`starter-vite-ts/src` or `backend/src`.

Scope §22 requires "Localized calendar and first-day-of-week settings". An Iranian
restaurant chain runs its day, its shifts and its books on 1405/06/25, not 2026-09-16.
HAMI is Iranian software and will be Jalali throughout. Staff cannot read these screens.

---

### F3 — BLOCKER · A kitchen ticket with no printer route vanishes silently

**Observed:** paying for ORD-20260916-0001 correctly created a `KITCHEN_TICKET` and a
`CUSTOMER_RECEIPT` print job — both with `printer_id = NULL`, status `QUEUED`, and
**zero print attempts**. All 25 print jobs ever created in this database are still `QUEUED`.

**Cause:** `backend/src/modules/printing/print-queue.service.ts:149-181`. When
`resolvePrintersForRoute` returns nothing, the job is still saved as `QUEUED` with no
printer, no `PrintAttempt` row is written, and the audit event recorded is the ordinary
`PRINT_JOB_ENQUEUED`. Nothing distinguishes "printed fine" from "went nowhere". No alert,
no operational-monitoring entry, no badge on the print queue.

In a restaurant this is an order the kitchen never sees and nobody finds out until a
customer asks where their food is. The failure mode is silence, which is the worst
property a print path can have.

Contributing: the seed creates **no printers, printer groups or print routes at all**
(the only three printers in the database are leftover test rows named `TMP-PR`,
`TMP-PR2`, `TMP-PR3`), so routing has nothing to match and this path is the default
experience, not an edge case.

---

### F4 — GAP · The operational UI is half in English

In a Persian, RTL product the following render untranslated, in screens staff use hourly:

- **POS:** "Active Cart (0 items)", "Held", "Clear", "Cart is empty. Tap products to add
  items", "Discount", "Apply", "Coupon Code", "CATEGORIES", "All Items", "Place Order",
  "Search products by English/Persian name, SKU or code".
- **Manual discount dialog:** "Apply Manual Cashier Discount", "Quick Presets",
  "Discount Justification Reason", "Customer Satisfaction / Courtesy", "Apply to Cart".
- **Payment result:** "Order Placed Successfully!", "Remaining Due", "Ref / POS",
  "Amount", "Time", "SUCCEEDED", "Close".
- **Reports:** the entire page — "Reports Catalog & Analytics", "Run Report",
  "Export Typed XLSX", "Select Report", "Business Date", "Gross Subtotal", "Order Number",
  "Type", "Channel", "Branch Id".
- **Reason codes:** every one is English — "Manager Manual Adjustment",
  "Customer Dissatisfaction Refund", "Damaged Goods Waste", "Expired Stock Waste".

The orders list and the order drawer, by contrast, are fully and well localized — so this
is uneven coverage rather than a missing capability.

---

### F5 — GAP · Reports show raw branch UUIDs

The Sales Summary "Branch Id" column prints `c18c351a-4b1e-412b-9107-aac4fe8bee6a`
instead of "Downtown Express". No operator can use that, and it makes the multi-branch
consolidated reports — a headline reason to leave HAMI — effectively unreadable.

---

### F6 — GAP · The blind close is not blind

The close-shift dialog displays **"نقد مورد انتظار: 5,000,000"** (expected cash) at the
top, above the empty count field, before the cashier enters anything. A cashier who is
short simply types the number shown back.

Blind close was a deliberate design decision on this project. The arithmetic is right —
opening float 5,000,000, cash sales 0, expected 5,000,000, counted 4,900,000,
shortage −100,000 — and the close correctly flagged "شیفت با مغایرت بسته شد". Only the
disclosure is wrong.

*(No approver PIN was demanded at −100,000, and that is correct: the default
`varianceTolerance` is exactly 100,000 and the check is strictly greater-than, so the
test landed on the boundary.)*

---

### F7 — GAP · Reason codes are not filtered by action

Cancelling an order offers "Damaged Goods Waste" and "Expired Stock Waste" — stock-waste
reasons — alongside refund reasons. There is no reason code that actually means
"customer cancelled". The cancel dialog is showing the unfiltered tenant list.

---

### F8 — GAP · The demo tenant ships with almost no policy configured

`tenant_setting` holds exactly three rows (`MOADIAN`, and `ORDER_ACTIONS` twice).
`approval_rule` is **empty**. There are no `DISCOUNTS`, `DISCOUNT_AUTHORIZATIONS`,
`SHIFT_POLICY`, `GENERAL` or `FINANCIAL` settings, no printers and no print routes.

Everything that worked in this walk worked off **hardcoded code defaults** — the cashier
limit of "10% / 50,000 IRR" in the escalation prompt is not coming from the settings the
scope says govern it. Consequence: the centralized-settings story (§22) and the
configurable multi-step approval story (§2) cannot be demonstrated on a fresh install,
and nobody can tell from the UI which limits are real policy and which are fallbacks.

Also note one of those three rows is a **branch-scoped** `ORDER_ACTIONS` override, which
confirms branch overrides are live in contradiction of rev3 §22.

*Revised while fixing (2026-09-16):* the missing `DISCOUNTS` / `SHIFT_POLICY` rows turned out
to be harmless — the settings pages show and save the same defaults the backend falls back
to. The real gaps were **printers/routes and payment methods** (seeded in PR #20), and a
larger one: **approval rules are wired to nothing**. `/approvals/evaluate` has no caller;
every live escalation uses its own hardcoded limits. The configurable approval workflow in
scope §2 exists as a settings page only.

---

### F9 — HOUSEKEEPING · Test rows have leaked into the demo database

`TMP-TE` "Temp Terminal 2", printers `TMP-PR` / `TMP-PR2` / `TMP-PR3` ("Temp Printer",
"Temp", "Temp 2"), and coupon `VERIFY048` are test artifacts sitting in the seeded tenant.
They show up in the terminal picker a cashier uses to bind a till.

---

### F10 — BLOCKER · Cash-on-delivery money never becomes a payment

**Repro:** delivery order ORD-20260916-0003 at Downtown for Reza — 2 × Special House Burger
+ 20,000 zone fee = **565,000**, unpaid (cash on delivery). Courier CR-001 checked in at
Downtown, assigned, departed, completed with `cashCollected: 500000` (65,000 short).
Settlement SET-558243 created, actual cash 500,000 entered, sent to review.

**What worked:** the settlement computed expected cash 565,000, recorded a
**−65,000** discrepancy, and **refused to close** until an approval existed. With an approved
request it closed. That part is right.

**What is wrong, all confirmed in the database after the settlement closed:**

```
ORD-20260916-0003   state COMPLETED   paid_total 0   due_amount 565,000
payment rows on the order: 0
```

- **Completing the delivery marks the order `COMPLETED` with 565,000 still owed.** The order
  screen blocks exactly this (`ORDER_HAS_BALANCE`: "take the payment before completing it") —
  the delivery path simply goes around that guard.
- **Closing the settlement writes nothing to the order and nothing to any drawer.**
  `closeSettlement` in `delivery.service.ts` saves only the settlement and its assignments.
  The 500,000 the courier handed over is never recorded as a payment anywhere.
- Knock-on: COD cash is **absent from payments-by-method** and every sales-vs-payments
  reconciliation; the order carries a phantom 565,000 receivable forever; and because Moadian
  refuses unpaid orders ("The order is not fully paid yet"), **no COD delivery sale can ever be
  e-invoiced.** For a burger chain, cash-on-delivery is a large share of revenue.

**Also found in this flow:**
- **The courier's typed amount overwrites "expected".** `completeDelivery`
  (`delivery.service.ts:569`) sets `delivery.cash_expected = cashCollected`, so the delivery
  board shows 500,000 expected. The completion dialog pre-fills the order total as cash and
  always sends it — so on a **card-prepaid** order it would claim the courier owes that cash
  too. (The settlement itself recomputes from payments, so this misleads the board, not the
  settlement.)
- **Settlement preview ignored the branch filter** on the audited commit: a preview requested
  for Downtown included ORD-20260910-0005, a **Central Plaza** delivery. *Already fixed on
  `main`* by the shared-couriers work (7979f74) — `previewSettlement` now skips other branches'
  orders. The date filters are still accepted and unused.
- ~~Self-approval~~ — *withdrawn.* `approveRequest` resolves the approver from the PIN, never
  from the requester, and `2468` is also the Downtown manager's seeded PIN, so the manager
  approved it, not the admin who asked.

---

### F11 — BLOCKER · Merging two tables deletes one table's bill

**Repro:** ORD-20260916-0004 on E-02 (2 × burger + fries = 610,400) and ORD-20260916-0005 on
E-03 (cola = 32,700). Moved 0004 to E-04 ✓. Split one burger to a new check ✓ (0004 dropped
to 310,000 + tax; new check ORD-20260916-0006 took 250,000 + tax — money conserved).
Then merged 0005 into 0004.

**Result:**

```
ORD-20260916-0005   CANCELLED   subtotal 0   grand_total 0   (tax_total still 2,700)
  └─ Cola Can 330ml   ACTIVE   ← item never moved
ORD-20260916-0004   subtotal 310,000   ← unchanged; no cola
```

The source bill was cancelled and zeroed, but its item stayed on the cancelled order, so
**32,700 disappeared from the table**. Guests leave without paying for it and nothing flags it.

**Likely cause** (`dine-in.service.ts:431-456`): the loop sets `item.order_id = targetOrder.id`
and saves each item, then saves the source header — whose `items` relation is
`cascade: true` (`OrderHeader.entity.ts:178`) and still holds those same item objects — which
writes them straight back to the source order. The post-merge recalculation also carries the
target's old `tax_total` forward instead of recomputing it, so even a working move would
under-tax the merged bill.

---

### F12 — BLOCKER · Kiosk orders: wrong tender, not marked paid, never reach the kitchen

**Repro:** kiosk → EAT IN → Cheeseburger Special → Pay Now → receipt KOS-932574,
"Total Paid: 163,500 IRR (Cash)", "Status: PAID & SENT TO KITCHEN".

```
KOS-932574   state READY   paid_total 0   kitchen tickets 0
payment      CASH  163,500  SUCCEEDED
```

Three defects in one function, `kiosk.service.ts:375-420`:
- **Card booked as cash.** It looks for a method of kind `NETWORK_POS` or `CARD`; the seeded
  card method's kind is `CARD_POS`, so it falls back to `pmList[0]` — **CASH**. Every kiosk
  sale inflates expected cash in reports while no cash exists.
- **Not marked paid.** It writes the legacy `paid_amount` / `due_amount`, not `paid_total` /
  `outstanding_total`, which is what the rest of the system reads.
- **Never cooked.** It jumps the order straight to `READY` without the order-lifecycle
  service, so no kitchen ticket, no print job, no state event — while the receipt tells the
  guest it was sent to the kitchen.

Also: the payment reference is the last six digits of `Date.now()`, which repeats every
~16.7 minutes; the kiosk opens in English; and it served Downtown Express while the
signed-in header showed Central Plaza.

---

### F13 — GAP (high) · Snappfood orders are re-priced, and money is in the wrong unit

**Repro:** simulator webhook for SF-1213 — form total **1,910 Toman**, customer paid
1,910 Toman; Snappfood payload `price 1910`, `tax 110`, `vat 0.1`.

**Stored:** SNP-SF-1213, currency **IRR**, subtotal 1,100, tax 99 (9%), grand total **1,199**,
`paid_total` 1,199, **zero payment rows**, `customer_id` null.

- **Toman stored as Rial.** No Toman handling exists anywhere in the simulation service;
  1,910 Toman is 19,100 Rial, not 1,199.
- **Snappfood's own price and 10% VAT are discarded** and the order is re-priced from line
  items at our catalog rate. Our record can therefore never reconcile against Snappfood's
  settlement statement — which is the point of the `snappfood-reconciliation` report.
- **"Paid" with no payment.** `paid_total` is set but no payment row exists, so online
  Snappfood revenue is missing from payments-by-method.
- **Customer and address not mapped** — they live only as text in `notes`, shown in the
  accept drawer as raw English-labelled lines ("Customer:", "Address:"). Scope §15 lists
  customer/address mapping.

**What worked:** the incoming screen (5-minute auto-reject countdown, source badge,
prep-time buttons), accept posting back to Snappfood (`ORDER_ACCEPT`, `statusCode 42`,
`deliveryTime 20` in the integration log), and the kitchen ticket + print job on accept.

---

### F14 — GAP · Two reports hardcode values

- **payments-by-method never subtracts refunds.** `reports.service.ts:498`:
  `const refStr = '0.00';`. Today's 272,500 card refund (REF-20260916-0001) shows as
  `refunded_amount 0.00` and CARD_POS net is overstated by exactly that.
- **manual-discounts invents its cashier and approval.** `reports.service.ts:723-726` emit
  `cashier_id: 'CASHIER-1'` and `approval_status: 'NONE'` — the manager-PIN-approved 75,000
  discount from F1 is reported as unapproved and rung up by a cashier who doesn't exist.

---

### F15 — MINOR · Smaller things seen on the way

- **Credit:** limit enforcement works — a second 1,090,000 sale against 910,000 available was
  refused with an override path, and the EOD credit-usage report listed the first sale. But the
  refusal comes back as `code: INTERNAL_SERVER_ERROR` with HTTP 403, and the EOD report shows
  account UUIDs, not the customer or cashier.
- **Split** creates the new check in `DRAFT` rather than the state of the check it came from.
- **Card and credit sales need no open shift** (`payment.service.ts:158-161` only requires a
  drawer for cash). That is a documented choice, but it means those sales reconcile to no shift.
- **A shift has been open on TERM-01 at Central Plaza since 2026-09-11** — five days — with no
  alert anywhere.
- **Only three payment methods are seeded** (CASH, CARD_POS, CREDIT_ACCOUNT): no mobile POS,
  online or bank transfer, so the mobile-POS and alternative-refund stories (§11) can't be demoed.
- More leaked test rows: courier `TMP-C1`, delivery zone `TMP-Z1` "Temp Zone" (see F9).

---

## What went right

Worth stating plainly, because it is most of the system:

- The **POS gate chain** is genuinely well built: unbound device → pick terminal →
  no open shift → open with float → sell. Each step explains itself and refuses to skip.
- **Cancelling a paid order** is textbook: mandatory reason, manager PIN, an explicit
  "the amount will be returned to the same payment method" warning, then a real
  `REF-20260916-0001` for 272,500 to `CARD_POS` with the reason code and approval request
  linked, a refund allocation row, and the **original payment left `SUCCEEDED` and intact**.
  No payment was deleted to make a cancellation look tidy.
- **Coupon pricing** allocates per line and taxes the discounted base correctly.
- Payment, KDS ticket and print jobs all fan out from one action, in one transaction.
- The **orders list and order drawer** are polished and fully Persian.
- Reports run against live data with working XLSX/CSV export.
- **Courier settlement discrepancy control** computes the shortage and refuses to close
  without an approval.
- **Credit limits** are enforced with an override path, and credit sales land in the
  end-of-day credit report.
- **Incoming Snappfood orders** have a clean accept/reject screen with an auto-reject timer,
  and accept is posted back to Snappfood.
- **Move table and split check** both conserve money exactly.
- **The order screen refuses to complete an order with a balance**, and Moadian refuses to
  invoice unpaid or uncompleted orders — the guards exist; F10 is a path that goes around one.
