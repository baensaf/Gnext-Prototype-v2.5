# 🏗️ Gnext Prototype v2 — Prerequisite Baseline Data Setup

Before executing the 20 daily operational test scenarios, the following baseline configuration data must be entered into the system. All entries should be created directly via the **Gnext Web Application UI** (no direct database seeding).

---

## 🏢 1. Branch, Organization & Terminals Setup
*Path: `/app/operations/branches` & `/app/operations/terminals`*

| Field / Entity | Value | Notes |
|---|---|---|
| **Branch Code** | `BR-01` | Primary Store Code |
| **Branch Name** | `Central Flagship Store` | Main Location |
| **Address** | `123 Valiasr Square, Tehran, Iran` | Physical store location |
| **Currency** | `IRR` (or `USD`) | Base monetary unit |
| **Tax Rate** | `10%` (0.1000) | Standard VAT rate |
| **Terminal 1** | Code: `POS-01`, Name: `Cashier Main Terminal`, Type: `POS` | Assigned to Cashier counter |
| **Terminal 2** | Code: `KIOSK-01`, Name: `Lobby Self-Service Kiosk`, Type: `KIOSK` | Self-ordering station |

---

## 🍽️ 2. Dine-In Floor & Tables Setup
*Path: `/app/dine-in/floor`*

| Table Code | Name / Label | Capacity | Section | Status |
|---|---|---|---|---|
| `T-01` | Table 01 | 2 Guests | Main Dining Room | Vacant |
| `T-02` | Table 02 | 2 Guests | Main Dining Room | Vacant |
| `T-03` | Table 03 | 4 Guests | Main Dining Room | Vacant |
| `T-04` | Table 04 | 4 Guests | Main Dining Room | Vacant |
| `T-05` | Table 05 | 6 Guests | Main Dining Room | Vacant |
| `T-06` | Table 06 | 4 Guests | Outdoor Patio | Vacant |
| `VIP-01` | VIP Suite 1 | 8 Guests | Private Dining | Vacant |

---

## 🍔 3. Menu Categories Setup
*Path: `/app/catalog/categories`*

| Category Code | Category Name | Sort Order | Status |
|---|---|---|---|
| `CAT-BURGERS` | Burgers & Sandwiches | 1 | Active |
| `CAT-PIZZAS` | Pizzas & Mains | 2 | Active |
| `CAT-SIDES` | Appetizers & Sides | 3 | Active |
| `CAT-DRINKS` | Beverages & Refreshments | 4 | Active |
| `CAT-DESSERTS` | Desserts & Treats | 5 | Active |

---

## 🧀 4. Modifier & Option Groups Setup
*Path: `/app/catalog/modifiers`*

### Group A: Burger Doneness (`GRP-DONENESS`)
- Type: `Single Choice (Radio)`, Required: `Yes`, Min: 1, Max: 1
- **Modifiers**:
  1. `Rare` — Surcharge: `0 IRR`
  2. `Medium` — Surcharge: `0 IRR`
  3. `Well-Done` — Surcharge: `0 IRR`

### Group B: Cheese Options (`GRP-CHEESE`)
- Type: `Single Choice`, Required: `No`, Min: 0, Max: 1
- **Modifiers**:
  1. `Cheddar Cheese` — Surcharge: `15,000 IRR`
  2. `Swiss Cheese` — Surcharge: `18,000 IRR`
  3. `Blue Cheese` — Surcharge: `22,000 IRR`

### Group C: Burger Extras & Add-ons (`GRP-EXTRAS`)
- Type: `Multiple Choice (Checkboxes)`, Required: `No`, Min: 0, Max: 5
- **Modifiers**:
  1. `Extra Beef Patty` — Surcharge: `45,000 IRR`
  2. `Crispy Bacon` — Surcharge: `20,000 IRR`
  3. `Caramelized Onions` — Surcharge: `10,000 IRR`
  4. `Pickled Jalapenos` — Surcharge: `8,000 IRR`
  5. `No Pickles` — Surcharge: `0 IRR`

### Group D: Milk Preference (`GRP-MILK`)
- Type: `Single Choice`, Required: `Yes`, Min: 1, Max: 1
- **Modifiers**:
  1. `Whole Milk` — Surcharge: `0 IRR`
  2. `Oat Milk` — Surcharge: `12,000 IRR`
  3. `Almond Milk` — Surcharge: `15,000 IRR`

---

## 🍕 5. Products & Pricing Setup
*Path: `/app/catalog/products`*

| Product Code | Product Name | Category Code | Base Price | Tax Rate | Linked Option Groups |
|---|---|---|---|---|---|
| `PRD-BURGER-01` | Classic Beef Burger | `CAT-BURGERS` | `180,000 IRR` | 10% | Doneness, Cheese, Extras |
| `PRD-BURGER-02` | Double Smash Burger | `CAT-BURGERS` | `260,000 IRR` | 10% | Cheese, Extras |
| `PRD-PIZZA-01` | Truffle Mushroom Pizza | `CAT-PIZZAS` | `320,000 IRR` | 10% | None |
| `PRD-SIDE-01` | Crispy French Fries | `CAT-SIDES` | `75,000 IRR` | 10% | None |
| `PRD-SIDE-02` | Buffalo Chicken Wings | `CAT-SIDES` | `160,000 IRR` | 10% | None |
| `PRD-DRINK-01` | Fresh Lemon Mint Soda | `CAT-DRINKS` | `55,000 IRR` | 10% | None |
| `PRD-DRINK-02` | Iced Spanish Latte | `CAT-DRINKS` | `85,000 IRR` | 10% | Milk Preference |
| `PRD-DESSERT-01`| Chocolate Lava Cake | `CAT-DESSERTS` | `95,000 IRR` | 10% | None |

