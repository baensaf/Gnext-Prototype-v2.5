# Gnext Prototype v1.5 — Build Specification

**Status:** Implementation-ready baseline  
**Source of truth:** *Phase 1 — HAMI Replacement Scope, revision 3*  
**Target:** Customer-validation prototype; not production software  
**Required stack:** NestJS, React + TypeScript, MUI/MUI X, PostgreSQL, TypeORM, REST  
**Deployment shape:** one backend, one frontend, one PostgreSQL database; modular monolith  
**Locales:** English (`en`) and Persian (`fa`), with complete LTR/RTL behavior

This specification is normative. “Must” is a requirement; “may” is an explicitly optional implementation choice. When prose and an API/schema rule appear to conflict, the more specific API/schema rule wins. Amounts are decimal monetary amounts in the order currency; quantities are decimal only where explicitly allowed.

---

## 1. Prototype objectives

### 1.1 Questions to validate

The prototype must let restaurant operators determine whether Gnext can replace the operational parts of HAMI for the following questions:

1. Can an administrator configure branches, catalogs, menus, effective prices, operational policies, payment methods, tables, kitchen stations, delivery zones, couriers, and localized text without developer assistance?
2. Can a cashier open a shift and complete dine-in, pickup, delivery, kiosk-origin, and aggregator-origin orders with modifiers, discounts, customer credit, mixed/partial payments, corrections, cancellations, and refunds?
3. Do approval prompts, immutable financial history, reason capture, and audit history provide enough operational control despite simplified prototype permissions?
4. Can kitchen, dine-in, delivery, courier settlement, and cashier-closing workflows be followed end to end using realistic persisted data?
5. Are reports detailed enough to reconcile sales, payments, shifts, discounts, credit, aggregator orders, taxes, packaging, couriers, and alternative refunds?
6. Are Persian content, Persian entry, RTL layout, English content, LTR layout, locale-aware dates/numbers/currency, and tenant time-zone behavior usable throughout?
7. Do the simulators make failure, retry, duplicate, offline, sync-conflict, printer, terminal, Tara Pay, Snappfood, kiosk, and local-agent behavior understandable enough to validate future production requirements?

### 1.2 What must feel realistic

- Every item listed as fully functional uses PostgreSQL persistence through real backend APIs. Refreshing or restarting the application must not lose it.
- Order totals are computed by the backend from versioned price, tax, packaging, modifier, discount, and delivery snapshots. The frontend never submits authoritative totals.
- Payments, refunds, credit entries, cashier movements, and courier settlements are transactionally posted and retain immutable historical links.
- State transitions, approval requirements, time windows, reason codes, idempotency, and duplicate protection are enforced server-side.
- All lists expected to grow use server-side pagination, filtering, and stable sorting. MUI X Data Grid is used for administrative and report grids.
- Simulator actions create real orders, logs, queue records, and state transitions, but no external device or service is contacted.
- All significant actions are visible in audit history with actor, branch, time, entity, before/after or structured detail, and correlation ID.

### 1.3 Intentional simplifications

- One seeded tenant and one shared full-access administrator account exist. There is no user-management or tenant-management interface.
- A lightweight signed session is used. There is no Keycloak, SSO, advanced RBAC, production password lifecycle, or real PIN approver identity. Approval simulation uses named approver profiles and a fixed demonstration PIN.
- Tenant-configurable workflows are represented by safe configuration records, but the prototype ships one supported lifecycle per domain; configuration may enable/disable allowed actions and edit/cancel windows, not invent arbitrary states.
- One order has one currency; cross-currency payment, conversion, and exchange-rate accounting are deferred. Multiple currencies can be configured and used on different orders.
- Imports are validated CSV jobs suitable for thousands of rows, not a production multi-million-customer ingestion pipeline. Exports are streamed CSV; `.xlsx` export is limited to reports.
- Images are stored on the backend filesystem with database metadata. Object storage, CDN, and image transformation are deferred.
- Notifications are in-app operational alerts only. Email, SMS, push, and external alerting are excluded.
- “Business-day closing” is a persisted review/close operation after all branch shifts are closed; there is no accounting-ledger posting.

### 1.4 Simulated behavior

Snappfood, Tara Pay, network/mobile POS terminals, printers, kiosk hardware, the Rust local agent, offline branch operation, cloud–branch synchronization, and related failure/retry/conflict behavior are implemented behind in-process mock adapters. Every simulator screen, log, toast, status chip, and generated record must display a **SIMULATED** badge. Simulation records are real PostgreSQL records, while the external interaction is fake.

### 1.5 Exclusions

Production security hardening, real external credentials, real hardware or aggregator connectivity, Kubernetes, microservices, high availability, production observability, a production offline engine, a Rust service, automatic remote agent updates, true tenant isolation/administration, advanced permissions, accounting integration, payroll, inventory, procurement, reservation management, and production-scale performance are outside this prototype.

---

## 2. Final scope classification

Classification meanings:

- **Fully functional (F):** persisted, end-to-end, and enforced by the backend.
- **Simplified (S):** functional and persisted, with the stated prototype reduction.
- **Simulated (M):** realistic adapter, UI, logs, test actions, queues, and outcomes; no external system/device.
- **Excluded (X):** intentionally absent from the prototype.
- **Deferred to production (D):** represented in design or data where useful, but production capability is not built.

Every Phase 1 feature is included below. A comma-separated list within a cell preserves each named source feature; the decision column applies to all listed features unless a parenthetical exception says otherwise.

Source terminology is preserved semantically as follows: **shortage/overage** is the signed `short_over`/discrepancy amount; **duplicate detection** is the webhook/idempotency dedupe rule; **conflict handling** is the explicit sync-conflict workflow; **failure handling** is the attempt/retry/dead-letter behavior; **cancellation handling** uses the order/refund state machines; and kiosk **menu browsing** uses the same effective menu/catalog query as POS.

| Source area | Phase 1 features | Class | Prototype decision |
|---|---|---:|---|
| Organization | Tenant/company | S | One seeded tenant; editable profile/settings, no tenant CRUD or switching. |
| Organization | Branches; branch configuration; branch-specific menus; branch-specific prices; price groups; branch operating hours | F | Full CRUD/configuration and effective-dated relationships. |
| Organization | Branch heartbeat; online/offline status; last successful sync; branch agent version and health | M | Controlled by simulator and shown in operations dashboard. |
| Users/permissions | User management; roles and permissions; branch-scoped access; POS/cashier permissions; manager approvals; discount permission; maximum percentage/fixed deduction; refund/cancellation; edit; reprint; credit limits; shift-closing permission | S | One login has all permissions; persisted policy thresholds and named simulated approver profiles demonstrate enforcement. User/role CRUD is X; full RBAC is D. |
| Users/permissions | Audit logs | F | Append-only audit records and history UI. |
| PIN approvals | Tenant-level escalation rules; specific user/role/department/team approvers; one/multi-step flows; rules by action/amount/discount/branch/order state; limit-triggered escalation; approver PIN approve/reject; hashed/rate-limited/hidden PIN; detailed audit; all listed approval action types; centralized settings | S | Rules, steps, requests, approve/reject, rate limiting, and audit are persisted. Approvers are prototype profiles, all using seeded PIN `2468` stored as Argon2 hash. Roles/departments/teams are labels, not RBAC principals. Multi-step execution is functional. |
| Catalog | Categories; products; variants; modifier groups; min/max; combo products; packaging charges; tax configuration; images; descriptions; branch availability; channel availability; schedules; temporary suspension; discount eligibility/exclusion; product discount; non-stackable product discount | F | Functional CRUD and price/order enforcement. Combos use fixed component selections; no inventory deduction. |
| Catalog | Import/export | S | Validated CSV import/export with job result and row errors; no Excel catalog import. |
| Catalog | Aggregator product/category mapping | M | Persisted mappings used by Snappfood simulator. |
| Pricing | Base, branch, price-group, channel, delivery, packaging, modifier prices; effective dates; bulk updates; audit history | F | Effective-dated decimal prices, collision validation, and price snapshots. |
| Customers | Customer profiles; multiple phones; addresses; custom fields; tags/segments; deduplication; merge conflicts; bulk updates; history; branch/brand relationships; privacy/consent | F | Searchable, mergeable, auditable persisted model. Brand relationship is the single tenant; branch relation is “home branch.” |
| Customers | Multi-million database; high-volume import; mapping imported records | S | Indexed server paging and CSV mapping/import job; validated at prototype-scale, not load-tested for millions. |
| Customer club | Campaigns; percentage/fixed/manual discounts; product/category/customer/branch discounts; coupons; periods; limits; priority; conflicts; stacking; cashier limits; exclusions; never-discount; own non-stackable discount; configurable non-stackable; free item; free delivery; funding/source; escalation | F | Deterministic discount engine and approval requests. Free item uses an explicit reward product/quantity. |
| Customer credit | Accounts; simplified mode; eligibility; finite/unlimited limits; available balance; purchases; repayments; adjustments; approval; override; statement; aging; suspension; audit; EOD use; accounting handover; reporting dimensions | F | Real subledger. Aging is based on unpaid debit entries; no general-ledger export. |
| Orders | Dine-in; delivery; pickup; aggregator; kiosk; draft/open; modifiers; all notes; aggregator notes; customer/table; edit; replacement; cancellation; refund; reopen; reprint; history; reasons; approvals; idempotency/duplicates; allowed actions/state; cancellation stages; edit/cancel windows; escalation after window; paid cancellation through refund; complete history | F | One fixed state set with tenant-configurable action flags/windows. Kiosk/aggregator origins enter through simulators. Reopen is limited to submitted/unpaid orders; closed paid orders require refund, never reopen. |
| Orders | Tenant-configurable order lifecycle | S | Labels/action matrix configurable; adding/removing states at runtime is D. |
| Dine-in | Tables; floors/sections; status; guest count; move; merge; split orders; transfer items; guest bill; settle separately/together | F | Merge preserves source history and moves items; split creates linked child order(s). Printing is simulated. |
| Cashier/POS | Touch POS; multiple terminals; login; shifts; opening cash; cash drawer; closing; expected/actual; discrepancy; approver; business-day close; statement; coupons/manual discounts/limits; approval; edit/cancel windows | F | Multiple configured terminals may be selected, while the one shared account acts as cashier. Cash movements are persisted. |
| Cashier/POS | Offline creation; local transaction storage | M | Simulation center creates queued offline operation envelopes and later syncs them. Browser POS itself remains online. |
| Payments | Cash; customer credit; bank transfer; split/mixed/partial; allocations; correction; refund partial/full; reversal; original/alternative refund; cash/bank alternative; approvals; mandatory reason/reference; references; receipt; failed retry; audit; immutable links; paid/refunded/outstanding; reconciliation | F | External instruments use simulator adapter. “Payment correction” is reversal plus replacement, never mutation. |
| Payments | Network POS; mobile POS; online payment | M | Real payment records are posted only after simulated adapter result. |
| Payments | Terminal/device, ownership, settlement account; mobile POS classified as card; company-account reconciliation; reported apart from courier cash | F | Persisted device/instrument metadata and report dimensions. |
| Printers | Network/receipt/kitchen printers; groups; routing; branch/category/product/station; copies; customer/kitchen/courier documents; reprint; queue; retry; failure; fallback; history | M | Configuration, queue, rendered preview, retry/fallback, and history are real; no printer connection. |
| KDS | Screens; stations; routing; new/in-progress/ready; timers; bump/recall; priority; aggregator marker | F | Functional KDS board and ticket/item routing. |
| KDS | Offline operation | M | Offline/stale/reconnect UI and sync envelope simulator only. |
| Delivery | Workflow; zones/fees; courier profiles; attendance; today/shift availability; assignment; statuses; cash collection; company mobile terminal assignment; POS receipt verification; separate cash/POS settlement; compensation; discrepancies; batches/statements; adjustments/reversals; expected/actual instrument totals; reasons; audit | F | Compensation is a manually configured per-delivery flat amount snapshotted into settlement. |
| Snappfood | Branch credentials; branch outage independence; webhook endpoint; HMAC; processing; ack/pick/accept/reject; reasons; recovery; duplicates; modifications; notes; additional payment; cancellation; mapping; catalog/modifier/image sync; price/capacity; suspension; vendor; zones; express courier; retry/reconciliation | M | Mock credentials and HMAC test endpoint; every flow is generated locally with realistic payloads/logs. No Snappfood network calls. |
| Tara Pay | Authentication/credentials; validation; transaction; confirmation; reversal; refund; settlement; reconciliation; failure; audit | M | Adapter scenarios produce payment/credit records, logs, and retry states without external calls. |
| Local agent | Rust service; local DB; autonomous branch; external connectivity; local API; durable queues; offline writes; retry; conflicts; encrypted credentials; startup; remote updates; health; cloud sync | M | In-process simulator and PostgreSQL queue only. Rust binary, local DB, startup, encryption, and remote update implementation are X/D. |
| Cloud–branch sync | Incremental menu/price/customer/order/payment/refund/approval/config/courier sync; event queue; retry/DLQ; idempotency; conflict resolution; last sync; manual resync; logs | M | Versioned sync envelopes, conflict records, manual resolution, retries, DLQ, and logs in Simulation Center. No second database. |
| Kiosk | Web kiosk; browse; modifiers; cart; dine-in/takeaway; required/optional identification; guest checkout | F | Dedicated responsive route sharing order engine and backend APIs. |
| Kiosk | Network POS; printing; local-agent connection; offline-safe behavior | M | Adapter outcomes and visible states only. |
| Reports | DataGrid; branch/consolidated; sales; product/category; payment/mixed/mobile terminal/alternative refund; discounts/manual/exclusions/stacking; shifts/discrepancy; credit/EOD/customer; aggregator/notes/reconciliation; courier attendance/settlement/cash/POS; tax/packaging | F | Server queries with CSV and `.xlsx` export. |
| Reports | Saved filters and column layouts | S | Saved per shared account in database; no sharing/permissions. |
| Monitoring | User activity; order/payment history; discount/credit/refund/cancellation/alternative refund; multi-step approval; PIN/rate limit; courier attendance/settlement; mobile receipt; printer/integration logs; heartbeat; sync failures; offline duration | F/M | Domain histories are F. Hardware, integration, heartbeat, sync, and offline records are M. |
| Monitoring | Alerting and notifications | S | In-app alerts generated from simulator/domain failures; no external channel. |
| Settings | Centralized engine; tenant config; no branch overrides; lifecycle/actions/cancellation stages/windows; escalation actions/thresholds/workflows/approver labels; discount rules/limits; refund methods/permissions; credit mode/limits; kiosk identification | F/S | Persisted and editable. Lifecycle state creation is S as described above. |
| Currency | Multiple currencies; base/enabled; code/symbol/precision/rounding; currency on prices/orders/payments/refunds/credit/settlements/reports | S | Fully recorded and formatted; one currency per order/account/settlement and no FX conversion. |
| Localization | Multiple languages; default/enabled; translation management; UI/receipt/invoice/kiosk/customer text; RTL/LTR; time zone; UTC storage/display; localized date/time/number/currency/separators/calendar/first day | F/S | `en` and `fa` only. Gregorian persisted dates; Persian locale display uses Intl Persian calendar where selected. Arbitrary language addition is D. |

---

## 3. Architecture

### 3.1 Architecture decisions

| ID | Decision | Rationale and consequence |
|---|---|---|
| AD-01 | Use a NestJS modular monolith and a single React SPA. | Keeps deployment simple while preserving domain boundaries. Modules may call exported application services, never another module’s repositories. |
| AD-02 | Use TypeORM with explicit migrations; `synchronize` is always false. | TypeORM integrates cleanly with NestJS and PostgreSQL. Schema changes require a migration and matching DTO/entity updates. |
| AD-03 | Use UUID v4 primary keys and `tenant_id` on tenant-owned records. | Leaves a future multi-tenant path. Every tenant-scoped query includes the seeded tenant from request context; clients cannot choose it. |
| AD-04 | Store money in `numeric(19,4)` and currency codes as `varchar(3)`. | JavaScript receives monetary values as decimal strings. Backend calculations use `decimal.js`; never native floating point. Rounding occurs only at defined boundaries. |
| AD-05 | Store all timestamps as `timestamptz` in UTC and business dates as `date`. | Display uses tenant time zone and active locale. Business-day allocation is calculated at transaction time and stored. |
| AD-06 | Financial and audit rows are append-only. | Corrections use linked reversal/replacement rows. No endpoint updates or deletes posted financial entries. |
| AD-07 | Use synchronous transactions for prototype domain workflows and an outbox table for simulator/print/KDS side effects. | Critical records commit atomically. A NestJS interval worker processes outbox/queue items; Redis and Kafka are unnecessary. |
| AD-08 | Use signed, `HttpOnly`, `SameSite=Lax` cookie sessions. | The single seeded admin logs in with credentials from environment variables. CSRF uses same-origin deployment plus a per-session CSRF header for mutations. |
| AD-09 | One shared account has every permission; threshold approvals remain functional through simulated approver profiles. | Validates approval UX and audit without implementing user/RBAC management. |
| AD-10 | One order currency, determined when the order is created and immutable after its first item/payment. | Avoids undefined cross-currency math. Payment methods incompatible with the currency are rejected. |
| AD-11 | Order states are a fixed enum; tenant settings control permitted actions and time windows. | Prevents runtime workflow configuration from making code paths untestable. |
| AD-12 | Backend is authoritative for price, discounts, tax, credit, transition eligibility, and totals. | Frontend quote results are previews with a `quoteVersion`; submission recalculates and rejects stale quotes. |
| AD-13 | Use local filesystem storage under `DATA_DIR/uploads`, with opaque generated names and database metadata. | Appropriate for one deployable prototype. Only JPEG, PNG, and WebP up to 5 MB are allowed. |
| AD-14 | All external integrations implement a shared mock-adapter contract and are invoked only by simulator commands or domain services. | Produces credible outcomes without accidental network access. UI always labels them simulated. |
| AD-15 | Localization uses i18next on frontend and backend message keys; database translatable content uses a translation table. | Avoids duplicated locale columns and supports full fallback from `fa` to tenant default to `en`. |
| AD-16 | Soft-delete configuration/master data; never soft-delete transactions. | Deleted master data stops appearing in selection but historic foreign keys and snapshots remain valid. |
| AD-17 | Use optimistic locking (`version` integer) on editable aggregates. | Concurrent stale edits return `409 VERSION_CONFLICT`; financial posting additionally uses row locks. |
| AD-18 | CSV is UTF-8 with BOM on export; Excel reports use ExcelJS. | Persian opens correctly in common spreadsheet software. |

### 3.2 Backend structure

The backend is organized as `src/modules/<domain>` plus `src/common`. Each domain contains `entities/`, `dto/`, `controllers/`, `services/`, `policies/`, and tests. Controllers validate/authorize/translate HTTP only. Application services own use cases and transactions. Pure domain policy classes own calculations and transitions. Repositories are TypeORM repositories injected only inside their owning module.

Request flow:

`HTTP request → session/tenant/locale/correlation middleware → DTO validation → controller → application service → domain policy + repository transaction → audit/outbox → response envelope`

No generic CRUD controller or service is permitted for orders, pricing, discounts, payments, refunds, credit, shifts, delivery, settlements, approvals, sync, or integrations.

### 3.3 Frontend structure

The frontend uses React Router, TanStack Query for server state, React Hook Form + Zod for forms, i18next for text, and MUI/MUI X. Local component state handles drawers/dialogs; a small Zustand store holds session UI preferences, active locale/direction, selected branch/terminal for POS, and the in-progress POS cart. Persisted business state is never treated as authoritative in Zustand.

Feature folders mirror backend domains: `src/features/<domain>/{api,components,pages,schemas,types}`. Cross-feature UI is limited to `src/components`, `src/layouts`, `src/lib`, and `src/theme`. Generated/manual API types use a shared `src/api/contracts.ts`; no duplicate feature-specific definitions of the same DTO.

### 3.4 Module boundaries and dependency rules

- `Orders` may call Catalog/Pricing/Discounts/Customers/DineIn and emits outbox events consumed by KDS/Printing/Delivery.
- `Payments` may call Orders, Credit, Approvals, and Cashier; Orders never manipulates payment tables.
- `Refunds` is within the Payments module but exposed as a separate service/controller and never edits original payments.
- `Delivery` may read Orders and Payment summaries; it owns couriers/settlements.
- `Reports` uses read-only SQL query services over domain tables; it never mutates a domain.
- `Simulations` invokes public domain services and owns mock integration/sync state; domain modules do not depend on Simulation.
- `Audit` and `Outbox` are infrastructure modules usable by all domains.
- Circular NestJS module references and `forwardRef` are forbidden. Break a cycle with an internal event/outbox record or a narrow exported query service.

### 3.5 Shared backend libraries

- `Money`: Decimal parsing, scale, rounding, allocation, comparison, and JSON serialization.
- `DateTime`: tenant-zone conversion, business date calculation, effective-range validation.
- `Pagination`: `page`, `pageSize`, stable sort, filters, and `PagedResponse<T>`.
- `ProblemDetails`: consistent RFC 9457-style errors.
- `Idempotency`: mutation key reservation and replay.
- `AuditWriter`: append-only structured audit.
- `CurrentContext`: tenant, admin user, locale, correlation, session.
- `Validation`: phone normalization, currency, date ranges, identifiers, and safe CSV.

### 3.6 Authentication and approval identity

- `POST /api/v1/auth/login` verifies the seeded administrator password with Argon2id and creates a database session. The cookie is named `gnext_session`.
- Login is limited to 10 failed attempts per IP/username per 15 minutes. The UI shows a generic invalid-credentials message.
- The shared admin account is full access. Branch selection is operational context, not authorization.
- Approval profiles are seeded (`Supervisor`, `Finance`, `IT`) and are not login accounts. A profile’s PIN is Argon2id hashed. Five failed attempts for a profile in ten minutes locks PIN approval for ten minutes and writes an audit/rate-limit event.
- Every mutation requires the CSRF token returned by `/auth/me` in `X-CSRF-Token`. Simulator webhook endpoints use their documented HMAC instead.

### 3.7 Database and transaction strategy

- PostgreSQL 16 or newer; schema `public`; UTF-8.
- TypeORM migrations are the only schema mechanism. Seed is idempotent and runs explicitly.
- Default isolation is `READ COMMITTED`. Monetary posting, credit balance change, order finalization, shift close, and courier settlement lock the aggregate root rows using `SELECT … FOR UPDATE`.
- Unique partial indexes implement active-code uniqueness around soft deletes.
- Effective ranges use half-open intervals `[effective_from, effective_to)`. Overlap for the same pricing dimension is rejected under a transaction lock.
- Search uses normalized lowercase fields plus `pg_trgm` indexes where noted. The prototype does not require Elasticsearch.
- Each mutation that can be retried accepts `Idempotency-Key`; the backend stores request hash, status, and response for 24 hours. Same key/different body returns `409 IDEMPOTENCY_KEY_REUSED`.

### 3.8 API/error conventions

All URLs begin `/api/v1`. JSON uses camelCase; database uses snake_case. Success returns the DTO directly; paginated results return `{items,page,pageSize,total,sort}`. Creation returns `201`; command transitions generally return `200`; delete/archive returns `204`.

Errors use:

```json
{
  "type": "https://gnext.local/problems/order-state",
  "title": "Order action is not allowed",
  "status": 409,
  "code": "ORDER_ACTION_FORBIDDEN",
  "detail": "A paid order cannot be reopened.",
  "instance": "/api/v1/orders/.../reopen",
  "correlationId": "uuid",
  "fieldErrors": [{"field": "amount", "code": "EXCEEDS_OUTSTANDING", "messageKey": "validation.exceedsOutstanding"}]
}
```

Common status rules: `400` malformed/failed validation, `401` unauthenticated, `403` missing/expired approval, `404` absent or archived selection, `409` state/version/idempotency/uniqueness conflict, `422` valid shape but failed business rule, `429` rate limit, `500` unexpected failure. Unexpected failures are logged with correlation ID; stack traces never reach the client.

### 3.9 Audit strategy

Every create/update/archive, state transition, approval attempt/decision, price/discount evaluation, order edit, cash movement, financial posting, simulator action, import, export, reset, and settings change writes `audit_event` in the same transaction where applicable. Audit rows contain stable action codes, localized-display-independent structured details, masked sensitive values, and before/after JSON for editable master data. Reads are audited only for exports and sensitive customer/credit statements. Audit rows cannot be updated or deleted through the application.

### 3.10 Localization

- Supported UI languages are `en` and `fa`. Frontend message bundles must have identical keys; CI checks missing keys.
- `dir="rtl"` for Persian and `dir="ltr"` for English is applied at document root. The MUI theme, Emotion cache, icons, drawers, breadcrumbs, data-grid alignment, keyboard navigation, and animations must respond to direction.
- CSS must use logical properties (`margin-inline-start`, `inset-inline-end`) and MUI logical `sx`; never hardcode left/right except intrinsically directional data such as phone/IBAN controls.
- User-entered names/descriptions are stored verbatim. `localized_text` provides entity translations. Fallback order is requested language → tenant default → English → the entity’s base name.
- API reads `Accept-Language`; errors expose stable codes/message keys and may include localized detail.
- `Intl.DateTimeFormat`, `Intl.NumberFormat`, and configured currency metadata handle display. ISO/Gregorian values are sent to APIs. Persian display may use `fa-IR-u-ca-persian`, but users enter/select dates through a localized picker that returns ISO dates.

### 3.11 Files and images

`POST /files/images` is multipart, scans type by signature, rejects executable/polyglot names, generates an opaque UUID filename, stores checksum/size/dimensions, and returns a file ID plus protected content URL. Orphaned uploads older than 24 hours may be cleaned by a scheduled job. Archiving a product does not remove its image. The data reset deletes non-seed upload files only after database reset succeeds.

### 3.12 Simulator architecture

`SimulationModule` registers adapters implementing `IntegrationAdapter`:

```ts
interface IntegrationAdapter {
  kind: 'SNAPPFOOD' | 'TARA_PAY' | 'NETWORK_POS' | 'MOBILE_POS' | 'PRINTER' | 'KIOSK' | 'LOCAL_AGENT';
  execute(command: AdapterCommand, scenario: SimulationScenario): Promise<AdapterResult>;
}
```

Scenarios define deterministic outcome, latency (0–3000 ms), external reference, and optional error code. Random failure is not allowed in acceptance tests. Adapter calls produce `integration_attempt`, `simulation_log`, and where relevant `queue_item` records. A background worker claims queued rows with `FOR UPDATE SKIP LOCKED`, applies exponential prototype delays of 5 s, 30 s, then 2 min, and moves to `DEAD_LETTER` after three failures. Manual retry resets the attempt schedule and is audited.

---

## 4. Exact backend modules

The following is the complete NestJS module list. “Public API” means controllers and/or exported application-service operations that other modules may call. All list controllers use the common pagination/filter/sort contract described in Section 8.

### 4.1 `AppModule`

