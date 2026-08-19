# 🏗️ Gnext Prototype v2 — Prerequisite Baseline Data Setup (Part 2)

This document details the configuration records and baseline master data required to execute **Scenarios 21 through 40** (advanced daily operations, supervisor PIN thresholds, hardware simulations, price books, and inventory monitoring).

All data entries must be performed directly through the **Gnext Web Application UI** at `http://localhost:8081` (no direct database seeding).

---

## 🔑 1. Supervisor PIN & Approval Rules Setup
*Path: `/app/settings/approvals`*

| Rule Code | Rule Name | Condition / Threshold | Required Role | Supervisor PIN |
|---|---|---|---|---|
| `RULE-DISC-15` | Discount Exceeds 15% | Discount Percentage > 15.00% | Store Manager | `9999` (or `0000`) |
| `RULE-VOID-ITEM` | Line Item Void Authorization | Any line-item cancellation | Supervisor | `9999` |
| `RULE-REFUND-MAX` | High-Value Refund Approval | Refund Amount > 500,000 IRR | Store Manager | `9999` |
| `RULE-DAY-REOPEN` | Business Day Reopen Authorization | Reopen closed business day | General Manager | `9999` |

---

## 🖨️ 2. Hardware Printers & Print Routing Setup
*Path: `/app/operations/printers`*

| Printer Code | Printer Name | Hardware Type | IP / Port | Assigned Purpose | Target Station |
|---|---|---|---|---|---|
| `PRN-KITCHEN` | Kitchen Line Expediter | Thermal 80mm | `192.168.1.201:9100` | Kitchen Tickets | Grill & Pizza Lines |
| `PRN-RECEIPT` | Main Cashier Terminal Printer | Thermal 80mm | `192.168.1.202:9100` | Customer Tax Invoices | POS Register |
| `PRN-BAR` | Drinks & Bar Printer | Thermal 58mm | `192.168.1.203:9100` | Drink Tickets | Bar Station |

---

## 🏷️ 3. Price Books & Promotional Price Groups Setup
*Path: `/app/pricing/price-book`*

### Price Group: Happy Hour Specials (`GRP-HAPPY-HOUR`)
- **Active Hours**: 16:00 – 19:00 Daily
- **Scope**: Appetizers & Sides, Beverages
- **Override Rules**:
  - `PRD-SIDE-01` (Crispy French Fries): Standard `75,000 IRR` ➔ Happy Hour Price: `60,000 IRR` (20% off)
  - `PRD-SIDE-02` (Buffalo Chicken Wings): Standard `160,000 IRR` ➔ Happy Hour Price: `128,000 IRR` (20% off)
  - `PRD-DRINK-01` (Lemon Mint Soda): Standard `55,000 IRR` ➔ Happy Hour Price: `45,000 IRR` (~18% off)
  - `PRD-DRINK-02` (Iced Spanish Latte): Standard `85,000 IRR` ➔ Happy Hour Price: `70,000 IRR` (~18% off)

---

## 👥 4. Customer Duplicate Record (For Merge Testing)
*Path: `/app/customers`*

| Field | Primary Record (`CUST-001`) | Duplicate Record (`CUST-004`) |
|---|---|---|
| **First Name** | `Ali` | `A.` |
| **Last Name** | `Rezaei` | `Rezaei` |
| **Mobile Number** | `09121111111` | `09121111111` |
| **Email** | `ali.rezaei@example.com` | `ali.r.duplicate@example.com` |
| **Loyalty Tier** | Silver (5% cashback) | Bronze (0% cashback) |
| **Initial Wallet Balance** | `50,000 IRR` | `10,000 IRR` |

---

## 🎟️ 5. Single-Use & Constraint Coupons Setup
*Path: `/app/discounts/coupons`*

| Coupon Code | Discount Type | Discount Value | Min Order Spend | Max Usage Limit | Status |
|---|---|---|---|---|---|
| `SINGLE100` | Fixed Amount | `100,000 IRR` | `200,000 IRR` | **1 use total** | Active |
| `FLASH50` | Percentage | `50%` | `150,000 IRR` | **1 use total** | Active |
| `VIPCOURTESY` | Percentage | `30%` | `0 IRR` | 100 uses (Supervisor PIN req.) | Active |

---

## 📦 6. Inventory Items & Safety Thresholds Setup
*Path: `/app/inventory/stock`*

| Item Code | Item Name | Unit of Measure | Current Stock | Safety Threshold | Target Warning Level |
|---|---|---|---|---|---|
| `INV-BEEF` | 100% Beef Burger Patties | Pack (10 pcs) | 15 Packs | 10 Packs | Trigger alert at <= 10 |
| `INV-BUNS` | Brioche Burger Buns | Pack (12 pcs) | 20 Packs | 10 Packs | Trigger alert at <= 10 |
| `INV-FRIES` | Frozen French Fries | Kg | 30 Kg | 15 Kg | Trigger alert at <= 15 |
| `INV-CHEESE` | Aged Cheddar Cheese Slices | Pack (50 slices) | 12 Packs | 5 Packs | Trigger alert at <= 5 |

---

## 🍳 7. KDS Kitchen Stations & Category Routing Rules
*Path: `/app/operations/kds-configuration`*

| Station Code | Station Name | Screen ID | Filtered Categories | Ticket Alert SLA |
|---|---|---|---|---|
| `KDS-GRILL` | Main Kitchen (Grill & Fryer) | `SCR-01` | `CAT-BURGERS`, `CAT-SIDES` | 10 Minutes |
| `KDS-OVEN` | Pizza & Oven Station | `SCR-02` | `CAT-PIZZAS` | 15 Minutes |
| `KDS-BAR` | Beverage & Dessert Bar | `SCR-03` | `CAT-DRINKS`, `CAT-DESSERTS` | 5 Minutes |
