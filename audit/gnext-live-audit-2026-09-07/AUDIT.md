# Gnext v2 live daily-operations audit

Date: 2026-09-07  
Environment: `https://gnextdev.ir`  
Role: full administrator  
Primary viewport: Chrome, 2752 × 962 CSS pixels  
Audit mode: live workflow testing with demo/sample data; no source changes or database reset

## Executive result

Gnext v2 is usable for a guided prototype demonstration, but it is not yet stable enough for an unguided end-to-end daily-operations demo. The successful paths are broad: POS sale and payment, cashier shift close/open, courier check-in and dispatch, delivery settlement, kiosk checkout, order traceability, sales reporting, credit posting, and audit logging all executed.

The release blocker is cross-module state integrity. A held order loses its selected variant and changes price when resumed. KDS contains a multi-day backlog with extreme timers. A table release creates an immutable audit event but the floor map still shows the table occupied after a reload. A delivery reported as completed remains available for dispatch. These contradictions are visible to a reviewer and undermine confidence more than the remaining visual polish issues.

Recommended disposition: **remediate P1 findings before the developer showcase; keep P2 improvements for the next pass.**

## Workflow coverage

1. **POS product selection and pricing — Healthy before hold.** Selected `Cheeseburger Special`, changed it to Double Patty, and verified subtotal 220,000 IRR, tax 19,800 IRR, and total 239,800 IRR.
2. **Hold and resume — Failed.** The draft was stored as 150,000 IRR and resumed as the base product; variant label, 70,000 IRR uplift, and the original tax were lost.
3. **Order placement and cash payment — Healthy after the corrupted resume.** Order `ORD-20260907-0001` was placed and settled for 163,500 IRR, and the payment appeared in the active cash shift.
4. **KDS start and ready/exit — Partly healthy.** The new order moved from New to In Progress and then exited the active board. The board is operational, but 28 stale tickets from prior days remain and timers exceed 8,500 minutes.
5. **Cashier shift close/open — Healthy.** Reconciliation closed with zero variance and a fresh shift opened successfully.
6. **Dine-in table release — Failed state consistency.** The release action emitted `TABLE_RELEASED`, but T-01 remained occupied after waiting and a full route reload.
7. **Delivery assignment, dispatch, and completion — Healthy for the exercised order.** Courier attendance, assignment, dispatch, and completion all persisted for `ORD-20260901-0006`.
8. **Delivery board/report consistency — Failed.** `ORD-20260901-0005` was still unassigned on the dispatch board while the sales report identified it as `COMPLETED` and fully paid.
9. **Self-service kiosk — Healthy with content inconsistency.** A takeaway order completed and reached `READY`; the receipt calls itself a simulated card-terminal receipt while saying the payment was cash.
10. **Orders directory — Healthy.** The POS and kiosk orders were visible with totals and statuses after the page finished loading.
11. **Sales report — Healthy for exercised orders.** The POS, kiosk, and completed delivery records were present with matching totals.
12. **Customer credit — Healthy.** A 1,000 IRR repayment raised Nima Hosseini's balance from 3,000 to 4,000 IRR and updated aggregate totals.
13. **Audit log — Healthy but reveals contradictions.** Current-run kiosk, delivery, shift, language, and table-release events were traceable.
14. **Operational monitoring — Functional after a long blank load.** The page eventually reported API/database healthy, two terminals online, zero integration backlog, and two old alerts; it initially rendered as a blank white page for several seconds.
15. **English localization — Partial.** Navigation and most POS labels translated, but the primary PC-POS action remained Persian and catalog taxonomy/content stayed mixed-language.
16. **Keyboard accessibility spot check — At risk.** Keyboard focus traversed the entire sidebar before core POS controls, included an unlabeled button and focusable generic containers, and did not expose the product cards in the observed tab cycle.

## Findings

### P1 — Held orders destroy variant identity and price

The cart correctly contained `Cheeseburger Special (Double Patty)` at 239,800 IRR including tax. After Hold, the draft drawer showed 150,000 IRR. Resume restored the base product at 163,500 IRR including tax. The placed order and all downstream records therefore contained the wrong item configuration and total.

Impact: a cashier cannot trust held orders; pricing, kitchen preparation, receipts, and reports diverge from the original customer request.

Fix target: persist immutable line-level variant/modifier identifiers, names, unit-price deltas, tax basis, and computed totals in the held draft; add a round-trip regression test (`cart -> hold -> resume`) asserting exact equality.

![Held order total mismatch](screenshots/04-held-order-total-mismatch.png)

### P1 — Table release is audited but not reflected by operational state

The floor action on T-01 produced no success/error feedback. The audit log recorded `TABLE_RELEASED`, but T-01 remained occupied by `ORD-20260906-0004` after a later route reload, still showing two guests, 0 minutes, and 163,500 IRR.

Impact: staff can believe a table was released while seating availability remains blocked; the audit trail and source-of-truth state disagree.

Fix target: make the release transaction update order/table assignment atomically, return the authoritative table state, invalidate/refetch the floor query, and surface success or failure. Do not write a success audit event unless the state transition commits.

