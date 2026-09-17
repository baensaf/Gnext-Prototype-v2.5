# HAMI Replacement Audit — 2026-09-16

Can Gnext replace HAMI for Iran Burger? Audited against `Phase 1-- HAMI Replacement Scope_rev3.md`.

| Pass | What | Status |
|---|---|---|
| A | [Coverage sweep](PASS-A-COVERAGE.md) — all 22 scope areas mapped to routes, entities, pages | Done. Ends with 12 questions only the HAMI side can answer. |
| B | [Workflow walk](PASS-B-WORKFLOW-WALK.md) — 15 daily flows driven in the running app, findings F1–F15 | Done |
| C | HAMI delta — answers to the Pass A questions | Waiting on the product owner |
| D | Best-practice review | Cut |

## Fix tracker

All fixes below are merged to `main` and deployed to the VPS. Commits are the merged ones on `main`.

| Finding | Severity | PR | Merged | What changed |
|---|---|---|---|---|
| F1 manual discount recorded but never deducted | Blocker | #15 | 2026-09-16 | The cashier's discount comes off the bill lines and totals, and reaches Moadian as a real discount |
| F11 merging tables drops the merged bill | Blocker | #16 | 2026-09-16 | The merged table's items stay on the surviving bill |
| F12 kiosk: cash instead of card, not paid, never cooked | Blocker | #17 | 2026-09-16 | Kiosk sales are booked to the card, marked paid and sent to the kitchen |
| F3 unrouted print jobs fail silently | Blocker | #18 | 2026-09-16 | A document with no printer fails and raises a `PRINT_UNROUTED` alert. Follow-up #28 (2026-09-17) splits kitchen tickets by station, so product/category/station routes now work |
| F14 reports hardcode refunds and discount approvals | Gap | #19 | 2026-09-16 | Refunds and manual-discount approvals come from the records |
| F8 no printers or tenders seeded | Gap | #20 | 2026-09-16 | Each selling branch gets printers and routes; MOBILE_POS, ONLINE and BANK_TRANSFER tenders are seeded |
| F10 cash-on-delivery never becomes a payment | Blocker | #22 | 2026-09-16 | COD is paid at the settlement handover; a courier shortage is the courier's debt, booked against the drawer, not the customer's |
| F13 Snappfood re-pricing and Toman/Rial | Gap | #23 | 2026-09-17 | Snappfood amounts ×10 into Rial and kept as billed (VAT, delivery, packing, discount); online-paid orders get an ONLINE payment, reversed on cancel; customer and address linked by phone. Showing Toman in the UI was dropped: the prototype stays in Rial |
| F2 no Jalali calendar | Blocker | #27 | 2026-09-17 | Jalali dates and pickers everywhere, week starting Saturday, on Tehran's clock; head office can switch the chain to Gregorian (Settings → Calendar). Also fixed: business dates and report days were UTC on the VPS, so 00:00–03:30 Tehran time landed on the previous day |
| F4 / F5 / F6 / F7 / F9 / F15 | Gap / minor | — | — | Not started |

The audit docs themselves were merged as #21.

## Scope gaps from Pass A

| Gap (Pass A area) | PR | Merged | What changed |
|---|---|---|---|
| Scheduled availability (3) | #24 | 2026-09-17 | Weekly selling windows per product or category, per branch or chain-wide; orders outside the window are refused and the POS greys the item out |
| Free-item promotions (6) | #25 | 2026-09-17 | `FREE_ITEM` coupon type ("buy 2 burgers, get a drink free"); campaigns stay cut, so it is a coupon, not an automatic promotion |
| Combo products (3) | #26 | 2026-09-17 | A product can be a combo whose option groups are its slots; choices can name a product (follows its availability) and carry an upcharge; every slot must be filled |
| Free-delivery promotions (6) | — | — | Not started |
| Per-product packaging charges (3), discount funding tracking (6) | — | — | Not started |

Known limits left in the merged work: printed kitchen tickets and receipts stay Jalali even when head office picks Gregorian (the guest bill follows the setting); order, payment and refund numbers still carry the UTC date; combo choices are not routed to their own kitchen stations.
