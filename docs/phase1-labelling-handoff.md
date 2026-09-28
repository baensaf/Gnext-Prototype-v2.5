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
| V2 Floor | Creating tables and assigning one when an order is submitted (nothing more of the dine-in floor), the full approval engine, the full refund and correction set |
| V3 Delivery and Snappfood | The real Snappfood integration, customer import at scale, coupons, customer credit |
| V4 Club, credit and head office | Discount campaigns, Tara Pay, kiosk, chain-scale pricing, consolidated reports |
| F | After Phase 1. Offline operation is F. So is Moadian: Iran Burger issues tax invoices from its own accounting software. So is the KDS and everything that depends on it |

Full delivery moved from V3 to V1 on 2026-09-28. V3 is now mostly Snappfood and customers.
KDS moved from V2 to F on 2026-09-28: no restaurant in Iran runs a kitchen screen, so
tickets are printed. Kitchen stations and routing rules stay V1, because the printers use them.

## Where the decisions live

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
| Assigning a table to a dine-in order (the dine-in order type is V1) | V2 |
| Coupon codes | V3 |
| Customer credit as a tender | V3 |
| "Internet is down" banner and offline till | F |

Everything else on the POS page is V1: delivery orders, quick customer registration,
combos (HAMI has no combos, but Iran Burger needs them), manual discount with the
cashier's limit, hold and resume, and the cash, card and split payments.

**Page group 2, orders list and order drawer (`/app/orders`): V1. Incoming orders
(`/app/orders/incoming`): V3.** These features of the orders page ship later:

| Feature | Label |
|---|---|
| Snappfood "promised by" and "with support" chips, and Report to Snappfood | V3 |
| Table number in the list, the drawer and the change-type dialog | V2 |
| Kitchen progress chips (preparing, ready) | F |
| The icon marking an order taken offline | F |
| Head office's read-only view across branches (the branch column) | V4 |
| "Inspect snapshot" JSON in the audit tab | F |

Everything else on the orders page is V1, including editing lines on a sent order, changing
the order type, and the manager PIN for a late or paid cancellation.

**KDS (`/app/kds`): F.** On the kitchen settings page, the bump-screens tab and the target
preparation time are F. That page's other features wait for its own turn.

**Page group 3, dine-in floor (`/app/dine-in/floor`): V2, but a very basic V2.** V2 is only
creating sections and tables; the POS assigns a table when the order is submitted. Running
service from the floor is F: occupancy, table states, seating, move, merge, split, the guest
bill, paying from the table and releasing it.

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

## Next

Page group 6, payments and refunds, then groups 7–15 in the order listed on the Feature
labels tab.

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