- **Responsibility:** application composition, global configuration, global pipes/filters/interceptors, health endpoint, scheduled workers.
- **Entities:** none.
- **Services/controllers:** `HealthController`, `ReadinessService`.
- **Dependencies:** all modules below.
- **Public APIs:** `GET /health/live`, `GET /health/ready`.
- **Rules/events:** readiness fails when PostgreSQL or migrations are unavailable; simulated integrations never affect readiness.

### 4.2 `AuthModule`

- **Responsibility:** shared-admin login/session/logout, CSRF, request context, approval PIN verification.
- **Entities:** `AdminUser`, `Session`, `ApprovalProfile`, `PinAttempt`.
- **Services/controllers:** `AuthService`, `SessionService`, `PinVerificationService`; `AuthController`.
- **Dependencies:** Audit, TenantSettings.
- **Public APIs:** login/logout/me/change-language; internal `verifyApprovalPin(profileId,pin)`.
- **Rules/events:** full-access shared user only; Argon2id password/PIN; rate limits; audit login/logout/failure/lockout.

### 4.3 `TenantModule`

- **Responsibility:** single tenant identity, branches, operating hours, terminal registry, branch operational status.
- **Entities:** `Tenant`, `Branch`, `BranchOperatingHour`, `Terminal`, `BranchStatusSnapshot`.
- **Services/controllers:** `TenantProfileService`, `BranchService`, `TerminalService`, `BranchStatusService`; `TenantController`, `BranchesController`, `TerminalsController`.
- **Dependencies:** Audit, Localization.
- **Public APIs:** tenant profile read/update; branch/terminal CRUD; operating hours; branch status read.
- **Rules/events:** tenant/branch codes unique; archived branch cannot receive new orders; status snapshots are simulator-written; no branch-level settings overrides.

### 4.4 `SettingsModule`

- **Responsibility:** typed tenant settings, action matrix, reason codes, currencies, payment methods, approval workflow configuration.
- **Entities:** `TenantSetting`, `Currency`, `PaymentMethod`, `ReasonCode`, `ApprovalRule`, `ApprovalRuleStep`, `ApprovalRequest`, `ApprovalDecision`.
- **Services/controllers:** `SettingsService`, `ActionPolicyService`, `ReasonCodeService`, `ApprovalWorkflowService`; `SettingsController`, `ReasonCodesController`, `ApprovalRulesController`, `ApprovalRequestsController`.
- **Dependencies:** Auth/PIN, Tenant, Audit.
- **Public APIs:** settings read/update; reason/payment/currency configuration; approval evaluation/request/approve/reject.
- **Rules/events:** settings are schema-validated; approval request snapshots matching rule/steps; completed decisions cannot change; approval token is bound to action/entity/requester/amount and expires in 10 minutes.

### 4.5 `LocalizationModule`

- **Responsibility:** entity translations and UI/receipt/kiosk translation overrides.
- **Entities:** `LocalizedText`, `TranslationEntry`.
- **Services/controllers:** `LocalizationService`, `TranslationEntryService`; `TranslationsController`.
- **Dependencies:** Tenant, Audit.
- **Public APIs:** translation list/upsert/export/import; internal localized entity projection.
- **Rules/events:** locales restricted to enabled `en`/`fa`; empty translation removes override; key and entity-property allowlists prevent arbitrary writes.

### 4.6 `FilesModule`

- **Responsibility:** secure image upload/download metadata.
- **Entities:** `StoredFile`.
- **Services/controllers:** `FileStorageService`, `ImageValidationService`; `FilesController`.
- **Dependencies:** Auth, Audit.
- **Public APIs:** upload image, fetch content/metadata, archive unreferenced file.
- **Rules/events:** 5 MB, JPEG/PNG/WebP, opaque names, checksum; authorization required.

### 4.7 `CatalogModule`

- **Responsibility:** categories, products, variants, modifiers, combos, tax/packaging rules, availability, menus, mappings, catalog import/export.
- **Entities:** `Category`, `Product`, `ProductVariant`, `ModifierGroup`, `ModifierOption`, `ProductModifierGroup`, `ComboComponent`, `ProductAvailability`, `Menu`, `MenuCategory`, `MenuProduct`, `TaxRule`, `PackagingRule`, `AggregatorMapping`, `ImportJob`, `ImportJobRow`.
- **Services/controllers:** `CategoryService`, `ProductService`, `ModifierService`, `MenuService`, `AvailabilityService`, `TaxPackagingService`, `CatalogImportExportService`; corresponding resource controllers plus `CatalogImportsController`.
- **Dependencies:** Tenant, Files, Localization, Audit, Outbox.
- **Public APIs:** CRUD/search; menu composition; availability/suspension; CSV import/export; internal sellability and product snapshot queries.
- **Rules/events:** SKU/product code unique; min≤max; selected options belong to attached groups; combo required components valid; availability combines branch, channel, schedule, and suspension; archive prohibited when referenced by active menu unless removed atomically.

### 4.8 `PricingModule`

- **Responsibility:** price groups, branch membership, effective price records, bulk update, deterministic price resolution and history.
- **Entities:** `PriceGroup`, `PriceGroupBranch`, `PriceEntry`, `PriceBulkJob`.
- **Services/controllers:** `PriceBookService`, `PriceResolutionService`, `PriceBulkService`; `PriceGroupsController`, `PricesController`, `PriceBulkController`.
- **Dependencies:** Tenant, Catalog, Audit.
- **Public APIs:** price CRUD/list/history/bulk; internal `resolvePrice(PriceContext)`.
- **Rules/events:** non-overlapping range per complete dimension; precedence in Section 7; positive/zero amounts allowed, negative forbidden; changes audited.

### 4.9 `CustomersModule`

- **Responsibility:** profiles, phones, addresses, fields, tags/segments, consent, imports, dedupe/merge, history.
- **Entities:** `Customer`, `CustomerPhone`, `CustomerAddress`, `CustomFieldDefinition`, `CustomerCustomValue`, `CustomerTag`, `CustomerTagLink`, `CustomerSegment`, `CustomerConsent`, `CustomerMerge`, `ImportJob`, `ImportJobRow`.
- **Services/controllers:** `CustomerService`, `CustomerSearchService`, `CustomerMergeService`, `CustomerImportService`; `CustomersController`, `CustomerImportsController`, `CustomerSegmentsController`.
- **Dependencies:** Tenant, Audit, Outbox.
- **Public APIs:** CRUD/search/history; tag/consent; import; duplicate candidates; merge.
- **Rules/events:** Iranian phone normalized to E.164 when possible; duplicate score is exact normalized phone first, then email; merge is transactional and preserves source alias/history.

### 4.10 `DiscountsModule`

- **Responsibility:** campaigns, scopes, coupons, usage, evaluation, manual discounts, free items/delivery, funding.
- **Entities:** `DiscountCampaign`, `DiscountScope`, `Coupon`, `DiscountUsage`.
- **Services/controllers:** `DiscountCampaignService`, `DiscountEvaluationService`, `CouponService`; `DiscountsController`, `DiscountQuoteController`.
- **Dependencies:** Catalog, Customers, Tenant, Settings/Approvals, Audit.
- **Public APIs:** campaign/coupon CRUD; quote discount; internal deterministic `evaluate(orderDraft)` and `consumeUsage`.
- **Rules/events:** rule snapshot returned with line allocations; usage consumed only on submission; cancellation/refund does not restore usage by default; priority/stacking Section 7.

### 4.11 `CreditModule`

- **Responsibility:** customer credit accounts/subledger, eligibility, balance, purchases, repayment, adjustment, suspension, statement/aging.
- **Entities:** `CreditAccount`, `CreditEntry`.
- **Services/controllers:** `CreditAccountService`, `CreditPostingService`, `CreditReportQuery`; `CreditAccountsController`.
- **Dependencies:** Customers, Settings/Approvals, Payments (query contract only), Audit.
- **Public APIs:** account open/update/suspend; balance; repayment/adjustment; statement/aging; internal authorize/post/reverse credit purchase.
- **Rules/events:** balance is sum of immutable signed entries; account currency fixed; row lock on posting; finite available credit = limit + balance where debit is negative; no over-limit posting without approval.

### 4.12 `DineInModule`

- **Responsibility:** sections, tables, occupancy, table move/merge and item/order transfer coordination.
- **Entities:** `DiningSection`, `DiningTable`, `TableOccupancyEvent`.
- **Services/controllers:** `DiningLayoutService`, `TableOperationService`; `DiningController`.
- **Dependencies:** Tenant, Orders, Audit.
- **Public APIs:** section/table CRUD; floor view; assign/move/merge/split/transfer commands.
- **Rules/events:** one active order grouping per table; cannot archive occupied table; operations lock all affected orders/tables in sorted UUID order to avoid deadlock.

### 4.13 `OrdersModule`

- **Responsibility:** order aggregate, items/modifiers/notes, totals, lifecycle, edit/replace/split/cancel/reopen, history, idempotent submission.
- **Entities:** `Order`, `OrderItem`, `OrderItemModifier`, `OrderAdjustment`, `OrderNote`, `OrderLink`, `OrderStateEvent`.
- **Services/controllers:** `OrderDraftService`, `OrderQuoteService`, `OrderSubmissionService`, `OrderTransitionService`, `OrderEditService`, `OrderSplitService`, `OrderQueryService`; `OrdersController`, `OrderActionsController`.
- **Dependencies:** Tenant, Catalog, Pricing, Discounts, Customers, Settings/Approvals, Audit, Outbox. It uses a narrow DineIn query contract.
- **Public APIs:** create/list/get/quote/update draft; submit; state actions; edit/replace/split/transfer; cancel/reopen; history/guest-bill preview.
- **Rules/events:** server recalculates snapshots/totals; posted snapshots immutable; no hard delete; paid cancellation calls Payment refund orchestration through a command boundary; emits `ORDER_SUBMITTED/UPDATED/CANCELLED` outbox events.

### 4.14 `CashierModule`

- **Responsibility:** POS terminals, shifts, cash drawer movements, expected/actual close, business-day close/statement.
- **Entities:** `CashierShift`, `CashMovement`, `BusinessDayClose`.
- **Services/controllers:** `ShiftService`, `CashDrawerService`, `ShiftReconciliationService`, `BusinessDayService`; `ShiftsController`, `BusinessDaysController`.
- **Dependencies:** Tenant/Terminal, Orders queries, Payments queries, Settings/Approvals, Audit.
- **Public APIs:** open/current/movement/close shift; closing preview/statement; close business day.
- **Rules/events:** one open shift per terminal; opening float is a movement; no POS order submission without open shift except kiosk/aggregator; close locks shift and requires discrepancy reason/approval threshold.

### 4.15 `PaymentsModule`

- **Responsibility:** instruments/devices, payment intents/attempts, immutable payment/refund/reversal/correction records, allocations, reconciliation, adapter outcomes.
- **Entities:** `PaymentDevice`, `SettlementAccount`, `Payment`, `PaymentAllocation`, `PaymentAttempt`, `Refund`, `RefundAllocation`.
- **Services/controllers:** `PaymentService`, `PaymentAdapterService`, `RefundService`, `PaymentCorrectionService`, `PaymentReconciliationQuery`; `PaymentsController`, `RefundsController`, `PaymentDevicesController`.
- **Dependencies:** Orders, Credit, Cashier, Settings/Approvals, Simulation adapter port, Audit, Outbox.
- **Public APIs:** create/confirm/retry/cancel intent; list/get; reverse/correct; create/confirm refund; device/account CRUD; reconciliation.
- **Rules/events:** amounts decimal strings; allocation cannot exceed outstanding; success posts under transaction; device/reference rules by method; alternative refund rules Section 7; emits payment/refund events.

### 4.16 `KdsModule`

- **Responsibility:** kitchen stations/screens/routing and live ticket/item workflow.
- **Entities:** `KitchenStation`, `KdsScreen`, `KdsRoutingRule`, `KdsTicket`, `KdsTicketItem`, `KdsEvent`.
- **Services/controllers:** `KdsConfigurationService`, `KdsTicketService`, `KdsQueryService`; `KdsController`, `KdsConfigController`.
- **Dependencies:** Catalog, Orders query/events, Tenant, Audit.
- **Public APIs:** config CRUD; board feed; start/bump/recall/priority; item status.
- **Rules/events:** submission creates station tickets idempotently; ready only when all items ready; Server-Sent Events updates board with polling fallback.

### 4.17 `PrintingModule`

- **Responsibility:** simulated printers/groups/routes, print documents, queue, preview, failure/retry/fallback/history.
- **Entities:** `Printer`, `PrinterGroup`, `PrinterGroupMember`, `PrintRoute`, `PrintJob`, `PrintAttempt`.
- **Services/controllers:** `PrintRoutingService`, `PrintRenderService`, `PrintQueueService`; `PrintersController`, `PrintJobsController`.
- **Dependencies:** Tenant, Catalog, Orders, Delivery, Simulation, Audit, Outbox.
- **Public APIs:** config CRUD; enqueue/reprint/retry; list/history; HTML preview.
- **Rules/events:** all output marked simulated; route priority product→category→station→branch default; fallback after configured failure; reprint requires reason and audit.

### 4.18 `DeliveryModule`

- **Responsibility:** zones/fees, couriers, attendance/availability, delivery execution, mobile-terminal assignment, receipt verification, settlement batches/statements.
- **Entities:** `DeliveryZone`, `Courier`, `CourierAttendance`, `CourierTerminalAssignment`, `Delivery`, `DeliveryEvent`, `CourierSettlement`, `CourierSettlementLine`.
- **Services/controllers:** `DeliveryZoneService`, `CourierService`, `CourierAttendanceService`, `DeliveryService`, `CourierSettlementService`; `DeliveryController`, `CouriersController`, `CourierSettlementsController`.
- **Dependencies:** Tenant, Orders, Payments queries/devices, Settings/Approvals, Audit.
- **Public APIs:** zone/courier CRUD; attendance; assign/status; receipt verify; settlement preview/create/close/adjust/reverse; statements.
- **Rules/events:** only attended/available courier can be assigned; cash and mobile POS remain separate; settlement locks included deliveries/payments; closed batches corrected via linked adjustment/reversal.

### 4.19 `SimulationModule`

- **Responsibility:** mock adapters, Snappfood/Tara/terminal/kiosk/local-agent scenarios, offline/sync queue/conflict, deterministic logs and controls.
- **Entities:** `SimulationScenario`, `SimulationLog`, `IntegrationAttempt`, `QueueItem`, `SyncConflict`, `WebhookReceipt`.
- **Services/controllers:** adapter implementations, `SnappfoodSimulatorService`, `TaraPaySimulatorService`, `TerminalSimulatorService`, `OfflineSyncSimulatorService`, `SimulationLogService`; `SimulationController`, `SimulatedWebhooksController`.
- **Dependencies:** Tenant, Catalog, Orders, Payments through public commands, Delivery, Audit, Outbox.
- **Public APIs:** scenario CRUD; generate webhook/order/duplicate; set branch state; enqueue/trigger/retry/resolve; logs.
- **Rules/events:** deterministic outcome required; HMAC is validated for webhook test; duplicate external IDs replay prior result; no external network calls.

### 4.20 `ReportsModule`

- **Responsibility:** all operational report queries, saved views, CSV/XLSX export.
- **Entities:** `SavedReportView`, `ExportJob`.
- **Services/controllers:** one query class per report family, `ReportExportService`, `SavedViewService`; `ReportsController`, `ReportExportsController`.
- **Dependencies:** read-only access to domain tables, Tenant, Localization, Audit, Files.
- **Public APIs:** report data/summary/export; saved view CRUD.
- **Rules/events:** tenant/branch/business-date filters enforced; exports reproduce active filters/sort/columns; totals use unrounded stored allocations then configured presentation rounding.

### 4.21 `AuditModule`

- **Responsibility:** append-only audit/event timeline and operational alerts.
- **Entities:** `AuditEvent`, `OperationalAlert`.
- **Services/controllers:** `AuditWriter`, `AuditQueryService`, `AlertService`; `AuditController`, `AlertsController`.
- **Dependencies:** Tenant/Auth context.
- **Public APIs:** internal write; read/filter/entity timeline/export; alert acknowledge.
- **Rules/events:** no update/delete for audit; alert acknowledgment is audited; customer sensitive fields masked in generic before/after view.

### 4.22 `OutboxModule`

- **Responsibility:** reliable in-process after-commit work and idempotency records.
- **Entities:** `OutboxEvent`, `IdempotencyRecord`.
- **Services/controllers:** `OutboxWriter`, `OutboxWorker`, `IdempotencyService`; no public controller.
- **Dependencies:** Audit.
- **Public APIs:** internal enqueue/claim/complete/fail; idempotency reservation/replay.
- **Rules/events:** processed events retained 30 days; failures produce operational alerts; domain transaction never waits for simulated printer/integration work.

### 4.23 `SystemModule`

- **Responsibility:** seed metadata, prototype data reset orchestration, and reset status.
- **Entities:** `ResetJob`.
- **Services/controllers:** `PrototypeResetService`, `SeedProfileService`; `SystemController`.
- **Dependencies:** Auth, Audit, Files, and every owning module through a reset coordinator; it may not call domain repositories during normal runtime.
- **Public APIs:** start reset and read reset status.
- **Rules/events:** password revalidation, advisory lock, transactionally rebuild minimal seed, revoke sessions, never expose a partial-module reset; security/audit markers survive through the documented reset log mechanism.

---

## 5. Database design

### 5.1 Universal conventions

Unless explicitly stated, tenant-owned mutable tables include:

| Column | Type | Null/default | Rule |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Immutable. |
| `tenant_id` | `uuid` | not null, FK `tenant(id)` | Indexed; derived from session, never client-supplied. |
| `created_at` | `timestamptz` | not null, default `now()` | UTC. |
| `created_by` | `uuid` | nullable FK `admin_user(id)` | Null only for seed/system worker. |
| `updated_at` | `timestamptz` | not null, default `now()` | Updated by service. |
| `updated_by` | `uuid` | nullable FK `admin_user(id)` | As above. |
| `version` | `integer` | not null, default `1` | Increment on edit. |
| `deleted_at` | `timestamptz` | nullable | Present only for soft-deletable master data. |

Every FK has a B-tree index unless covered by a composite index. FKs default to `ON DELETE RESTRICT`; join/detail records owned exclusively by an unposted mutable aggregate may use `CASCADE`. Text codes match `^[A-Z0-9][A-Z0-9_-]{0,31}$`. `numeric(19,4)` values are constrained to appropriate non-negative or signed ranges. `jsonb` objects must validate through DTO/service schemas; they are not an escape hatch for core relational data.

Schema-table notation is normative: a column with `?` is nullable; every other listed column is `NOT NULL`. If no default is stated, there is no database default. Any untyped `*_id` is `uuid` and an FK to the singularly named table’s `id`; optional IDs are marked `?`. Untyped `code` is `varchar(32)`, `name`/`label`/`title` is `varchar(160)`, `description`/`note`/`reason`/`text` is `text`, `reference` is `varchar(160)`, `currency`/`currency_code` is `char(3)`, `amount` and named financial totals are `numeric(19,4)`, percentage/rate is `numeric(7,4)`, quantity is `numeric(12,3)`, count/order/priority/version is `integer`, business/as-of dates are `date`, event times are `timestamptz`, boolean names beginning `is_`, `has_`, `allows_`, or `requires_` are `boolean`, and payload/snapshot/details/mapping/definition fields are `jsonb`. Aggregate monetary totals and counters default to `0`; boolean defaults are only those explicitly stated, otherwise no default. Status/type fields use the Section 5.2 PostgreSQL enum when named there; locally enumerated values shown in a row use a `varchar` check constraint. A “standard” table has the universal UUID PK, tenant FK, audit/version fields, and stated soft-delete column. A transactional table without “standard” has the explicitly listed UUID PK/tenant/audit timestamps and is never soft-deleted. Composite PKs are named explicitly. These conventions supply the type/null/default/FK behavior for every shorthand column below.

Transactional tables have `created_at/created_by` but are not soft-deleted and generally are not updated after posting. Historical display uses snapshot columns rather than current mutable names/prices.

### 5.2 Enums

