# Pass A — Coverage Sweep (code presence)

Date: 2026-09-16 · Yardstick: `Phase 1-- HAMI Replacement Scope_rev3.md` (22 areas)

**What this is:** every scope area mapped to real backend routes, entities and pages
in the current `main`. Verdicts are about *code existing and wired*, not about the
flow working end to end — that is Pass B. Supersedes `TRACEABILITY_MATRIX.md`
(last updated 19 Aug, before shifts, incoming orders, shared couriers and Moadian).

Legend: **Built** = implemented and wired · **Partial** = core present, named
sub-features absent · **Simulated** = works against an in-repo fake, not a real
external system · **Missing** = no implementation.

---

## Summary

| # | Area | Verdict |
|---|---|---|
| 1 | Organization and Branch Management | Built |
| 2 | Users and Advanced Permissions | **Partial** |
| 3 | Catalog and Menu | **Partial** |
| 4 | Pricing | Built |
| 5 | Customer Management | Built |
| 6 | Customer Club and Discounts | **Partial** |
| 7 | Customer Credit | Built |
| 8 | Order Management | Built |
| 9 | Dine-In | Built |
| 10 | Cashier and POS | **Partial** |
| 11 | Payments | Built |
| 12 | Printers and Print Routing | Built |
| 13 | KDS | Built |
| 14 | Delivery and Couriers | Built |
| 15 | Snappfood Integration | **Simulated** |
| 16 | Tara Pay Integration | **Simulated** |
| 17 | Local Branch Agent (Rust) | **Missing** |
| 18 | Cloud–Branch Synchronization | **Simulated** |
| 19 | Kiosk | Built |
| 20 | Reports | Built |
| 21 | Audit and Operational Monitoring | Built |
| 22 | Centralized Tenant Settings and Localization | **Partial** |

105 entities · 28 backend modules · 66 page components · 24 report codes · 49 backend spec files.

---

## Area detail

### 1. Organization and Branch Management — Built
`tenant.controller.ts` — `/tenant`, `/branches` CRUD, `/branches/:id/operating-hours`,
`/branches/:id/status`, `/terminals` CRUD. Entities `Branch`, `BranchOperatingHour`,
`BranchStatusSnapshot`, `Terminal`. Pages `operations/branches`, `branch-detail`,
`terminals`, `fleet-rollup`, `monitoring`.
Heartbeat / online-offline / last-sync exist as `BranchStatusSnapshot` plus the monitoring page.
*Gap:* "branch agent version and health" is snapshot data only — no real agent reports it (see 17).

### 2. Users and Advanced Permissions — Partial
`users.controller.ts` — list / create / patch only. Roles are a **fixed 6-value enum**
(`SUPER_ADMIN, ADMIN, OWNER, MANAGER, SUPERVISOR, CASHIER` in
`common/utils/user-scope.util.ts`), not editable role records with permission flags.
Approvals: `ApprovalRule` + `ApprovalRequest` + `ApprovalDecision` + `PinAttemptLog`,
PIN hashed and rate-limited, `/approvals/evaluate` and request / approve / reject endpoints,
pages `settings/roles`, `settings/approvals`, `settings/discount-authorizations`.

*Gaps vs scope:*
- No per-user permission toggles — discount / refund / order-edit / reprint / shift-closing
  are governed by role plus approval rules, not by individual grants.
- `ApprovalRule` conditions are `action + threshold_type + threshold_value` only —
  **no branch and no order-state condition**, both of which the scope requires.
- `approver_role` is a single varchar, so approvers **cannot** be specific users,
  departments or teams; `required_steps` caps at 2.
- Per-user credit approval limits are not modelled.

### 3. Catalog and Menu — Partial
`catalog.controller.ts` covers categories, products, variants, option groups (min/max),
price groups, menus, availability suspend / resume. Import/export via the `import-export`
module and `tools/import-wizard`. Aggregator mapping via the Snappfood catalog-sync simulator.

