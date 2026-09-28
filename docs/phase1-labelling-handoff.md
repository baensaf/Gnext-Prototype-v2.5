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
| V2 Floor and kitchen | Table assignment and the dine-in floor, KDS, the full approval engine, the full refund and correction set |
| V3 Delivery and Snappfood | The real Snappfood integration, customer import at scale, coupons, customer credit |
| V4 Club, credit and head office | Discount campaigns, Tara Pay, kiosk, chain-scale pricing, consolidated reports |
| F | After Phase 1. Offline operation is F. So is Moadian: Iran Burger issues tax invoices from its own accounting software |

Full delivery moved from V3 to V1 on 2026-09-28. V3 is now mostly Snappfood and customers.

## Where the decisions live

- **Claude Doc "Phase 1 Decision Register"**: https://claude.ai/code/artifact/ba67a43a-c842-4738-81e1-28af6e84ddbe.
  The product manager shares it with the new account. It has two tabs:
  - **Decision register**: every decision found in the docs and code (rows S, A, R, C, O, P,
    Y, K, D, U, I, G, L), each marked Confirmed, Accepted recommendation or Implicit in
    code, and waiting for a Keep, Change or Open verdict. Open questions are Q-01 to Q-16.
  - **Feature labels**: the page walkthrough order, one table per page, and a
    "Decided across pages" table. The Label column is a V1/V2/V3/V4/F dropdown.
- **In the prototype**: `starter-vite-ts/src/config/version-labels.ts` mirrors the Feature
  labels tab. `PAGE_LABELS` maps a path prefix to a version. `FEATURE_LABELS` lists only
  the features that ship later than their page. `<VersionTag feature="…" />` from
  `src/components/version-tag` draws the chip. The header chip shows the page's version
  and toggles every label on and off. Shipped in PR #156 and live on gnextdev.ir.

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

## Next

Page group 2: orders list (`/app/orders`), order detail (`/app/orders/:id`) and incoming
orders (`/app/orders/incoming`). After that, groups 3–15 in the order listed on the
Feature labels tab.

## Routine for each page

1. Read the page's code (`starter-vite-ts/src/pages/…`) and list its features.
2. Give the product manager one short table: feature, suggested label, one-line reason. Flag
   the close calls. They are short on tokens, so keep it tight.
3. When they answer, add the page's rows to the Feature labels tab.
4. Update `version-labels.ts`: the page's entry in `PAGE_LABELS`, plus a `FEATURE_LABELS`
   entry and a `<VersionTag>` for each feature that ships later than its page.
5. Ship a small PR as `CLAUDE.md` describes: a worktree from `origin/main`,
   `npm run lint` and `npm run build`, a PR, then `gh pr merge --rebase` once CI passes.
   The merge deploys to gnextdev.ir.

Any locale strings you add go into both `en.json` and `fa.json` with the same keys.
