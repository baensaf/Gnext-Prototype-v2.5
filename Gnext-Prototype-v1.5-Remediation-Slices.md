# Gnext Prototype v1.5 — Remediation Slices

**Target repository:** `D:\VibeCoding\Antigravity\Gnext_Prototype_v1.5`  
**Primary product contract:** `Gnext-Prototype-v1.5-Build-Specification.md`  
**Purpose:** repair the existing Antigravity implementation; do not rebuild from another starter  
**Execution:** one slice at a time, with a reviewable commit after every passing slice

---

## 1. Authority and scope

The original build specification remains authoritative for product behavior, architecture, schema intent, APIs, pages, state machines, business rules, localization, and verification. This remediation document controls only:

1. the order in which the existing repository is repaired;
2. the acceptance evidence required before claiming a slice complete;
3. the treatment of functionality that was implemented beyond v1.5 scope.

If these instructions conflict with the original specification, follow the original specification except for the explicit decisions below.

### Explicit updated decisions

- Do **not** remove working overimplemented functionality merely because it is outside v1.5.
- Active out-of-scope functionality must be labeled **V5 Preview** in navigation, page headers, API documentation, and relevant simulator/report output. It must not be counted toward v1.5 completion.
- Inventory is retained as **V5 Preview**. It must not affect v1.5 catalog availability, order totals, order submission, KDS, reports, or branch status unless a future V5 specification explicitly authorizes that coupling.
- Unused starter-template code may remain if it is unreachable and does not affect build, security, bundle behavior, navigation, or tests. Do not spend a remediation slice deleting harmless files.
- Remove the workspace switcher from the rendered application shell and navigation. Its unused source files may remain.
- Do not remove or downgrade MUI Premium/Pro dependencies in this remediation.
- Do not replace the existing Minimal-based frontend or redesign the visual system.

---

## 2. Mandatory Antigravity working protocol

Before every remediation slice, Antigravity must:

1. Read this entire document and the original build specification.
2. Confirm the repository is on the remediation branch and show `git status --short`.
3. Preserve all pre-existing user changes. Never reset, discard, or overwrite work.
4. Implement only the current remediation slice.
5. Use forward migrations; never enable TypeORM runtime synchronization.
6. Avoid installing libraries unless the current dependencies cannot meet a stated requirement.
7. Run the slice checks, report exact commands/results, and commit only after they pass.
8. Stop after the slice and wait for user approval.

Every completion report must contain:

- commit hash and message;
- changed files and migration names;
- APIs and pages exercised;
- test counts and failures/warnings;
- database verification evidence;
- English/LTR and Persian/RTL evidence;
- any deviation from either specification;
- confirmation that no later slice was implemented.

### Global completion gates

No slice may be called complete when any of these are true:

- backend or frontend type checking fails;
- a migration cannot build a fresh PostgreSQL database;
- the slice relies on frontend mock/static business data;
- a fully functional workflow writes only to memory;
- a mutation endpoint can be called without an authenticated session and valid CSRF token, except documented simulated webhook/health routes;
- money is calculated with JavaScript `number`, `parseFloat`, or floating-point arithmetic;
- financial/order-critical writes are not transactional;
- the slice introduces a dead button, wildcard redirect masking a missing page, unresolved TODO, or silent fallback actor/tenant;
- English/Persian translation keys differ;
- the repository contains uncommitted slice changes at handoff.

---

## 3. Remediation slices

### R0 — Preserve the current implementation and establish the remediation branch

**Objective:** make the existing work recoverable before repairs begin.

**Required work**

- Inspect all 65 current modified/untracked entries and identify which belong to Slice 22, localization edits, uploaded test images, or other user work.
- Create a checkpoint commit containing the intended current implementation. Do not commit secrets, runtime uploads, caches, or generated output.
- Add `backend/uploads/` to `.gitignore`; retain a tracked `.gitkeep` only if the directory must exist.
- Move any legitimate seed image into a documented seed-assets folder; exclude random runtime uploads.
- Create branch `remediation/v1.5-conformance` from the checkpoint.
- Record current tool versions and commands in a root `README.md` without copying the starter-template mock-server guidance.

**Acceptance criteria**

- `git status --short` is empty on the remediation branch.
- Existing source is recoverable from the checkpoint commit.
- No `.env`, password, PIN, provider key, runtime upload, `node_modules`, build output, or database artifact is committed.
- README identifies backend/frontend locations, PostgreSQL requirement, startup order, environment template, default prototype credentials, and safe commands.

**Verification:** `git status`, `git ls-files`, secret-pattern scan, fresh clone file inventory. Do not run reset/seed against valuable data.

**Must not change:** product behavior, schema, routes, premium dependencies, or existing domain logic.

### R1 — Mark future functionality as V5 Preview and simplify active navigation

**Objective:** retain extra work without presenting it as v1.5 scope.

**Required work**