![Table remains occupied](screenshots/26-table-released-after-reload.png)

![Release audit event](screenshots/25-audit-table-release.png)

### P1 — Delivery board can dispatch an order already reported completed

The dispatch board offered `ORD-20260901-0005` as unassigned. The sales report simultaneously listed the same order as `COMPLETED`, paid 98,100 IRR, with zero outstanding.

Impact: a completed delivery can be assigned and delivered again; operational and financial views cannot both be trusted.

Fix target: define one delivery state machine and reconcile delivery-job status with order status. Exclude completed/cancelled orders from assignable jobs and add idempotent guards to assignment and dispatch APIs.

![Unassigned delivery backlog](screenshots/14-delivery-backlog.png)

![Report marks the same order completed](screenshots/23-report-delivery-status-conflict.png)

### P1 — KDS backlog is not demo-stable

KDS displayed 28 new tickets and one in-progress ticket from prior days. Visible timers exceeded 8,500 minutes, while the new current-run ticket was placed below the stale queue.

Impact: the current demo order is buried, SLA colors/timers are meaningless, and kitchen staff cannot identify today's actionable work.

Fix target: seed only a bounded current-day scenario; add business-date/station filters, stale-order cleanup/archive behavior, and ordering that prioritizes actionable live tickets. Provide a demo reset that clears operational queues without rebuilding the whole environment.

![Stale KDS backlog](screenshots/06-kds-stale-backlog.png)

### P2 — Kiosk payment wording contradicts itself

The success receipt is headed `SIMULATED CARD TERMINAL`, uses a `POS-KOS-*` terminal reference, and reports `Total Paid ... (Cash)`.

Impact: reviewers cannot tell which payment method the prototype is demonstrating.

Fix target: explicitly select a simulated payment method or label the whole step as generic simulated payment, then use the same instrument in the receipt, transaction, and report.

![Kiosk receipt wording conflict](screenshots/20-kiosk-payment-result.png)

### P2 — English mode is incomplete

English mode translated the shell and most POS labels, but the primary PC-POS button remained Persian. Mixed-language taxonomy and Persian catalog content may be intentional data, but system-authored operational labels should be consistently localized.

Impact: the English walkthrough looks unfinished and can reverse reading direction within the same task.

Fix target: inventory system-owned strings by route, localize all primary actions, and keep data-language fallback separate from UI-language translation.

![English POS with untranslated primary action](screenshots/33-pos-english-settled.png)

### P2 — Long blank states and delayed reconciliation reduce perceived stability

Orders, credit, reporting, monitoring, and several mutations initially showed stale data or an empty/blank state before settling. Successful courier actions also appeared unchanged for roughly one to three seconds.

Impact: a presenter can repeat an action, assume failure, or narrate an incorrect state.

Fix target: show skeletons/spinners in the content region, disable repeated submission while pending, show mutation success/error toasts, and refetch/invalidate immediately after success.

![Monitoring after delayed load](screenshots/28-operations-monitoring-still-blank.png)

### P2 — Keyboard navigation has avoidable barriers

The observed tab order begins with body/focus traps and an unlabeled button, traverses the long sidebar before the primary POS workflow, and includes generic `div` elements as focus targets. Product cards were not encountered in the observed tab cycle, despite being the core action.

Impact: keyboard and assistive-technology users may need excessive navigation or may be unable to add products.

Fix target: add a skip-to-content link, use semantic buttons for product cards and expandable navigation, remove non-interactive containers from the tab order, give every icon-only control an accessible name, and ensure a strong visible focus style.

## What worked well

- Tax calculation was correct in both POS and kiosk scenarios.
- The paid POS sale propagated to the cash drawer shift.
- Shift reconciliation and subsequent new-shift creation completed cleanly.
- Courier attendance, assignment, dispatch, completion, and settlement worked for the exercised delivery.
- POS and kiosk orders were visible in the order directory and sales report.
- Credit repayment updated both the customer row and aggregate totals.
- Audit events captured the current run with actor type and correlation IDs.
- Monitoring eventually showed the core API/database online and terminals connected.

## Remediation order

1. Fix held-order round-trip integrity and add automated equality tests.
2. Make table release transactional and reconcile table, order, and audit state.
3. Prevent completed/cancelled orders from appearing as assignable delivery jobs.
4. Add a deterministic demo reset/seed for KDS, tables, delivery, shifts, and alerts.
5. Add consistent pending/success/error UI states after every mutation.
6. Clean up kiosk payment semantics and English localization.
7. Improve keyboard semantics and focus order.

## Evidence limits

- This was a live, black-box audit of currently visible features, not a source-code, API-contract, security, load, or database audit.
- Login and permission matrices were intentionally out of scope; testing used one full-admin account.
- Payment, hardware, courier, and integration behavior was evaluated as prototype/simulated behavior, not against real devices or providers.
- Desktop Persian received the deepest coverage. English received a representative POS pass. Mobile viewport emulation was not available in the selected authenticated browser, so responsive/mobile layout is not certified by this run.
- Accessibility findings are a keyboard/semantic spot check, not a WCAG conformance audit with screen readers or automated tooling.