| Enum | Values |
|---|---|
| `channel` | `POS`, `KIOSK`, `SNAPPFOOD`, `ADMIN` |
| `order_type` | `DINE_IN`, `PICKUP`, `DELIVERY` |
| `order_state` | `DRAFT`, `SUBMITTED`, `CONFIRMED`, `PREPARING`, `READY`, `OUT_FOR_DELIVERY`, `COMPLETED`, `CANCELLED` |
| `payment_status` | `PENDING`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `REVERSED`, `PARTIALLY_REFUNDED`, `REFUNDED` |
| `refund_status` | `PENDING`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `REVERSED` |
| `payment_method_kind` | `CASH`, `CREDIT`, `NETWORK_POS`, `MOBILE_POS`, `ONLINE`, `BANK_TRANSFER`, `TARA_PAY` |
| `shift_state` | `OPEN`, `CLOSING_REVIEW`, `CLOSED` |
| `kds_state` | `NEW`, `IN_PROGRESS`, `READY`, `RECALLED`, `CANCELLED` |
| `delivery_state` | `UNASSIGNED`, `ASSIGNED`, `PICKED_UP`, `EN_ROUTE`, `DELIVERED`, `FAILED`, `CANCELLED` |
| `settlement_state` | `DRAFT`, `UNDER_REVIEW`, `CLOSED`, `REVERSED` |
| `approval_state` | `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `CANCELLED` |
| `queue_state` | `PENDING`, `PROCESSING`, `SUCCEEDED`, `FAILED`, `DEAD_LETTER`, `CONFLICT` |
| `integration_kind` | `SNAPPFOOD`, `TARA_PAY`, `NETWORK_POS`, `MOBILE_POS`, `PRINTER`, `KIOSK`, `LOCAL_AGENT`, `CLOUD_SYNC` |
| `price_type` | `BASE`, `PRICE_GROUP`, `BRANCH`, `CHANNEL`, `DELIVERY`, `PACKAGING`, `MODIFIER` |
| `discount_type` | `PERCENTAGE`, `FIXED_AMOUNT`, `FIXED_PRICE_DEDUCTION`, `FREE_ITEM`, `FREE_DELIVERY` |
| `scope_type` | `TENANT`, `BRANCH`, `CUSTOMER`, `TAG`, `SEGMENT`, `CATEGORY`, `PRODUCT`, `CHANNEL`, `ORDER_TYPE` |
| `credit_entry_type` | `PURCHASE`, `REPAYMENT`, `ADJUSTMENT`, `REVERSAL`, `REFUND` |
| `audit_actor_type` | `ADMIN`, `APPROVER_PROFILE`, `SYSTEM`, `SIMULATOR`, `WEBHOOK` |

### 5.3 Identity, tenant, settings, localization, and files

| Table | Specific columns and constraints | Indexes / lifecycle / validation |
|---|---|---|
| `tenant` | `id uuid PK`; `code varchar(32) UQ NN`; `name varchar(160) NN`; `base_currency char(3) NN`; `default_locale varchar(5) NN`; `time_zone varchar(64) NN`; audit fields | Exactly one seeded row. No delete. Currency/locale/time zone must reference enabled valid values. |
| `admin_user` | `id`, `tenant_id`; `username varchar(80) NN`; `display_name varchar(160) NN`; `password_hash text NN`; `is_active boolean NN default true`; `preferred_locale varchar(5) NN`; `last_login_at timestamptz`; audit | `UQ(tenant_id,lower(username))`; no public CRUD/delete. |
| `session` | `id uuid PK`; `user_id uuid NN`; `token_hash char(64) NN UQ`; `csrf_hash char(64) NN`; `expires_at`, `last_seen_at`, `revoked_at timestamptz`; `ip inet`; `user_agent varchar(512)` | Index user/expiry; purge expired after 30 days; token value never stored. |
| `approval_profile` | standard; `code`, `name`; `profile_type varchar(20)` (`USER/ROLE/DEPARTMENT/TEAM`); `pin_hash text`; `is_active bool` | Active code unique; soft delete; seed Supervisor/Finance/IT. |
| `pin_attempt` | `id`, `tenant_id`, `profile_id`, `request_id?`; `success bool`; `ip inet`; `attempted_at`; `locked_until?`; `correlation_id uuid` | Index `(profile_id, attempted_at desc)`; append-only, retain for prototype. |
| `branch` | standard; `code varchar(32)`, `name varchar(160)`, `phone varchar(32)?`, `address text?`, `time_zone varchar(64)?`, `price_group_id uuid?`, `is_active bool default true` | Active code unique; trigram name; soft delete; branch zone falls back to tenant. |
| `branch_operating_hour` | standard; `branch_id`; `day_of_week smallint NN`; `open_time time?`; `close_time time?`; `is_closed bool NN`; `spans_midnight bool NN` | `UQ(branch_id,day_of_week)`; day 0–6; open/close required unless closed. |
| `terminal` | standard; `branch_id`; `code`, `name`; `terminal_type varchar(20)` (`CASHIER/KIOSK/KDS`); `is_active bool`; `last_seen_at?` | Active code unique per branch; soft delete. |
| `branch_status_snapshot` | `id`, `tenant_id`, `branch_id`; `is_online bool`; `agent_version varchar(40)?`; `agent_health varchar(20)`; `last_heartbeat_at?`; `last_sync_at?`; `offline_since?`; `details jsonb`; `recorded_at` | Latest index `(branch_id,recorded_at desc)`; append-only; simulator only. |
| `tenant_setting` | standard; `key varchar(100)`; `value jsonb`; `schema_version integer` | `UQ(tenant_id,key)`; allowlisted keys only; no soft delete. |
| `currency` | standard; `code char(3)`; `symbol varchar(8)`; `decimal_precision smallint`; `rounding_increment numeric(19,4)`; `is_enabled bool`; `is_base bool` | `UQ(tenant_id,code)`; precision 0–4; exactly one base. Soft delete forbidden if referenced. |
| `payment_method` | standard; `code`, `name`; `kind payment_method_kind`; `currency_code char(3)?`; `requires_reference/device bool`; `allows_refund/alternative_refund bool`; `is_active bool`; `sort_order int` | Active code unique; soft delete. Kind immutable after use. |
| `reason_code` | standard; `code`, `name`; `applies_to varchar(30)[]`; `requires_note bool`; `is_active bool` | Active code unique; at least one applies-to; soft delete. |
| `localized_text` | standard; `entity_type varchar(40)`, `entity_id uuid`, `field varchar(40)`, `locale varchar(5)`, `value text NN` | `UQ(tenant_id,entity_type,entity_id,field,locale)`; entity/field allowlist. Delete allowed with parent. |
| `translation_entry` | standard; `namespace varchar(40)`, `key varchar(160)`, `locale varchar(5)`, `value text` | `UQ(tenant_id,namespace,key,locale)`; no soft delete; only override allowlisted runtime keys. |
| `stored_file` | standard; `storage_key varchar(255) UQ`; `original_name varchar(255)`; `mime_type varchar(80)`; `size_bytes bigint`; `sha256 char(64)`; `width/height int?`; `status varchar(16)` | checksum index; soft delete; size 1..5 MB, positive dimensions. |

### 5.4 Approval configuration

| Table | Specific columns and constraints | Indexes / lifecycle / validation |
|---|---|---|
| `approval_rule` | standard; `code`, `name`; `action varchar(40)`; `priority int`; `branch_id?`; `order_states order_state[]?`; `min_amount/max_amount numeric?`; `min_percentage/max_percentage numeric(7,4)?`; `conditions jsonb`; `is_active bool` | Active code unique; index action/priority; ranges valid; soft delete. First matching lowest priority number is used. |
| `approval_rule_step` | standard; `rule_id`; `step_order smallint`; `profile_id`; `label varchar(120)` | `UQ(rule_id,step_order)`; step order starts 1 contiguous; cascade only while rule unused. |
| `approval_request` | `id`, `tenant_id`; `rule_id?`; `action`; `entity_type/id`; `requester_id`; `branch_id?`; `amount/currency?`; `percentage?`; `reason`; `state`; `current_step`; `expires_at`; `context_snapshot jsonb`; timestamps | Index state/expiry and entity; append-only except state/current step; no delete. Snapshot steps/policy on creation. |
| `approval_decision` | `id`, `tenant_id`, `request_id`, `step_order`, `profile_id`; `decision varchar(10)`; `reason?`; `decided_at`; `pin_attempt_id` | `UQ(request_id,step_order)`; append-only; decision APPROVE/REJECT. |

### 5.5 Catalog and menu

| Table | Specific columns and constraints | Indexes / lifecycle / validation |
|---|---|---|
| `category` | standard; `code`, `name`, `description?`, `parent_id?`, `image_file_id?`, `sort_order int`, `is_active bool` | Active code unique; parent same tenant/not self; trigram name; soft delete. |
| `product` | standard; `code`, `sku?`, `name`, `description?`; `category_id`; `product_type varchar(16)` (`STANDARD/COMBO`); `image_file_id?`; `tax_rule_id?`; `packaging_rule_id?`; `discount_eligibility varchar(20)`; `own_discount_non_stackable bool`; `is_active bool` | Active code and non-null SKU unique; trigram name/SKU; soft delete. |
| `product_variant` | standard; `product_id`; `code`, `name`; `is_default bool`; `sort_order`; `is_active` | Active code unique per product; exactly one default for products with variants; soft delete. |
| `modifier_group` | standard; `code`, `name`; `minimum_selection int`; `maximum_selection int`; `free_selection_count int default 0`; `is_required bool`; `sort_order`; `is_active` | Active code unique; `0≤min≤max`, `free≤max`; soft delete. |
| `modifier_option` | standard; `group_id`; `code`, `name`; `sort_order`; `is_active` | Active code unique in group; soft delete. |
| `product_modifier_group` | `product_id`, `group_id` composite PK; `sort_order`; `min_override?`, `max_override?` | overrides valid and not above active options. Hard-delete relationship allowed if product still draft/master. |
| `combo_component` | standard; `combo_product_id`; `component_product_id`; `quantity numeric(12,3)`; `selection_group varchar(80)`; `min/max_selection int`; `sort_order` | combo cannot contain itself/another combo in prototype; positive quantity. Soft delete with combo. |
| `product_availability` | standard; `product_id`; `branch_id?`; `channel?`; `available_from/to timestamptz?`; `weekly_schedule jsonb?`; `is_available bool`; `suspended_until?`; `reason?` | Resolution index product/branch/channel; range valid. Most specific active rule wins. |
| `menu` | standard; `code`, `name`; `branch_id?`; `channel?`; `effective_from/to timestamptz?`; `is_active` | Active code unique; range valid; one effective menu per branch/channel/time. Soft delete. |
| `menu_category` | `menu_id`, `category_id` composite PK; `sort_order`; `display_name_override?` | Unique sort per menu optional; hard-delete join. |
| `menu_product` | `menu_id`, `product_id` composite PK; `category_id`; `sort_order`; `is_featured bool` | Product/category must belong to menu; hard-delete join. |
| `tax_rule` | standard; `code`, `name`; `rate numeric(7,4)`; `inclusive bool`; `effective_from/to date`; `is_active` | rate 0..100; no overlapping active range for code; soft delete. |
| `packaging_rule` | standard; `code`, `name`; `calculation varchar(16)` (`PER_ORDER/PER_ITEM`); `amount numeric(19,4)`; `currency_code`; `effective_from/to date`; `is_active` | nonnegative; matching order currency; soft delete. |
| `aggregator_mapping` | standard; `provider integration_kind`; `entity_type`; `entity_id`; `branch_id`; `external_id varchar(160)`; `payload_snapshot jsonb?` | `UQ(tenant_id,provider,branch_id,entity_type,external_id)`; mapping entity unique per same dimension. Soft delete. |

### 5.6 Pricing

| Table | Specific columns and constraints | Indexes / lifecycle / validation |
|---|---|---|
| `price_group` | standard; `code`, `name`; `is_active` | Active code unique; soft delete. |
| `price_group_branch` | `price_group_id`, `branch_id` composite PK; audit timestamps | Branch belongs to at most one active group (`UQ(branch_id)`). |
| `price_entry` | standard; `price_type`; `product_id?`; `variant_id?`; `modifier_option_id?`; `packaging_rule_id?`; `branch_id?`; `price_group_id?`; `channel?`; `order_type?`; `currency_code`; `amount numeric(19,4)`; `effective_from timestamptz`; `effective_to?`; `source varchar(20)` | Resolution index on target/dimensions/effective range; exclusion constraint or service lock prevents overlap for identical dimensions. Soft delete only before effective/use; otherwise supersede with new row. |
| `price_bulk_job` | `id`, tenant/audit; `status`; `request jsonb`; `total_rows`, `success_rows`, `failed_rows`; `result_file_id?`; timestamps | Append result; retry creates new job. |

### 5.7 Customers and credit

| Table | Specific columns and constraints | Indexes / lifecycle / validation |
|---|---|---|
| `customer` | standard; `customer_number varchar(40)`; `first_name`, `last_name`, `display_name`; `email?`; `birth_date?`; `home_branch_id?`; `status varchar(16)`; `merged_into_id?`; `search_text text` | Active number unique; trigram/search index; email lowercase index; soft delete only if no transactions; merged source hidden but retained. |
| `customer_phone` | standard; `customer_id`; `phone_raw`, `phone_normalized`; `label`; `is_primary`; `verified_at?` | Index normalized; one primary/customer; exact normalized phone drives duplicate suggestions, not global uniqueness. |
| `customer_address` | standard; `customer_id`; `label`, `recipient_name?`, `phone?`, `province?`, `city`, `line1`, `line2?`, `postal_code?`, `latitude/longitude numeric?`; `is_primary` | Index customer/city; coordinate ranges; soft delete. |
| `custom_field_definition` | standard; `code`, `name`; `data_type varchar(16)`; `required bool`; `options jsonb?` | Active code unique; soft delete. |
| `customer_custom_value` | `customer_id`, `definition_id` composite PK; `value_text/value_number/value_date/value_boolean` | Exactly one typed value matches definition. |
| `customer_tag` | standard; `code`, `name`, `color varchar(7)?` | Active code unique; soft delete. |
| `customer_tag_link` | `customer_id`, `tag_id` composite PK; `created_at/by` | Hard-delete link allowed/audited. |
| `customer_segment` | standard; `code`, `name`; `definition jsonb`; `is_dynamic bool`; `is_active` | Definition supports allowlisted filters only; soft delete. |
| `customer_consent` | `id`, tenant/customer; `consent_type`; `status varchar(12)`; `source`; `captured_at`; `expires_at?`; `evidence text?`; created fields | Append-only status events; latest determines current consent. |
| `customer_merge` | `id`, tenant; `source_customer_id`, `target_customer_id`; `field_resolution jsonb`; `merged_at/by`; `reason` | Source ≠ target; source may merge once; append-only. |
| `credit_account` | standard; `customer_id`; `currency_code`; `mode varchar(16)` (`FINITE/UNLIMITED/POLICY`); `credit_limit numeric(19,4)?`; `status varchar(16)` (`ACTIVE/SUSPENDED/CLOSED`); `policy_note?` | `UQ(tenant_id,customer_id,currency_code)`; row lock; no delete after entries. Limit required FINITE, null UNLIMITED. |
| `credit_entry` | `id`, tenant/account; `entry_type`; `amount numeric(19,4)` signed; `currency_code`; `order_id?`; `payment_id?`; `related_entry_id?`; `reason_code_id?`; `reference?`; `business_date`; `posted_at/by`; `balance_after numeric(19,4)` | Append-only; index account/post time, branch/cashier via joins; currency account match; zero forbidden; reversal links original once. |
| `import_job` | `id`, tenant; `domain varchar(20)`; `file_id`; `mapping jsonb`; `status`; counts; timestamps/audit | Index status; immutable result; domain CUSTOMER/CATALOG. |
| `import_job_row` | `id`, `job_id`; `row_number`; `status`; `source jsonb`; `errors jsonb`; `entity_id?` | `UQ(job_id,row_number)`; append result. |

### 5.8 Discounts

| Table | Specific columns and constraints | Indexes / lifecycle / validation |
|---|---|---|
| `discount_campaign` | standard; `code`, `name`; `discount_type`; `percentage?`; `amount?`; `currency_code?`; `priority int`; `stacking_group varchar(40)?`; `is_stackable bool`; `coupon_required bool`; `usage_limit_total/per_customer int?`; `effective_from/to timestamptz`; `minimum_subtotal?`; `reward_product_id/quantity?`; `funding_source varchar(80)`; `is_active` | Active code unique; range/type fields valid; soft delete. Lower priority number wins. |
| `discount_scope` | standard; `campaign_id`; `scope_type`; `scope_id?`; `is_exclusion bool` | Index campaign/type/id; tenant scope has null ID; no duplicate identical scope. |
| `coupon` | standard; `campaign_id`; `code`; `max_uses?`; `uses_count int`; `effective_from/to?`; `is_active` | `UQ(tenant_id,upper(code))`; counter locked on consume; soft delete. |
| `discount_usage` | `id`, tenant/campaign; `coupon_id?`, `customer_id?`, `order_id`; `amount numeric`; `currency_code`; `used_at`; `reversed_at?`; `snapshot jsonb` | `UQ(campaign_id,order_id)` unless multi-award explicitly allowed (not in prototype); append-only. |

### 5.9 Orders and dine-in

| Table | Specific columns and constraints | Indexes / lifecycle / validation |
|---|---|---|
| `dining_section` | standard; `branch_id`; `code`, `name`; `sort_order`; `is_active` | Active code unique/branch; soft delete. |
| `dining_table` | standard; `branch_id`, `section_id`; `code`, `name`; `capacity int`; `status varchar(16)`; `is_active` | Active code unique/branch; capacity >0; status derived/maintained transactionally; soft delete. |
| `table_occupancy_event` | `id`, tenant/table/order; `event_type`; `from_table_id?`; `guest_count?`; `occurred_at/by`; `details jsonb` | Append-only; table/time index. |
| `order` | `id`, tenant; `order_number varchar(40)`; `external_source?`, `external_id?`; `branch_id`; `terminal_id?`; `shift_id?`; `channel`; `order_type`; `state`; `currency_code`; `customer_id?`; `table_id?`; `guest_count?`; `delivery_address_id?`; `business_date`; money totals: `subtotal`, `modifier_total`, `packaging_total`, `delivery_fee`, `discount_total`, `tax_total`, `grand_total`, `paid_total`, `refunded_total`, `outstanding_total`; `submitted_at?`, `completed_at?`, `cancelled_at?`; `quote_version`; `parent_order_id?`; `version`; created/updated | `UQ(tenant_id,order_number)`; partial `UQ(tenant_id,external_source,external_id)`; indexes branch/business_date/state/customer/table; no delete. `paid_total` is successful non-reversed payment principal; refunds are tracked separately. Totals nonnegative and equation checked by service. |
| `order_item` | `id`, tenant/order; `line_number`; product/variant IDs; snapshots `product_code/name`, `variant_name?`; `quantity numeric(12,3)`; `unit_price`, `base_total`, `modifier_total`, `discount_total`, `tax_total`, `packaging_total`, `line_total`; `notes?`; `state varchar(16)`; `replaces_item_id?`; timestamps | `UQ(order_id,line_number)`; no delete after submit—void/replacement event and state used. Positive quantity. |
| `order_item_modifier` | `id`, tenant/order_item; group/option IDs; name snapshots; `quantity`; `unit_price`; `total`; timestamps | Unique item/option where not repeatable; no mutation after submit except item version replacement. |
| `order_adjustment` | `id`, tenant/order; `order_item_id?`; `type varchar(24)`; `source_type`; `source_id?`; `code/name snapshot`; `amount numeric(19,4)` signed; `funding_source?`; `calculation_snapshot jsonb`; timestamps | Append/snapshot per quote version; finalized adjustments immutable. Discount negative, fees/tax positive. |
| `order_note` | `id`, tenant/order; `order_item_id?`; `note_type varchar(20)`; `text`; `source`; timestamps | Append-only after submission; corrections add new note. Max 1000 chars. |
| `order_link` | `id`, tenant; `from_order_id`, `to_order_id`; `link_type` (`SPLIT/MERGE/TRANSFER/REPLACEMENT`); timestamps/details | Unique relation/type; no self link. |
| `order_state_event` | `id`, tenant/order; `from_state?`, `to_state`; `action`; `reason_code_id?`; `reason_text?`; `approval_request_id?`; `occurred_at/by`; `snapshot jsonb` | Append-only; order/time index; first event creates DRAFT. |

### 5.10 Cashier, payments, and refunds

| Table | Specific columns and constraints | Indexes / lifecycle / validation |
|---|---|---|
| `cashier_shift` | `id`, tenant/branch/terminal; `shift_number`; `state`; `currency_code`; `business_date`; `opened_at/by`; `closed_at/by?`; `opening_cash`, `expected_cash?`, `actual_cash?`, `short_over?`; `closing_note?`; `approval_request_id?`; `version` | One open/closing shift per terminal partial unique; index branch/date/state; no delete. |
| `cash_movement` | `id`, tenant/shift; `type` (`OPENING_FLOAT/CASH_PAYMENT/CASH_REFUND/PAID_IN/PAID_OUT/CLOSE_ADJUSTMENT`); `amount` signed; `currency_code`; `payment_id?`, `refund_id?`; `reason_code_id?`; `reference?`; `posted_at/by` | Append-only; zero forbidden; shift must be open except close adjustment. |
| `business_day_close` | `id`, tenant/branch; `business_date`; `currency_code`; `status`; totals jsonb; `closed_at/by`; `reopened_at/by?`; `approval_request_id?` | `UQ(branch_id,business_date,currency_code)`; close only once; prototype reopening requires approval and creates audit, never deletes. |
| `settlement_account` | standard; `code`, `name`; `account_type`; `masked_identifier?`; `currency_code`; `is_company_owned`; `is_active` | Active code unique; soft delete. |
| `payment_device` | standard; `branch_id?`; `code`, `name`; `kind` network/mobile; `ownership` company/courier/third_party; `settlement_account_id`; `device_identifier`; `is_active` | device ID unique; soft delete; mobile POS is never CASH. |
| `payment` | `id`, tenant/order; `payment_number`; `method_id`; `method_kind snapshot`; `status`; `amount`; `currency_code`; `device_id?`; `settlement_account_id?`; `reference?`; `receipt_number?`; `shift_id?`; `business_date`; `idempotency_key?`; `original_payment_id?`; `correction_group_id?`; `failure_code/message?`; `initiated_at`; `posted_at?`; `version` | UQ payment number; partial UQ idempotency; order/status, method/date/device indexes; no delete. Amount >0; success immutable except derived status as refund/reversal posts. |
| `payment_allocation` | `id`, tenant/payment/order; `amount`; `currency_code`; `created_at` | Payment may allocate only to its order in prototype; sum equals succeeded payment amount; append-only. |
| `payment_attempt` | `id`, tenant/payment; `attempt_no`; `adapter`; `scenario_id?`; `status`; `request_snapshot`, `response_snapshot jsonb`; `external_reference?`; `error_code?`; `started_at`, `finished_at?` | `UQ(payment_id,attempt_no)`; append-only; sensitive fields masked. |
| `refund` | `id`, tenant/order; `refund_number`; `status`; `method_id`; `method_kind snapshot`; `amount`; `currency_code`; `reason_code_id`; `reason_text`; `reference`; `is_alternative_method`; `approval_request_id?`; `device_id?`; `settlement_account_id?`; `shift_id?`; `original_refund_id?`; `failure_code?`; `initiated_at`; `posted_at?`; `version` | UQ number; order/status/method/date indexes; no delete; amount >0. Alternative requires non-empty reference/reason/approval per settings. |
| `refund_allocation` | `id`, tenant/refund; `payment_id`; `order_item_id?`; `amount`; `created_at` | Sum equals succeeded refund; per-payment total never exceeds refundable amount; append-only. |

### 5.11 KDS and printing

| Table | Specific columns and constraints | Indexes / lifecycle / validation |
|---|---|---|
| `kitchen_station` | standard; `branch_id`; `code`, `name`; `target_minutes int`; `is_active` | Active code unique/branch; target 1..1440; soft delete. |
| `kds_screen` | standard; `branch_id`, `terminal_id?`; `code`, `name`; `station_ids uuid[]`; `is_active` | Active code unique; at least one station; soft delete. |
| `kds_routing_rule` | standard; `branch_id`; `station_id`; `product_id?`; `category_id?`; `priority int` | Exactly one product/category; product rule higher specificity; soft delete. |
| `kds_ticket` | `id`, tenant/order/station; `ticket_number`; `state`; `priority int`; `is_aggregator bool`; `created_at`, `started_at?`, `ready_at?`, `bumped_at?`; `version` | `UQ(order_id,station_id)`; board index branch/station/state/time; no delete. |
| `kds_ticket_item` | `id`, tenant/ticket/order_item`; `state`; `quantity`; timestamps | `UQ(ticket_id,order_item_id)`; no delete. |
| `kds_event` | `id`, tenant/ticket; `from_state?`, `to_state`; `action`; `occurred_at/by`; `details jsonb` | Append-only. |
| `printer` | standard; `branch_id`; `code`, `name`; `printer_type`; `simulated_address`; `is_active`; `fallback_printer_id?` | Active code unique/branch; no fallback cycle; soft delete. |
| `printer_group` | standard; `branch_id`; `code`, `name` | Active code unique; soft delete. |
| `printer_group_member` | `group_id`, `printer_id` composite PK; `priority`; `copies int` | Copies 1..5; unique priority/group. |
| `print_route` | standard; `branch_id`; `document_type`; `product_id?`; `category_id?`; `station_id?`; `printer_group_id`; `priority`; `copies` | At most one target selector; soft delete. |
| `print_job` | `id`, tenant/branch; `document_type`; entity type/id; `printer_id?`; `status queue_state`; `copies`; `rendered_html text`; `is_reprint`; `reason?`; `created_at/by`; `completed_at?`; `version` | Queue status/time index; no delete; HTML sanitized/escaped. |
| `print_attempt` | `id`, tenant/job/printer; `attempt_no`; `status`; `scenario_id?`; `error_code/message?`; `started_at`, `finished_at?` | Unique job/attempt; append-only. |

### 5.12 Delivery and courier settlement

| Table | Specific columns and constraints | Indexes / lifecycle / validation |
|---|---|---|
| `delivery_zone` | standard; `branch_id`; `code`, `name`; `polygon jsonb?`; `postal_prefixes text[]?`; `fee`; `currency_code`; `estimated_minutes`; `is_active` | Active code unique; either polygon or prefixes; soft delete. Prototype permits manual zone selection. |
| `courier` | standard; `code`, `name`, `phone`; `compensation_per_delivery`; `currency_code`; `is_active` | Active code/normalized phone indexes; soft delete. |
| `courier_attendance` | `id`, tenant/courier/branch; `business_date`; `checked_in_at`; `checked_out_at?`; `status` AVAILABLE/UNAVAILABLE; `note?`; audit | `UQ(courier_id,branch_id,business_date)`; check-out after check-in. |
| `courier_terminal_assignment` | `id`, tenant/courier/device; `assigned_at`; `returned_at?`; `assigned_by`; `condition_note?` | One active assignment/device and courier partial unique. |
| `delivery` | `id`, tenant/order; `zone_id?`; `courier_id?`; `state`; `fee snapshot`; `currency`; `address_snapshot jsonb`; `assigned_at?`, `picked_up_at?`, `delivered_at?`; `cash_expected`; `mobile_pos_expected`; `compensation_amount`; `failure_reason?`; `version` | `UQ(order_id)`; courier/state/date indexes; no delete. |
| `delivery_event` | `id`, tenant/delivery; from/to state; reason?; occurred at/by; details | Append-only. |
| `courier_settlement` | `id`, tenant/courier/branch; `settlement_number`; `business_date_from/to`; `state`; `currency`; `expected_cash`, `actual_cash`, `expected_pos`, `verified_pos`, `compensation`, `adjustments`, `net_due`, `discrepancy`; `reason_code_id?`; `approval_request_id?`; `closed_at/by?`; `reversal_of_id?`; `version` | UQ number; courier/date/state indexes; no delete. Closed immutable; reversal once. |
| `courier_settlement_line` | `id`, tenant/settlement; `line_type`; `delivery_id?`; `payment_id?`; `amount`; `instrument_kind?`; `verified bool`; `reference?`; created | Append-only; included payment/delivery may belong to only one non-reversed closed settlement. |

### 5.13 Simulation, reports, audit, and infrastructure