- Introduce a small frontend feature registry containing `version`, `status`, and `labelKey`; do not build a generic feature-flag platform.
- Mark Inventory as `V5 Preview` in sidebar, route page header, empty/error states, and API responses/documentation.
- Place active future functionality in a navigation group named **Future — V5 Preview**.
- Ensure V5 modules cannot change v1.5 order, availability, KDS, delivery, reports, or financial outcomes.
- Remove the workspace switcher from the rendered shell, including its button/popover and header space. Its source component may remain unused.
- Keep premium/pro dependencies unchanged.
- Hide starter sign-up, alternate JWT, upgrade, contacts, demo dashboards, and other template routes from active routing/navigation. If retained in source, they must be unreachable.
- Replace catch-all routing to Dashboard with a real localized 404 page so missing v1.5 routes are not concealed.

**Acceptance criteria**

- Inventory remains usable but visibly says `V5 Preview` in both locales.
- Workspace switcher is absent at desktop/tablet/mobile widths.
- No public sign-up or alternate authentication route is reachable.
- Unknown route renders 404 and does not redirect to Dashboard.
- V5 code has no imports/dependencies in v1.5 domain services except its isolated module registration.

**Tests:** route tests; nav snapshot in en/fa and LTR/RTL; dependency/import scan proving Inventory is isolated; 404 E2E.

**Must not change:** Inventory internals beyond isolation/labels, frontend theme, MUI dependencies.

### R2 — Replace schema synchronization with a real migration baseline

**Objective:** make PostgreSQL schema creation deterministic and safe.

**Required work**

- Remove `synchronize: true` from `seed.ts`; all TypeORM data sources must use `synchronize: false`.
- Create a shared TypeORM `DataSource` configuration used by runtime, migration CLI, tests, and seed.
- Create ordered forward migrations for every current v1.5 entity/table, constraint, enum, index, FK, soft-delete field, audit field, and extension.
- Put Inventory/V5 tables in migrations but mark them as V5 in migration comments/documentation; do not couple them to v1.5 transactions.
- Add migration scripts: create, generate, run, revert, show, and fresh-test database.
- Add an idempotent minimal seed that inserts the specification’s tenant/admin/branches/settings/reference data without creating schema.
- Replace timestamp-derived seed IDs with stable codes/lookups; seed may generate UUIDs once per database.

**Acceptance criteria**

- Empty PostgreSQL → migrations → minimal seed → backend readiness succeeds.
- Re-running migrations/seed changes nothing and produces no duplicates.
- `migration:show` reports no pending migration after setup.
- Migration revert/run succeeds for the newest migration in a disposable database.
- No application or seed path performs schema synchronization.

**Tests:** real PostgreSQL migration test, schema constraint/index inspection, seed idempotency test.

**Must not change:** entity meaning or delete existing user data; use additive/transforming forward migrations.

### R3 — Enforce authenticated request context and CSRF

**Objective:** ensure all protected APIs derive tenant/user from the verified session.

**Required work**

- Add session authentication guard and request-context middleware/interceptor that resolves session, user, tenant, locale, IP, and correlation ID.
- Apply the guard globally with explicit public decorators only for live/readiness, login, and documented simulated webhook endpoints.
- Add mutation CSRF guard comparing `X-CSRF-Token` to the authenticated session hash.
- Remove every hardcoded fallback tenant/user/actor UUID from controllers and services.
- `tenantId`, `userId`, and actor identity must never be accepted from client bodies for protected actions.
- Fix `/auth/me` to return the CSRF token associated with the current session; do not generate a new unmatched token on every request.
- Enforce session expiry/revocation and inactive-user checks.
- Restrict CORS to configured frontend origins; never `origin: true` with credentials.
- Protect uploaded-file content behind an authenticated controller; do not expose the upload directory as unauthenticated static files.

**Acceptance criteria**

- Every protected read returns 401 without session.
- Every protected mutation returns 403 without valid CSRF.
- Wrong/expired/revoked session cannot mutate data.
- Two sessions cannot select/inject a different tenant via headers/body/query.
- Login/logout/me and locale preference work in the SPA after refresh.

**Tests:** guard/unit plus Supertest integration tests with real cookie/CSRF flow; negative tests for every public exception; CORS tests.

**Must not change:** one shared full-access administrator model; no advanced RBAC/Keycloak.

### R4 — Add global DTO validation, API conventions, pagination, and error contracts

**Objective:** make REST input/output deterministic.

**Required work**

- Configure global `ValidationPipe` with transform, whitelist, and `forbidNonWhitelisted`.
- Create explicit request/query DTOs for every controller; remove `any` and anonymous unvalidated mutation bodies.
- Validate UUIDs, enums, strings, money strings, quantities, ISO dates/timestamps, paging, sorting allowlists, and filter allowlists.
- Standardize Problem Details responses and stable error codes; never leak stack traces.
- Add common `PagedResponse<T>` and convert all potentially large lists to server-side paging with stable `id` tie-break.
- Require `version` on mutable aggregate updates and map stale writes to `409 VERSION_CONFLICT`.
- Normalize API base URL through `VITE_SERVER_URL`; remove hardcoded frontend localhost URL.
- Generate shared contract types from an OpenAPI document or maintain one explicit contracts package. Do not keep conflicting per-page shapes.