---

## 👥 6. Customers & Loyalty Club Tiers Setup
*Path: `/app/customers` & `/app/customer-club/discounts`*

### A. Loyalty Club Tiers
- **Bronze Tier**: 0% cashback accrual, entry level.
- **Silver Tier**: 5% cashback accrual on all completed orders.
- **Gold Tier**: 10% cashback accrual + priority service.

### B. Customer Directory
1. **Customer 1 (Active Club Member)**
   - Name: `Ali Rezaei`
   - Phone: `09121111111`
   - Email: `ali.rezaei@example.com`
   - Tier: `Silver`
   - Initial Wallet Balance: `50,000 IRR`

2. **Customer 2 (Delivery Regular)**
   - Name: `Sara Mohammadi`
   - Phone: `09122222222`
   - Address: `No 42, Valiasr Ave, Floor 3, Tehran`
   - Tier: `Bronze`
   - Initial Wallet Balance: `0 IRR`

3. **Customer 3 (Corporate B2B Client)**
   - Name: `Acme Tech Solutions`
   - Phone: `09123333333`
   - Tax Number: `TAX-99887766`
   - Credit Account Status: `Active`
   - Credit Limit: `5,000,000 IRR`
   - Current Balance: `0 IRR`

---

## 🛵 7. Delivery Couriers Setup
*Path: `/app/delivery/couriers`*

| Courier Code | Full Name | Phone Number | Vehicle Type | Vehicle Plate | Status |
|---|---|---|---|---|---|
| `CR-01` | Reza Moradi | `09351112233` | Motorbike | `45A-123-IR` | Available / On-Shift |
| `CR-02` | Hamid Kazemi | `09362223344` | Motorbike | `18B-456-IR` | Available / On-Shift |

---

## 🏷️ 8. Discounts, Coupons & Campaigns Setup
*Path: `/app/discounts/coupons` & `/app/discounts/campaigns`*

| Coupon Code | Discount Type | Value | Min Spend | Max Usage | Active Period |
|---|---|---|---|---|---|
| `WELCOME10` | Percentage | `10%` | `50,000 IRR` | 100 uses | Active |
| `VIP20` | Percentage | `20%` | `100,000 IRR` | 50 uses | Active |
| `SUMMER50K` | Fixed Amount | `50,000 IRR` | `250,000 IRR` | 200 uses | Active |

---

## 🍳 9. Kitchen Display Stations & Printers Setup
*Path: `/app/operations/kds-configuration` & `/app/operations/printers`*

| Station Code | Station Name | Screen Type | Routed Categories | Target SLA |
|---|---|---|---|---|
| `KDS-GRILL` | Grill & Burger Station | Main Line KDS | `CAT-BURGERS`, `CAT-SIDES` | 10 Minutes |
| `KDS-OVEN` | Pizza & Oven Station | Main Line KDS | `CAT-PIZZAS` | 15 Minutes |
| `KDS-BAR` | Drinks & Dessert Station | Drinks KDS | `CAT-DRINKS`, `CAT-DESSERTS` | 5 Minutes |

| Printer Code | Printer Name | Type | IP / Port | Assigned Purpose |
|---|---|---|---|---|
| `PRN-KITCHEN` | Kitchen Expediter Printer | Thermal 80mm | `192.168.1.201:9100` | Kitchen Tickets |
| `PRN-RECEIPT` | Cashier Receipt Printer | Thermal 80mm | `192.168.1.202:9100` | Customer Tax Invoices |

---

## 🔑 10. Staff Accounts, Roles & Supervisor PINs
*Path: `/app/settings/approvals` & `/app/settings/general`*

| Staff Name | Role | Access Level | POS PIN | Supervisor Override PIN |
|---|---|---|---|---|
| `Morteza Kiani` | Cashier | POS Cashier | `1234` | N/A |
| `Neda Hosseini` | Cashier / Server | POS Cashier | `5678` | N/A |
| `Farhad Rahimi` | Store Manager | Supervisor / Admin | `9999` | `9999` (or `0000`) |

---

## 📌 11. Operational Reason Codes
*Path: `/app/settings/reasons`*

- **Item / Order Void Reasons**:
  - `Customer Changed Mind`
  - `Cashier Entry Error`
  - `Out of Stock / 86'd`
- **Refund Reasons**:
  - `Wrong Item Delivered`
  - `Quality Issue / Customer Complaint`
  - `Duplicate Payment`
- **Cash Movement Reasons**:
  - `Safe Drop / Skim`
  - `Emergency Petty Cash - Ice / Groceries`
  - `Petty Cash - Cleaning Supplies`
  - `Cash Float Top-up`
