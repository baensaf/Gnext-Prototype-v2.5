# HAMI Replacement Audit — 2026-09-16

Can Gnext replace HAMI for Iran Burger? Audited against `Phase 1-- HAMI Replacement Scope_rev3.md`.

| Pass | What | Status |
|---|---|---|
| A | [Coverage sweep](PASS-A-COVERAGE.md) — all 22 scope areas mapped to routes, entities, pages | Done. Ends with 12 questions only the HAMI side can answer. |
| B | [Workflow walk](PASS-B-WORKFLOW-WALK.md) — 15 daily flows driven in the running app, findings F1–F15 | Done |
| C | HAMI delta — answers to the Pass A questions | Waiting on the product owner |
| D | Best-practice review | Cut |

## Fix tracker

| Finding | Severity | PR | State |
|---|---|---|---|
| F1 manual discount recorded but never deducted | Blocker | #15 | Open, CI green |
| F11 merging tables drops the merged bill | Blocker | #16 | Open, CI green |
| F12 kiosk: cash instead of card, not paid, never cooked | Blocker | #17 | Open, CI green |
| F3 unrouted print jobs fail silently | Blocker | #18 | Open, CI green |
| F14 reports hardcode refunds and discount approvals | Gap | #19 | Open, CI green |
| F8 no printers or tenders seeded | Gap | #20 | Open, CI green |
| F10 cash-on-delivery never becomes a payment | Blocker | #22 | Open. Decided: COD is paid at the settlement handover; a shortage is the courier's debt, booked against the drawer, not the customer's |
| F2 no Jalali calendar | Blocker | — | Not started; a project, not a fix |
| F13 Snappfood re-pricing and Toman/Rial | Gap | `fix/snappfood-toman-pricing` | Open. Snappfood's amounts ×10 into Rial, kept as billed; online-paid orders get an ONLINE payment, reversed on cancel; customer and address linked by phone. Showing Toman in the UI is a separate slice |
| F4 / F5 / F6 / F7 / F9 / F15 | Gap / minor | — | Not started |