**Acceptance criteria**

- Unknown mutation fields and invalid money numbers are rejected.
- Large lists never return unbounded data.
- Frontend renders field errors and correlation IDs from Problem Details.
- Current backend and frontend type checks pass.

**Tests:** controller validation integration suite; paging/filter/sort contract suite; frontend error mapping tests.

**Must not change:** REST, camelCase JSON target, UUID IDs, decimal-string money.

### R5 — Implement reusable transactions, idempotency, money, audit, and outbox foundations

**Objective:** provide safe primitives before repairing domain workflows.

**Required work**

- Implement transaction helpers that accept a transaction-scoped EntityManager; domain operations must not mix global repositories inside a transaction.
- Implement deterministic lock ordering and PostgreSQL row locks for financial/order aggregates.
- Complete `IdempotencyRecord` reservation/replay, request hash comparison, 24-hour expiry, and same-key/different-body conflict.
- Require `Idempotency-Key` on the commands marked in the original specification.
- Centralize money parsing/calculation/rounding/allocation using `decimal.js`; forbid `number` money in DTOs/services.
- Add an automated source check rejecting `parseFloat`, `toFixed`, or arithmetic on monetary fields in domain/frontend business logic.
- Make AuditWriter transaction-aware so audit commits with the mutation.
- Complete durable outbox claim/process/fail behavior using `FOR UPDATE SKIP LOCKED`; no in-memory event queue.

**Acceptance criteria**

- Retried identical mutation returns the original result with no duplicate rows.
- Different request body with same key returns 409.
- Forced failure after a financial insert rolls back financial, aggregate, audit, and outbox writes.
- Allocation/rounding properties pass across representative currencies.

**Tests:** real PostgreSQL concurrency/rollback/idempotency/locking tests and property-based money allocation tests.

**Must not change:** modular monolith or REST deployment shape.

### R6 — Complete tenant, branch, terminal, settings, localization, and media foundations

**Objective:** bring foundational configuration to specification parity.

**Required work**

- Complete branch paging/search, operating-hour validation, terminal lifecycle, branch status snapshots, currencies, payment methods, reason codes, and typed tenant settings.
- Enforce one tenant, no tenant switching, and no branch-level policy overrides.
- Replace generic settings JSON writes with per-group validated schemas.
- Complete `localized_text`/translation-entry behavior with `en`/`fa` fallback and CSV import/export.
- Validate media by signature, size, MIME, dimensions, opaque filename, checksum, and ownership/reference.
- Make media tests use a temporary directory, never the repository upload directory.
- Ensure runtime uploads are ignored and cleanup behavior is deterministic.

**Acceptance criteria**

- Branch/currency/time-zone settings persist and format correctly.
- Persian and English localized entity names follow fallback order.
- Invalid/cross-tenant file access is rejected.
- Media unit/integration test passes without changing repository files.

**Tests:** branch/settings/localization/media integration tests; UTF-8 CSV round-trip; RTL/LTR screenshots.

**Must not change:** V5 Inventory or premium dependencies.

### R7 — Repair catalog relational model

**Objective:** replace the compressed catalog model with the required functional catalog.

**Required work**

- Add/complete product variants, modifier groups/options, product-group links, min/max/free selections, combo components, tax rules, packaging rules, image relationships, descriptions, discount flags, translations, and history.
- Migrate existing OptionGroup/OptionItem/ProductOptionGroup data into the final contract without losing records.
- Enforce codes/SKUs, default variant, combo-cycle, modifier min/max, archive/reference, and soft-delete rules.
- Implement server-paged category/product/modifier endpoints matching the original API specification.
- Update frontend category/product/modifier pages to use real forms, field errors, loading/empty/error states, and localized text.
- V5 Inventory stock must not decide whether a catalog item is sellable.

**Acceptance criteria**

- A bilingual standard product and combo with required modifiers can be created and reloaded.
- Impossible modifier/combo configurations are rejected server-side.
- Historic order snapshots survive product/archive changes.
- Product list supports server paging and Persian search.

**Tests:** entity constraints, migrations, CRUD/search/archive integration, frontend product workflow E2E.

**Must not change:** Inventory remains separate V5 Preview.

### R8 — Rebuild menus, availability, and pricing precedence

**Objective:** make backend price/menu/availability resolution authoritative.

**Required work**

- Implement effective-dated `PriceEntry` dimensions and exact precedence from Section 7 of the original specification.
- Add non-overlap enforcement and transactional price supersession.
- Complete price groups/branch membership, branch/channel/order-type/variant/modifier/packaging/delivery prices, resolution diagnostics, price history, and atomic bulk preview/commit.
- Complete branch/channel/effective menus and atomic composition.
- Implement availability specificity, schedules, temporary suspension/resume, and sellability resolution.
- Remove menu-level ad hoc price overrides that bypass the price book; migrate them into price entries.
- Frontend price/menu/availability pages must display the selected resolution source.

**Acceptance criteria**