| Table | Specific columns and constraints | Indexes / lifecycle / validation |
|---|---|---|
| `simulation_scenario` | standard; `code`, `name`; `integration_kind`; `outcome`; `latency_ms`; `error_code?`; `response_template jsonb`; `is_active` | Active code unique/kind; latency 0..3000; soft delete. |
| `simulation_log` | `id`, tenant; `kind`; `branch_id?`; `level`; `action`; `entity_type/id?`; `correlation_id`; `message`; `details jsonb`; `occurred_at` | Kind/time/branch/level indexes; append-only. |
| `integration_attempt` | `id`, tenant; `kind`; `branch_id?`; `operation`; `external_id?`; `status`; `attempt_no`; request/response jsonb; error; timestamps/correlation | UQ kind/branch/operation/external/attempt; append-only. |
| `queue_item` | `id`, tenant; `queue_type`; `branch_id?`; `dedupe_key`; `payload jsonb`; `state`; `attempt_count`; `available_at`; `locked_at/by?`; `last_error?`; `created_at`, `completed_at?`; `version` | Partial UQ queue/dedupe for nonterminal; claim index state/available; no delete. |
| `sync_conflict` | `id`, tenant/queue_item`; `entity_type/id`; `local_version`, `cloud_version`; local/cloud payloads; `status` OPEN/RESOLVED; `resolution` LOCAL/CLOUD/MERGED?; merged payload?; resolved at/by | Open conflict indexes; no delete. Resolution immutable. |
| `webhook_receipt` | `id`, tenant; `provider`; `branch_id`; `external_event_id`; `signature_valid`; `payload_hash`; `payload`; `response_status`; `received_at`; `processed_at?` | `UQ(provider,branch_id,external_event_id)`; append-only; duplicate returns stored semantic result. |
| `saved_report_view` | standard; `report_code`; `name`; `filters`, `columns`, `sort jsonb`; `is_default` | UQ report/name/shared user; soft delete. |
| `export_job` | `id`, tenant; `report_code`; request jsonb; `format`; `status`; `file_id?`; row_count?; error?; created/completed/audit | status/time index; retain metadata; file lifecycle independent. |
| `audit_event` | `id uuid`; `tenant_id`; `actor_type`; `actor_id?`; `action`; `entity_type/id?`; `branch_id?`; `correlation_id`; `ip inet?`; `before_data/after_data/details jsonb?`; `occurred_at` | Entity/time, actor/time, action/time, correlation indexes; append-only; no update/delete/FK cascade. |
| `operational_alert` | standard without delete; `severity`; `source`; `code`; `title_key`; `details`; `status` OPEN/ACKNOWLEDGED; entity link; opened/ack timestamps/by | Open/severity/time index; acknowledge only. |
| `outbox_event` | `id`; tenant; `event_type`; aggregate type/id; payload; state; attempts; available/locked/processed times; error; created | claim and aggregate indexes; delete only by 30-day maintenance. |
| `idempotency_record` | `id`; tenant; `scope`; `key`; `request_hash`; `status`; `response_status/body`; `created_at`; `expires_at` | `UQ(tenant_id,scope,key)`; expiry index; same hash replays result. |
| `reset_job` | `id`; `tenant_id`; `status` (`PENDING/RUNNING/SUCCEEDED/FAILED`); `requested_at/by`; `started_at?`; `completed_at?`; `result_counts jsonb?`; `error_code?`; `correlation_id`; `version` | One PENDING/RUNNING partial unique per tenant; status/time index. Reset status metadata is kept in the control schema or recreated after tenant-table reset; password/confirmation are never stored. |

### 5.14 Relationship and integrity rules

1. An order, its items, adjustments, payments, refunds, delivery, KDS tickets, and print jobs always share tenant and branch context. Services validate this before inserts; composite consistency is tested.
2. Product/price/config FKs preserve referential history, while all order lines also snapshot human-readable codes/names and monetary inputs.
3. `order.grand_total = subtotal + modifier_total + packaging_total + delivery_fee + tax_total - discount_total`, rounded to the currency increment. `outstanding_total = max(0, grand_total - paid_total)`, where `paid_total` excludes reversed payments but is not reduced by refunds. Refunds are returns of already collected value and do not reopen collection; `refunded_total` is reported separately. An open partial payment that must be undone uses payment reversal, not refund. Refund eligibility is calculated independently.
4. `payment` and `refund` posted rows are never edited for amount/method/reference. Their status may advance only through the state machine; reversal is a linked new record/movement.
5. Credit balance is not a freely editable column. `credit_entry.balance_after` is the locked running balance and is checked against the sum in tests.
6. Deleting referenced master records returns `409 REFERENCED_RESOURCE`; archiving is used instead.
7. Database migrations create check constraints for enums/ranges and all uniqueness described above; business services provide localized friendly errors before constraint errors where possible.

---

## 6. State machines

All transitions are backend commands. A transition uses the aggregate `version`, locks the aggregate, rechecks conditions, writes the state/event/audit in one transaction, and emits outbox work afterward. “Approval” means an approved, unexpired request bound to the exact command context.

### 6.1 Order

| Current | Allowed transition/action | Conditions | Forbidden / audit |
|---|---|---|---|
| none | `CREATE → DRAFT` | Active branch; enabled currency; cashier draft requires open shift; admin draft may be created without shift for setup/testing. | Audit `ORDER_CREATED`. |
| `DRAFT` | update items/customer/table/address/notes; `SUBMIT → SUBMITTED`; `CANCEL → CANCELLED` | All products sellable; modifier rules valid; type-specific fields present; quote current; total valid. Cancel requires reason if items exist. | No payment against DRAFT. Submission snapshots prices/discounts/tax. |
| `SUBMITTED` | `CONFIRM → CONFIRMED`; edit/replace; `CANCEL → CANCELLED` | Config action allowed. Cashier edit/cancel within configured minutes; after window requires approval. Aggregator accept confirms; reject cancels. | Cannot change branch/currency/type after submission. Audit each edit with before/after. |
| `CONFIRMED` | `START_PREPARATION → PREPARING`; edit/replace; `CANCEL → CANCELLED` | Same window/approval; KDS ticket exists or order has no routed kitchen items. | Cannot reduce paid order below net paid amount; use refund as part of atomic edit command. |
| `PREPARING` | `MARK_READY → READY`; limited edit/replace; `CANCEL → CANCELLED` | Ready only when all non-cancelled KDS tickets ready or manager override approval. Edit/cancel always requires approval after preparation starts. | Cannot remove already-ready item without approval/reason. |
| `READY` | `DISPATCH → OUT_FOR_DELIVERY` for delivery; `COMPLETE → COMPLETED` for dine-in/pickup; cancel | Order is fully paid unless setting `allowCompleteWithOutstanding` is true; delivery has assigned courier before dispatch. | Normal item edit forbidden; correction requires approved replacement command. |
| `OUT_FOR_DELIVERY` | `DELIVER → COMPLETED`; `DELIVERY_FAILED → READY`; cancel via refund flow | Courier/delivery state aligns. Failed requires reason. | Item edits forbidden. Cancellation requires approval and refunds posted amounts. |
| `COMPLETED` | refund/reprint only | Refund within available refundable amount; reprint reason. | Reopen/edit/cancel forbidden. Never delete. |
| `CANCELLED` | reprint/history only | — | Reopen forbidden if any succeeded payment existed. An unpaid order cancelled from SUBMITTED may `REOPEN → SUBMITTED` only with approval and within same business day. |

Additional rules:

- An order’s payment status is derived from succeeded payments/refunds and is not an order state.
- `SUBMIT` can move directly to `CONFIRMED` for configured channels (`POS`, `KIOSK`) by performing both state events in one transaction.
- Cancellation before payment voids remaining items and KDS work. Cancellation after payment is an orchestration: create required refunds/reversals, wait for successful simulated external results, then cancel. Failure leaves the order in its prior state with a failed refund record; retry is available.
- Every action writes `order_state_event` or an item/edit audit event even when state is unchanged.

### 6.2 Payment

| Current | Transitions | Required conditions | Forbidden / audit |
|---|---|---|---|
| none | `CREATE → PENDING` | Order not cancelled; amount >0 and ≤ outstanding unless overpayment method explicitly allowed (none in prototype); active compatible method. | Idempotency required for POS submit. Audit initiation. |
| `PENDING` | `PROCESS → PROCESSING`; `CANCEL → CANCELLED` | Cash/credit/bank may process synchronously; external simulated instruments create attempt. | Cannot edit amount/method after processing begins. |
| `PROCESSING` | `SUCCEED → SUCCEEDED`; `FAIL → FAILED` | Valid adapter response/reference/device requirements. Success transaction locks order/shift/credit. | Duplicate success callback is idempotent. Audit attempt/outcome. |
| `FAILED` | `RETRY → PROCESSING`; `CANCEL → CANCELLED` | Retry creates next attempt; order still payable. | Existing attempt unchanged. |
| `SUCCEEDED` | `REVERSE → REVERSED`; successful refund updates derived status to `PARTIALLY_REFUNDED` or `REFUNDED` | Reversal only for unsettled same-day correction, zero refunds, and permitted method; otherwise refund. | Amount/method/reference immutable. Audit/link reversal. |
| `PARTIALLY_REFUNDED` | more refunds → `REFUNDED` | Sum refunds ≤ amount minus reversals. | Direct reversal forbidden. |
| `REFUNDED`, `REVERSED`, `CANCELLED` | none | — | Terminal. |

Cash success creates positive `CASH_PAYMENT`; cash refund creates negative `CASH_REFUND`. Credit payment creates a negative PURCHASE entry; its refund/reversal creates positive REFUND/REVERSAL. Simulated terminal/Tara/online outcomes must not post allocation, shift, credit, or order totals until `SUCCEEDED`.

### 6.3 Refund

| Current | Transitions | Required conditions | Forbidden / audit |
|---|---|---|---|
| none | `CREATE → PENDING` | Amount >0; allocations identify original successful payments and optionally items; total ≤ refundable amount; reason required; alternative method policy satisfied. | Original payment remains unchanged. Audit request and allocation. |
| `PENDING` | `PROCESS → PROCESSING`; `CANCEL → CANCELLED` | Approval completed if required; target method active; cash refund requires open shift. | Cannot alter after process starts. |
| `PROCESSING` | `SUCCEED → SUCCEEDED`; `FAIL → FAILED` | Adapter/reference rules. Success atomically posts refund allocations/cash/credit/order totals. | Duplicate callback idempotent. |
| `FAILED` | `RETRY → PROCESSING`; `CANCEL → CANCELLED` | Same approval remains valid for exact unchanged refund; otherwise new approval. | No silent target-method change. |
| `SUCCEEDED` | `REVERSE → REVERSED` | Only erroneous same-business-day refund, method supports reversal, approval + reason; creates linked counter-record/movements. | No mutation/delete. |
| `CANCELLED`, `REVERSED` | none | — | Terminal. |

### 6.4 Cashier shift

| Current | Transitions/actions | Conditions | Forbidden / audit |
|---|---|---|---|
| none | `OPEN → OPEN` | Active cashier terminal; no open shift on terminal; opening cash ≥0; enabled currency. | Audit/opening movement. |
| `OPEN` | accept orders/payments; paid-in/out; `BEGIN_CLOSE → CLOSING_REVIEW` | Paid-in/out require amount, reason, reference; begin close produces immutable preview version. | Cannot change opening cash. |
| `CLOSING_REVIEW` | `RETURN_TO_OPEN`; `CLOSE → CLOSED` | Actual cash entered. `short_over = actual - expected`; nonzero needs reason; absolute discrepancy above setting requires approval. All processing cash payments/refunds resolved. | No new POS orders/payments while review. Audit preview and decision. |
| `CLOSED` | none | Statement available. | Cannot reopen prototype shift. Corrections use later shifts/accounting note. |

Expected cash = opening float + cash payments − cash refunds + paid-in − paid-out. POS/mobile/online/bank/credit/Tara amounts never affect physical expected cash.

### 6.5 KDS ticket and item

| Current | Transitions | Conditions | Forbidden / audit |
|---|---|---|---|
| none | order event creates `NEW` | At least one submitted routed item. | Idempotent per order/station. |
| `NEW` | `START → IN_PROGRESS`; `BUMP → READY`; `CANCEL → CANCELLED` | Bump allowed for quick item; cancel mirrors order/item cancel. | Audit KDS event. |
| `IN_PROGRESS` | `BUMP → READY`; `CANCEL → CANCELLED` | Ticket READY when every active item READY/CANCELLED. | Cannot edit routed snapshot silently. |
| `READY` | `RECALL → RECALLED` | Recall within 10 minutes or approval afterward; reason required. | Bumped time retained. |
| `RECALLED` | `START → IN_PROGRESS`; `BUMP → READY` | — | Audit recall/rework timer. |
| `CANCELLED` | none | — | Terminal. |

Priority is integer 0–9, default 5; higher displays first, then oldest submitted time. Preparation timer starts on ticket creation and highlights amber at target, red at 150% target.

### 6.6 Delivery

| Current | Transitions | Conditions | Forbidden / audit |
|---|---|---|---|
| none | delivery order submit creates `UNASSIGNED` | Valid address and fee snapshot. | One delivery/order. |
| `UNASSIGNED` | `ASSIGN → ASSIGNED`; `CANCEL → CANCELLED` | Courier checked in, AVAILABLE, same branch; not simultaneously over configured active-delivery limit (default 5). | Audit assignment. |
| `ASSIGNED` | reassign; `PICK_UP → PICKED_UP`; cancel | Order READY for pickup; reassignment requires reason after pickup is forbidden. | Courier cannot be removed silently. |
| `PICKED_UP` | `DEPART → EN_ROUTE`; `FAIL → FAILED` | — | Order moves OUT_FOR_DELIVERY on depart. |
| `EN_ROUTE` | `DELIVER → DELIVERED`; `FAIL → FAILED` | Cash/mobile receipt actuals captured; order completion payment rule satisfied. | Delivery proof is optional prototype note/reference. |
| `FAILED` | `REASSIGN → UNASSIGNED`; `RETURN → ASSIGNED`; `CANCEL → CANCELLED` | Reason mandatory; approved if order/payment settings require. | History retained. |
| `DELIVERED`, `CANCELLED` | none | Settlement may later include delivered records. | Terminal. |

### 6.7 Courier settlement

| Current | Transitions/actions | Conditions | Forbidden / audit |
|---|---|---|---|
| none | `CREATE → DRAFT` | Courier/branch/date/currency; collect eligible un-settled delivered orders and instrument lines. | Snapshot expected amounts/compensation. |
| `DRAFT` | enter actual cash, verify each POS receipt, add adjustment; `REVIEW → UNDER_REVIEW`; discard if never posted | Adjustment requires reason/reference. | Cannot include same line in another active batch. |
| `UNDER_REVIEW` | `RETURN → DRAFT`; `CLOSE → CLOSED` | Actuals entered; every mobile receipt verified or discrepancy reason; discrepancy above threshold requires approval. | Locks included deliveries/payments. |
| `CLOSED` | `REVERSE → REVERSED` | Approval, reason, same currency; linked reversal batch/lines. | No edit/delete. |
| `REVERSED` | none | New corrected settlement may be created. | Terminal. |

Expected cash sums courier-collected CASH only. Expected POS sums company-owned mobile POS succeeded payments tied to the courier/device/delivery. Compensation reduces amount due from courier. `net_due = actual_cash + verified_pos - compensation + adjustments`; discrepancies are shown separately per instrument, never netted into a fake cash value.

### 6.8 Simulated synchronization queue

| State | Transitions | Conditions / actions |
|---|---|---|
| `PENDING` | `PROCESSING` | Branch online and item available; worker claim or manual trigger. |
| `PROCESSING` | `SUCCEEDED`, `FAILED`, `CONFLICT` | Deterministic scenario; version mismatch creates conflict. Lock timeout returns to PENDING. |
| `FAILED` | `PENDING` retry, `DEAD_LETTER` | Auto retry while attempt <3; manual retry allowed from either state. |
| `CONFLICT` | `SUCCEEDED` after resolution or `PENDING` | User selects LOCAL, CLOUD, or provides validated MERGED payload; resolution audit required. |
| `SUCCEEDED`, `DEAD_LETTER` | no automatic transition | Manual retry from DEAD_LETTER clones a new queue item linked in details; original remains. |

Queue dedupe key is `branchId:entityType:entityId:operation:sourceVersion`. Re-enqueue with the same active key returns the existing item.

### 6.9 Simulated integration attempt

| State | Transitions | Conditions / actions |
|---|---|---|
| `PENDING` | `PROCESSING`, `CANCELLED` | Command persisted. |
| `PROCESSING` | `SUCCEEDED`, `FAILED` | Adapter scenario result after configured latency. |
| `FAILED` | `PROCESSING` via retry, `DEAD_LETTER` | Each retry adds an attempt. Maximum 3 automatic attempts. |
| `SUCCEEDED`, `CANCELLED`, `DEAD_LETTER` | terminal | Manual retry clones operation from DEAD_LETTER; duplicate webhook returns original result without new domain effect. |

All attempts log request hash, masked request/response, simulated scenario, latency, result, correlation ID, and linked domain entity.

---

## 7. Business rules

### 7.1 Money, quantities, rounding, and effective dates

1. APIs accept money as strings matching `^-?\d{1,15}(\.\d{1,4})?$` and return fixed-scale decimal strings. Numeric JSON values for money are rejected.
2. Calculations use at least four decimal places. Percentage calculation is unrounded until line allocation. Final line/order/payment/refund values round to the currency’s decimal precision and then nearest configured increment using half-away-from-zero.
3. A rounding remainder is assigned deterministically to the highest-priced eligible line; ties use lowest line number. The sum of line allocations must exactly equal the order adjustment.
4. Standard order quantity is integer 1–999. Decimal quantity is allowed only if product setting `allowsFractionalQuantity=true`, scale ≤3, and quantity >0.
5. Effective ranges are half-open: start inclusive, end exclusive. Null end is infinity. Evaluation time is the branch-local transaction time converted to UTC.
6. Records cannot be backdated to change a submitted order. Editing historical effective data affects only future quotes; orders retain snapshots.

### 7.2 Price resolution

For each product/variant/modifier at quote time:

1. Filter active price rows by tenant, currency, target, effective timestamp, and compatible dimensions. A row with a non-null dimension must equal the order context.
2. Choose exactly one product/variant unit-price row using descending specificity: `BRANCH+CHANNEL+ORDER_TYPE`, `BRANCH+CHANNEL`, `BRANCH+ORDER_TYPE`, `BRANCH`, `PRICE_GROUP+CHANNEL+ORDER_TYPE`, `PRICE_GROUP+CHANNEL`, `PRICE_GROUP+ORDER_TYPE`, `PRICE_GROUP`, `CHANNEL+ORDER_TYPE`, `CHANNEL`, `DELIVERY` for delivery context, then `BASE`. Within equal specificity, latest `effective_from` wins; equal starts are forbidden.
3. A variant-specific row beats its product row at the same specificity. No resolved row returns `422 PRICE_NOT_CONFIGURED`; the item cannot be added/submitted.
4. Modifier options resolve independently using `MODIFIER` rows with the same branch/group/channel specificity; missing modifier price means zero only if the option has `allowZeroPrice=true`, otherwise error.
5. Packaging uses product packaging rule and optional price entry; per-item amount multiplies quantity, per-order rule is charged once per distinct rule. Delivery fee comes from selected zone unless a more specific effective delivery price exists.
6. Tax-inclusive: embedded tax = taxable gross × rate/(100+rate). Tax-exclusive: add taxable net × rate/100. Discounts reduce the taxable basis unless campaign setting `discountAfterTax=true` (seeded false and not editable in prototype UI).
7. Quote response lists chosen `priceEntryId`, effective range, price type, and breakdown. Submission recalculates. If any chosen price/availability/discount differs from `quoteVersion`, return `409 QUOTE_STALE` with a fresh quote.

### 7.3 Branch pricing and bulk updates

- A branch may belong to one price group. Explicit branch rows always beat group rows.
- Changing group membership affects future quotes immediately and is audited; existing orders are unchanged.
- Bulk update requires target dimension, currency, operation (`SET`, `INCREASE_AMOUNT`, `INCREASE_PERCENT`), effective start, and selected product IDs. It previews row-level old/new values, rounding, and conflicts. Confirmation creates new price rows in one transaction or creates none if any row fails.
- Overlapping price entries for identical complete dimensions are rejected. To change a future price, close the current row at the new row’s start and insert the new row atomically.

### 7.4 Discount eligibility, priority, and stacking

The server evaluates only active campaigns within effective time and usage limits, then scopes/exclusions.

1. Candidate must match every populated context dimension: branch/customer/tag/segment/channel/order type. A campaign with positive product/category scopes applies only to those lines. Exclusion scopes always win.
2. Product `NEVER_DISCOUNT` is never eligible, including manual discounts. `CAMPAIGN_EXCLUDED` rejects automatic/coupon campaigns but permits manual discounts within approval policy. A product with an applied own discount marked non-stackable is removed from all later discounts.
3. Coupon text is trimmed and uppercased. At most one coupon campaign per code; an invalid/inactive/exhausted coupon returns a visible error, never silently ignores it.
4. Candidates sort by ascending priority, then larger customer benefit, then campaign UUID for stability. Manual discounts have priority 10; coupon 20 unless campaign explicitly sets lower; automatic campaigns use configured priority 30–999.
5. Non-stackable campaign: if applied, no other campaign in the same stacking group may apply to the same line/order. A null stacking group means global group `DEFAULT`.
6. Stackable percentage discounts apply sequentially to the remaining eligible line basis, not additively. Fixed discounts then allocate proportionally across eligible remaining bases. Total discount cannot make a line/order below zero.
7. For mutually exclusive candidates, simulate each on the same pre-group basis and choose the one with greatest customer benefit; tie uses priority then UUID.
8. Fixed amount larger than eligible basis is capped; the unused amount is not carried or paid as cash.
9. Free-item campaign adds a zero-net-price reward line linked to the campaign if qualification is met. The normal list price is snapshotted and an equal discount adjustment applied. Reward product availability/modifiers must be valid. No recursive qualification from reward lines.
10. Free delivery applies only to delivery fee, capped to fee. It does not discount items.
11. Campaign total/per-customer and coupon counters are locked and consumed on order submission. A failed submission consumes nothing. Cancellation/refund does not restore usage in prototype.
12. The quote returns every considered campaign with `APPLIED` or stable rejection reason for explainability. Discount audit records applied and rejected summaries.

### 7.5 Manual discounts and approvals

- One manual percentage and one manual fixed-price deduction may exist per order, and both are in stacking group `MANUAL`; by default they do not stack with each other. Replacing one requires a new reason and audit event.
- Manual percentage range is 0.01–100. Fixed deduction >0 and ≤ eligible subtotal. Products marked never-discount are excluded from the basis.
- If percentage exceeds `cashierMaxDiscountPercent` or fixed deduction exceeds `cashierMaxFixedDeduction`, submission returns `403 APPROVAL_REQUIRED` with a pending request ID. The unchanged command may be retried after approval with `approvalRequestId`.
- Price override is modeled as a manual fixed adjustment, not editing price snapshot, and always requires approval plus reason.
- Approval is also required if settings specify action/state/amount threshold, even if cashier limit is not exceeded. The most restrictive matching rule wins; if equal priority, the rule with more steps wins.

### 7.6 Customer credit

1. One account per customer/currency. Account must be ACTIVE and customer eligible. A suspended account cannot purchase but may receive repayment/refund.
2. Signed balance convention: purchases are negative; repayments/refunds are positive. `available = unlimited` for UNLIMITED, otherwise `max(0, limit + balance)`.
3. A credit payment amount cannot exceed order outstanding. It also cannot exceed available credit unless an exact limit-override approval is supplied. Policy mode uses tenant default limit unless customer override exists.
4. Credit posting locks account and order, rechecks balance, inserts entry and payment/allocation, and stores new running balance in one transaction.
5. Repayment requires method/reference and amount >0. It posts positive entry; over-repayment is allowed only with approval and produces positive customer balance.
6. Manual adjustment requires signed amount, reason, reference, and approval. No direct balance edit.
7. Credit refund posts positive REFUND linked to original PURCHASE/payment. Reversing a credit payment posts opposite linked entry.
8. Aging buckets use debit entries not fully offset by subsequent positive entries FIFO: current (0–30), 31–60, 61–90, 90+ days, in tenant local business date.

### 7.7 Split and partial payments

- An order may have multiple successful payments. Each new payment amount must be ≤ collectible outstanding at initiation and rechecked at success.
- Partial payment leaves order open with visible outstanding. `COMPLETED` is blocked unless outstanding is zero, except the explicit tenant setting noted in the order state machine.
- Mixed payment is not a separate record; it is two or more successful payments of different kinds on the same order.
- Cash + external terminal: post cash immediately, then attempt terminal. If terminal fails, cash remains posted and outstanding remains. UI offers retry/change method/refund cash, never rolls back a real successful cash payment silently.
- Credit + terminal follows the same rule; if subsequent method fails, credit purchase remains and can be explicitly reversed/refunded.
- Parallel payment attempts on the same order are prohibited by an order row lock/active-intent check. One `PENDING/PROCESSING` payment at a time.
- Allocation order is explicit in the payment dialog; default amount equals outstanding. There is no gratuity or overpayment/change calculation in the prototype.

### 7.8 Refunds and alternative methods

1. Refundable order amount = sum succeeded payments − sum succeeded refunds − sum successful payment reversals. Item-level refund additionally cannot exceed each line’s paid, non-refunded net allocation.
2. Full refund uses all remaining refundable allocation. Partial refund requires amount and optional selected line quantities; the backend allocates proportionally across original successful payments, oldest first, unless the user selects specific payments.
3. Original-method refund is default. Cash/credit are synchronous. Simulated external methods require a success scenario/reference.
4. Alternative target method is allowed only if tenant setting includes the original→target pair, target payment method is active/compatible currency, requester supplies reason code, note, reference, and an approved request. Cash target also requires open shift.
5. A POS-origin refund to CASH remains a refund linked to the POS payment and appears in alternative-refund and cash-shift reports. It never changes original method classification.
6. A POS-origin refund to BANK_TRANSFER requires bank transfer reference. Mobile/network device is not required for bank target.
7. Failed refunds change no posted totals or cash/credit ledger. Retry reuses immutable amount/allocation/method and creates another attempt.
8. Payment reversal is permitted only for same-business-day correction, not for returning goods/service. Otherwise use refund.
9. Correction flow: reverse eligible wrong payment, then create replacement payment. Both link by `correctionGroupId`; if replacement fails, reversal remains and order is outstanding.
10. Ordinary customer refunds are allowed only after the order is `COMPLETED` or as part of the paid-order cancellation orchestration. To undo an open order’s partial payment, use the eligible payment reversal/correction flow so collectible outstanding remains accurate.

### 7.9 Order editing, replacement, cancellation, and duplicate prevention

- Draft item updates replace mutable lines normally. After submission, edit command creates a new quote version and history diff; removed lines are marked `VOIDED`, changed lines are superseded by new lines, and original snapshots stay queryable.
- Editing is allowed only by the configured action matrix and time window measured from `submitted_at`. Exactly at the boundary is outside the cashier window and requires approval.
- An edit that lowers total below net paid must include a refund plan; commit order changes only after synchronous refund success, or keep a pending proposed edit record in command response (prototype UI retries after external refund success). Never leave grand total below net paid without linked refund.
- Replacement selects original line, replacement product/modifiers/quantity, reason, and approval if required. Price is current effective price, not original price. Difference increases outstanding or requires refund.
- Split orders allocate whole or partial quantities to a new linked order with the same branch/currency/customer; payments are not moved. If source already paid, split requires settlement plan and approval. Default UX restricts split to unpaid items.
- Merge tables/orders is allowed when branch/currency/type match and neither order has processing payments. Items move into target via linked history; successful payments stay linked to source, and “settle together” UI pays each outstanding order in sequence under one dialog.
- Cancellation requires active reason code and optional mandatory note. Before payment it transitions normally. After any success, it invokes full remaining refund; only after refund success does cancellation complete.
- `Idempotency-Key` is mandatory on submit, payment, refund, offline/simulator injection, settlement close, and import commit. Duplicate aggregator external ID returns `200` with original order and `duplicate:true`, logs receipt, and creates no new order/items/payments/KDS work.

### 7.10 Shift closing and business day

- Shift expected totals derive only from posted records with the shift ID; failed/pending records are excluded.
- Close preview lists opening float, cash sales, cash refunds, paid-in, paid-out, expected cash, actual cash input, variance, noncash totals by method/device/account, credit use, refunds, and order count.
- A shift with pending payments/refunds cannot close. A shift may close with outstanding orders because another shift can settle them; statement lists them.
- Nonzero cash variance requires reason. Absolute variance ≥ configured threshold (default IRR `1,000,000`) requires approval.
- Branch business day can close only when no branch shift for that business date/currency is OPEN/CLOSING_REVIEW and no payment/refund is PROCESSING. Close snapshots report totals. Reopen requires approval and reason; subsequent close creates a new snapshot version in audit, not new PK.

### 7.11 Courier settlement

- Eligible delivery: DELIVERED, courier matches, business date in range, currency matches, and not in another non-reversed closed batch.
- Cash expected uses successful CASH amount marked collected-by-courier minus courier cash refunds. Company mobile POS expected uses successful MOBILE_POS on a device assigned during delivery time and the company settlement account. Network POS/mobile owned by another party appears separately and is not cash.
- Each mobile receipt requires receipt number and checked verification. Missing/mismatched receipt becomes discrepancy with reason.
- Actual cash, verified POS, compensation, and adjustments are separate lines. Do not combine POS receipt into actual cash.
- Closing with any discrepancy requires reason; above configured threshold requires approval. Closed lines and totals are immutable. Adjustment after closing creates a new settlement adjustment batch; reversal creates equal opposite lines and frees original delivery lines only after reversal completion.

### 7.12 Availability, schedules, and conflict rules

- Product sellable = active product/category/menu membership + active branch/channel availability + within weekly/effective schedule + not currently suspended + resolvable price.
- Explicit unavailable rule at product+branch+channel wins over available broader rule. Specificity: product/branch/channel → product/branch → product/channel → product global. At equal specificity latest created active rule wins and is audited.
- A product that becomes unavailable after it is in a draft is shown invalid; submit fails with the affected lines. Submitted orders keep the product.
- Sync conflict default is “manual”; no last-write-wins. Resolution must choose local/cloud/merged and stores both originals plus result. Financial conflicts cannot use arbitrary merge: choose authoritative complete version or cancel and correct through domain commands.

---

## 8. REST API specification

### 8.1 Global contract

- Resource IDs are UUID path parameters. Invalid UUID is `400`; unknown or archived resource is `404` unless an `includeArchived=true` list filter is used.
- Lists accept `page` (default 1), `pageSize` (default 25, max 100), `sort` (`field:asc|desc`, multiple comma-separated), and resource filters. Response is `PagedResponse<T>`. Every list has a stable final `id:asc` tie-break.
- Search `q` is trimmed, max 100 characters, and matches documented name/code/reference fields. Date filters are ISO `YYYY-MM-DD`; timestamps are ISO 8601 with offset.
- Mutating DTOs reject unknown properties. Updates are `PATCH` with `version` required. Creation returns full resource DTO. Commands return updated aggregate plus `warnings` and relevant IDs.
- All mutations have the side effect “write audit”; transactional domain mutations also write outbox as specified. Tables below mention additional side effects. Common errors (`400/401/404/409 version or uniqueness/500`) apply to every relevant endpoint and are not repeated.
- `Idempotency-Key` is required where marked **I**. `X-CSRF-Token` is required on every authenticated mutation.
- Deleting a master endpoint means soft archive and returns `204`; `REFERENCED_RESOURCE` is `409`. Restore is intentionally not exposed.

Core DTO shapes used below:

```ts
type Money = string;
type EntityRef = { id: string; code?: string; name: string };
type PagedResponse<T> = { items: T[]; page: number; pageSize: number; total: number; sort: string[] };
type CommandMeta = { approvalRequestId?: string; reasonCodeId?: string; reason?: string; version: number };
type OrderSummaryDto = { id:string; orderNumber:string; branch:EntityRef; channel:Channel; orderType:OrderType; state:OrderState; currencyCode:string; customer?:EntityRef; table?:EntityRef; grandTotal:Money; paidTotal:Money; refundedTotal:Money; outstandingTotal:Money; businessDate:string; createdAt:string; version:number };
type OrderDetailDto = OrderSummaryDto & { items:OrderItemDto[]; adjustments:AdjustmentDto[]; notes:NoteDto[]; payments:PaymentDto[]; delivery?:DeliveryDto; stateHistory:StateEventDto[]; availableActions:string[] };
type QuoteDto = { quoteVersion:string; currencyCode:string; items:QuotedItemDto[]; consideredDiscounts:DiscountDecisionDto[]; subtotal:Money; modifierTotal:Money; packagingTotal:Money; deliveryFee:Money; discountTotal:Money; taxTotal:Money; grandTotal:Money; warnings:string[] };
```

Where a table uses the compact form `GET/POST/PATCH/DELETE /resource[/:id]`, it expands to four exact endpoints: `GET /resource` returns the documented paged DTO and accepts the documented filters/sort; `POST /resource` accepts all create-eligible schema fields and returns `201` with the resource; `PATCH /resource/:id` accepts any create-eligible field plus mandatory `version` and returns the updated resource; `DELETE /resource/:id` performs the documented soft archive and returns `204`. The validation, reference, archive, common error, CSRF, and audit rules in Sections 5 and 8.1 apply individually to all four. Child collections follow the same convention only when explicitly shown.

### 8.2 Authentication and tenant

| Method / URL | Purpose; request → response | Validation, filters/sort, errors | Additional side effects / audit |
|---|---|---|---|
| `POST /auth/login` | `{username,password,locale?}` → `{user,csrfToken,expiresAt}` and cookie | Nonempty, locale en/fa; `401 INVALID_CREDENTIALS`, `429 LOGIN_RATE_LIMITED` | Session, login/failure audit; password never logged. |
| `POST /auth/logout` | empty → `204` | Valid session/CSRF | Revoke session; audit logout. |
| `GET /auth/me` | session → `{user,tenant,csrfToken,permissions:['*'],settingsSummary}` | `401` | Updates session last-seen at most once/5 min; no audit. |
| `PATCH /auth/me/preferences` | `{preferredLocale,version}` → user DTO | enabled locale | Audit preference change. |
| `GET /tenant` | → tenant DTO | — | — |
| `PATCH /tenant` | `{name,baseCurrency,defaultLocale,timeZone,version}` → tenant DTO | currency enabled; IANA zone; default locale enabled; `422 CURRENCY_IN_USE` if incompatible base change | Audit before/after. |

### 8.3 Branches, terminals, settings, approvals, localization, and files

| Method / URL | Purpose; request → response | Validation / list contract / errors | Side effects / audit |
|---|---|---|---|
| `GET /branches` | list branches → `PagedResponse<BranchDto>` | filters `q,isActive,includeArchived`; sort `code,name,createdAt` | — |
| `POST /branches` | `BranchCreateDto{code,name,phone?,address?,timeZone?,priceGroupId?,isActive}` → Branch | code/name; valid group/zone | Audit. |
| `GET /branches/:id` | detail with hours/latest status → BranchDetail | — | — |
| `PATCH /branches/:id` | partial create fields + `version` → detail | cannot deactivate with open shifts; `422 BRANCH_HAS_OPEN_SHIFT` | Audit. |
| `DELETE /branches/:id` | archive → `204` | no active orders/shifts | Audit. |
| `PUT /branches/:id/operating-hours` | `{version,hours:[{dayOfWeek,isClosed,openTime?,closeTime?,spansMidnight}]}` → list | exactly 7 unique days; valid times | Replace transactionally; audit diff. |
| `GET /branches/status` | branch status dashboard → paged status | filters `branchId,isOnline,health,q`; sort `lastHeartbeatAt,lastSyncAt,name` | — |
| `GET /terminals` | paged terminal list | filters `branchId,type,isActive,q`; sort `code,name,lastSeenAt` | — |
| `POST /terminals` | `{branchId,code,name,terminalType,isActive}` → Terminal | branch active; enum | Audit. |
| `PATCH /terminals/:id` | partial + version → Terminal | cannot deactivate with open shift | Audit. |
| `DELETE /terminals/:id` | archive | no open shift | Audit. |
| `GET /settings` | typed settings document → `SettingsDto` | optional `group` | — |
| `PATCH /settings/:group` | `{version,values}` → SettingsDto | group schema; no unknown keys; action matrix only known states/actions | Audit diff; invalidate settings cache. |
| `GET /currencies` / `POST /currencies` | list all / create `CurrencyCreateDto` | list filter enabled; ISO code, precision 0–4, valid increment | Audit mutations. |
| `PATCH /currencies/:id` / `DELETE /currencies/:id` | update/archive | referenced currency cannot archive/change precision | Audit. |
| `GET /payment-methods` / `POST /payment-methods` | list / create method | filters kind/active/currency; validate device/reference flags | Audit. |
| `PATCH /payment-methods/:id` / `DELETE /payment-methods/:id` | update/archive | used kind immutable; referenced archive allowed but unavailable future | Audit. |
| `GET /reason-codes` / `POST /reason-codes` | list / create reason | filters appliesTo/isActive/q; nonempty appliesTo | Audit. |
| `PATCH /reason-codes/:id` / `DELETE /reason-codes/:id` | update/archive | known applies-to values | Audit. |
| `GET /approval-rules` / `POST /approval-rules` | paged list / create rule with ordered steps | filters action/branch/active/q; valid ranges; active profiles; contiguous steps | Audit. |
| `GET /approval-rules/:id` / `PATCH /approval-rules/:id` / `DELETE /approval-rules/:id` | detail/update/archive | used requests keep snapshots; optimistic version | Audit. |
| `GET /approval-requests` | paged requests | filters state/action/branch/entityType/entityId/dateFrom/dateTo; sort createdAt,expiresAt,amount | — |
| `GET /approval-requests/:id` | request + decisions → detail | requester may view; one shared user | — |
| `POST /approval-requests/:id/approve` | `{profileId,pin,reason?}` → request | correct current step/profile; not expired; `403 PIN_INVALID`, `423 PIN_LOCKED`, `409 STEP_ALREADY_DECIDED` | Decision, next step/final state, audit without PIN. |
| `POST /approval-requests/:id/reject` | same → request | reason required | Decision/final reject/audit. |
| `POST /approval-requests/:id/cancel` | `{reason}` → request | only requester, PENDING | Audit. |
| `GET /translations` | paged translation entries | filters `locale,namespace,q`; sort namespace,key | — |
| `PUT /translations/:namespace/:key/:locale` | `{value,version?}` → entry | allowlisted key, enabled locale, max 4000 chars | Upsert/audit. |
| `DELETE /translations/:namespace/:key/:locale` | remove override | exists | Audit. |
| `GET /translations/export` | UTF-8 CSV download | locale/namespace filters; max 50k | Audit export. |
| `POST /translations/import` **I** | multipart CSV `{namespace,key,locale,value}` → ImportResult | all-or-nothing; duplicate key error | Upsert/audit import. |
| `POST /files/images` **I** | multipart `file` → StoredFileDto | MIME/signature/size/dimensions; `413 FILE_TOO_LARGE`, `422 INVALID_IMAGE` | Store opaque file; audit. |
| `GET /files/:id/content` | stream file | active reference/auth; ETag checksum | — |
| `DELETE /files/:id` | archive orphan | `409 FILE_IN_USE` | Archive and schedule physical cleanup; audit. |

### 8.4 Catalog and menus

All standard catalog list endpoints filter `q,isActive,includeArchived` plus stated FKs and sort `code,name,sortOrder,updatedAt` as applicable.

| Method / URL | Purpose; request → response | Validation / errors | Side effects / audit |
|---|---|---|---|
| `GET /categories` / `POST /categories` | paged tree-capable list / create `CategoryCreateDto` | filters parentId; valid parent/image | Audit. |
| `GET /categories/:id` / `PATCH /categories/:id` / `DELETE /categories/:id` | detail/update/archive | no cycles; cannot archive with active product/menu refs | Audit. |
| `GET /products` / `POST /products` | paged products / create product with optional variants/group links | filters categoryId,type,branchId,channel,availability,discountEligibility; validate tax/packaging/image | Audit; catalog-change outbox. |
| `GET /products/:id` / `PATCH /products/:id` / `DELETE /products/:id` | full detail/update/archive | code/SKU unique; combo rules; active references | Audit/outbox. |
| `POST /products/:id/variants` | create variant → Variant | unique code; default invariant | Audit. |
| `PATCH /products/:id/variants/:variantId` / `DELETE ...` | update/archive variant | used historic variant may archive; default reassignment required | Audit. |
| `PUT /products/:id/modifier-groups` | `{version,groups:[{groupId,sortOrder,minOverride?,maxOverride?}]}` → Product | active groups; valid overrides | Replace links/audit/outbox. |
| `PUT /products/:id/combo-components` | component DTO array → Product | product is COMBO; no cycles/nested combos; valid selection counts | Replace/audit. |
| `GET /modifier-groups` / `POST /modifier-groups` | paged groups / create with options optional | min/max/free constraints | Audit. |
| `GET /modifier-groups/:id` / `PATCH ...` / `DELETE ...` | detail/update/archive | cannot reduce max below product override or active option requirements | Audit. |
| `POST /modifier-groups/:id/options` | create option → DTO | unique code | Audit. |
| `PATCH /modifier-groups/:id/options/:optionId` / `DELETE ...` | update/archive | historic use retained | Audit. |
| `GET /products/:id/availability` | list rules | filters branch/channel/activeAt | — |
| `POST /products/:id/availability` | create availability/suspension rule | valid range/schedule; max suspension 30 days per action | Audit/outbox. |
| `PATCH /products/:id/availability/:ruleId` / `DELETE ...` | update/archive | matching product | Audit/outbox. |
| `POST /products/:id/suspend` | `{branchId?,channel?,until,reason}` → rule | future until, reason | Creates availability rule; audit/outbox. |
| `POST /products/:id/resume` | `{availabilityRuleId}` → product availability | current suspension exists | Ends rule now; audit/outbox. |
| `GET /menus` / `POST /menus` | paged menus / create menu | filters branch/channel/effectiveAt; no overlap | Audit/outbox. |
| `GET /menus/:id` / `PATCH /menus/:id` / `DELETE /menus/:id` | detail/update/archive | date/menu constraints | Audit/outbox. |
| `PUT /menus/:id/composition` | `{version,categories:[{categoryId,sortOrder,displayNameOverride?,products:[{productId,sortOrder,isFeatured}]}]}` → MenuDetail | active products/categories; no duplicates | Atomic replace/audit/outbox. |
| `GET /tax-rules` / `POST /tax-rules` | paged/list tax rules / create | rate/range; filters activeAt | Audit. |
| `PATCH /tax-rules/:id` / `DELETE ...` | update/archive | used historic rule not deleted | Audit. |
| `GET /packaging-rules` / `POST /packaging-rules` | list/create | amount/currency/range | Audit. |
| `PATCH /packaging-rules/:id` / `DELETE ...` | update/archive | referenced behavior | Audit. |
| `GET /aggregator-mappings` / `POST /aggregator-mappings` | paged mappings / create | filters provider,branch,entityType,q; SNAPPFOOD only currently | Audit/simulation log. |
| `PATCH /aggregator-mappings/:id` / `DELETE ...` | update/archive | external uniqueness | Audit. |
| `POST /catalog/imports` **I** | multipart CSV + `{domain,mapping}` → ImportJob | headers/mapping, UTF-8, max 10 MB/20k rows | Stage and validate; audit. |
| `GET /catalog/imports/:id` | job + paged error rows | row page/filter status | — |
| `POST /catalog/imports/:id/commit` **I** | `{mode:'CREATE_ONLY'\|'UPSERT'}` → job | validated job, no errors for all-or-nothing; `409 IMPORT_CHANGED` | Transactional write/outbox/audit. |
| `GET /catalog/export` | CSV stream | filters same as product list; selected columns allowlist | Audit export. |

### 8.5 Pricing and discounts

| Method / URL | Purpose; request → response | Validation / filters / errors | Side effects / audit |
|---|---|---|---|
| `GET /price-groups` / `POST /price-groups` | paged groups / create | `q,isActive`; code unique | Audit. |
| `GET /price-groups/:id` / `PATCH ...` / `DELETE ...` | detail/update/archive | archive only after branch reassignment | Audit. |
| `PUT /price-groups/:id/branches` | `{version,branchIds}` → group detail | active branches; one group/branch | Atomic membership/audit. |
| `GET /prices` | paged `PriceEntryDto` | filters target/product/variant/modifier/branch/group/channel/orderType/currency/type/effectiveAt; sort effectiveFrom,amount,productName | — |
| `POST /prices` | `PriceEntryCreateDto` → entry | complete target dimensions; amount/range/currency; `409 PRICE_RANGE_OVERLAP` | Audit; price-change outbox. |
| `PATCH /prices/:id` | only future unused row fields + version → entry | effective/used row must be superseded; `422 PRICE_IMMUTABLE` | Audit/outbox. |
| `DELETE /prices/:id` | archive future unused | `409 PRICE_ALREADY_EFFECTIVE` | Audit/outbox. |
| `GET /prices/resolve` | query context → resolved breakdown | productId, branchId, channel, orderType, currency, at; `422 PRICE_NOT_CONFIGURED` | Optional diagnostic audit omitted. |
| `GET /prices/:id/history` | audit timeline → paged | date/action sort occurredAt | — |
| `POST /price-bulk/preview` | bulk request → `{previewToken,rows,expiresAt}` | max 500 products; operation/range | No mutation; no audit. |
| `POST /price-bulk/commit` **I** | `{previewToken}` → BulkJob | token 10 min, unchanged inputs; all rows valid | Atomic rows/outbox/audit. |
| `GET /discounts` / `POST /discounts` | paged campaigns / create full campaign/scopes | filters type,active,effectiveAt,q,branch; type-specific fields, scope validity | Audit. |
| `GET /discounts/:id` / `PATCH ...` / `DELETE ...` | detail/update/archive | used campaign can change future behavior but history snapshots remain | Audit. |
| `GET /coupons` / `POST /coupons` | paged/create coupon | filters campaign,active,q; uppercase unique, campaign requires coupon | Audit. |
| `PATCH /coupons/:id` / `DELETE ...` | update/archive | usage count immutable | Audit. |
| `POST /discount-quotes` | `DiscountQuoteRequest{orderDraft,manual?,couponCode?}` → Quote discount decision | full draft context; invalid coupon `422` | Audit only when manual/approval candidate. |

### 8.6 Customers and credit

| Method / URL | Purpose; request → response | Validation / filters / errors | Side effects / audit |
|---|---|---|---|
| `GET /customers` / `POST /customers` | paged search / create profile with phones/addresses/tags/consents | filters q,phone,email,tag,segment,homeBranch,status; sort name,customerNumber,createdAt; normalized fields | Audit/customer-change outbox. |
| `GET /customers/:id` / `PATCH ...` / `DELETE ...` | detail/update/archive | merged customer redirects with `409 CUSTOMER_MERGED` target; delete only no transactions | Audit/outbox. |
| `GET /customers/:id/history` | combined order/credit/audit history → paged | filters type/date; sort occurredAt | Audit sensitive history read. |
| `POST /customers/duplicates` | profile fields → candidate list with scores/reasons | phone/email/name present | No mutation. |
| `POST /customers/merge` **I** | `{sourceId,targetId,fieldResolution,reason,version[]}` → target | no processing orders; valid resolution; `409 MERGE_CONFLICT` | Relink allowed references, source merge marker, audit/outbox. |
| `GET /customer-tags` / `POST /customer-tags` | list/create | q/active; color format | Audit. |
| `PATCH /customer-tags/:id` / `DELETE ...` | update/archive | — | Audit. |
| `GET /customer-segments` / `POST /customer-segments` | list/create segment | allowlisted definition filters | Audit. |
| `PATCH /customer-segments/:id` / `DELETE ...` | update/archive | — | Audit. |
| `POST /customer-imports` **I** | upload/map CSV → ImportJob | max 20k; required phone/name per policy | Stage/audit. |
| `GET /customer-imports/:id` / `POST /customer-imports/:id/commit` **I** | results / commit | commit mode create/upsert; duplicate strategy SKIP/UPDATE/REVIEW | Writes customer records/audit/outbox. |
| `GET /credit-accounts` | paged account search | filters customer,q,status,currency,availableBelow; sort balance/customerName | — |
| `POST /customers/:customerId/credit-accounts` | `{currencyCode,mode,creditLimit?,policyNote?}` → account | one/customer/currency | Audit. |
| `GET /credit-accounts/:id` / `PATCH ...` | detail/update policy/status | limit reduction below exposure requires approval; currency immutable | Audit. |
| `POST /credit-accounts/:id/suspend` / `.../activate` | `{reason,approvalRequestId?,version}` → account | reason; cannot close with nonzero balance | Audit. |
| `GET /credit-accounts/:id/statement` | paged entries + opening/closing totals | dateFrom/dateTo,type,branch,shift; sort postedAt | Audit sensitive export/read. |
| `POST /credit-accounts/:id/repayments` **I** | `{amount,methodId,reference,reason?,version}` → entry/balance | positive, currency/method; overpayment approval | Immutable posting/audit. |
| `POST /credit-accounts/:id/adjustments` **I** | `{amountSigned,reasonCodeId,reason,reference,approvalRequestId,version}` | nonzero/exact approval | Immutable posting/audit. |
| `GET /credit-aging` | paged customers + bucket totals | filters asOf,branch,customer,status; sort total/bucket/name | — |

### 8.7 Dine-in and orders

| Method / URL | Purpose; request → response | Validation / filters / errors | Side effects / audit |
|---|---|---|---|
| `GET /dining/sections` / `POST /dining/sections` | list/create section | branchId required list filter; sort sortOrder/name | Audit. |
| `PATCH /dining/sections/:id` / `DELETE ...` | update/archive | no active tables on archive | Audit. |
| `GET /dining/tables` / `POST /dining/tables` | list/floor state / create | filters branch,section,status,q; capacity | Audit create/update. |
| `PATCH /dining/tables/:id` / `DELETE ...` | update/archive | occupied cannot archive/move branch | Audit. |
| `GET /dining/floor` | full branch section/table/order summaries | branchId; optional section/status | No pagination; max prototype floor 500 tables. |
| `POST /dining/orders/:orderId/move-table` | `{targetTableId,guestCount?,...meta}` → Order | target available/same branch; allowed state | Locks tables/order; occupancy/state audit. |
| `POST /dining/orders/merge` **I** | `{sourceOrderIds,targetOrderId,reason,...meta}` → detail | same branch/currency, no processing pay | Item links/occupancy/audit. |
| `POST /orders/:id/split` **I** | `{lines:[{orderItemId,quantity}],targetTableId?,settlementPlan?,...meta}` → `{source,newOrder}` | positive remaining qty; payment rule | Create linked order/audit/KDS updates. |
| `POST /orders/transfer-items` **I** | `{sourceOrderId,targetOrderId,lines,reason,...meta}` → both orders | compatibility; unpaid default | Links/quotes/audit/KDS. |
| `GET /orders` | paged summaries | filters q,branch,state,type,channel,customer,table,shift,businessDateFrom/To,paymentStatus,createdFrom/To; sort createdAt,orderNumber,grandTotal,state | — |
| `POST /orders` | `OrderCreateDto{branchId,terminalId?,shiftId?,channel,orderType,currencyCode,customerId?,tableId?,guestCount?,deliveryAddressId?,items?,notes?}` → detail | context/type/shift | Create DRAFT/event/audit. |
| `GET /orders/:id` | full detail | — | — |
| `PATCH /orders/:id` | draft metadata/items + version → detail | only DRAFT for generic patch; submitted uses edit command | Requote/audit. |
| `POST /orders/:id/quote` | optional `{couponCode,manualDiscount,deliveryZoneId,version}` → Quote | current draft; product/price/discount rules | No persistent financial change; audit manual request. |
| `POST /orders/:id/submit` **I** | `{quoteVersion,approvalRequestIds?,version}` → detail | stale quote, required fields, usage limits | Snapshots, state/KDS/print/delivery outbox, audit. |
| `POST /orders/:id/confirm` | `CommandMeta` → detail | state/action/approval | State event/audit/KDS. |
| `POST /orders/:id/start-preparation` | meta → detail | state/KDS | State event/audit. |
| `POST /orders/:id/mark-ready` | meta → detail | KDS readiness or approval | State event/audit. |
| `POST /orders/:id/dispatch` | meta → detail | delivery assignment/status | Order+delivery events/audit. |
| `POST /orders/:id/complete` | meta → detail | type/payment/outstanding | State/audit. |
| `POST /orders/:id/edit` **I** | `{changes,quoteVersion,refundPlan?,...meta}` → detail | action matrix/window/approval/paid-total rule | Versioned line changes/requote/refund orchestration/audit. |
| `POST /orders/:id/replace-item` **I** | `{orderItemId,replacement,reasonCodeId,reason,quoteVersion,...meta}` → detail | allowed/price/payment | Supersede line/KDS/audit. |
| `POST /orders/:id/cancel` **I** | `{reasonCodeId,reason,refundPlan?,...meta}` → detail | window/approval/refund success | Refund orchestration/state/KDS/print/audit. |
| `POST /orders/:id/reopen` **I** | `{reasonCodeId,reason,approvalRequestId,version}` → detail | cancelled unpaid from SUBMITTED/same business day | State/audit. |
| `GET /orders/:id/history` | paged unified timeline | filters eventType/actor/date; sort occurredAt | — |
| `GET /orders/:id/guest-bill` | HTML/JSON preview | dine-in order; query locale | Creates no print job; audit not needed. |
| `POST /orders/:id/reprint` **I** | `{documentType,reasonCodeId,reason,copies}` → PrintJob | allowed document/copies; approval if rule | Enqueue simulated print/audit. |

### 8.8 Shifts, payments, and refunds

| Method / URL | Purpose; request → response | Validation / filters / errors | Side effects / audit |
|---|---|---|---|
| `GET /shifts` | paged shifts | filters branch,terminal,state,businessDate,currency; sort openedAt,closedAt,variance | — |
| `POST /shifts/open` **I** | `{terminalId,currencyCode,openingCash,businessDate}` → Shift | active cashier terminal/no open shift | Shift + opening movement/audit. |
| `GET /shifts/current` | current shift | terminalId query | `404 NO_OPEN_SHIFT` |
| `POST /shifts/:id/movements` **I** | `{type:'PAID_IN'\|'PAID_OUT',amount,reasonCodeId,reason,reference,version}` → movement/shift | OPEN, positive; paid-out cannot exceed policy without approval | Movement/audit. |
| `POST /shifts/:id/begin-close` | `{version}` → ClosePreview | OPEN, no processing financials | State review/audit. |
| `POST /shifts/:id/return-to-open` | `{reason,version}` → Shift | CLOSING_REVIEW | State/audit. |
| `POST /shifts/:id/close` **I** | `{actualCash,reasonCodeId?,reason?,approvalRequestId?,previewVersion,version}` → Statement | preview current/discrepancy rules | Close movement/state/audit. |
| `GET /shifts/:id/statement` | statement DTO/export view | closed or preview | — |
| `GET /business-days` | paged closes/status | branch/date/currency/status | — |
| `POST /business-days/close` **I** | `{branchId,businessDate,currencyCode}` → close | no open shifts/processing | Snapshot/audit. |
| `POST /business-days/:id/reopen` | `{reason,approvalRequestId,version}` → close | approved | Mark reopened/audit. |
| `GET /payment-devices` / `POST /payment-devices` | paged/list/create device | filters branch,kind,ownership,active,q; valid account/kind | Audit. |
| `PATCH /payment-devices/:id` / `DELETE ...` | update/archive | device identifier unique; active assignment prevents archive | Audit. |
| `GET /settlement-accounts` / `POST /settlement-accounts` | list/create account | currency/identifier | Audit. |
| `PATCH /settlement-accounts/:id` / `DELETE ...` | update/archive | referenced behavior | Audit. |
| `GET /payments` | paged payments | filters order,branch,shift,status,kind,method,device,account,businessDate,reference,q; sort initiatedAt,amount,status | — |
| `POST /orders/:orderId/payments` **I** | `{methodId,amount,deviceId?,reference?,receiptNumber?,scenarioId?,shiftId?,version}` → Payment | outstanding/currency/method/shift/device; one active attempt | Create/process; cash/credit synchronous, external attempt; audit. |
| `GET /payments/:id` | payment + attempts/allocations/refunds | — | — |
| `POST /payments/:id/retry` **I** | `{scenarioId?,version}` → Payment | FAILED, order payable | New attempt/outcome/audit. |
| `POST /payments/:id/cancel` | `{reason,version}` → Payment | PENDING/FAILED | State/audit. |
| `POST /payments/:id/reverse` **I** | `{reasonCodeId,reason,approvalRequestId?,version}` → payment/link | same-day eligible | Linked reverse cash/credit/adapter effects/audit. |
| `POST /payments/:id/correct` **I** | `{reason,approvalRequestId?,replacementPayment}` → `{reversed,replacement}` | reversal eligible; replacement valid | Reversal then new payment; audit group. |
| `GET /refunds` | paged refunds | filters order,branch,status,method,alternative,businessDate,reason; sort initiatedAt,amount,status | — |
| `POST /orders/:orderId/refunds` **I** | `{amount?,full?,allocations?,targetMethodId?,deviceId?,reference,reasonCodeId,reason,approvalRequestId?,scenarioId?,shiftId?,version}` → Refund | refundable/alternative rules | Create/process/post/audit. |
| `GET /refunds/:id` | refund + allocations/attempts | — | — |
| `POST /refunds/:id/retry` **I** | `{scenarioId?,version}` → Refund | FAILED, same immutable request | New attempt/audit. |
| `POST /refunds/:id/cancel` | `{reason,version}` → Refund | PENDING/FAILED | State/audit. |
| `POST /refunds/:id/reverse` **I** | `{reasonCodeId,reason,approvalRequestId,version}` → Refund | eligible same day/method | Linked counter entries/audit. |

### 8.9 KDS and printing

| Method / URL | Purpose; request → response | Validation / filters / errors | Side effects / audit |
|---|---|---|---|
| `GET /kds/board` | active tickets grouped by station → board | branchId required; stationIds,state; limit 500, not paged | — |
| `GET /kds/events` | SSE stream | branch/stations; authenticated; heartbeat 15s | Read only; client falls back to 5s polling. |
| `POST /kds/tickets/:id/start` / `.../bump` / `.../recall` | `{reason?,version}` → ticket | state; recall reason/time approval | Event, order readiness recompute, audit. |
| `POST /kds/tickets/:id/priority` | `{priority,reason,version}` → ticket | 0–9 | Event/audit. |
| `POST /kds/ticket-items/:id/state` | `{state,reason?,version}` → item/ticket | allowed item state | Recompute ticket/order; audit. |
| `GET/POST/PATCH/DELETE /kds/stations[/:id]` | station CRUD | branch/q/active list; target minutes | Audit. |
| `GET/POST/PATCH/DELETE /kds/screens[/:id]` | screen CRUD | active stations/terminal | Audit. |
| `GET/POST/PATCH/DELETE /kds/routing-rules[/:id]` | rule CRUD | exactly product/category, same branch | Audit. |
| `GET/POST/PATCH/DELETE /printers[/:id]` | printer CRUD | list branch/type/active/q; no fallback cycles | Audit. |
| `GET/POST/PATCH/DELETE /printer-groups[/:id]` | group CRUD | members/priority/copies valid | Audit. |
| `GET/POST/PATCH/DELETE /print-routes[/:id]` | route CRUD | target specificity/same branch | Audit. |
| `GET /print-jobs` | paged jobs | filters branch,status,type,entity,reprint,date; sort createdAt,status | — |
| `GET /print-jobs/:id` | job + attempts + preview | — | — |
| `POST /print-jobs/:id/retry` **I** | `{scenarioId?,useFallback?,reason}` → job | failed/dead; printer active | Queue/attempt/audit. |
| `POST /print-jobs/:id/reprint` **I** | `{reasonCodeId,reason,copies}` → new job | completed/failed source | Linked reprint queue/audit. |

### 8.10 Delivery and couriers

| Method / URL | Purpose; request → response | Validation / filters / errors | Side effects / audit |
|---|---|---|---|
| `GET/POST/PATCH/DELETE /delivery-zones[/:id]` | zone CRUD | list branch/active/q; geometry/prefix/fee rules | Audit. |
| `GET /couriers` / `POST /couriers` | paged/create | filters branch attendanceStatus/active/q; phone/compensation | Audit. |
| `GET /couriers/:id` / `PATCH ...` / `DELETE ...` | detail/update/archive | active deliveries/terminal assignment block archive | Audit. |
| `POST /couriers/:id/check-in` **I** | `{branchId,businessDate,status,note?}` → Attendance | unique day; active courier | Attendance audit. |
| `POST /couriers/:id/check-out` | `{note?,version}` → Attendance | no EN_ROUTE deliveries; return terminal or record exception | Audit. |
| `PATCH /couriers/:id/availability` | `{branchId,businessDate,status,note?,version}` → Attendance | checked in | Audit. |
| `POST /couriers/:id/terminal-assignments` **I** | `{deviceId,conditionNote?}` → assignment | company mobile device, both free | Audit. |
| `POST /courier-terminal-assignments/:id/return` | `{conditionNote?,version}` → assignment | active | Audit. |
| `GET /deliveries` | paged deliveries | filters branch,state,courier,zone,businessDate,order,q; sort assignedAt,deliveryTime,state | — |
| `GET /deliveries/:id` | detail/history/payment expectations | — | — |
| `POST /deliveries/:id/assign` | `{courierId,reason?,version}` → Delivery | availability/capacity/state | Assignment event/audit. |
| `POST /deliveries/:id/pick-up` / `.../depart` | meta → Delivery | state/order ready | Delivery+order event/audit. |
| `POST /deliveries/:id/deliver` **I** | `{cashReceived?,mobileReceipts?:[{paymentId,receiptNumber}],note?,version}` → Delivery/order | expectations/payment completion | Delivery/order state, receipt data/audit. |
| `POST /deliveries/:id/fail` | `{reasonCodeId,reason,version}` → Delivery | state eligible | Event/audit. |
| `POST /deliveries/:id/requeue` | `{reason,version}` → Delivery | FAILED | Unassign/event/audit. |
| `GET /courier-settlements/preview` | computed eligible lines/totals | courierId,branchId,dateFrom/dateTo,currency | No mutation. |
| `GET /courier-settlements` | paged batches | filters courier,branch,state,date,currency; sort createdAt,discrepancy | — |
| `POST /courier-settlements` **I** | `{courierId,branchId,dateFrom,dateTo,currency,lineIds}` → DRAFT | eligibility/no duplicate lines | Snapshot/locks reservations/audit. |
| `GET /courier-settlements/:id` | detail/lines/events | — | — |
| `PATCH /courier-settlements/:id` | `{actualCash,receiptVerifications,adjustments,version}` → DRAFT | DRAFT; reasons for adjustments | Update draft/audit. |
| `POST /courier-settlements/:id/review` | `{version}` → UNDER_REVIEW | required actuals/verifications | State/audit. |
| `POST /courier-settlements/:id/return` | `{reason,version}` → DRAFT | under review | State/audit. |
| `POST /courier-settlements/:id/close` **I** | `{reasonCodeId?,reason?,approvalRequestId?,version}` → CLOSED | discrepancy rules | Immutable close/audit. |
| `POST /courier-settlements/:id/reverse` **I** | `{reasonCodeId,reason,approvalRequestId,version}` → reversal | CLOSED/not reversed | Counter batch/free lines/audit. |
| `GET /courier-settlements/:id/statement` | localized statement DTO/HTML | closed/reversed | Audit export if downloaded. |

### 8.11 Kiosk and system

| Method / URL | Purpose; request → response | Validation / filters / errors | Side effects / audit |
|---|---|---|---|
| `GET /kiosk/bootstrap` | `terminalId` → `{branch,terminal,identificationPolicy,locale,currency,menu,categories,paymentMethods,simulatedCapabilities}` | active KIOSK terminal; `422 KIOSK_TERMINAL_REQUIRED`; menu may return domain empty state | Read-only aggregation; product pages and order/payment commands remain the standard APIs. |
| `POST /system/reset` **I** | `{confirmation,password}` → `202 {resetId,status:'PENDING'}` | exact phrase, current shared-admin password; `403 PASSWORD_INVALID`, `409 RESET_IN_PROGRESS` | Creates reset job/security marker and starts reset; all sessions later revoked. |
| `GET /system/reset/:id` | → `{id,status,requestedAt,startedAt?,completedAt?,resultCounts?,errorCode?,correlationId}` | reset job exists | Read only; no password/confirmation retained. |

### 8.12 Simulation Center

Every response includes `{simulated:true, correlationId}`. These endpoints always create `simulation_log`; domain effects use normal public services and validations.

| Method / URL | Purpose; request → response | Validation / filters / errors | Side effects / audit |
|---|---|---|---|
| `GET /simulation/scenarios` / `POST /simulation/scenarios` | list/create deterministic scenarios | filters kind,outcome,active; outcome compatible; latency 0–3000 | Audit. |
| `PATCH /simulation/scenarios/:id` / `DELETE ...` | update/archive | built-in scenario code cannot delete, only disable | Audit. |
| `POST /simulation/snappfood/orders` **I** | `{branchId,externalOrderId?,orderType,customer,address?,notes?,items:[{externalProductId,quantity,modifiers}],additionalPayment?,scenarioId}` → order/webhook/log | mappings/HMAC-generated internally; valid branch | Webhook receipt, real order/KDS/delivery, ack log. |
| `POST /simulation/snappfood/duplicates` **I** | `{sourceWebhookReceiptId,count:1..10}` → duplicate results | source successful | Receipts/logs; no new domain order. |
| `POST /simulation/snappfood/orders/:orderId/action` | `{action:'PICK'\|'ACCEPT'\|'REJECT'\|'MODIFY'\|'CANCEL'\|'RECOVER',payload?,scenarioId}` → result | allowed order state; decline reason | Normal order command/integration log/audit. |
| `POST /simulation/snappfood/catalog-sync` **I** | `{branchId,direction:'PUSH'\|'RECOVER',entityTypes,scenarioId}` → queue items | mappings/branch | Queue/logs; no external call. |
| `POST /simulation/payments/outcome` | `{paymentId,scenarioId,outcome:'SUCCESS'\|'FAILURE'}` → Payment | payment PROCESSING/FAILED; compatible adapter | Adapter attempt/posting/audit. |
| `POST /simulation/tara/transactions` **I** | `{orderId,operation:'VALIDATE'\|'CREATE'\|'CONFIRM'\|'REVERSE'\|'REFUND'\|'SETTLE'\|'RECONCILE',amount?,scenarioId}` → result | operation/state rules | Payment/refund/integration records as applicable. |
| `POST /simulation/printers/outcome` | `{printJobId,scenarioId,outcome,useFallback?}` → PrintJob | queued/failed job | Attempt/status/log/audit. |
| `POST /simulation/branches/:id/connectivity` | `{isOnline,agentVersion?,health,reason}` → status | branch exists | Status snapshot; schedules queue worker if online; audit/log. |
| `POST /simulation/offline/operations` **I** | `{branchId,operationType,payload,localVersion?,dedupeKey}` → QueueItem | branch offline; payload schema per type | Queue/log/audit. |
| `POST /simulation/sync/trigger` **I** | `{branchId,queueItemIds?,scenarioId}` → summary | branch online; items claimable | Process queues/conflicts/log/audit. |
| `POST /simulation/sync/conflicts` **I** | `{queueItemId,cloudPayload,cloudVersion}` → conflict | item pending/processing | Conflict/log/audit. |
| `POST /simulation/sync/conflicts/:id/resolve` **I** | `{resolution:'LOCAL'\|'CLOUD'\|'MERGED',mergedPayload?}` → conflict/item | OPEN; merged validates domain | Apply/enqueue result/log/audit. |
| `POST /simulation/queues/:id/retry` **I** | `{scenarioId?}` → new/current item | FAILED/DLQ; active dedupe rules | Reset/clone/log/audit. |
| `GET /simulation/queues` | paged queue | filters branch,type,state,attempts,date,q; sort createdAt,availableAt,attempts | — |
| `GET /simulation/logs` | paged logs | filters kind,branch,level,action,entity,correlation,date,q; sort occurredAt | — |
| `GET /simulation/logs/:id` | full masked request/response chain | — | — |

The raw simulated Snappfood webhook endpoint is `POST /simulated-webhooks/snappfood/:branchCode`; it requires `X-Snappfood-Event-Id`, timestamp, and HMAC-SHA256 over `timestamp.rawBody` using the branch’s mock secret. Timestamp skew >5 minutes is `401 WEBHOOK_TIMESTAMP_INVALID`; bad signature is `401 WEBHOOK_SIGNATURE_INVALID`; duplicate event returns the stored outcome.

### 8.13 Audit, alerts, and reports

| Method / URL | Purpose; request → response | Validation / filters / errors | Side effects / audit |
|---|---|---|---|
| `GET /audit-events` | paged audit | filters actorType/actorId/action/entityType/entityId/branch/correlation/date/q; sort occurredAt only | Generic before/after masks secrets/PIN/password. |
| `GET /audit-events/:id` | full event | — | — |
| `GET /alerts` | paged alerts | filters status,severity,source,branch,date; sort openedAt,severity | — |
| `POST /alerts/:id/acknowledge` | `{note?,version}` → alert | OPEN | Acknowledge/audit. |
| `GET /reports/:reportCode` | report rows + `{summary,columns}` | report-specific filters in Section 13 plus page/sort; unknown filter rejected | No audit for ordinary view. |
| `POST /reports/:reportCode/exports` **I** | `{format:'CSV'\|'XLSX',filters,sort,columns,locale}` → ExportJob | max 100k rows; columns allowlist; `422 EXPORT_TOO_LARGE` | Queue file generation; audit export. |
| `GET /report-exports/:id` | job/status/download link | owner shared account | — |
| `GET /saved-report-views` / `POST /saved-report-views` | list/create saved layout | reportCode; filters/columns/sort validate against report | Audit. |
| `PATCH /saved-report-views/:id` / `DELETE ...` | update/archive | optimistic version | Audit. |

---

## 9. Frontend application structure

### 9.1 Route hierarchy and navigation

```text
/login
/app
  /dashboard
  /pos
  /kiosk                         (staff preview inside the app shell, labelled "Kiosk preview"; a full-screen guest device shell is not built)
  /orders
  /orders/:orderId
  /dine-in/floor
  /kds
  /delivery/orders
  /delivery/couriers
  /delivery/couriers/:courierId
  /delivery/settlements
  /delivery/settlements/:settlementId
  /cashier/shifts
  /cashier/shifts/:shiftId
  /cashier/business-days
  /payments
  /refunds
  /customers
  /customers/:customerId
  /credit/accounts
  /credit/accounts/:accountId
  /catalog/categories
  /catalog/products
  /catalog/products/:productId
  /catalog/modifiers
  /catalog/menus
  /catalog/menus/:menuId
  /catalog/availability
  /catalog/import-export
  /pricing/price-book
  /pricing/price-groups
  /pricing/bulk-update
  /discounts/campaigns
  /discounts/campaigns/:campaignId
  /discounts/coupons
  /operations/branches
  /operations/branches/:branchId
  /operations/terminals
  /operations/kds-configuration
  /operations/printers
  /operations/print-queue
  /operations/monitoring
  /simulation
  /simulation/snappfood
  /simulation/payments-printers
  /simulation/offline-sync
  /simulation/logs
  /reports/:reportCode
  /audit
  /settings/general
  /settings/order-workflow
  /settings/discounts-credit
  /settings/payments-refunds
  /settings/approvals
  /settings/reasons
  /settings/localization
  /settings/data-reset
