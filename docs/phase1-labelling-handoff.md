# Phase 1 labelling: handoff

Written 2026-09-28 for the Claude session that continues this work on another PC. Read
this file, `docs/phase1-decisions.md` and `Phase 1-- HAMI Replacement Scope_rev3.md` first.

## The work

The product manager is turning this prototype into Phase 1, minus the offline
capabilities, delivered as four versions. The two of you walk every frontend page. For each
page, the product manager decides which version ships each feature: V1, V2, V3, V4, or F
(Future, after Phase 1). The labels become the developers' scope.

| Version | What it is for |
|---|---|
| V1 Counter | One branch sells, delivers and closes its day: POS, catalog, cash and card, shifts, business day, printing, and full delivery (addresses, zones, couriers, dispatch board, courier settlement) |
| V2 Floor | The full approval engine, the full refund and correction set (dine-in tables were removed on 2026-10-10) |
| V3 Delivery and Snappfood | The real Snappfood integration, coupons, customer credit, the kiosk |
| V4 Club, credit and head office | Discount campaigns, Tara Pay, chain-scale pricing, consolidated reports |
| F | After Phase 1. Offline operation is F. So is Moadian: Iran Burger issues tax invoices from its own accounting software. The KDS was F and was removed from the prototype on 2026-10-10 |

Full delivery moved from V3 to V1 on 2026-09-28. V3 is now mostly Snappfood and customers.
KDS moved from V2 to F on 2026-09-28: no restaurant in Iran runs a kitchen screen, so
tickets are printed. Kitchen stations and routing rules stay V1, because the printers use them.