- The full precedence matrix and half-open effective boundaries pass.
- Bulk update cannot partially commit.
- POS/Kiosk/catalog preview receive the same server-resolved price and availability.
- Existing orders retain snapshots after price changes.

**Tests:** table-driven price matrix, overlap concurrency, menu/schedule boundary, bulk rollback, UI composer/bulk E2E.

**Must not change:** one currency per order; no FX engine.

### R9 — Complete customer profiles, deduplication, merge, consent, tags, and segments

**Objective:** repair the customer model before discounts/credit/order assignment.

**Required work**

- Add multiple phones, addresses, custom field definitions/values, tags/links, segments, consent events, merge history, home branch, search normalization, and customer history.
- Migrate the existing single `mobile` field into a primary phone record while maintaining a temporary compatible read projection.
- Implement duplicate suggestions and transactional merge with field-resolution choices.
- Add server pagination/search by Persian/English name, normalized phone, customer number, tag, segment, branch, and status.
- Complete list/detail routes rather than one combined directory page only.

**Acceptance criteria**

- Multiple phones/addresses persist; exact normalized phone drives duplicate suggestions.
- Merge relinks supported references and leaves a traceable source alias.
- Customer profile/order/credit/consent/activity tabs use persisted data.

**Tests:** normalization/deduplication/merge concurrency; customer E2E in en/fa.

**Must not change:** one-tenant brand relationship; no advanced privacy platform.

### R10 — Complete approval policies and PIN workflow

**Objective:** replace raw-PIN shortcuts with bound approval requests.

**Required work**

- Add approval profiles and ordered rule steps if absent; retain seeded Supervisor/Finance/IT profiles.
- Match rules by action, priority, branch, order state, amount, percentage, and allowed condition keys.
- Snapshot rule/steps on request creation; implement pending/current step/approve/reject/expire/cancel.
- Bind approval to exact requester, action, entity, values, version, and command hash for ten minutes.
- Use Argon2 PIN hashes, five-attempt lockout, lock events, and audit without logging PIN.
- Remove direct `pin` authorization from refund/cancellation/discount/payment commands; commands accept approved request IDs.
- Complete Approval UI stepper and pending-request page with localized states.

**Acceptance criteria**

- One-step and two-step approvals work; changed command invalidates approval.
- Wrong PIN locks correctly and never appears in logs/network response.
- Concurrent decisions cannot approve the same step twice.

**Tests:** matcher, expiry, binding, rate limit, concurrent decision PostgreSQL tests and UI E2E.

**Must not change:** no real user/RBAC management.

### R11 — Rebuild deterministic discounts

**Objective:** implement the original discount rules rather than coupon-only arithmetic.

**Required work**

- Add campaign types, scopes, exclusions, priorities, stacking groups, usage records, funding source, customer/tag/segment/branch/product/category/channel/order-type eligibility, free items, and free delivery.
- Implement exact evaluation order, sequential percentages, fixed allocation, caps, never-discount, own non-stackable discount, conflict winner, coupon normalization/limits, and explainability.
- Lock usage counters at submission; quote does not consume usage.
- Implement manual percent/fixed discount with reason and approval request binding.
- Remove frontend discount calculation; frontend renders server quote/decisions only.

**Acceptance criteria**

- Every Section 7 discount example has a deterministic test.
- Quote lists applied and rejected campaigns with stable reasons.
- Concurrent final submissions cannot exceed usage limits.
- Free reward lines cannot recursively qualify promotions.

**Tests:** table-driven engine suite, allocation property tests, concurrent usage integration, campaign/coupon UI E2E.

**Must not change:** usage is not restored on cancellation/refund in v1.5.

### R12 — Rebuild order aggregate and POS draft/quote/submission

**Objective:** create the authoritative workflow on which later financial/operational slices depend.

**Required work**

- Add required order items/modifiers/adjustments/notes/links/state events and price/tax/discount/packaging/delivery snapshots.
- Implement DRAFT creation/update, server quote, `quoteVersion`, idempotent submit, allowed state commands, edit/replace/cancel/reopen rules, windows, approvals, and complete history.
- Use the exact fixed order states from the original specification; migrate existing statuses.
- Create order number safely with a database-backed sequence/unique retry, not `Date.now()`.
- Quote and submit through transactions and backend catalog/pricing/discount policies.
- Rebuild POS cart to use decimal strings and server quotes. Client may display a tentative loading subtotal but must not submit it as authority.
- Add required customer/table/address/type/notes behavior, hold drafts, stale-quote comparison, and session cart restoration/requote.

**Acceptance criteria**

- Duplicate submit creates one order/KDS/outbox set.
- Price/availability/discount change returns stale quote and explicit updated totals.
- Direct illegal status assignment is impossible.
- Submitted edit creates retained history/snapshots rather than overwriting lines.
- POS works at required desktop/mobile sizes in both directions.

**Tests:** state matrix, totals, idempotency/concurrent edit, snapshot history, complete POS E2E.

**Must not change:** no Inventory coupling; no frontend business totals.

### R13 — Repair cashier shifts and business-day close

**Objective:** make cash operations transactional and reconcilable.