*Gaps vs scope:*
- **Combo products** — no entity, no endpoint (only a string mention in the importer and simulator).
  *Closed by #26 (2026-09-17).*
- **Scheduled availability** — `ProductAvailability` supports branch, channel and
  `suspended_until`, but there is no recurring schedule (e.g. breakfast 07:00–11:00 daily).
  *Closed by #24 (2026-09-17).*
- Packaging charges exist on the order, not as per-product configuration.
- Product-level / non-stackable discount configuration: see area 6.

### 4. Pricing — Built
`PriceEntry`, `PriceGroup`, `PriceGroupBranch`, `PriceGroupItem`, `PriceBulkJob`;
`/price-groups`, `/catalog/prices/bulk-update`, `/products/:id/effective-price`.
Page `catalog/pricing`. Effective dates, channel prices and branch prices all present.

### 5. Customer Management — Built
`customer.controller.ts` plus 12 supporting entities (`CustomerPhone`, `CustomerAddress`,
`CustomerTag`, `CustomerSegment`, `CustomFieldDefinition`, `CustomerConsent`,
`CustomerMerge`). Dedupe (`/customers/duplicates`) and merge endpoints present.
Bulk import through the import wizard. Page `customers/directory`.
*Note:* "multi-million" scale is untested — carried into Pass B as an open item.

### 6. Customer Club and Discounts — Partial
`discounts.controller.ts` — coupons, `/coupons/validate`, `/discount-quotes`,
customer discounts CRUD, one-time coupons. `discount-evaluation.service.ts` handles
stacking, priority and exclusions. Settings groups `DISCOUNTS` and `DISCOUNT_AUTHORIZATIONS`
carry the cashier max-percentage and max-fixed-deduction limits, tied to PIN escalation.
Pages `discounts/hub`, `discounts/coupons`, `customer-club/customer-discounts`,
`customer-club/wallet-cashback`.

*Gaps vs scope:*
- **Discount campaigns were deliberately cut** — coupons carry their own terms instead.
- **Free-item and free-delivery promotions** — no implementation found.
  *Free-item closed by #25 (2026-09-17) as a coupon type; free delivery still open.*
- Discount funding / source tracking is not modelled.

### 7. Customer Credit — Built
`credit.controller.ts` — accounts, limits, suspend / activate, statement, repayments,
manual adjustments, `/credit-aging`. Reports `credit-aging`, `credit-eod-usage`,
`customer-credit`. Page `customers/credit`.

### 8. Order Management — Built
`order.controller.ts` is the largest surface: create, quote, submit, confirm,
start-preparation, mark-ready, dispatch, complete, edit, replace-item, cancel, reopen,
split, transfer-items, accept / reject (aggregator intake), history, guest-bill, receipt.
The `order-lifecycle` module plus the `settings/order-workflow` page make allowed actions
per state tenant-configurable. `IdempotencyRecord` for duplicate protection. `ReasonCode`
entity plus `settings/reasons`. Edit / cancel time windows in `order-edit-policy.spec.ts`.
Post-payment cancellation routes through `/orders/:orderId/cancel-paid` — a refund, not a delete.

### 9. Dine-In — Built
`dine-in.controller.ts` — sections, tables, floor, seat / release, move-table, merge.
Split and transfer-items live on the order controller. Guest bill endpoint present.
Entities `DiningArea`, `DiningTable`, `TableSession`, `TableOccupancyEvent`.
Page `operations/dine-in`.

### 10. Cashier and POS — Partial
`shifts.controller.ts` — open, movements, begin-close, return-to-open, close, statement,
policy; `business-days.controller.ts` — close / reopen. Blind close plus approver PIN,
per-terminal shifts, device-bound terminal, variance tolerance in `SHIFT_POLICY`.
POS at `pages/pos/order.tsx` with a receipt page. Discount and deduction limits enforced
with PIN escalation.