**Simplified on 2026-10-10 (PR #231).** To keep V1–V4 small, these were removed from the
prototype rather than labelled F:

- **The KDS and prep stations.** A branch adds its printers, then on Operations → Print
  routing sends categories or single products to them. One item can go to several printers;
  a product with its own printers ignores its category's. Anything not routed prints on the
  branch's default kitchen printer. Routing is per branch, not per till.
- **Dine-in tables.** Floors, tables, seating, split and move checks, the POS table picker and
  the "require a table" setting. The dine-in order type stays.
- **The courier pay engine.** Pay rules, the zone courier rate and the courier-pay setting.
  A settlement is what the courier collected, plus any adjustment.
- **The "ready" step for platform orders.** The POS Online board has three lanes: New,
  Accepted, Needs attention. The Online tab is V3.
- **Built-in gender and wedding date.** Head office adds its own customer questions on
  Settings → Customer fields (V1); existing answers became two fields.

The same day these F features went too: stop reasons, stop time limits and the stop PIN; the
"taken offline" marker; the past-dates check; the online payment gateway device; the audit
explorer and the delivery and customer audit tabs; serial, label and fallback printers;
production-kitchen and office branches; customer import; blocking a customer; the currencies
screen; Moadian; and the inventory preview report. Simulators and test tools stay.

Moved to V4: failing a delivery and swapping the rider, the courier "working today" check-in,
and a mobile card reader per courier. The kiosk stays V3.

## Where the decisions live

Since 2026-10-10 the master copies are `decisions/register.md` and `decisions/feature-labels.md`
in the private product-management repo (baensaf/gnext-product-management). The Claude Docs
below are frozen.

- **Claude Doc "Phase 1 Decision Register"**: https://claude.ai/code/artifact/1775b8f0-b936-4b43-aac1-ded088ace0e4.
  Rebuilt on 2026-09-28 under the account Claude works in, because the docs tools refuse a
  doc owned by another organization even when it is shared. The first copy
  (`ba67a43a-…`) is no longer updated. It has two tabs:
  - **Decision register**: every decision found in the docs and code (rows S, A, R, C, O, P,
    Y, K, D, U, I, G, L), each marked Confirmed, Accepted recommendation or Implicit in
    code, and waiting for a Keep, Change or Open verdict. Open questions are Q-01 to Q-16.
  - **Feature labels**: the page walkthrough order, one table per page, and a
    "Decided across pages" table. The Label column is a V1/V2/V3/V4/F dropdown.
- **In the prototype**: `starter-vite-ts/src/config/version-labels.ts` mirrors the Feature
  labels tab. `PAGE_LABELS` maps a path prefix to a version. `FEATURE_LABELS` lists only
  the features that ship later than their page. `<VersionTag feature="…" />` from
  `src/components/version-tag` draws the chip. A tag icon in the header toggles every label
  on and off. Shipped in PR #156 and live on gnextdev.ir.
  V1 is the default and draws no chip anywhere (header, menu or feature), and an unlabelled
  page shows nothing either: only pages and features that ship later are marked.

## Done so far

**Page 1, POS register (`/app/pos`): V1.** These features ship later than the page:

| Feature | Label |
|---|---|
| Stop an item: reason picker, duration choice, manager PIN (a plain 86 from the tile, with no reason or PIN, is V1) | F |
| Coupon codes | V3 |
| Customer credit as a tender | V3 |
| "Internet is down" banner and offline till | F |

Everything else on the POS page is V1: delivery orders, quick customer registration,
manual discount with the cashier's limit, hold and resume, and the cash, card and split
payments. Sizes, add-ons and combos on the POS are V1 too (moved back from V4 on 2026-10-04,
with page group 8).

**Page group 2, orders list and order drawer (`/app/orders`): V1. Incoming orders
(`/app/orders/incoming`): V3.** These features of the orders page ship later:

| Feature | Label |
|---|---|
| Snappfood "promised by" and "with support" chips, and Report to Snappfood | V3 |
| The icon marking an order taken offline | F |
| Head office's read-only view across branches (the branch column) | V4 |
| "Inspect snapshot" JSON in the audit tab | F |

Everything else on the orders page is V1, including editing lines on a sent order, changing
the order type, and the manager PIN for a late or paid cancellation.

**KDS (`/app/kds`) and page group 3, dine-in floor (`/app/dine-in/floor`):** removed on
2026-10-10 (they were F and a very basic V2).

**Page group 5, shifts and business days (`/app/cashier/…`): V1. The chain shift roll-up
(`/app/cashier/rollup`): V4.** A V1 shift close only asks for the counted cash, and the
cashier closes it. These ship later:

| Feature | Label |
|---|---|
| Safe drop | V4 |
| Blind count, a reason for a difference, a manager PIN beyond the tolerance | V4 |
| A manager PIN to leave the till's open orders open | V4 |
| Reopening a closed business day | V2 |
| "Check past dates against the cutoff" | F |

The business day closes by itself once it has ended and every shift is counted (Q-03,
answered 2026-09-29).

**Page group 6, payments and refunds.** Payments (`/app/payments`) is V1 and is now only
the list of payments taken. Refunds (`/app/refunds`) is V2: in V1, money goes back only by
cancelling a paid order from the Orders page. The card terminal set-up moved out of Payments
into Settings → Hardware → Card terminals (`/app/operations/card-terminals`, V1), next to
registers and printers. The bank settlement accounts moved to Settings → Payments & refunds
and are V4. The "online payment gateway" device type is F; the "bank transfer account"
type is V4.

**Page group 7, delivery (`/app/delivery/…`): V1.** Decided 2026-09-29:

- **Couriers belong to one branch in V1**, and a courier is a user with a Courier role,
  added by the branch manager on Delivery → Couriers, which opens the account too (username:
  the mobile in its +98 form). A courier cannot sign in in V1: the account is there for the
  Android tracking app that comes later. The manager marks who is "working today", which
  resets at the day's cutoff. *Built in PR #168; moved to V4 on 2026-10-10.*
- **Zones are V1, drawn on a map** (OpenStreetMap; Neshan or Map.ir later need only a tile
  URL and a key). The till still picks the zone by postal code. *Built in PR #169.*
- **Couriers are salaried; Gnext does not work out courier pay.** The pay rules were removed
  on 2026-10-10.

| Feature | Label |
|---|---|
| Courier availability (available, busy, offline) | V4 |
| Moving a courier to another branch | V4 |
| The courier detail page | V4 |
| The settlement "review" step | V4 |
| Reversing a closed settlement | V2 |
| Snappfood orders the store delivers, on the board | V3 |
| The delivery audit tab | F |
| Failing a delivery, swapping the rider | V4 |
| The courier "working today" check-in | V4 |
| A mobile card reader per courier | V4 |
| Head office's fleet roll-up (`/app/delivery/rollup`) | V4 |

**Page group 8, catalog (`/app/catalog/…`): V1.** Decided 2026-09-29, extended 2026-10-04 so
the V1 menu is complete: a V1 product sits in a category and can have sizes (each with its own
price), add-on groups (the add-ons page `/app/catalog/modifiers`, set up from one sheet,
inherited from the category, asked at the POS or not) and a packaging price; combos, whose
choices are add-on groups, are V1 too. All of it works on the POS. The packaging price is
charged per item on delivery and takeaway orders, as its own line on the bill and receipt, not
on dine-in (the prototype still only records it). Categories don't nest:
sub-categories were removed from the prototype (migration 083 makes each one a category of
its own). The 86 report (`/app/catalog/availability/report`) is V4.
Today's stock and importing products and categories are V1. So is the on/off-menu switch
(added 2026-10-03): it hides an item or a whole category everywhere until it is turned back on,
separate from a stop (sold out for now) and from archive (gone). An item keeps its own
switch, so a category turned back on brings its items back as they were.

| Feature | Label |
|---|---|
| Most per order | V4 |
| A product's price history tab | V4 |
| Stopping an item on Snappfood only | V3 |
| A reason when stopping an item | F |
| Stopping until the next shift, or for set hours (V1 is available or off until further notice) | F |
| Stopping items at several branches at once (head office) | V4 |
| Selling windows (for example, breakfast only) | V2 |
| Importing customers | F |

**Page group 9, pricing.** Decided 2026-09-29. Branch prices (`/app/pricing/price-lists`)
are V4: a V1 branch sells at base prices. Price changes (`/app/pricing/changes`) are V1:
raise or lower base prices now, by percent or amount, by category, with rounding. Snappfood
prices (`/app/pricing/snappfood`) are V3. So is the shown ("fake") discount on them (added
2026-10-03): a percent, as a channel default, per item, or set on a whole category; the menu
prints a struck-through price that much higher (the price ÷ (1 − %), rounded up to the
rule's step, at most 90%) while the customer pays the real price. Nothing is taken off the
bill, so it is not a discount campaign (those stay cut). Not on the item page or the till.

| Feature | Label |
|---|---|
| Scheduling a price change for a later day | V4 |
| Changing a price list's prices | V4 |
| Changing add-on prices | V4 |

**Page group 10, customers, credit and discounts.** Decided 2026-09-29. Customers
(`/app/customers`) is V1: register and find a customer, with their addresses. The customer
profile page (`/app/customers/:id`) is V4. Credit accounts (`/app/credit/accounts`) are V3.
Coupons (`/app/discounts/coupons`) are V3; customer-specific rates and the wallet with
cashback (`/app/discounts/…`) are V4, with the customer club.

The V1 register form (2026-10-03, the same dialog on the customers page and the POS): the
name in one box; the mobile, which is also the customer code; optional birthday; the questions
head office adds on Settings → Customer fields (gender and wedding date became such fields on
2026-10-10); and delivery addresses typed
in the same step, each with an optional pin on the map. The credit limit field opens at 0, is
shown to head office only, and carries the V3 chip.

Finding a customer is V1 and searches the server, sized for 500,000 customers per chain. At
the POS: type 3+ characters of the mobile (any form: 0912…, +98…, Persian digits) or the
name; the best 20 come back, the exact mobile first; "Register" opens the form with the
typed mobile when nothing matches. The customers page pages on the server, newest first.

| Feature | Label |
|---|---|
| Blocking a customer (refuse to serve) | F |
| Credit limit and the wallet/credit balance on the customers page | V3 |
| The audit log tab on a customer profile | F |
| Credit aging | V4 |
| The coupon test bench | F |

**Automatic item discounts (`/app/pricing/item-discounts`): V1.** Decided 2026-10-03, from the
Nasr HAMI backup (15% and 20% dated item discounts on 144 of 602 counter invoices). Head
office sets a percent off one item between two business days (no end date runs until
deleted); one item has one discount on any day. It comes off every till line of the item at
every branch by itself, and the one order discount (manual, coupon, customer rate) then
applies to what is left, as HAMI does. A line keeps the percent it was given when the order is
sent. The till shows "−20%" on the cart line; the receipt marks the line and the discount total
includes it. Not a discount campaign (no targeting, no conditions); campaigns stay cut.

| Feature | Label |
|---|---|
| Category-wide item discounts | V2 |
| Fixed-amount item discounts; time-of-day | V2 |
| Item discounts on the kiosk | V3 |
| Item discounts on offline agent tills (not built yet: needs an agent release; offline orders take no discounts today) | V1 |
| Only some branches | V4 |
| Sending item discounts to Moadian | F |

**Page group 11, operations (`/app/operations/…`): V1.** Decided 2026-09-29: branches, tills,
printers and print routing, the print queue and branch agents. Monitoring
(`/app/operations/monitoring`) is V4. The kiosk moved from V4 to V3 (`/app/kiosk` is V3).

| Feature | Label |
|---|---|
| Branch types "production kitchen" and "office" | F |
| The kiosk as a device type | V3 |
| Serial-port printers, label printers, a fallback printer | F |
| Simulated printers, the hardware simulator and "simulate outcome" | F |
| "Ready to sell offline" on a branch agent | F |

**Page group 12, reports, audit and Moadian.** Decided 2026-09-29. The reports page
(`/app/reports`) is V2. V1 has one very basic report instead: the dashboard (page group 15). The audit
explorer (`/app/audit`) and Moadian are F. Reports that ship later than the page:

| Report | Label |
|---|---|
| Snappfood orders, Snappfood webhook reconciliation | V3 |
| Customer credit ledger, end-of-day credit use | V3 |
| Customer activity, credit aging, branch comparison | V4 |
| Saved report views | V4 |
| Print job log, integration and webhook log, "V5 preview: inventory" | F |

**Page group 13, settings (`/app/settings/…`): V1.** Decided 2026-09-29. **Money is shown
in Toman** everywhere (screens, receipts, exports) and stored in Rial, as banks and card
terminals expect. More than one currency is F: the Omani rial and the US dollar come in V7.
Approval policies (`/app/settings/approvals`) are V2; V1 keeps the fixed manager-PIN checks.
Branch overrides are V4; courier pay was removed on 2026-10-10. The localization demo and data reset pages are F.

| Feature | Label |
|---|---|
| More than one currency | F (V7) |
| Reopening closed orders | V2 |
| Incoming orders (accepting automatically) | V3 |
| Refund methods | V2 |
| Difference tolerance, blind count | V4 |

**Page group 14, kiosk (`/app/kiosk`): V3.** Decided 2026-09-29: ordering, card payment on the
terminal, the order number, the customer's phone and name, and setting up the kiosk device.
Sizes and add-ons on the kiosk ship with the kiosk (V1 in the catalog since 2026-10-04). The simulated card terminal is F.

**Page group 15, dashboard, simulators and tools.** Decided 2026-09-29. The dashboard
(`/app/dashboard`) is V1 and is V1's one basic report: today's sales, open orders and open
shifts. Branch health and the list of branches with their agents are V4 (head office). The
simulators (`/app/simulation/…`) and the offline till (`/till`) are F.

**V1 print routing (decided 2026-09-30, simplified 2026-10-10).** No stations: a branch's
categories and products are routed straight to its printers, any number each, and a product's
own printers replace its category's. An item with no route goes to the branch's default kitchen
printer. One chit layout, one copy; a chit prints when the order is sent and a change chit when
lines are added or voided. F: copies or paper templates per printer.

The V1 product scope: https://claude.ai/code/artifact/e999955c-f8c1-48f7-8278-88a7daf5e125

## Next

Every page group is labelled (2026-09-29). Next: turn the labels into the product scope
documents for V1–V4. in the order listed on the Feature labels tab.

## Routine for each page

1. Read the page's code (`starter-vite-ts/src/pages/…`) and list its features.
2. Give the product manager one short table: feature, suggested label, one-line reason. Flag
   the close calls. They are short on tokens, so keep it tight.
3. When they answer, add the page's rows to the Feature labels tab.
4. Update `version-labels.ts`: the page's entry in `PAGE_LABELS`, plus a `FEATURE_LABELS`
   entry and a `<VersionTag>` for each feature that ships later than its page.
5. Ship a small PR as `CLAUDE.md` describes: a worktree from `origin/main`,
   `npm run lint` and `npm run build`, a PR, then `gh pr merge --rebase` once CI passes.
   The merge deploys to gnext.top.

Any locale strings you add go into both `en.json` and `fa.json` with the same keys.