**Required work**

- Align entities with CashierShift, immutable CashMovement, and BusinessDayClose semantics.
- Enforce one open shift per terminal/currency, opening movement, paid-in/out reasons, closing-review state, stale preview version, processing-payment blockers, discrepancy reason/approval, immutable close, and business-day blockers/reopen approval.
- Derive expected cash only from persisted shift-linked cash movements.
- Replace frontend variance arithmetic with server preview values; UI may format only.

**Acceptance criteria**

- Concurrent open attempts yield one shift.
- Noncash/mobile POS/credit never alter expected physical cash.
- Close failure rolls back all movements/state/audit.
- Statement totals reconcile after refresh.

**Tests:** PostgreSQL concurrency/rollback/formula tests, close E2E, report fixture.

**Must not change:** no shift reopen; business-day rules remain as original.

### R14 — Repair customer credit subledger

**Objective:** make credit immutable, locked, and financially consistent.

**Required work**

- Align current account/transaction entities with immutable signed CreditEntry semantics and running balance.
- Support finite/unlimited/policy modes, eligibility, suspension, limit override approvals, purchases, repayment, adjustment, reversal/refund, statement, and FIFO aging.
- Lock the account during all postings; use decimal strings and transaction-scoped repositories.
- Remove frontend aggregation as an authoritative total; use server-provided summaries.

**Acceptance criteria**

- Concurrent purchases cannot exceed limit.
- Balance equals immutable entries; direct balance update is impossible.
- Aging boundaries and opening/closing statements are correct in tenant business dates.

**Tests:** concurrency, reversal, limit approval, FIFO aging, UI account/statement E2E.

**Must not change:** signed balance convention and account currency immutability.

### R15 — Rebuild payments, split/partial settlement, devices, and corrections

**Objective:** guarantee atomic payment posting and correct classification.

**Required work**

- Align payment states, attempts, allocations, devices, settlement accounts, references, shift, business date, idempotency, original/correction links.
- Implement one active intent per order, transaction/row lock, success-only posting, failure/retry, cash/credit synchronous adapters, deterministic simulated external adapters, reversal, and correction.
- Split payment must post each tender explicitly; a later failed tender must retain earlier successes.
- Mobile POS is always card/POS and requires device owner/account/receipt metadata.
- Update order paid/outstanding totals only inside the same posting transaction.
- Remove native-number payment amounts from frontend and backend.

**Acceptance criteria**

- Duplicate callbacks/commands cannot double-post.
- Cash movement, credit entry, payment/allocation, order totals, audit, and outbox commit or roll back together.
- Cash + failed POS and credit + failed POS behave exactly as specified.
- Correction is reversal plus replacement, never mutation.

**Tests:** real concurrent payment/idempotency/rollback tests; mixed-payment and failure/retry E2E.

**Must not change:** no overpayment/gratuity/FX.

### R16 — Rebuild refunds and paid-order cancellation

**Objective:** preserve immutable payment history and enforce refund eligibility.

**Required work**

- Align Refund and allocation records with pending/processing/succeeded/failed/cancelled/reversed states.
- Compute remaining refundable principal across original payments, prior refunds, and reversals under row locks.
- Implement full/partial/item allocations, original-method default, alternative-method matrix, approved request, mandatory reason/reference, cash-shift requirement, external failure/retry, and refund reversal.
- Never create a negative “payment” as a substitute for a refund record.
- Do not reduce original payment principal or reopen collectible outstanding after a completed-order refund.
- Paid cancellation completes only after required refund succeeds; failed external refund leaves order unchanged.

**Acceptance criteria**

- Concurrent refunds cannot exceed remaining refundable amount.
- POS→cash/bank alternative refunds retain original/target classification and approval link.
- Failed refund changes no posted order/cash/credit totals.
- Original payment remains immutable.

**Tests:** concurrency/allocation/alternative method/rollback/retry/cancel orchestration; E2E.

**Must not change:** ordinary refunds only for completed orders or paid-cancel orchestration.

### R17 — Complete dine-in operations

**Objective:** implement tables, occupancy, split/merge/transfer, and settlement behavior safely.

**Required work**

- Complete sections/floors, tables, occupancy events, guest counts, assign/move, merge, split orders, transfer quantities/items, guest bill, and settle separately/together.
- Lock all affected tables/orders in sorted UUID order.
- Preserve order links/history; never move successful payments between orders.
- Replace table-number strings on orders with real table relationships while preserving snapshot display.

**Acceptance criteria**

- Move/merge/split/transfer update every affected aggregate atomically.
- Incompatible branch/currency/type or processing payments block operations.
- Floor refresh shows accurate occupancy after every operation.

**Tests:** multi-row concurrency/deadlock, partial quantity split, history, floor/settlement E2E.

**Must not change:** source payments remain on source orders.

### R18 — Complete KDS and simulated printing

**Objective:** replace compressed station/printer simulation with full persisted workflows.

**Required work**

