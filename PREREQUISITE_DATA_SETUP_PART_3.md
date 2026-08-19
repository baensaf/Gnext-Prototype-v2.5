# 🏗️ Gnext Prototype v2 — Prerequisite Baseline Data Setup (Part 3)

This document details the configuration records, master data, customer groups, dedicated price groups, KDS routing definitions, and courier terminal pairings required to execute **Scenarios 41 through 60** in **Gnext Prototype v2**.

All master data configuration entries can be reviewed and configured through the **Gnext Web Application UI** at `http://localhost:8081`.

---

## 👥 1. Customer Groups & Corporate Policy Setup
*Path: `/app/customers`*

| Group Code | Group Name | Description | Bound Discount Campaign | Default Price Group |
|---|---|---|---|---|
| `GRP-CORP-VIP` | Corporate VIP Accounts | Contracted B2B corporate client accounts | 15% Corporate Discount | Base / Airport Tier |
| `GRP-STAFF` | Internal Staff & Employees | Staff dining courtesy group | 25% Staff Meal Discount | Standard Base |
| `GRP-DIPLOMAT` | Diplomatic & Embassy | Official tax-exempt diplomatic accounts | 0% Special Rate (Tax Exempt) | Standard Base |

---

## 🏷️ 2. Dedicated Price Groups & Branch Mappings Setup
*Path: `/app/pricing/price-groups`*

### Price Group: Airport & Express Premium Tier (`PG-AIRPORT`)
- **Code**: `PG-AIRPORT`
- **Name**: `Airport & Express Premium Tier`
- **Currency**: `IRR`
- **Assigned Branch**: `Downtown Express (TEH-DOWNTOWN)`
- **Item-Level Price Overrides**:
  - `PRD-BURGER-01` (Classic Beef Burger): Standard `220,000 IRR` ➔ Override: `260,000 IRR`
  - `PRD-DRINK-01` (Fresh Lemon Mint Soda): Standard `55,000 IRR` ➔ Override: `70,000 IRR`
  - `PRD-PIZZA-01` (Truffle Mushroom Pizza): Standard `380,000 IRR` ➔ Override: `420,000 IRR`

---

## 💱 3. Foreign Currencies & Exchange Rates Setup
*Path: `/app/settings/general` & `/app/payments`*

| Currency Code | Currency Name | Symbol | Exchange Rate to Base (IRR) | Tender Enabled |
|---|---|---|---|---|
| `IRR` | Iranian Rial (Base) | ریال | `1.00` | Yes (Domestic) |
| `USD` | US Dollar | $ | `55,000.00 IRR` | Yes (Foreign Cash / Card) |
| `EUR` | Euro | € | `60,000.00 IRR` | Yes (Foreign Cash / Card) |

---

## 🍳 4. KDS Multi-Station Category Routing Setup
*Path: `/app/operations/kds-configuration`*

| Station Code | Station Name | Screen ID | Routed Categories | Target SLA |
|---|---|---|---|---|
| `KDS-GRILL` | Main Kitchen (Grill & Fryer) | `SCR-01` | `CAT-BURGERS`, `CAT-SIDES` | 10 Minutes |
| `KDS-OVEN` | Pizza Oven Station | `SCR-02` | `CAT-PIZZAS` | 15 Minutes |
| `KDS-BAR` | Beverage & Dessert Bar | `SCR-03` | `CAT-DRINKS`, `CAT-DESSERTS` | 5 Minutes |
| `EXPEDITER` | Head Expediter & Pass Station | `SCR-EXP` | **ALL CATEGORIES (Consolidated View)** | Overall SLA |

---

## 🛵 5. Delivery Couriers & Mobile Terminal Inventory Setup
*Path: `/app/delivery/couriers` & `/app/operations/terminals`*

| Courier Code | Courier Name | Assigned Vehicle | Paired Mobile Terminal | Status |
|---|---|---|---|---|
| `COUR-01` | Hamid Kazemi | Motorbike (78-456-A) | `TERM-MOBI-01` | Available |
| `COUR-02` | Babak Rad | Motorbike (45-123-B) | `TERM-MOBI-02` | Available |
| `COUR-03` | Reza Moradi | Van (Catering Batch) | `TERM-MOBI-03` | On-Duty (Catering) |

---

## 📋 6. Test CSV Files for Catalog Import Staging
*Path: `/app/catalog/import-export`*

### File: `new_beverages.csv`
```csv
sku,name,category_code,base_price,is_active
PRD-DRINK-03,Sparkling Mineral Water,CAT-DRINKS,35000,true
PRD-DRINK-04,Cold Brew Nitro Coffee,CAT-DRINKS,95000,true
PRD-DRINK-01,Fresh Lemon Mint Soda,CAT-DRINKS,55000,true  <-- Duplicate conflict for testing
PRD-DRINK-06,Fresh Orange Pomegranate Juice,CAT-DRINKS,85000,true
PRD-DRINK-07,Iced Hibiscus Berry Tea,CAT-DRINKS,65000,true
```
