# Gnext Prototype v2 — Functional Audit and Stabilization Report

## Decision

The prototype is ready for a fresh VPS demo deployment after the deployment operator supplies VPS access and runtime secrets. The repaired build is not production software, but its primary restaurant workflows now operate coherently with deterministic sample data and pass the complete automated regression suite.

The remaining issues are presentation, localization, loading latency, bundle size, and dependency-maintenance debt. They should be addressed in a later enhancement pass; none blocks a controlled stakeholder demo.

## Scope and priorities

- Audience: broad stakeholder validation before the development team receives the delivery target.
- Priority: functional correctness and demo stability.
- Authentication: intentionally low priority.
- External services and physical hardware: simulated surfaces are acceptable when clearly identified.
- Data: disposable sample data; no migration or customer-data preservation is required.

## Verification baseline

| Gate | Result |
|---|---|
| Clean database initialization | Passed: new database, all 44 migrations, deterministic seed |
| Backend TypeScript build | Passed |
| Backend automated tests | Passed: 34 suites, 233 tests |
| Frontend production build | Passed: 2,544 modules transformed |
| Modified frontend-file lint | Passed |
| English/Persian key parity | Passed: 2,081 keys in each locale |
| Production Compose parse | Passed with required secrets supplied |

The final regression database was `gnext_regression_20260831_2`. It was created from an empty PostgreSQL database and was not copied from the interactive audit database.

## Browser-validated feature coverage

| Lane | Validated behavior | Outcome |
|---|---|---|
| Branch and terminal context | Authenticated branch selection reaches POS and operational pages | Passed |
| Catalog and pricing | Seeded products, category, 9% product tax, price book, and override controls render | Passed |
| POS and orders | Variant selection, hold, resume, draft update, submit, exact-cash payment, visible error state | Passed after repair |
| Tax correctness | POS quote uses the persisted product rate; 150,000 IRR produces 13,500 IRR tax and 163,500 IRR total | Passed after repair |
| Dine-in | Seeded hall and tables render; a POS order linked to T-01 changes occupancy and shows the order | Passed after repair |
| KDS | Submitted orders appear; Start and Ready state transitions work | Passed |
| Cashier | Shift opens with a sample float and is reflected in operations | Passed |
| Customers and credit | Three seeded customers, wallet/credit ledger, 10,000,000 IRR aggregate limit, and 350,000 IRR aging balance render | Passed after repair |
| Delivery and fleet | Courier check-in, delivery POS order, dispatch, assignment, departure, collection, completion, and courier compensation | Passed after repair |
| Kiosk | Order type, menu, customization, cart, simulated card payment, and receipt | Passed |
| Reports | Sales summary includes created orders, payment, outstanding values, and summary totals | Passed |
| Audit and monitoring | Audit events populate with real timestamps; operational alerts and terminal health render | Passed after repair |
| Simulation center | Snappfood, hardware, offline-sync, and integration-log modules are discoverable and clearly presented as simulations | Passed for demo surface |
| Reset and repeatability | Reset skips retired schema tables; a fresh database can migrate and seed cleanly | Passed after repair |

## Stability defects repaired

### P0 — Reset referenced tables removed by migration 39

`ImportExportService.systemReset` attempted unconditional deletion from retired tables. It now checks the live schema, clears only existing operational tables, and reports the tables actually cleared.

### P0 — Held POS draft update violated the non-null order-item foreign key

Saving an order aggregate after deleting its loaded children caused TypeORM to set stale child `order_id` values to `NULL`. The order header is now persisted before item replacement, and the regression test verifies save-before-delete ordering.

### P0 — POS tax display and submitted total disagreed

The POS displayed a hard-coded 10% estimate while the backend stored a different total. The frontend now renders the backend quote, and the quote engine calculates tax from the product's persisted rate after discounts. A dedicated regression test covers 9% tax.

### P1 — Dine-in orders were not connected to actual tables

The POS stored only the display table number. It now carries the selected table ID in create/update/resume payloads. The seed provides a dining area and tables T-01 through T-08.

### P1 — Seed lacked cross-module demonstration data

The deterministic seed now includes a dining area, eight tables, one courier, a VIP group, three customers, addresses, credit accounts, and a genuine outstanding-credit entry. All sample records remain idempotent.

### P1 — Audit timestamps rendered as `Invalid Date`

The audit API returns `occurred_at`; the page requested `created_at`. The grid now uses the actual event field, and the inspector falls back to structured event details when before/after snapshots are absent.

### P1 — Credit transaction action was clipped

The transaction form now wraps responsively and retains a visible action button in the 1,280 × 720 audit viewport.

### P1 — Branch bootstrap ran before authentication and did not recover

Branch loading is now tied to authenticated state and clears predictably on logout.

### P1 — Certification test bypassed the customer service

The credit workflow test now creates a customer through `CustomerService`, matching the application path, and uses balances that genuinely produce an aging entry.

## Remaining non-blocking issues

1. Persian locale still contains substantial English operational copy and English sample names. The locale files have exact key parity, but a previous heuristic found roughly 257 potentially hard-coded strings.
2. Dense four-column boards and wide data grids need a dedicated RTL/responsive polish pass; the delivery board and audit grid are usable but visually cramped at 1,280 px.
3. Some list views display their empty/loading state for several seconds. Delivery actions can remain visually stale until the next five-second poll or manual refresh even though the backend transaction succeeded.
4. The production frontend bundle is large: approximately 2.81 MB JavaScript, 809 KB gzip. Route-level code splitting is recommended before treating performance as a product requirement.
5. The repository-wide legacy frontend lint baseline remains 38 errors and 23 warnings; all files modified during this stabilization pass lint clean.
6. The earlier dependency audit reported 14 backend findings (11 moderate, 3 high). These should be triaged before any non-prototype exposure.
7. Demo reset remains destructive by design. It is appropriate for this disposable prototype but must never be reused as a real-customer maintenance operation.

## Deployment readiness

`docker-compose.prod.yml` now keeps PostgreSQL and the backend API private, requires database/admin secrets, exposes the frontend on port 80, and includes container health checks. Nginx proxies a public `/health/ready` origin check. See `DEPLOYMENT_HANDOFF.md` for the fresh-deploy and verification commands.

The deployed VPS should expose only HTTP port 80 to the Arvan origin plus the operator's SSH port. Arvan may continue to own public TLS and CDN behavior.

## Evidence

Captured evidence is stored in `audit/gnext-functional-audit-2026-08-31/screenshots/`. Viewport captures are authoritative; full-page RTL captures from the audit browser showed a capture-only horizontal offset and were not used to claim application-wide overflow.