- Add KDS screens, routing rules, ticket/item events, station targets, priority, timers, idempotent creation, bump, recall, and order readiness roll-up.
- Add printers, groups/members, routes, print jobs/attempts, copies, document types, preview, failure, retry, fallback, reprint reason/history.
- Use outbox events from order changes; printing failure must not roll back orders.
- Implement SSE board updates with polling fallback.
- Clearly label all printer/hardware behavior simulated.

**Acceptance criteria**

- One ticket per order/station despite event retries.
- Product routing beats category; fallback chain records every attempt.
- Recall/time thresholds and ticket readiness match the state machine.

**Tests:** routing/idempotency/SSE/reconnect/sanitized preview/fallback and KDS E2E.

**Must not change:** no real printer or production offline KDS connection.

### R19 — Complete delivery, couriers, attendance, device assignment, and execution

**Objective:** separate delivery execution from settlement and instrument accounting.

**Required work**

- Add delivery zones/fees, courier profiles, attendance, availability, terminal assignments, delivery/events, compensation snapshots, and exact state machine.
- Require valid address/zone on delivery order.
- Enforce attended/available/capacity checks and one active mobile-device assignment.
- Capture courier cash and company mobile POS receipt/reference separately.
- Align order dispatch/completion with delivery transitions transactionally.

**Acceptance criteria**

- Only eligible courier can be assigned.
- Device cannot be assigned twice.
- Cash and POS expectations remain separate through delivery completion.
- Failed/requeue history is retained.

**Tests:** attendance/device/state/concurrency tests and complete delivery E2E.

**Must not change:** tips are not part of the v1.5 specification; preserve existing data but hide/ignore tip behavior for v1.5 unless marked V5 Preview.

### R20 — Repair courier settlements

**Objective:** make courier settlement immutable and reconcilable.

**Required work**

- Implement exact eligibility, preview, unique line reservation, expected/actual cash, expected/verified POS, compensation, adjustments, discrepancies, reasons, approval, review/return/close/reverse/statement.
- Use one transaction and locks for create/close/reverse.
- Never net mobile POS into cash.
- Closed batches and lines are immutable; corrections use linked adjustment/reversal batch.
- Remove frontend calculation of authoritative settlement totals.

**Acceptance criteria**

- Same delivery/payment cannot enter two active/closed non-reversed batches.
- Server totals match statement/report after refresh.
- Close failure leaves no partial batch/line state.

**Tests:** concurrency, formulas, reversal, approval, complete courier-day E2E.

**Must not change:** instrument separation and compensation formula.

### R21 — Make kiosk reuse the standard order/payment engines

**Objective:** remove the kiosk’s duplicate floating-point implementation.

**Required work**

- Keep `/kiosk/bootstrap` as a read aggregation.
- Route kiosk order creation through the same draft/quote/submit application services as POS.
- Route kiosk payment through the standard payment service and simulated terminal adapter.
- Enforce required/optional identification and guest rules server-side.
- Remove client and kiosk-service price/tax/total arithmetic; all amounts are decimal strings from server quotes.
- Retain responsive touch UX and visible simulated hardware/offline labels.

**Acceptance criteria**

- Same basket/context produces exactly the same POS and kiosk quote.
- Direct client-supplied unit price/additional price is ignored/rejected.
- Duplicate kiosk submit/payment is idempotent.

**Tests:** parity/property tests, policy tests, mobile/tablet en/fa RTL/LTR E2E.

**Must not change:** kiosk remains part of v1.5; V5 Inventory does not affect kiosk availability.

### R22 — Complete deterministic external simulators

**Objective:** create realistic simulations without bypassing domain rules.

**Required work**

- Add persisted scenarios, logs, attempts, webhook receipts, aggregator mappings, deterministic outcome/latency/error, masked payloads, and correlation chains.
- Remove hardcoded secrets and random outcome/order generation; use configured mock branch secret and caller-selected deterministic scenario.
- Implement raw Snappfood timestamp/HMAC validation, per-branch path/credentials, mapping failures, duplicate stored result, notes, accept/reject/pick/modify/additional payment/cancel/recovery/catalog sync.
- Invoke standard order/payment/refund services rather than writing order/payment tables directly.
- Complete Tara validation/create/confirm/reversal/refund/settlement/reconciliation/failure/retry flows through mock adapters.
- Ensure zero outbound network/device calls.

**Acceptance criteria**

- Duplicate webhook produces one domain effect and a traceable duplicate receipt.
- Invalid HMAC/timestamp creates no order.
- Generated orders obey mappings, pricing, state, KDS, delivery, and payment rules.
- Deterministic test results never depend on `Math.random()`.

**Tests:** HMAC/skew/idempotency/mapping/scenario/zero-network and simulator UI E2E.

**Must not change:** every external interaction remains simulated and labeled.

### R23 — Complete durable offline/synchronization simulation

**Objective:** meet the simulated durability/conflict requirements without building a production offline engine.

**Required work**