*Gap vs scope:*
- **Offline order creation and local transaction storage at the POS are absent.** No offline
  handling exists in the POS page; the `offline-sync` module is a server-side simulator, not
  a till that keeps selling when the network drops. This is the single biggest divergence
  from a HAMI-class on-premise cash register.

### 11. Payments — Built
`payment.controller.ts` — create, process, void, reverse, correct; plus `payment-devices`
and `settlement-accounts`. Entities `Payment`, `PaymentAllocation`, `PaymentAttempt`,
`PaymentDevice`, `PaymentMethod`, `SettlementAccount`. Refunds in `refund.controller.ts`
including `/refunds/:id/reverse` and alternative refund methods (report `alternative-refunds`).
Mobile POS classified separately (report `mobile-pos`); mixed payments (report `mixed-payments`).
Pages `operations/payments`, `settings/payments`.

### 12. Printers and Print Routing — Built
`printers.controller.ts` — printers, printer groups, print routes, print jobs, retry,
reprint, `/orders/:id/reprint`. Entities `PrintJob`, `PrintAttempt`, `PrintRoute`,
`PrinterGroup`. Failure simulation at `/simulation/printers/outcome`.
Pages `operations/printers`, `print-queue`. Report `print-operations`.
*Note:* printing is simulated end to end — there is no physical ESC/POS driver.

### 13. KDS — Built
`kds.controller.ts` — board, tickets, start / bump / recall / priority, item state,
stations, screens, routing rules. Entities `KdsScreen`, `KitchenStation`,
`KdsRoutingRule`, `KitchenTicket`, `KitchenTicketItem`, `KdsEvent`.
Pages `operations/kds`, `kds-configuration`.

### 14. Delivery and Couriers — Built
`delivery.controller.ts` — zones, couriers, attendance, availability, terminal assignment,
board, assign / depart / complete / fail / requeue, events.
`courier-settlements.controller.ts` — preview, create, review, return, close, reverse,
statement. Cash and mobile-POS receipts settle separately (`CourierTerminalAssignment`,
`CourierSettlementLine`). Couriers are chain-wide records moved between branches.
Reports `courier-attendance`, `courier-settlements`, `courier-reconciliation`.

### 15. Snappfood Integration — Simulated
The full vendor-API surface is reproduced inside `simulation.controller.ts` (ack, pick,
accept, reject, decline-reason, latest, category / product / topping / menu sync, image
upload, vendor status, deliveries) plus a per-branch webhook at
`/simulated-webhooks/snappfood/:branchCode` with HMAC. `IntegrationLog`, duplicate
detection, report `snappfood-reconciliation`.
*Gap:* it talks to our own fake. No live-credential connection has been made, and the
known live-connection gaps are on record from the 2026-09-13 check against spec 4.3.0.

### 16. Tara Pay Integration — Simulated
`/simulation/tara/transactions` and `/simulation/tara/command` only. No real credential
flow, settlement or reconciliation against Tara.

### 17. Local Branch Agent (Rust) — Missing
No Cargo project anywhere in the repo. There is no local service, no local database,
no durable on-premise queue, no automatic startup and no remote update channel.
Everything runs cloud-side. Consequence: **a branch cannot operate during an internet
outage**, which is the core promise of this scope area.

### 18. Cloud–Branch Synchronization — Simulated
`offline-sync.controller.ts` — status, toggle-connectivity, queue, trigger, retry,
retry-dlq, conflicts, resolve-conflict. Entities `OfflineQueueItem`, `OutboxEvent`,
`SyncConflictRecord`, `SyncCategoryLog`. Page `simulation/offline-sync`.
The queue, DLQ, idempotency and conflict-resolution *logic* is real and tested
(`r23-offline-sync-postgres.spec.ts`); what is simulated is the far end — there is no
branch node to sync with (see 17).