```

Primary navigation groups, in order: **Live Operations** (Dashboard, POS, Dine-in, KDS, Incoming Orders, Delivery, Cashier, Orders, Kiosk preview, Payments, Refunds, Print Queue), **Business Management** (Catalog, Prices, Customers & Credit, Discounts & Loyalty), **Reports & Compliance** (Reports, Audit, Moadian, Monitoring, Branch Agents, head-office roll-ups), **Settings & System** (Settings Hub, Users & Roles), **Simulation Sandbox**. The header scope is either head office or one branch. An unconfined account with no saved choice starts at head office. Each scope shows its own menu: head office shows the chain's screens and hides the ones that run one site; a branch shows its own screens and hides the chain's. A site-only page opened at head office by its address asks which branch to open it in. Organization settings that a branch can see are read-only there and labelled "Set at head office". The header search covers the sidebar and the Settings Hub cards. Menus Composer (`/app/catalog/menus`) stays routable but has no menu link while no selling channel reads menus. A persistent **SIMULATED ENVIRONMENT** banner appears on simulator, kiosk hardware status, external payment, print, branch-status, and sync pages.

### 9.2 Layout and reusable components

- `AppShell`: responsive top bar, logical-direction navigation drawer, branch selector, business-date indicator, locale switcher, alerts, user menu.
- `PageHeader`: title, localized help text, breadcrumbs, primary action, status chips.
- `ServerDataGrid`: MUI X grid in server pagination/filter/sort mode; URL-synchronized filters; density/columns saved where supported; row actions menu; CSV-safe text.
- `EntityFormDrawer`: create/quick edit, 480 px logical width desktop, full screen mobile, dirty-close confirmation.
- `ConfirmActionDialog`: action-specific title/body, impact summary, reason selector/note, approval state, exact destructive label.
- `ApprovalStepperDialog`: matching rule, requester action summary, ordered approver profiles, secure PIN input, attempt/lock status; PIN cleared after every submission.
- `MoneyField`: string-controlled, locale display on blur, canonical decimal on submit, currency suffix/prefix.
- `LocalizedTextFields`: English/Persian tabs, fallback indicator, character counts.
- `DateTimeRangeField`: locale-aware picker; displays zone; sends ISO.
- `StatusChip`, `SimulatedBadge`, `AuditTimeline`, `MoneyBreakdown`, `OrderStateStepper`, `EmptyState`, `ErrorPanel`, `SkeletonPage`, `UnsavedChangesGuard`, `FileImagePicker`, `ReferenceAutocomplete` (debounced server search), and `ReasonApprovalBlock`.

### 9.3 Forms, state, and API clients

- React Hook Form owns form state; Zod mirrors DTO shape and immediate constraints. Backend field errors map by `field` into the form. Business rules remain backend-only and render in an error summary.
- TanStack Query keys begin `[domain, tenantId, branchId?, filters...]`. Mutations invalidate only affected resource/list/report summaries. Optimistic updates are limited to cosmetic preference changes; financial/order transitions wait for server response.
- `src/api/httpClient.ts` sends cookie, CSRF, locale, correlation ID, `Idempotency-Key`, parses Problem Details, and retries GET once on transient failure; mutations never auto-retry.
- One API file per backend domain. Command hooks expose `isPending` and disable repeat action. Idempotency UUID is generated when a dialog opens and remains stable until the command succeeds or its inputs change.
- URL search params are the source of truth for lists/reports; browser back restores filters/page. Sensitive PINs, passwords, and customer details are never placed in URL/localStorage.
- POS draft cart is stored in `sessionStorage` keyed by branch/terminal/shift, without payment details. On restore it is requoted and unavailable lines are highlighted.

### 9.4 Loading, empty, and error behavior

- Initial pages show structured skeletons, not spinners over blank screens. Background refresh keeps existing data and shows a small progress bar.
- Every grid has a domain-specific empty message plus primary action if creation is possible. Filtered-empty state offers “Clear filters.”
- Inline lookup failures retain entered form values and offer retry. Full-page `404` provides return link. `409 VERSION_CONFLICT` opens a compare/reload dialog; never overwrites automatically.
- `QUOTE_STALE` displays old versus new totals and requires explicit “Accept new quote.” `APPROVAL_REQUIRED` opens the stepper without losing the attempted form. External simulated failure shows method, scenario, error code, retained successful allocations, and Retry/Change method actions.
- Toasts confirm successful commands but never contain secrets. Persistent workflow errors are inline near the affected aggregate.

### 9.5 RTL/LTR and responsiveness

- At 1280 px and above, admin pages use full navigation and grids. At 768–1279 px, drawer collapses and forms use two/one columns. Below 768 px, grids switch to card lists for operational pages; complex administration displays a supported-tablet notice but remains usable with horizontal grid scroll.
- POS and kiosk are touch-first from 360 px upward: minimum touch target 48 px, product tiles minimum 120×96 px desktop/tablet, bottom-sheet cart on narrow devices.
- In RTL, navigation opens from inline-start, form labels and grid text follow content direction, numeric money columns remain end-aligned, phone/reference/IDs render LTR with `dir="ltr"`, and stepper progression mirrors. Icon meanings (play, arrow progression) mirror; universal icons (print, delete) do not.

---

## 10. Page-by-page specifications

### 10.1 Global page rules

Every page below must implement skeleton, domain empty state, filtered empty state, Problem Details error panel with retry/correlation ID, permission/action disabling from backend `availableActions`, localized labels/tooltips, keyboard focus, RTL/LTR, and audit link where the record has history. Required fields show localized required marker and validation before submit. Archive/cancel/refund/reverse/close/merge/reset actions always use confirmation dialogs; archive dialogs name the entity and explain historical retention.

### 10.2 Home, orders, dine-in, cashier, and finance pages

| Route/page | Visible content, workflow, filters/actions/validation | Endpoints and acceptance criteria |
|---|---|---|
| `/login` **Sign in** | Logo, environment label, username, password, locale. Submit disabled empty. Generic invalid message; lock countdown. | `POST /auth/login`, `GET /auth/me`. Successful login sets direction before rendering dashboard; credentials never persist in browser. |
| `/app/dashboard` **Operations dashboard** | Branch/date filters; KPI cards sales/orders/outstanding/open shifts/open alerts; branch status table (branch, online, heartbeat, last sync, agent); recent orders/alerts. Simulated status cards are labeled. | reports summary, branches/status, alerts, orders. Changing branch refreshes all cards; failed widget is independently retryable. |
| `/app/orders` **Orders** | Columns number, business date/time, branch, channel/type, customer/table, state, total, paid/refunded/outstanding, cashier/shift. Filters per API. Actions view, continue draft in POS, reprint, eligible cancel/refund. | `GET /orders`, reprint command. Server paging/sort; status totals match detail; URL persists filters. |
| `/app/orders/:id` **Order detail** | Header/state stepper; totals; item/modifier table; notes; customer/table/delivery; payments/refunds; KDS/delivery chips; adjustment breakdown; unified timeline. Actions are exact backend available actions: edit/replace, confirm/start/ready/dispatch/complete, cancel, split/transfer, pay/refund/reprint. Dialogs capture required reason/approval/refund plan. | `GET /orders/:id`, all order action/payment/refund/history endpoints. After command detail refreshes without duplicate event; immutable original amounts/history remain visible. |
| `/app/dine-in/floor` **Floor** | Branch/section filters; section tabs; table cards show status, capacity, guests, order number/amount/age. Select free table → new dine-in POS; occupied → order drawer. Actions move, merge, split, transfer, print bill, settle. | floor/dining/order endpoints. Conflicting operation returns refresh prompt; moving/merging updates both table cards atomically. |
| `/app/cashier/shifts` **Shifts** | Grid number, branch, terminal, business date, currency, state, opened/closed, expected, actual, variance. Filters. Actions open shift, view/current, close eligible. Open dialog: terminal/currency/business date/opening cash. | shift list/open/current. Cannot open duplicate terminal shift; created shift becomes POS context. |
| `/app/cashier/shifts/:id` **Shift detail/close** | Summary, movements table (time,type,amount,reason,reference), sales by method, open/outstanding orders, close preview. Add paid-in/out. Begin close → actual cash → variance/reason/approval → close. | shift movement/begin/return/close/statement. Noncash never changes expected cash; closed statement totals reconcile exactly. |
| `/app/cashier/business-days` **Business days** | Branch/date/currency filters; cards/grid status, shift count, sales, pending financials, close/reopen. Confirmation lists blockers. | business-day endpoints. Close blocked until stated conditions; reopen needs approval and remains audited. |
| `/app/payments` **Payments** | Columns payment no/order/date/branch/shift/method/device/account/reference/amount/status/refunded. Filters API. Detail drawer shows attempts/allocations; actions retry, reverse, correct. | payments endpoints. Failed attempt does not affect posted totals; correction shows both linked records. |
| `/app/refunds` **Refunds** | Columns refund no/order/date/branch/original methods/target method/alternative chip/amount/reason/reference/status/approver. Filters; detail allocations/attempts; retry/reverse. | refunds endpoints. Alternative method visibly distinguished and exportable; no original payment mutation. |

### 10.3 Customers, credit, delivery, KDS, and printing pages

| Route/page | Visible content, workflow, filters/actions/validation | Endpoints and acceptance criteria |
|---|---|---|
| `/app/customers` **Customers** | Grid customer number, name, primary phone, email, home branch, tags, credit status/balance, last order. Filters q/phone/tag/segment/branch/status. Create form has identity, multiple phones/addresses, tags, consent, custom fields; duplicate candidates shown before save. Actions view/edit/merge/import. | customer/tag/segment/duplicate endpoints. Persian search and normalized phone search work; merge preview requires field resolution. |
| `/app/customers/:id` **Customer detail** | Profile header; tabs Overview, Phones/Addresses, Orders, Credit, Consent, Activity. Edit drawer, add/open credit, merge. Merged source shows target link. | customer detail/history, orders filtered, credit endpoints. All tabs real persisted data; edits reflected in POS customer search. |
| `/app/credit/accounts` **Credit accounts** | Grid customer, currency, mode, limit, balance, available, status, oldest debt. Filters/status/currency/branch/balance; actions open, suspend/activate, repay, adjust. | credit list/aging. Totals string-safe and match ledger; approval flow retains form. |
| `/app/credit/accounts/:id` **Credit detail** | Account policy and current balance; statement grid date/type/order/payment/reference/debit/credit/balance; date/type filters; aging cards. Dialogs repayment/adjust/suspend. | account/statement/aging commands. Running balance reconciles; immutable entries have linked reversal. |
| `/app/kds` **Kitchen display** | Full-screen station selector; columns New/In Progress/Ready; cards number, channel badge, aggregator, age timer, priority, items/modifiers/notes. Actions start/bump/recall/change priority and item state. Connection/offline simulated banner. | KDS board/SSE/actions. New submitted ticket appears without reload; timer colors and state rules exact; RTL card order mirrors. |
| `/app/delivery/orders` **Delivery board** | Branch/date/courier/state filters; kanban/list toggle. Card order/customer/address/zone/fee/state/courier/payment expectations/age. Actions assign/reassign, pickup, depart, deliver (cash/receipt capture), fail/requeue. | delivery/courier endpoints. Only available couriers selectable; completion captures separate cash/POS. |
| `/app/delivery/couriers` **Couriers** | Grid code/name/phone/attendance/today status/active deliveries/device/expected cash/POS. Actions create/edit, check in/out, availability, assign/return device, detail. | courier/attendance/assignment endpoints. Device cannot have two active assignees; attendance state updates delivery selector. |
| `/app/delivery/couriers/:id` **Courier detail** | Profile, attendance calendar/list, active/history deliveries, assigned device, unsettled totals, past settlements. | courier/delivery/settlement report endpoints. Totals split cash and POS. |
| `/app/delivery/settlements` **Courier settlements** | Filters courier/branch/date/state/currency; grid no/courier/range/expected cash/actual cash/expected POS/verified POS/compensation/net/discrepancy/state. Create opens preview and line selector. | settlement preview/list/create. Already-settled lines unavailable; preview matches report. |
| `/app/delivery/settlements/:id` **Settlement detail** | Instrument summary cards; line grid delivery/payment/type/expected/actual/reference/verified/discrepancy; compensation/adjustments; workflow stepper. Edit draft, review, return, close, reverse, statement. | settlement commands/detail. Close validations and approval exact; closed data read-only. |
| `/app/operations/printers` **Printer configuration** | Tabs Printers, Groups, Routes. Grids/forms show branch/type/simulated address/fallback; group members/priority/copies; route document/target/group/priority. All have SIMULATED badge. | printer/group/route CRUD. Fallback cycles and invalid cross-branch routes blocked. |
| `/app/operations/print-queue` **Print queue** | Columns time/branch/document/entity/printer/status/attempts/reprint/error. Filters; detail preview/attempt history; retry/fallback/reprint. Scenario selector only in simulation mode. | print job endpoints. Failure leaves visible job; retry adds attempt; preview escapes customer input. |

### 10.4 Catalog, pricing, and discount pages

| Route/page | Visible content, workflow, filters/actions/validation | Endpoints and acceptance criteria |
|---|---|---|
| `/app/catalog/categories` **Categories** | Tree/grid code/name/parent/product count/active/sort; create/edit drawer with translations/image. Reorder uses explicit sort numbers. | category/file/translation endpoints. Cannot create cycle/archive referenced category; Persian name renders. |
| `/app/catalog/products` **Products** | Grid image/code/SKU/name/category/type/base price/availability/discount eligibility/active. Filters category/type/branch/channel/availability/q. Actions create/edit/archive/suspend/resume/export. | product/price/availability endpoints. Server pagination; effective price/availability context displayed, not guessed. |
| `/app/catalog/products/:id` **Product editor** | Tabs General (codes, translations, image, tax/packaging, discount flags), Variants, Modifier groups, Combo components, Availability, Prices, History. Save each tab with version. | product child/config/prices/audit endpoints. Min/max and combo constraints inline/backend; history remains after archive. |
| `/app/catalog/modifiers` **Modifiers** | Group cards/grid code/name/min/max/free/required/products/active; editor options code/name/translations/sort and price link. | modifier CRUD/prices. Cannot configure impossible selection; POS enforces exact rule. |
| `/app/catalog/menus` **Menus** | Grid code/name/branch/channel/effective range/categories/products/status; filters. Create. | menus endpoints. Overlap errors point to conflicting menu. |
| `/app/catalog/menus/:id` **Menu composer** | Metadata plus two-pane category/product composer; server product search; selected list with sort/featured; preview branch/channel/time. Unsaved guard. | menu composition. Save all-or-nothing; archived/unavailable products warned; effective preview matches POS. |
| `/app/catalog/availability` **Availability schedule** | Branch/channel/time filters; grid product/category/base status/specific rule/suspended until/reason. Bulk selection may create same rule for selected products (max 200). | availability/suspend/resume endpoints. Specificity explanation visible; resumes only selected rule. |
| `/app/catalog/import-export` **Catalog data exchange** | Upload CSV, choose Catalog/Customer shortcut, map columns, preview valid/error rows, commit create/upsert, download result/export. | import/export endpoints. No commit with errors in all-or-nothing mode; row errors identify line/field; UTF-8 Persian round-trip. |
| `/app/pricing/price-book` **Price book** | Context bar branch/group/channel/order type/currency/effective time; grid product/variant/resolved price/source/effective dates; row detail alternatives. Create/supersede price. | price list/resolve/create/patch. Display chosen precedence; no overlap; money exact. |
| `/app/pricing/price-groups` **Price groups** | Grid code/name/branches/active; editor branch assignment dual list. | price-group endpoints. A branch appears in one group; reassignment confirmation states future-price impact. |
| `/app/pricing/bulk-update` **Bulk price update** | Stepper: context/operation → product filter/selection → effective date → preview old/new/source/conflicts → confirm. | bulk preview/commit. Token expiry handled; no partial commit; exact rounded output. |
| `/app/discounts/campaigns` **Campaigns** | Grid code/name/type/priority/stackability/scopes/effective range/usage/funding/status; filters. Create/duplicate/archive. | discount endpoints. Expired/exhausted status derived; duplicate gets new code and inactive default. |
| `/app/discounts/campaigns/:id` **Campaign editor** | Tabs Offer, Eligibility scopes, Exclusions, Stacking/priority, Limits/coupon, Funding, Usage. Type-specific fields; live deterministic sample calculator with selected products/customer/branch. | discount CRUD/quote. Invalid combinations blocked; calculator decision reasons match POS quote. |
| `/app/discounts/coupons` **Coupons** | Grid code/campaign/period/max/used/remaining/status; create/edit/archive; search exact code. | coupon endpoints. Codes normalized uppercase; counters read-only and concurrency-safe. |

### 10.5 Configuration, monitoring, reports, audit, and settings pages

| Route/page | Visible content, workflow, filters/actions/validation | Endpoints and acceptance criteria |
|---|---|---|
| `/app/operations/branches` **Branches** | Grid code/name/price group/hours/active/online/heartbeat/sync/agent. Actions create/edit/detail, simulator connectivity link. | branch/status endpoints. Operational status labeled simulated. |
| `/app/operations/branches/:id` **Branch detail** | Tabs profile, hours, menus/prices links, terminals, operational status/logs. Seven-day hours editor. | branch/hour/terminal/status/log endpoints. Overnight hours display on correct local dates. |
| `/app/operations/terminals` **Terminals & payment devices** | Tabs cashier/kiosk/KDS terminals and payment devices/accounts. Columns branch/code/type/status/device owner/account/last seen. | terminal/device/account CRUD. Distinguish app terminal vs payment device clearly. |
| `/app/operations/kds-configuration` **KDS configuration** | Tabs Stations, Screens, Routing; station targets; screen station multi-select; rules product/category priority. Preview routing for product. | KDS config endpoints. Product rule beats category; cross-branch invalid. |
| `/app/operations/monitoring` **Operational monitoring** | Branch status cards, open alerts, offline duration, sync failures, integration/print failure summary. Filters branch/severity/source/date; acknowledge alerts. | status/alerts/simulation logs. Simulation labels; acknowledgment persists/audits. |
| `/app/reports/:reportCode` **Report viewer** | Report selector, defined filters, summary cards, ServerDataGrid, group/subtotal options, saved view menu, column chooser, CSV/XLSX export. Columns from Section 13. | report/export/saved-view endpoints. Server totals independent of page; exported rows/filters/locale match view. |
| `/app/audit` **Audit explorer** | Grid time/actor/action/branch/entity/correlation/summary; filters API; detail drawer before/after/details with masked values and entity link. | audit endpoints. No edit/delete; financial links traverse both directions. |
| `/app/settings/general` **General** | Tenant name, base/enabled currencies and metadata, default/enabled languages, time zone, date/time/number/currency preview, first day. | tenant/settings/currency. Base/currency changes protect referenced data; preview updates both locales. |
| `/app/settings/order-workflow` **Order workflow** | Fixed state diagram; per-state allowed-action checkboxes; edit/cancel minutes; cancellation stages; completion/outstanding option; kiosk ID policy. Cannot add/remove states. | settings order group. Invalid matrices (no submit path, cancel paid without refund) rejected. |
| `/app/settings/discounts-credit` **Discount & credit policies** | Cashier percentage/fixed limits, stacking defaults/exclusions links, credit default mode/limit/override threshold, suspension policy. | settings group. Money/percent validation; changes affect future commands only. |
| `/app/settings/payments-refunds` **Payment & refund policies** | Active methods, original/alternative refund method matrix, approval requirement, references, reversal window, discrepancy thresholds. | settings/payment methods. Alternative path cannot be enabled without target method/reason/approval rule. |
| `/app/settings/approvals` **Approvals** | Rule grid and builder: action, priority, branch/state/amount/percent conditions, ordered profile steps. Pending requests panel/approval dialog. Profiles read-only seed identities. | approval endpoints. Preview shows matching example; PIN hidden/cleared/rate-limited. |
| `/app/settings/reasons` **Reason codes** | Grid code/name/applies-to/requires note/status; CRUD/archive. | reason endpoints. Used code can archive, history retains snapshot/reference. |
| `/app/settings/localization` **Localization** | Namespace/key grid with English/Persian side-by-side, missing indicator, search; inline edit; CSV import/export; direction/receipt preview. | translation endpoints. Identical keys enforced; Persian strings render RTL without reversing IDs/numbers. |
| `/app/settings/data-reset` **Data reset** | Explains retained seed vs deleted transactional/config data; typed phrase `RESET PROTOTYPE`; password re-entry; reset button; result counts. No scheduling. | reset endpoint defined in Section 14. Only shared admin; auditable; on success logout and reseed; failure rolls back. |

### 10.6 Per-page dialog requirements

- **Archive:** entity name, references impact, “Archive” button; never says delete when soft archive occurs.
- **Cancel order:** current state, paid/refundable totals, required reason/note, refund plan/method, approval status; button changes to “Refund and cancel” when paid.
- **Refund:** refundable total, selectable payments/items, amount/full toggle, original target default, alternative warning, method/device/reference, reason, approval, deterministic simulation scenario.
- **Payment:** outstanding, allocations already paid, method tiles, amount, device/reference conditional fields, scenario and SIMULATED badge for external methods. Success dialog shows retained balance/outstanding.
- **Shift/settlement close:** server preview version, expected vs actual, separated instruments, discrepancy, reason, approval; stale preview forces reload.
- **Merge/split/transfer:** source/target identifiers, item quantities, payment warning, resulting estimated totals, reason/approval. No dead buttons: unavailable actions have tooltip explaining backend rule.

---

## 11. POS specification

### 11.1 Layout and context

Desktop/tablet uses: category rail at inline-start, product grid center, cart panel inline-end. Header contains branch, terminal, open shift/status, order type, table/address/customer summary, search, network/simulator indicators, and locale. Narrow screens show product grid with a sticky bottom cart summary; tapping opens full-height bottom sheet. POS cannot sell until branch/terminal/currency and open shift are selected; kiosk/aggregator exceptions are not exposed here.

### 11.2 Product selection and large catalogs

- Load the effective menu for branch/channel `POS`/current time, then categories. Product search is debounced 250 ms, server-backed after 2 characters, scoped to effective menu, and matches code/SKU/English/Persian name.
- Category selection pages products in 50-item chunks with virtualization/infinite scroll. Tiles show image placeholder, localized name, variant hint, resolved price, unavailable/suspended overlay, and modifier-required marker.
- A tile adds default variant directly only if no required modifier/variant choice exists. Otherwise it opens `ProductConfigurationDrawer` with variant radio, modifier groups in configured order, min/max/free counters, combo selections, quantity, and 1000-character note.
- The drawer disables Add until every min/max and combo rule passes. Price preview calls order quote after selection; it never computes authoritative tax/discount locally.

### 11.3 Cart and order context

- Cart rows show name/variant, modifiers, quantity controls, item note, base/modifier/discount/tax/packaging/net. Actions edit, duplicate, remove. Remove after submission becomes an edit command with reason/approval; draft removal is immediate local/draft patch.
- Footer shows subtotal, modifiers, packaging, delivery, discounts by name, tax, grand total, paid, outstanding. A stale quote banner blocks Pay/Submit until accepted.
- Order type segmented control: Dine-in, Pickup, Delivery. Changing after items warns and requotes. Dine-in requires table and guests 1–99; delivery requires customer, address, and zone; pickup customer is optional.
- Customer button opens debounced search by phone/name/number, create-new drawer, and clear action. Assigning customer recalculates customer campaigns/credit. Customer credit balance/status is shown without exposing unrelated private fields.
- Notes separate `ORDER`, `KITCHEN`, `COURIER`, and `CUSTOMER_RECEIPT`; labels explain visibility.

### 11.4 Discounts

- “Discounts” opens a drawer with coupon input, manual percentage/fixed tabs, reason, current campaign decisions, excluded lines, funding source, and resulting totals.
- Coupon error remains inline. Manual amount over limit opens approval stepper; approved request is attached to the exact unchanged quote. Editing amount invalidates prior approval.
- The cashier cannot directly choose automatic campaigns or alter priority/stacking. “Why?” expands backend decision/rejection reasons.

### 11.5 Submit and order lifecycle

- New cart creates backend draft at the first product add; subsequent changes patch draft and quote. “Hold” leaves DRAFT and clears local active cart; held drafts appear under Orders.
- “Send order” performs final quote then submit with idempotency key. For configured POS auto-confirm, UI shows submitted/confirmed and KDS/print simulated job outcomes.
- If product/price changed, show comparison and require acceptance. If branch offline simulator status is active, normal POS shows a blocking “Online POS unavailable” panel and link to Simulation Center; it does not pretend to be production offline POS.
- Submitted edits use the order-detail edit workflow; cashier window countdown is shown. Expired window opens approval.

### 11.6 Payments

- Payment drawer lists active methods filtered by currency and shows outstanding. Default amount is full outstanding; user may enter smaller positive amount.
- Cash requires open shift and confirms immediately. Customer credit requires selected customer/account and shows available credit. Network/mobile/Tara/online use selected deterministic scenario, device/reference fields, and SIMULATED badge. Bank transfer requires reference.
- After success, the allocation is displayed in a payment stack; outstanding updates. “Add another payment” enables split/mixed payment. “Complete order” appears only when state/type and outstanding rule allow.
- On external failure, keep all previous successes, show attempt/error, and offer Retry with scenario, Change method for remaining amount, or Close drawer. No automatic retry and no duplicated pending record.
- Mobile POS is labeled “Card — Mobile POS,” requires a device, owner/account, and receipt number, and never appears under cash.

### 11.7 Printing and errors

- Order submission may enqueue kitchen/customer print jobs according to routes. A nonblocking SIMULATED toast shows queued/succeeded/failed; failed printing never rolls back the order. Details link to print queue.
- Business validation is inline and focus moves to summary/first field. Network/API failure preserves cart and idempotency key; Retry fetches draft before resubmission. A 409 version conflict compares server cart and offers Reload server cart; no automatic merge.

### 11.8 POS acceptance criteria

1. A cashier can open a shift, find a Persian-named product in a 1,000-product menu, satisfy modifiers, assign customer/table or delivery address, apply coupon/manual discount with approval, submit, pay with two methods, send to KDS, print-simulate, and complete without page reload.
2. Totals shown in POS equal backend/order/report totals exactly after refresh.
3. Failed second payment retains first payment and accurate outstanding; retry cannot duplicate the first payment.
4. All required workflows are operable at 1024×768 and 390×844, in English/LTR and Persian/RTL, with 48 px targets and no clipped primary action.

---

## 12. Simulation Center

### 12.1 Landing page `/app/simulation`

Show four cards (Snappfood, Payments & Printers, Offline & Sync, Logs), active scenario counts, queued/failed/DLQ counts, branch online status, and a permanent warning: “All external behavior on this page is simulated; created Gnext records are real.” Quick actions generate Snappfood order, set branch offline, create offline transaction, and fail next printer/payment.

### 12.2 Snappfood page `/app/simulation/snappfood`

- **Generate order form:** branch, external ID (auto or manual), type pickup/delivery, mapped customer/address, aggregator notes, line builder using external mapped IDs/modifiers, additional-payment amount, scenario. Payload preview and HMAC preview are collapsible.
- **Actions:** Generate; Generate & Accept; duplicate 1–10 times from a receipt; Pick/Accept/Reject with decline reason; Modify quantity/items/notes; Add payment; Cancel; Recover recent order; trigger catalog/menu/category/product/modifier/image/price/capacity/suspension/vendor/zone sync.
- **Results:** webhook HTTP/signature/duplicate status, ack latency, linked Gnext order, mapping errors, queue/log chain. Missing mapping produces a failed receipt/log and no partial order.
- **Acceptance:** duplicate event creates exactly one order; notes preserved; reject/cancel follow state/payment rules; every external action is labeled and logged.

### 12.3 Payments & Printers page `/app/simulation/payments-printers`

- Tabs Network POS, Mobile POS, Tara Pay, Printer. Scenario editor fields kind/code/name/outcome/latency/error/response; built-ins: Immediate Success, Timeout Failure, Declined, Success After Retry, Duplicate Callback, Printer Paper Out, Printer Offline, Fallback Success.
- Payment tester selects existing PENDING/FAILED payment or creates through linked order; chooses outcome and submits callback. Displays attempt chain, external reference, posting effect, device/account classification.
- Tara tester exposes Validate/Create/Confirm/Reverse/Refund/Settle/Reconcile commands and shows linked payment/refund/logs.
- Printer tester selects job/printer, success/failure/fallback, retry. Preview remains available for failures.
- **Acceptance:** failure posts no financial/cash/credit effect; duplicate success callback is idempotent; mobile POS report classification remains card; print fallback records both attempts.

### 12.4 Offline & Sync page `/app/simulation/offline-sync`

- Branch connectivity panel controls online/offline, health, mock version, heartbeat, and last-sync. Going offline records start; going online records duration and does not auto-process until configured/triggered.
- Offline operation builder: operation type (order/customer/payment/refund/approval/config/courier), schema-driven JSON/form payload, local version, dedupe key. For financial types, use safe canned payload builders; invalid arbitrary JSON is rejected.
- Queue grid: state, branch, type/entity, created/available, attempts, error, dedupe. Actions trigger selected/all, retry, clone DLQ, inspect.
- Conflict split view shows local vs cloud JSON field diff, version, choose Local/Cloud/Merged, merged editor with schema validation and explicit financial warning.
- Logs show incremental sync categories: menus/prices/customers/orders/payments/refunds/approvals/settings/courier. A trigger produces per-category counts and final last-sync only when all selected items succeed or resolve.
- **Acceptance:** offline queue persists across restart; retry schedule/attempt counts exact; conflict resolution preserves both originals; last successful sync is not advanced by failed batch.

### 12.5 Logs page `/app/simulation/logs`

Server grid columns time/level/kind/branch/action/entity/status/attempt/correlation/summary. Filters from API; detail drawer shows timeline, masked request/response, queue/webhook/payment/order/print links, retry eligibility. Copy correlation ID is allowed; copying full sensitive payload is not. Empty state suggests simulator quick action.

---

## 13. Reports

### 13.1 Common report behavior

- Report dates default to current tenant business date and use the stored `business_date` for business reports; operational event reports use `occurred_at` converted to tenant/branch zone. UI always labels which basis is used.
- Branch selector allows one, multiple, or All. All means all non-archived and historically referenced branches; row data always includes branch. A consolidated total is the sum of branch subtotals, never a separate pre-aggregated store.
- Server applies filters, grouping, sorting, pagination, and totals. Summary totals cover all matching rows, not current page. Drill links preserve filters.
- CSV is UTF-8 BOM with ISO raw date/money plus localized display columns only when selected. XLSX has title/filter metadata sheet, frozen header, typed dates/numbers, locale-formatted display, and totals row. Exports are capped at 100,000 rows.
- Empty state says “No data for the selected filters,” lists the date/branches, and offers Clear filters; zero totals are shown, not omitted.
- Saved filters/layout stores report code, filters, column order/visibility, grouping, and sort. It never stores result rows.

### 13.2 Report catalog

| Code / name | Data source and columns | Filters; grouping and totals |
|---|---|---|
| `sales-summary` **Sales** | `order` plus successful payment/refund aggregates. Columns business date, branch, channel, type, order count, gross subtotal, modifiers, packaging, delivery, discounts, tax, net sales, paid, refunded, outstanding. | Date, branch, channel/type/state/currency. Group date/branch/channel/type. Totals all monetary/count columns; exclude cancelled from net sales but show optional cancelled count. |
| `product-sales` **Product/category sales** | submitted non-void `order_item`, category/product snapshots, allocated adjustments. Columns category, product/code, variant, quantity, gross, modifier, discount, tax, packaging, net, order count. | Date, branch, channel/type, category/product, currency. Group category/product/variant/branch; totals quantity/money. Refund quantities/amount shown in separate columns, not erased from sales. |
| `payments-by-method` **Payment methods** | succeeded/reversed `payment`, allocations, method/device/account. Columns date, branch, shift, method kind/name, device, owner, settlement account, count, succeeded, reversed, refunded, net. | Date, branch, shift, method/kind/device/account/currency. Group instrument/account/branch/date; totals. Mobile POS separate from CASH. |
| `mixed-payments` **Mixed payments** | orders with ≥2 successful method kinds and allocations. Columns order, date, branch, total, each method allocation, paid/refunded/outstanding, method count. | Date, branch, channel/type, currency, method-includes. Group branch/method combination; totals allocation columns. |
| `mobile-pos` **Mobile POS terminal** | MOBILE_POS payments, device/owner/account, courier assignment/delivery. Columns payment/order/date/branch/courier/device/owner/account/receipt/reference/amount/status/refunded/settlement batch. | Date, branch, courier, device, account, status, settled/unsettled. Group device/account/courier; totals amount/refund/net. |
| `alternative-refunds` **Alternative refund method** | successful/pending refunds with original payment method and target. Columns refund/order/date/branch/original method/device/target method/amount/reason/reference/approval/actor/status. | Date, branch, original/target method, status, reason, approver. Group method pair/branch/reason; totals count/amount. |
| `discounts` **Discount performance** | `order_adjustment`, campaign/usage snapshots. Columns campaign/code/type/funding/branch/orders/uses/eligible basis/discount amount/gross/net/average. | Date, branch, channel/type, campaign/type/funding/currency. Group campaign/branch/type; totals. Cancelled orders filter toggle. |
| `manual-discounts` **Cashier discounts and deductions** | manual adjustments, order/shift/approval. Columns date/order/branch/shift/cashier, manual type, percent/basis/amount, reason, within limit, approval/profile, product exclusions count. | Date, branch, shift,type,approval status,reason. Group cashier(shared admin)/shift/branch/type; totals amount/orders. |
| `discount-stacking` **Exclusions and stacking** | applied/rejected decision snapshots and line allocations. Columns order,line/product,campaign,decision/rejection reason,priority,stacking group,basis,amount,never-discount/non-stackable flags. | Date, branch, campaign,decision/reason,product/category. Group reason/campaign/product; totals applied amount and affected lines. |
| `cashier-shifts` **Shifts** | shift/cash movements/payment aggregates. Columns shift/branch/terminal/date/open/close/currency/opening,cash sales/refunds,paid-in/out,expected,actual,variance,noncash by method,state/approval. | Date, branch,terminal,state,currency,variance-only. Group branch/terminal/date; totals with opening/actual meaningful only per shift then summed. |
| `cash-discrepancies` **Cash discrepancies** | closed shifts with nonzero variance and settlement discrepancies. Columns source type/id,date,branch,person/terminal,expected,actual,variance,reason,approval. | Date, branch,source,threshold,reason. Group branch/source/reason; totals absolute/signed variance. |
| `customer-credit` **Credit ledger** | credit accounts/entries/customer/order/payment. Columns date,customer/account,currency,type,order,branch,shift,cashier,debit,credit,balance,reference/reason. | Date, branch,customer,status,type,shift,currency. Group customer/branch/shift/type; totals debit/credit/net. Opening/closing balance computed per filter. |
| `credit-eod-usage` **End-of-day credit usage** | PURCHASE entries by business date. Columns date,branch,shift,cashier,customer/order,amount,limit,balance after. | Date, branch,shift,customer,currency. Group date/branch/shift/customer; totals purchase amount/count. This is accounting handover view. |
| `credit-aging` **Credit aging** | FIFO aging query. Columns as-of, customer, account status, limit, balance, available,current,31–60,61–90,90+,oldest date. | As-of date, branch relationship,customer,status,currency,bucket-positive. Group status/branch; bucket totals. |
| `customer-activity` **Customer activity** | customer with order aggregates/tags/consent. Columns customer/phone/home branch/tags,status,first/last order,order count,gross,discount,net,refund,credit use. | Date, branch,tag/segment,status,consent,has orders. Group tag/segment/home branch; totals customers/orders/net. |
| `aggregator-orders` **Aggregator orders and notes** | SNAPPFOOD orders/webhook receipts/notes/integration attempts. Columns external/order IDs,date,branch,state,ack latency,duplicate count,customer,address,note,additional payment,total,error/reconciliation status. | Date, branch,state,duplicate/error/note-present. Group branch/state/error; totals orders/value/duplicates. |
| `snappfood-reconciliation` **Snappfood reconciliation** | webhook/order/payment/integration logs/mappings. Columns external ID, Gnext order, expected vs actual total, status, mapping errors, last action, attempts, duplicate, discrepancy. | Date, branch,status/discrepancy/mapping entity. Group branch/discrepancy; totals expected/actual/difference. Clearly SIMULATED. |
| `courier-attendance` **Courier attendance** | attendance/courier/delivery counts. Columns date,branch,courier,check-in/out,duration,status,device,assigned/completed/failed deliveries. | Date, branch,courier,status. Group courier/branch/date; totals hours/deliveries. |
| `courier-settlements` **Courier settlements** | settlement/lines/delivery/payment. Columns batch/date range/branch/courier/state,currency,expected/actual cash,expected/verified POS,compensation,adjustments,net due,discrepancy,reason/approval. | Date overlap, branch,courier,state,currency,discrepancy. Group courier/branch/state; totals, excluding reversed by default with toggle. |
| `courier-reconciliation` **Courier cash and POS** | delivered orders/payment instruments/settlement lines. Columns delivery/order/date,courier,device,cash expected/received,POS expected/receipt/verified,batch,discrepancy reason. | Date, branch,courier,device,settled/verified/discrepant. Group courier/device/instrument; separate cash/POS totals. |
| `tax-packaging` **Tax and packaging** | order/item adjustment snapshots/tax and packaging rules. Columns date,branch,tax rule/rate,inclusive,gross/taxable/tax; packaging rule/calculation/quantity/amount; refunds. | Date,branch,channel/type,tax rule,packaging rule,currency. Group rule/rate/branch; totals taxable/tax/packaging/refund. |
| `print-operations` **Print operations** | print job/attempt/printer/route. Columns time,branch,type/entity,printer/group,status,attempts,fallback,reprint,error,duration. | Date-time,branch,type,printer,status,error/reprint. Group printer/status/error; totals jobs/failures/retries. SIMULATED. |
| `integration-operations` **Integration and sync** | integration attempts, queues, conflicts, branch snapshots. Columns time,branch,kind,operation,entity,status,attempts,error,latency,conflict resolution,correlation. | Date-time,branch,kind,status,error/conflict. Group kind/branch/status/error; totals attempts/failures/latency average. SIMULATED. |

---

## 14. Demo and realistic data strategy

### 14.1 Required environment and shared credentials

Environment variables:

```text
ADMIN_USERNAME=admin@gnext.local
ADMIN_PASSWORD=GnextDemo!2026
APPROVER_DEMO_PIN=2468
SEED_PROFILE=minimal
DATA_DIR=./data
```

These are prototype defaults and must be printed once in the seed command output and included in the local README, not hardcoded in frontend source or returned by APIs. Backend hashes password/PIN at seed time. Deployment must allow overrides. UI labels the account “Shared Prototype Administrator.”

### 14.2 Minimal idempotent seed

- Tenant: `GNEXT`, name “Gnext Prototype”, base/enabled currency IRR (symbol `ریال`, precision 0, increment 1), also USD disabled-by-default demonstration currency; default locale Persian, enabled `fa/en`, time zone `Asia/Tehran`, first day Saturday.
- Branches: `TEH-CENTRAL` “Tehran Central” and `TEH-NORTH` “Tehran North”; seven-day operating hours; online healthy simulated snapshot. Two branches are necessary to validate branch/group/consolidated behavior.
- Terminals per branch: one cashier, one kiosk, one KDS. Payment devices: one company network POS and one company mobile POS linked to seeded IRR acquiring accounts.
- Payment methods: Cash, Customer Credit, Network POS, Mobile POS, Bank Transfer, Online, Tara Pay; external ones clearly simulated.
- Approval profiles: Supervisor, Finance, IT; PIN from environment. Seed rules: discounts above 10% or IRR 1,000,000 fixed → Supervisor; alternative refund → Supervisor then Finance; shift/courier discrepancy ≥ IRR 1,000,000 → Supervisor; reopen/financial correction → Supervisor.
- Reason codes: customer cancellation, kitchen issue, payment correction, refund requested, alternative refund, cash discrepancy, courier discrepancy, reprint, price override, other (requires note).
- One price group (`STANDARD`), default order action matrix/windows (edit 10 min, cancel 10 min), refund-method matrix, kiosk optional identification, built-in deterministic scenarios.
- Reference configuration only: one dining section and five tables per branch, one Kitchen station and one Packaging station, printer configurations/routes, one delivery zone per branch.
- Catalog minimum: exactly two categories, four products, one required modifier group with three options, one combo, base/branch price examples, one menu per branch/channel. This is enough to open/test POS but not excessive.
- Customers/couriers: one demo customer with IRR credit account and one courier per branch. No pre-created orders, payments, refunds, shifts, settlements, audit noise, or reports beyond seed audit marker.

### 14.3 Optional demonstration data

An explicit `seed --profile demo` may add 20 customers, 30 products, 3 campaigns/coupons, 4 couriers, and 30 days of at most 200 coherent completed/cancelled/refunded orders with shifts/deliveries. It must use the same public domain services or a deterministic fixture builder respecting all invariants. Demo records use a `demo_batch_id` in audit details so reset can identify them. Minimal remains the default because customers will enter their own data.

### 14.4 Reset mechanism

`POST /api/v1/system/reset` requires `{confirmation:'RESET PROTOTYPE',password}` plus CSRF and idempotency. It returns `202 {resetId}`; `GET /api/v1/system/reset/:id` returns status/counts. The reset worker:

1. Acquires a PostgreSQL advisory lock and rejects concurrent reset with `409 RESET_IN_PROGRESS`.
2. Revalidates shared admin password and writes a pre-reset security log outside the data transaction.
3. In one transaction truncates tenant-owned operational/configuration tables in FK-safe order while retaining migrations; then reruns minimal seed with stable tenant/admin IDs.
4. Commits, removes non-seed upload files, revokes every prior session, writes post-reset seed/audit marker, and reports counts.
5. On database failure rolls back all data changes and retains files/sessions; UI reports correlation ID. Physical file deletion failure creates alert but reset remains complete.

The reset page must list retained/deleted classes before confirmation. There is no API to reset a single module and no production exposure.

---

## 15. Implementation slices

### 15.1 Rules for slices

Implement in exact order. A slice is complete only when migrations, seed changes, backend, frontend, translations, tests, and acceptance checks pass together. Do not start the next slice with failing checks. Temporary static data is allowed only inside Storybook/tests; a page delivered in a slice must call its real API. “Do not change” entries are frozen contracts unless a deviation is reported before implementation and this specification is amended.

### Slice 1 — Workspace, database, auth, shell

- **Entities/migrations:** `tenant`, `admin_user`, `session`, `audit_event`, `outbox_event`, `idempotency_record`; PostgreSQL extensions and universal conventions.
- **Backend/APIs:** App/Auth/Audit/Outbox foundation; health, login/logout/me/preferences; global validation/error/context/CSRF/correlation.
- **Frontend/pages:** `/login`, protected `AppShell`, placeholder `/app/dashboard`, locale toggle with base `en/fa` bundles, error boundary/API client.
- **Acceptance:** minimal seed login works; invalid/rate-limited login behaves; cookie/CSRF enforced; refresh retains session; direction changes without reload; health distinguishes readiness.
- **Tests:** migrations up/down on empty DB; auth unit/integration; CSRF/error contract; Playwright login/logout/en/fa; no missing translation keys.
- **Must not change:** stack, TypeORM, URL prefix, Problem Details shape, UUID/UTC/money-string conventions, shared-admin model.

### Slice 2 — Tenant, branches, terminals, currency and base settings

- **Entities:** `branch`, `branch_operating_hour`, `terminal`, `branch_status_snapshot`, `tenant_setting`, `currency`, `payment_method`, `reason_code`.
- **APIs:** tenant; branch/hours/status; terminal; settings; currencies/payment methods/reasons.
- **Pages:** Dashboard branch-status skeleton with real data; Branch list/detail; Terminals base tab; Settings General/Reasons.
- **Acceptance:** two seeded branches/hours/terminals display; CRUD persists; inactive/open-shift guards scaffolded; branch zone/date/currency preview correct.
- **Tests:** uniqueness/ranges/hours overnight; paging/filter/sort; branch CRUD UI both directions.
- **Must not change:** one tenant/no branch settings overrides; one-order-currency decision; fixed locale set.

### Slice 3 — Localization and file images

- **Entities:** `localized_text`, `translation_entry`, `stored_file`.
- **APIs:** translations CRUD/import/export; image upload/content/archive.
- **Pages:** Settings Localization and reusable localized/image inputs; direction/receipt preview.
- **Acceptance:** Persian/English entity text fallbacks; UTF-8 CSV round trip; 5 MB/type/signature validation; direction works across shell/grid/form/dialog.
- **Tests:** fallback unit tests; malicious/oversized upload; RTL visual snapshots; translation-key CI.
- **Must not change:** i18next/Intl strategy, filesystem storage contract, logical CSS requirement.

### Slice 4 — Catalog foundation

- **Entities:** categories, products, variants, modifier groups/options/links, combo components, tax/packaging rules.
- **APIs:** catalog CRUD and composition children; file/translation integration.
- **Pages:** Categories, Products list/detail General/Variants/Modifiers/Combo, Modifiers.
- **Acceptance:** create a bilingual product with required modifiers and combo; invalid selection rules/cycles rejected; archive preserves references.
- **Tests:** domain constraints, CRUD/paging/search Persian, frontend forms; migration FK/archive tests.
- **Must not change:** catalog table contracts, combo fixed-component model, no inventory behavior.

### Slice 5 — Menus, availability, and pricing

- **Entities:** availability, menus/category/product joins, price groups/branches, price entries/bulk job.
- **APIs:** menu, availability/suspend, price groups/prices/resolve/bulk.
- **Pages:** Menus/composer, Availability, Price Book/Groups/Bulk Update; product Prices/Availability tabs.
- **Acceptance:** different branches/channels/times resolve correct menu/availability/price; overlap rejected; bulk update is atomic; quote diagnostic explains source.
- **Tests:** full precedence matrix, half-open boundaries, rounding/currency, concurrent overlap, composer/bulk Playwright.
- **Must not change:** Section 7 price precedence, effective-range semantics, server authority.

### Slice 6 — Customers and customer data model

- **Entities:** customer/phones/addresses/custom fields/tags/links/segments/consent/merge.
- **APIs:** customers CRUD/search/history, duplicates/merge, tags/segments. Import UI remains disabled with explanatory “delivered in Slice 22,” not a dead action.
- **Pages:** Customers list/detail and create/edit/merge flows; reusable customer selector for later POS.
- **Acceptance:** Persian/name/phone search; duplicate suggestions; transactional merge preserving source; multiple contacts/consents persist.
- **Tests:** normalization/scoring/merge concurrency; paging indexes via query plan sanity; UI profile/merge both locales.
- **Must not change:** duplicate priority, merge history/alias model, no hard delete with transactions.

### Slice 7 — Approval workflows and operational policies

- **Entities:** approval profiles/rules/steps/requests/decisions, PIN attempts; complete tenant policy schemas.
- **APIs:** rules/request/approve/reject/cancel; PIN rate limiting; settings action matrices/windows/thresholds.
- **Pages:** Settings Approvals, Order Workflow, Discounts & Credit, Payments & Refunds; Approval dialog.
- **Acceptance:** one- and two-step rules match deterministic context; wrong PIN lock; expired/changed command cannot reuse approval; all decisions audited.
- **Tests:** rule precedence/expiry/rate limit/hash; concurrent approvals; Playwright approval and RTL secure input.
- **Must not change:** seeded profiles/PIN model, 10-minute binding/expiry, fixed domain state enums.

### Slice 8 — Discounts

- **Entities:** campaigns/scopes/coupons/usage; order-adjustment contract migration may be introduced now but not orders UI.
- **APIs:** campaign/coupon CRUD and discount quote.
- **Pages:** Campaign list/editor/calculator, Coupons; manual/coupon reusable drawer.
- **Acceptance:** eligibility/exclusions/priority/non-stackability/sequential stacking/free item/free delivery are explainable; limits lock correctly; over-limit manual discount creates approval.
- **Tests:** table-driven Section 7 cases, rounding allocations, concurrent usage, editor/calculator parity.
- **Must not change:** discount evaluation order, no frontend calculation authority, usage not restored on cancel/refund.

### Slice 9 — Cashier shifts and cash drawer

- **Entities:** cashier shift, cash movement, business-day close.
- **APIs:** shift open/current/movement/begin/return/close/statement; business-day list/close/reopen.
- **Pages:** Shifts list/detail, Business days; POS header shift selector.
- **Acceptance:** terminal has one open shift; expected cash formula exact; discrepancy reason/approval; processing blocker; closed immutable.
- **Tests:** row-lock/concurrent open, close totals, approval threshold, cash vs noncash fixtures, UI close flow.
- **Must not change:** expected cash formula, no shift reopen, business-day definition.

### Slice 10 — Orders and core POS

- **Entities:** order/items/modifiers/adjustments/notes/links/state events; dining FK nullable, delivery fields prepared.
- **APIs:** order create/list/get/draft patch/quote/submit/transitions/edit/replace/cancel/reopen/history/guest bill.
- **Pages:** full POS product/cart/customer/order type for Pickup initially; Orders list/detail and transition/edit dialogs.
- **Acceptance:** open-shift cashier builds bilingual modifier order, quotes, discounts, submits/idempotently auto-confirms, edits within/after window, cancels unpaid, restores session cart.
- **Tests:** totals equation/snapshots/state matrix/idempotency/stale quote/concurrent edit; POS desktop/mobile/RTL/LTR E2E.
- **Must not change:** order states, snapshot/append-only edit strategy, no payments in order tables, submitted-order no delete.

### Slice 11 — Customer credit

- **Entities:** credit account/entries.
- **APIs:** account list/open/detail/update/suspend, statement, repay/adjust, aging, internal purchase/reversal ports.
- **Pages:** Credit list/detail, customer Credit tab; POS credit display (payment button disabled until Slice 12 with explanation).
- **Acceptance:** finite/unlimited/policy available balance, immutable postings, repayment/adjustment/approval, suspension, FIFO aging and reports query.
- **Tests:** locked concurrent posting, running balance, over-limit approval, aging boundary dates, UI statement/RTL money.
- **Must not change:** signed balance convention, account currency immutability, no direct balance edit.

### Slice 12 — Payments and mixed/partial settlement

- **Entities:** settlement accounts/devices, payment/allocation/attempt.
- **APIs:** device/account CRUD; payment create/get/list/retry/cancel/reverse/correct; cash/credit and simulated terminal adapter success/failure.
- **Pages:** POS payment drawer/mixed stack; Payments list/detail; Terminal device/account tab; order payment section.
- **Acceptance:** cash + mobile POS and credit + terminal workflows; failure retains success; device/account/reference captured; mobile POS never cash; reversal/correction immutable.
- **Tests:** outstanding locks/parallel attempts/idempotency, cash movement/credit atomicity, duplicate callback, E2E mixed/failed retry.
- **Must not change:** one active intent/order, posting only on success, method classifications, correction as reversal+replacement.

### Slice 13 — Refunds and paid cancellation

- **Entities:** refund/refund allocation and attempt relationships.
- **APIs:** refund create/list/get/retry/cancel/reverse; order paid cancel orchestration; alternative method policy.
- **Pages:** Refunds list/detail, refund/cancel dialog, order/refund history.
- **Acceptance:** partial/full/original/alternative refund; POS→cash/bank requires reference/reason/approval; failed refund changes no totals; paid order cancellation waits for refund.
- **Tests:** refundable caps/concurrency/proportional allocation, cash/credit counter-entry, alternative matrix, E2E failures/retry/reverse.
- **Must not change:** original payment immutability, alternative reporting identity, cancellation order.

### Slice 14 — Dine-in

- **Entities:** dining section/table/occupancy events; order links exercised.
- **APIs:** dining CRUD/floor/move/merge/split/transfer.
- **Pages:** Floor and dine-in POS context; merge/split/transfer/guest bill/settle-together UI.
- **Acceptance:** assign guests/table, move, merge compatible unpaid items, split quantity/new order, transfer, separately/together payment sequence, statuses atomic.
- **Tests:** multi-row lock/deadlock ordering, compatibility/payment guards, occupancy derivation, floor mobile/RTL E2E.
- **Must not change:** payment remains on source, linked history, same branch/currency merge constraints.

### Slice 15 — KDS and simulated printing

- **Entities:** KDS configuration/tickets/items/events; printer/group/member/routes/jobs/attempts.
- **APIs:** KDS board/SSE/actions/config; print config/queue/preview/retry/reprint.
- **Pages:** KDS/config; Printers/Print queue; POS/order print status.
- **Acceptance:** submission routes idempotent station tickets/prints; start/bump/recall/timers; failure/fallback/reprint reason; printing never rolls back order.
- **Tests:** routing specificity/idempotency/ticket roll-up/SSE reconnect; fallback cycle; sanitized preview; operational E2E.
- **Must not change:** simulated labels, print route precedence, ready rule/timer thresholds.

### Slice 16 — Delivery and couriers

- **Entities:** zones/couriers/attendance/terminal assignment/delivery/events.
- **APIs:** zone/courier/attendance/device assignment; delivery list/detail/assign/status/deliver/fail/requeue.
- **Pages:** Delivery board, Couriers list/detail; delivery POS fields.
- **Acceptance:** delivery order requires customer/address/zone; available courier assignment; status/order alignment; physical cash and mobile receipt capture remain separate.
- **Tests:** attendance/capacity/device uniqueness/state matrix; payment expectation classification; board E2E in locales.
- **Must not change:** one delivery/order, mobile POS classification, delivered capture fields.

### Slice 17 — Courier settlements

- **Entities:** settlement/lines.
- **APIs:** preview/list/create/detail/update/review/return/close/reverse/statement.
- **Pages:** Settlement list/detail; courier unsettled totals.
- **Acceptance:** eligible lines unique; expected vs actual cash and POS separate; receipt verification; compensation/adjustment/discrepancy/approval; close/reverse immutable.
- **Tests:** calculations/concurrent batch/close locks/reversal; statement/report fixture; full courier-day E2E.
- **Must not change:** formulas/eligibility, no cash/POS net classification, closed append-only behavior.

### Slice 18 — Kiosk

- **Entities:** no new domain entities; terminal/order/payment/print records use KIOSK channel.
- **APIs:** reuse catalog/order/payment; a read-only `GET /kiosk/bootstrap?terminalId=` may aggregate menu/settings/branch context.
- **Pages:** full `/app/kiosk` browse/modifiers/cart, dine-in/takeaway, required/optional identity, guest checkout, simulated terminal/receipt.
- **Acceptance:** both ID policies; guest allowed only optional; order/payment/print real persisted; hardware/offline labels; touch/mobile RTL/LTR.
- **Tests:** bootstrap context, policy enforcement backend, price parity POS, kiosk viewport/accessibility E2E.
- **Must not change:** same order/price engine, no separate kiosk totals logic, no real/offline hardware claim.

### Slice 19 — External integration simulators

- **Entities:** scenarios/logs/integration attempts/webhook receipts/aggregator mappings; complete adapter port.
- **APIs:** Simulation scenarios, Snappfood generator/raw HMAC/duplicates/actions/catalog sync, payment/printer outcomes, Tara commands.
- **Pages:** Simulation landing, Snappfood, Payments & Printers, Logs; dashboard simulated status links.
- **Acceptance:** mapped Snappfood order/notes/modification/additional payment/cancel/recovery; duplicate exactly-once; HMAC; Tara lifecycle; deterministic scenarios and masked logs.
- **Tests:** signature/skew/duplicate/adapter contract; no outbound network test; each scenario E2E; all labels visible.
- **Must not change:** zero external calls, domain services used for real records, retry/attempt audit.

### Slice 20 — Offline and synchronization simulation

- **Entities:** queue items/sync conflicts plus status snapshots/logs.
- **APIs:** branch connectivity/offline operation/sync trigger/conflict/retry/queue/log.
- **Pages:** Offline & Sync; Operations Monitoring/branch status; POS offline block.
- **Acceptance:** persisted queue, retry/DLQ, dedupe, conflict diff/resolution, incremental categories, offline duration/last successful sync rules.
- **Tests:** worker claim concurrency/restart, retry timing, financial merge rejection, conflict resolution, E2E offline→queue→online→sync.
- **Must not change:** no second/local DB or browser offline engine, manual conflict default, last-sync semantics.

### Slice 21 — Reports, audit explorer, alerts, exports

- **Entities:** saved report view/export job/operational alert; audit already exists.
- **APIs:** every Section 13 report, exports/saved views, audit/alerts.
- **Pages:** all Report Viewer codes, Audit, Dashboard KPIs, Monitoring alerts.
- **Acceptance:** every report columns/filters/groups/totals; cross-report fixture reconciliation; UTF-8 CSV/XLSX; saved views; immutable/masked audit; acknowledge alerts.
- **Tests:** SQL query fixtures/totals/paging/export; property reconciliation (sales/payment/refund/credit/shift/courier); UI viewer/exports/locales.
- **Must not change:** report catalog/definitions, totals over all pages, audit immutability, 100k export cap.

### Slice 22 — Imports, reset, seed profiles, and final hardening

- **Entities:** import jobs/rows, export/reset job metadata if required; no core-contract changes.
- **APIs:** catalog/customer imports/exports, system reset/status; complete data seed commands.
- **Pages:** Import/Export, Data Reset; final empty/error/loading/accessibility pass on every page.
- **Acceptance:** Persian CSV staging/mapping/errors/atomic commit; minimal/demo seeds; transactional reset/relogin; all source-scope traceability and Section 16 checks pass.
- **Tests:** CSV injection/encoding/size/duplicate modes, reset rollback/advisory lock/files, fresh-install E2E, full regression/typecheck/lint/build/migrations.
- **Must not change:** existing migrations except new forward migration, public contracts, minimal seed quantities, reset retention/deletion rules.

---

## 16. Verification checklist

### 16.1 Required commands after every slice

The coding agent must configure and run equivalent commands (names may reflect the workspace package manager):

```text
lint
typecheck
test:unit
test:integration
test:e2e --slice=<n>
build
migration:run:fresh
translation:check
```

All failures must be fixed before proceeding. Database checks run against PostgreSQL, never an in-memory substitute. Money/state/idempotency tests must include concurrent requests where noted. Frontend E2E runs at desktop 1440×900, tablet 1024×768, and mobile 390×844 where the page is operational.

### 16.2 Slice-specific verification matrix

Each row explicitly covers backend (B), frontend (F), database (DB), Persian (FA), English (EN), RTL, LTR, workflow (W), and regression (R).

| Slice | B | F | DB | FA | EN | RTL | LTR | W | R |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | Auth/CSRF/rate/error tests | Login/shell/session | Fresh migrations, hashes, UTC | Login/errors translated | Same keys/text | Shell/dialog mirror | Shell normal | Login→refresh→logout | Health/build/contracts |
| 2 | CRUD/settings validation | Branch/terminal/settings | Unique/FK/hour checks | Persian names/date preview | English CRUD | Grids/forms/nav | Same LTR | Seed→edit→status | Slice 1 auth/context |
| 3 | Fallback/upload/import | Localization/image UI | UQ/checksum/archive | Entry/search/CSV | Entry/search/CSV | Preview/all shared UI | Preview/all UI | Upload→bind→display | Slices 1–2 and key check |
| 4 | Catalog rules/search | All editor tabs | FK/cycles/archive | Product/modifier text/search | Same | Drawers/tabs/tree | Same | Create product/combo | Auth/settings/files |
| 5 | Resolve/overlap/bulk | Composer/price flows | Range/concurrency/atomicity | Names/currency/dates | Same | Composer/grid/stepper | Same | Configure→resolve→bulk | Catalog CRUD |
| 6 | Search/dedupe/merge | Profile/list/merge | Relink/unique/index | Name/address/phone search | Same | Profile/tabs/dialog | Same | Create→candidate→merge | Branch/catalog unaffected |
| 7 | Rules/PIN/expiry | Builders/approval dialog | Immutable decisions/locks | Action/reason/error text | Same | Stepper/PIN | Same | Request→multi-approve | Settings/auth/audit |
| 8 | Evaluation/usage concurrency | Campaign/coupon/calculator | Usage/scope constraints | Campaign/product decision | Same | Editor/calculator | Same | Quote→approval→apply | Price/customer/rules |
| 9 | Shift formula/state | Open/movement/close | Partial unique/locks | Money/date/reasons | Same | Close cards/dialog | Same | Open→move→close | Approval/branch/auth |
| 10 | Order totals/state/idempotency | POS/orders/detail | Snapshots/events/no delete | Search/cart/notes/errors | Same | POS responsive/mirrored | Same | Draft→submit→edit/cancel | Catalog/price/discount/shift |
| 11 | Ledger/limit/aging | Account/statement | Lock/running balance | Customer/money/date | Same | Tables/dialogs | Same | Open→purchase-port→repay | Customer/approval/order |
| 12 | Post/retry/reverse/correct | Mixed payment UX | Atomic allocation/cash/credit | Methods/errors/receipt | Same | Payment drawer | Same | Cash+POS fail/retry | Order/shift/credit totals |
| 13 | Refund caps/method policy | Refund/cancel dialogs | Immutable links/counter rows | Reasons/methods | Same | Allocation/dialog | Same | Partial/alt/paid cancel | Payments/orders/reports fixtures |
| 14 | Move/merge/split locks | Floor/table dialogs | Occupancy/link integrity | Table/guest labels | Same | Floor/cards/actions | Same | Dine-in→split→settle | Orders/payments/KDS hooks |
| 15 | Routing/state/queue | KDS/print config/queue | Idempotent tickets/jobs | Kitchen/product notes | Same | Board/timers/routes | Same | Submit→bump→fail print→retry | Order state/performance |
| 16 | Courier/delivery states | Board/profile/capture | Assignment uniqueness | Address/status/receipt | Same | Kanban/cards/dialog | Same | Assign→deliver | Orders/payments/devices |
| 17 | Settlement formula/state | Batch detail/statement | Line uniqueness/immutability | Statement/reasons | Same | Summary/grid/stepper | Same | Preview→verify→close→reverse | Delivery/payment/approval |
| 18 | Kiosk policy/bootstrap | Touch kiosk | KIOSK channel consistency | Full customer UI | Full customer UI | Touch flow mirrors | Touch LTR | Browse→identify/guest→pay | Price/order/payment/print |
| 19 | HMAC/idempotent adapters | All simulator tabs/logs | Receipt/attempt UQs | Payload notes/display | Same | Forms/log detail | Same | Generate→duplicate→action | Domain records/audit/no network |
| 20 | Queue/retry/conflict worker | Offline/sync/monitor | Claim/dedupe/persistence | Conflict/status text | Same | Diff/grid/actions | Same | Offline→conflict→resolve | Simulator/branch/POS block |
| 21 | Every report/export/audit | Viewer/audit/alerts | Query totals/indexes/append-only | Columns/CSV/XLSX | Same | Grid/filter/export | Same | Transaction→reports reconcile | Full domain fixture suite |
| 22 | Import/reset/security | Exchange/reset/all states | Atomic import/reset/fresh migrate | UTF-8/full UI pass | Full UI pass | All-route visual pass | All-route visual pass | Fresh seed→customer journey→reset | Entire suite/build/no TODO/dead action |

### 16.3 Final workflow acceptance set

Before handoff, run these in both locales/directions where user-facing:

1. Configure branch/menu/prices/product/modifiers; open shift; create dine-in order; approve discount; split payment cash/mobile POS; KDS bump; simulated print failure/retry; complete; close shift; reconcile reports.
2. Create customer/credit account; credit + terminal partial payment; repayment; statement/aging; partial original refund; alternative cash refund approval; verify immutable links/reports/audit.
3. Create delivery order; check in courier; assign company mobile device; deliver with physical cash and mobile receipt; close courier settlement with discrepancy approval; verify separate instrument totals.
4. Generate Snappfood order/notes; accept/modify/add payment; send duplicate; cancel/refund; verify exactly one order and reconciliation/logs.
5. Set branch offline; enqueue representative operations; trigger failed retry/DLQ; create/resolve conflict; sync online; verify last-sync/offline duration/alerts.
6. Kiosk optional guest and required identification flows; simulated network POS/receipt failure and retry.
7. Export every report CSV/XLSX with Persian text; import customer/catalog Persian CSV; save layout; reset prototype and verify minimal seed/login.

---

## 17. Coding-agent rules

1. Follow this document exactly. Do not redesign the architecture, state models, database contracts, routes, money rules, or module ownership.
2. Complete one implementation slice at a time. A slice includes migration, backend, frontend, translations, tests, seed effects, and documentation. Do not build future-slice substitutes into the current slice.
3. Do not add a library unless the fixed stack or named shared libraries cannot reasonably implement the requirement. Before adding one, report the need, alternatives, bundle/runtime effect, and license.
4. Do not invent features, states, roles, settings, endpoints, pages, report meanings, or integration behavior. Do not silently remove or defer features.
5. Do not replace a fully functional workflow with a static screen, in-memory store, fixture, or frontend mock. PostgreSQL and real REST APIs are mandatory for all fully functional/simplified persisted scope.
6. Simulators must never call real external hosts or devices. They must be visibly labeled and still persist their logs/queues/domain results.
7. Do not create dead buttons, placeholder actions, catch-all “Coming soon” controls, or links to missing routes. Before a future slice exists, omit the control or show clearly disabled text naming the delivery slice, as specified.
8. Do not use mock frontend data outside Storybook/tests. TanStack Query calls the real backend. Do not duplicate totals, price, discount, approval, credit, transition, refund, or settlement business logic in React.
9. Do not create a giant generic service/controller or monolithic page. Use the exact modules/feature folders; controllers stay thin; domain policies are testable; pages compose focused components.
10. Do not modify a database contract without a forward TypeORM migration and updates to entity, DTO, validation, service, API client, UI schema, reports, seed, and tests. Never use TypeORM `synchronize`.
11. Financial/payment/refund/credit/cash/settlement/audit records are immutable after posting. Corrections are linked reversals/replacements. Never “fix” an amount with SQL update or cascade delete.
12. Use PostgreSQL transactions and row locks for order-critical and financial operations. Preserve lock ordering. Require idempotency where marked. Never rely on the UI to prevent duplicates.
13. Money travels as decimal strings and is calculated with `decimal.js`; no JavaScript floating point. Store `numeric(19,4)`, apply configured rounding, and assert allocation sums.
14. Store timestamps as UTC `timestamptz`; compute/display using tenant/branch time zone. Never store localized date strings. Effective ranges are half-open.
15. Every large list uses server pagination/filter/sort and stable tie-break. Do not load all products/customers/orders/report rows into the browser.
16. Every major mutation writes audit in the same transaction. Never log passwords, PINs, secrets, full card data, or unmasked sensitive payloads.
17. Support Persian content and search. Use logical layout properties, direction-aware MUI/Emotion, `Intl`, and identical `en/fa` keys. Do not hardcode left/right CSS for layout.
18. Handle loading, empty, filtered-empty, field error, business error, conflict, and retry states exactly as specified. Preserve user input on recoverable errors.
19. Run lint, type checking, unit, integration, slice E2E, build, fresh migrations, and translation checks after every slice. Report actual commands/results and do not continue with failures.
20. Report any required deviation before implementing it. State the affected decision/sections/entities/APIs/pages/tests and wait for an amended specification. Do not leave TODO/FIXME/unresolved placeholder decisions in delivered code.

---

## Definition of prototype completion

Prototype v1.5 is complete only when all 22 slices and Section 16 checks pass from a fresh PostgreSQL database; every classified F/S feature has persisted end-to-end behavior at its stated simplification; every M feature is visibly simulated with realistic controls/logs/results; excluded/deferred items have not leaked in as misleading partial implementations; all report totals reconcile to transactional sources; and the complete customer-validation workflows work in English/LTR and Persian/RTL.