- Persist branch connectivity/status/heartbeat/version/offline-since/last-successful-sync; remove in-memory connectivity map.
- Implement queue dedupe key, retry schedule, attempts, worker claiming, failed/dead-letter states, manual retry clone, and incremental category logs.
- Validate offline operation payload per domain; do not accept arbitrary financial JSON.
- Create explicit version conflicts with local/cloud originals and Local/Cloud/Merged resolution.
- Disallow arbitrary merged financial payloads; use domain correction commands.
- Advance last successful sync only after all selected work succeeds/resolves.

**Acceptance criteria**

- Restart preserves offline state/queue/conflicts.
- Duplicate enqueue returns existing active item.
- Failed/conflicted batch does not advance last successful sync.
- Resolution retains originals/result/audit.

**Tests:** worker concurrency/restart/retry/DLQ/dedupe/conflict and offline→online E2E.

**Must not change:** no Rust agent, local database, or real offline browser engine.

### R24 — Replace report, alert, export, and audit placeholders

**Objective:** implement every required report from real persisted data.

**Required work**

- Implement all report codes and definitions in Section 13 of the original specification, including filters, grouping, totals, business-date/branch handling, paging, and drill links.
- Delete hardcoded sample report rows and mock XLSX bytes.
- Use ExcelJS already approved by the original specification if not present; add only if necessary.
- Add saved report views and export jobs; CSV UTF-8 BOM and real typed XLSX.
- Persist operational alerts; remove in-memory alert array.
- Complete immutable audit query/paging/masking and alert acknowledgment audit.
- Add server-derived Dashboard KPIs and Monitoring summaries.

**Acceptance criteria**

- Every report catalog entry executes a real query and returns no invented row.
- Page totals equal export totals for identical filters.
- Cross-report fixtures reconcile sales/payments/refunds/credit/shifts/couriers.
- Alerts survive restart.

**Tests:** fixture-based PostgreSQL report suite, export parsing tests, reconciliation properties, report/audit UI E2E.

**Must not change:** V5 Inventory must not appear in v1.5 reports except a separate clearly labeled V5 Preview report.

### R25 — Repair CSV import/export and make reset safe

**Objective:** complete Slice 22 without mock UI or destructive reset behavior.

**Required work**

- Connect import wizard to real upload/map/distinct/validate/commit/status APIs; remove `setTimeout` and invented summary counts.
- Align APIs with staged `ImportJob`/row results, UTF-8 CSV, mapping, row errors, duplicate strategy, all-or-nothing commit, idempotency, and audit.
- Ensure import commit uses transaction-scoped repositories and cannot partially write.
- Replace reset SQL completely. Never use `OR 1=1`, unrestricted DELETE, or raw client table selection.
- Implement confirmation phrase, password revalidation, advisory lock, ResetJob/status, transactional tenant-data reset, minimal reseed, session revocation, post-reset audit/security marker, and safe upload cleanup.
- Connect reset page to start/status APIs and log the user out on success.
- Do not include V5 Inventory records in the default minimal seed. A separate explicit V5 demo seed may create them and must be labeled.

**Acceptance criteria**

- Import UI result equals persisted job result; Persian CSV round-trips.
- Failed import/reset rolls back database changes.
- Reset affects only intended tenant-owned data and recreates minimal seed.
- Concurrent reset is rejected; credentials/phrase are never stored.

**Tests:** CSV injection/encoding/mapping/duplicate/rollback; disposable-database reset/advisory/session/file tests; UI E2E.

**Must not change:** never run reset tests against the user’s normal database.

### R26 — Complete route/page parity, localization, loading, and error states

**Objective:** make the frontend conform to the specified route and page contract after backend repair.

**Required work**

- Implement every exact v1.5 route from Section 9.1, including detail/configuration/simulation/report routes currently missing.
- Redirect only documented legacy aliases; do not replace missing routes with Dashboard.
- Split oversized pages into focused components/dialogs/drawers while preserving Minimal theme.
- Use TanStack Query for server state and React Hook Form + Zod for forms as specified; remove manual duplicated loading/state patterns where practical.
- Replace all hardcoded user-facing operational text with matching `en`/`fa` keys. IDs/phone/reference remain LTR inside RTL.
- Implement skeleton, empty, filtered-empty, field/business error, version conflict, approval required, stale quote, and retry states.
- Apply full RTL/LTR logical layout and required responsive widths/touch targets.
- Keep V5 Preview navigation/page labels translated; remove workspace switcher permanently.

**Acceptance criteria**

- Automated route inventory matches the specification.
- Translation key checker reports zero missing keys; main journeys contain no hardcoded English-only text.
- Every page has documented loading/empty/error behavior.
- Desktop/tablet/mobile screenshots show no clipped primary actions in both directions.

**Tests:** route/translation/accessibility/visual checks and page-level E2E.

**Must not change:** premium dependencies and visual theme; no Product Design redesign.

### R27 — Final integration, regression, and customer-validation certification

**Objective:** prove the repaired prototype is actually complete.

**Required work**