### 19. Kiosk — Built
`kiosk.controller.ts` — bootstrap, orders, pay. `KioskSession` entity.
Identification policy configurable via `KIOSK_CUSTOMER_IDENTITY_POLICY`.
Page `pos/kiosk`.

### 20. Reports — Built
24 report codes, all DataGrid-driven, with `/reports/query`, `/reports/export`,
`/reports/saved-views` and per-report export jobs. Codes cover sales-summary,
product-sales, payments-by-method, mixed-payments, mobile-pos, alternative-refunds,
discounts, manual-discounts, cashier-shifts, cash-discrepancies, customer-credit,
credit-aging, credit-eod-usage, customer-activity, aggregator-orders,
snappfood-reconciliation, courier-attendance, courier-settlements, courier-reconciliation,
tax-packaging, branch-comparison, print-operations, integration-operations.
Branch scoping is enforced (`report-branch-scope.spec.ts`).

### 21. Audit and Operational Monitoring — Built
`AuditEvent`, `OperationalAlert`, `PinAttemptLog`, `OrderStateEvent`, `DeliveryEvent`,
`TableOccupancyEvent`, `KdsEvent`, `IntegrationLog`, `PrintAttempt`.
`/reports/audit`, `/reports/alerts`, `/reports/alerts/:id/acknowledge`.
Pages `operations/audit-explorer`, `monitoring`.
*Gap:* alerting exists as in-app records only; there is no outbound notification channel
(SMS, email or push).

### 22. Centralized Tenant Settings and Localization — Partial
`settings.controller.ts` — settings by group, scoped settings, branch override clear,
currencies CRUD, payment methods CRUD, reason codes CRUD. Groups include `GENERAL`,
`DISCOUNTS`, `DISCOUNT_AUTHORIZATIONS`, `ORDER_ACTIONS`, `SHIFT_POLICY`, `FINANCIAL`,
`KIOSK_CUSTOMER_IDENTITY_POLICY`. `localization.controller.ts` — strings, bilingual map,
translation export / import. `currency_code` is recorded on orders and payments.
Pages: `settings/hub` plus ten settings pages.

*Gaps vs scope:*
- The scope says **"no branch-level overrides in Phase 1"**, but `settings/branch-overrides`
  and `/settings/:group/override` exist — the build went beyond the written scope here.
  Worth confirming this is wanted rather than accidental.
- Approval-workflow configurability is limited by the `ApprovalRule` shape (see area 2).
- Localized calendar and first-day-of-week: Jalali handling needs Pass B confirmation.

---

## Questions for you (the HAMI side)

These decide whether a gap above is a blocker or a non-issue for Iran Burger.

1. **Offline till (10, 17).** When Iran Burger's internet drops, does their HAMI till keep
   taking and printing orders? How often does that actually happen at their branches?
2. **Combo products (3).** Do they sell combos or meal deals as a single priced item on HAMI?
3. **Scheduled availability (3).** Any time-of-day menus (breakfast) or day-of-week items?
4. **Campaigns vs coupons (6).** Does HAMI run timed discount campaigns they rely on, or is
   per-coupon plus per-customer discounting enough?
5. **Free item / free delivery (6).** Do they run "buy 2 get 1" or free-delivery promotions?
6. **Permissions granularity (2).** On HAMI, are permissions set per user or per role? Do they
   ever need an approver to be a *named person* rather than "any supervisor"?
7. **Approval conditions (2).** Do their rules ever depend on the branch or on the order's
   state, or only on amount and percentage?
8. **Tara Pay (16).** Is Tara actually in use at Iran Burger today, or aspirational?
9. **Snappfood (15).** Are live credentials available for a real connection test?
10. **Branch overrides (22).** Should branches be able to override tenant settings, or should
    that be locked down as the scope says?
11. **Alerting (21).** Does HAMI send them SMS or notifications on anything they depend on?
12. **Scale (5).** Roughly how many customer records are in their HAMI database?
