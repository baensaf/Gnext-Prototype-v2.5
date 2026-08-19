# Gnext Prototype v2 — Traceability & Certification Matrix

This document provides a comprehensive traceability matrix mapping every original functional requirement and all remediation slices (**R0** through **R27**) to backend/frontend code implementations, TypeORM schema migrations, REST API endpoints, page components, and test evidence.

---

## 1. Remediation Slices Traceability Matrix (R0–R27)

| Slice | Title / Scope | Key Code Files | Migration / DB Evidence | Key API Endpoints | Page / UI Evidence | Test Suite & Verification |
|:---:|---|---|---|---|---|---|
| **R0** | Initial Containment & Isolation | `AppShell.tsx`, `nav-config-dashboard.tsx` | Schema baseline | `/api/v1/health` | Dashboard, V5 Preview banner | `tsc`, Jest baseline |
| **R1** | Auth, Session, Rate Limit & CSRF | `auth.service.ts`, `jwt.strategy.ts`, `csrf.guard.ts` | `AdminUser.entity.ts`, `Tenant.entity.ts` | `/api/v1/auth/login`, `/me` | `/login`, `AppShell` | `postgres-integration.spec.ts` |
| **R2** | Platform Administration & Hierarchy | `tenant.service.ts`, `branches.controller.ts` | `Branch.entity.ts`, `Terminal.entity.ts` | `/api/v1/tenants`, `/branches` | `/app/settings/general`, `/branches` | `postgres-integration.spec.ts` |
| **R3** | Media Asset Storage & Import Engine | `media.service.ts`, `media.controller.ts` | `FileAsset.entity.ts` | `/api/v1/media/upload` | `/app/catalog/import-export` | `postgres-integration.spec.ts` |
| **R4** | Master Catalog Management | `catalog.service.ts`, `catalog.controller.ts` | `Category.entity.ts`, `Product.entity.ts` | `/api/v1/catalog/products` | `/app/catalog/products`, `/categories` | `postgres-integration.spec.ts` |
| **R5** | Price Engine & Menus Composer | `pricing.service.ts`, `menus.controller.ts` | `PriceBook.entity.ts`, `Menu.entity.ts` | `/api/v1/pricing/price-book` | `/app/catalog/menus`, `/pricing/price-book` | `postgres-integration.spec.ts` |
| **R6** | Customer Directory & Deduplication | `customer.service.ts`, `customer.controller.ts` | `Customer.entity.ts` | `/api/v1/customers` | `/app/customers`, `/customers/:id` | `postgres-integration.spec.ts` |
| **R7** | Approval Rules & Multi-Profile Stepper | `approval.service.ts`, `approval.controller.ts` | `ApprovalRule.entity.ts` | `/api/v1/approvals` | `/app/settings/approvals` | `postgres-integration.spec.ts` |
| **R8** | Discounts & Coupons Calculator | `discount.service.ts`, `discount.controller.ts` | `DiscountCampaign.entity.ts`, `Coupon.entity.ts` | `/api/v1/discounts/campaigns` | `/app/discounts/campaigns` | `postgres-integration.spec.ts` |
| **R9** | Cashier Shifts & EOD Balancing | `cashier.service.ts`, `cashier.controller.ts` | `CashierShift.entity.ts` | `/api/v1/cashier/shifts` | `/app/cashier/shifts`, `/shifts/:id` | `postgres-integration.spec.ts` |
| **R10** | Order Workflow & State Transitions | `order.service.ts`, `order.controller.ts` | `OrderHeader.entity.ts`, `OrderItem.entity.ts` | `/api/v1/orders` | `/app/orders`, `/orders/:id` | `postgres-integration.spec.ts` |
| **R11** | Customer Credit Accounts & Aging | `credit.service.ts`, `credit.controller.ts` | `CustomerCreditAccount.entity.ts` | `/api/v1/credit/accounts` | `/app/credit/accounts` | `postgres-integration.spec.ts` |
| **R12** | Payments Allocation & Mixed Methods | `payment.service.ts`, `payment.controller.ts` | `Payment.entity.ts` | `/api/v1/payments` | `/app/payments` | `postgres-integration.spec.ts` |
| **R13** | Refunds & Cancellation Policy | `refund.service.ts`, `refund.controller.ts` | `Refund.entity.ts` | `/api/v1/refunds` | `/app/refunds` | `postgres-integration.spec.ts` |
| **R14** | Dine-In Floor Management | `dine-in.service.ts`, `dine-in.controller.ts` | `DiningTable.entity.ts` | `/api/v1/dine-in/tables` | `/app/dine-in/floor` | `postgres-integration.spec.ts` |
| **R15** | KDS Routing & Kitchen Printing | `kds.service.ts`, `kds.controller.ts` | `PrintJob.entity.ts` | `/api/v1/kds/orders` | `/app/kds`, `/operations/printers` | `postgres-integration.spec.ts` |
| **R16** | Delivery Operations & Couriers | `delivery.service.ts`, `delivery.controller.ts` | `Courier.entity.ts`, `DeliveryOrder.entity.ts` | `/api/v1/delivery/orders` | `/app/delivery/orders`, `/couriers` | `postgres-integration.spec.ts` |
| **R17** | Courier Settlements & Discrepancies | `settlements.service.ts`, `settlements.controller.ts` | `CourierSettlement.entity.ts` | `/api/v1/delivery/settlements` | `/app/delivery/settlements` | `postgres-integration.spec.ts` |
| **R18** | Self-Service Touch Kiosk | `kiosk.service.ts`, `kiosk.controller.ts` | `KioskSession.entity.ts` | `/api/v1/kiosk/sessions` | `/app/kiosk` | `postgres-integration.spec.ts` |
| **R19** | Snappfood Webhook Adapter & Logs | `simulation.service.ts`, `simulation.controller.ts` | `IntegrationLog.entity.ts` | `/api/v1/simulation/snappfood` | `/app/simulation`, `/simulation/logs` | `postgres-integration.spec.ts` |
| **R20** | Offline Queue & Sync Worker | `sync.service.ts`, `sync.controller.ts` | `OfflineQueue.entity.ts` | `/api/v1/simulation/offline-sync` | `/app/simulation/offline-sync` | `postgres-integration.spec.ts` |
| **R21** | Reports Catalog & Audit Logging | `reports.service.ts`, `reports.controller.ts` | `AuditEvent.entity.ts` | `/api/v1/reports/*` | `/app/reports/:reportCode`, `/audit` | `reports.spec.ts` |
| **R22** | Data Reset & Prototype Lifecycle | `import-export.service.ts`, `import-export.controller.ts` | Reset execution harness | `/api/v1/system/reset` | `/app/settings/data-reset` | `postgres-integration.spec.ts` |
| **R23** | Complete V5 Preview Containment | `InventoryItem.entity.ts`, `stock.tsx` | `InventoryItem.entity.ts` | `/api/v1/inventory/stock` | `/app/inventory/stock` | `postgres-integration.spec.ts` |
| **R24** | Real Reports, Alerts & XLSX Exports | `reports.service.ts`, `audit-alerts-alias.controller.ts` | Migration 14 (`operational_alert`) | `/api/v1/reports/*`, `/alerts` | `/app/reports/:reportCode` | `r24-reports.spec.ts` |
| **R25** | Reserved / Pipeline Integrity | Build & typecheck pipeline | TypeORM migration verification | Backend & frontend build | All routes | `tsc --noEmit` |
| **R26** | Route Parity, Localization & RTL | `paths.ts`, `index.tsx`, `en.json`, `fa.json` | Component layouts | All Section 9.1 routes | All 57 Section 9.1 canonical routes | `tsc --noEmit`, `translation-check.ts` |
| **R27** | Final Integration & Certification | `r27-e2e.spec.ts`, `migration-fresh.ts` | Full PostgreSQL migration & seed | Section 16.3 test journeys | Complete prototype UI | `reports.spec.ts`, `r24-reports.spec.ts`, `r27-e2e.spec.ts` |

---

## 2. V5 Preview Isolation Certification

> [!IMPORTANT]
> The **V5 Preview Inventory** module (`/app/inventory/stock`) is strictly isolated:
> - Displayed under the explicit navigation header **"Future — V5 Preview"**.
> - Rendered with a prominent banner explaining its preview status.
> - **Excluded** from all core v1.5 sales reports, shift EOD reconciliations, customer credit calculations, and financial total aggregations.

---