- Add PostgreSQL integration harness and Playwright E2E harness.
- Add scripts required by Section 16: lint, typecheck, unit, integration, E2E, build, migration fresh/revert/show, translation check.
- Run all six final workflow acceptance journeys from the original specification in English/LTR and Persian/RTL as applicable.
- Verify V5 Preview features are isolated and labeled, with Inventory excluded from v1.5 acceptance totals.
- Produce a traceability matrix mapping every original functional/simplified/simulated feature and all remediation slices to code, migration, API, page, and test evidence.
- Remove no V5 Preview functionality. Only fix it if it breaks v1.5 build/security/isolation.
- Resolve all type errors, test failures, and lint errors. Warnings require explicit disposition; do not ignore hook-dependency or localization warnings.

**Acceptance criteria**

- Clean clone + empty PostgreSQL can install, migrate, seed, start, and pass all checks.
- Backend/frontend typecheck and lint have zero errors; accepted warnings are documented and do not affect correctness.
- All unit/integration/E2E tests pass with counts reported.
- All v1.5 report totals reconcile to transactions.
- No mock frontend data exists in functional modules.
- No mutation lacks auth/CSRF/audit where required.
- `git status --short` is empty and a final signed-off commit exists.

**Must not change:** do not claim production readiness; simulations remain simulated; V5 Preview remains outside v1.5 certification.

---

## 4. Recommended execution groups

Execute strictly in slice order, but the following groups are useful review checkpoints:

| Checkpoint | Slices | Outcome required before continuing |
|---|---|---|
| A — Preserve and contain | R0–R1 | Clean branch, V5 labeling, no workspace switcher, no hidden missing-route redirects. |
| B — Safe platform | R2–R6 | Fresh migrations/seed, enforced auth/CSRF/validation, transaction/idempotency/money/audit foundations. |
| C — Sellable configuration | R7–R11 | Catalog/customer/approval/discount/pricing contracts pass integration tests. |
| D — Core transactions | R12–R16 | Orders, POS, shifts, credit, payments, refunds are transactional and immutable. |
| E — Operations | R17–R21 | Dine-in, KDS/printing, delivery/settlements, and kiosk work end to end. |
| F — Simulation and evidence | R22–R27 | Simulators, sync, reports, import/reset, frontend parity, and final certification pass. |

Do not parallelize slices within groups C or D because their schema and business rules depend on earlier slices. UI-only work for a slice may proceed in parallel with its backend only if both use an already-agreed contract and merge before slice verification.

---

## 5. Prompt to give Antigravity for each slice

Replace `[SLICE]` with one remediation slice number and title.

```text
Treat these as authoritative, in order:
1. Gnext-Prototype-v1.5-Build-Specification.md for product and architecture.
2. Gnext-Prototype-v1.5-Remediation-Slices.md for repair order and updated V5 decisions.

Implement [SLICE] only in the existing repository.

Before coding:
- Read both documents completely.
- Show the current branch, commit, and git status.
- Summarize the exact requirements, affected contracts, and tests for [SLICE].
- Identify conflicts with existing user changes; do not discard them.
- Report any required deviation before implementing it.

During implementation:
- Preserve current work and existing data through forward migrations.
- Do not implement later slices.
- Do not use mock frontend data for functional modules.
- Do not calculate money with JavaScript numbers.
- Use transactions, locks, idempotency, audit, and validation where the slice requires them.
- Keep overimplemented functionality, label it V5 Preview, and keep it isolated from v1.5.
- Remove the workspace switcher from active UI when working on R1/R26.
- Do not change MUI Premium/Pro dependencies.

After implementation:
- Run every check required by the slice plus typecheck and lint for both apps.
- Fix all failures.
- Verify English/LTR and Persian/RTL behavior.
- Show migration/database evidence where applicable.
- Commit the completed slice with a focused message.
- Report commit hash, changed files, APIs/pages, exact command results, acceptance evidence, deviations, and remaining risks.
- Stop and wait for approval.
```

---

## 6. Prohibited shortcuts

- Do not mark the existing broad UI as completion evidence without exercising real APIs and PostgreSQL records.
- Do not keep hardcoded tenant/user fallback IDs after R3.
- Do not use frontend authentication as a substitute for backend guards.
- Do not use `synchronize`, raw schema creation in seed, or hand-edited production tables.
- Do not treat repository-mocked unit tests as integration tests.
- Do not return sample report rows, mock XLSX bytes, in-memory alerts, or local fake import/reset success.
- Do not invoke repositories outside the active transaction for critical commands.
- Do not create negative payments to represent refunds.
- Do not allow direct status patching around state machines.
- Do not retain duplicated POS/Kiosk pricing or payment logic.
- Do not delete V5 Preview features solely to reduce scope.
- Do not reconnect the workspace switcher.

---

## 7. Remediation completion definition

Remediation is complete only when R0–R27 are individually committed and verified; a fresh database is created solely through migrations; minimal seed is idempotent; all protected APIs enforce session/tenant/CSRF; all functional financial/order workflows are transactional and use decimal-safe money; all simulated features are persisted, deterministic, labeled, and network-free; every required page/API/report exists; imports/reset are real and safe; both locales/directions pass; all required automated checks pass; V5 Preview functionality remains clearly isolated; the workspace switcher is absent; and the repository is clean.
