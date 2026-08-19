# 📋 Gnext Prototype v2 — 20 Daily Operations Test Scenarios (Part 3)

This document specifies 20 advanced operational test scenarios (Scenarios 41 through 60) designed to test specialized enterprise workflows, customer group policies, dedicated price groups and branch overrides, category and group-scoped bulk price updates, customer privacy and consent governance, multi-currency tender conversions, multi-station split KDS routing and expediter aggregation, table reservations, diplomatic tax exemptions, courier attendance and batch dispatching, catalog Excel/CSV import/export with conflict resolution, and end-to-end corporate catering contract order fulfillment in **Gnext Prototype v2**.

---

## 📑 Scenario Index (Part 3: Scenarios 41 – 60)

| # | Scenario Title | Primary Module / Path | Key Focus Areas |
|---|---|---|---|
| **41** | **Customer Group Creation & Policy Discount Binding** | `/app/customers` | Customer group definition, default discount campaign binding, member assignment |
| **42** | **Customer Directory Group Filtering & Multi-Factor Search** | `/app/customers` | Group member filtering, telephone/national ID lookup, profile drawer inspection |
| **43** | **Dedicated Price Group Creation & Airport/Downtown Tier Assignment** | `/app/pricing/price-groups` & `/app/operations/branches` | Price group creation, currency specification, branch assignment mapping |
| **44** | **Price Group Item-Level Price Overrides via Matrix Editor** | `/app/pricing/price-groups` & `/app/pricing/price-book` | Item override prices, price group priority resolution, matrix persistence |
| **45** | **POS Dynamic Group Price Resolution Across Multiple Branches** | `/app/pos` & `/app/pricing/price-book` | Multi-branch pricing behavior, terminal branch context, automatic line item pricing |
| **46** | **Category-Wide Percentage Bulk Price Adjustment with Rounding** | `/app/pricing/bulk-update` | Batch formula pricing, percentage increment (+10%), ceiling/nearest rounding, preview diff |
| **47** | **Fixed-Amount Bulk Price Surcharge on Specific Price Group** | `/app/pricing/bulk-update` & `/app/pricing/price-groups` | Price-group scoped adjustment, flat currency delta (+20,000 IRR), matrix preview |
| **48** | **Customer Marketing Consent & Privacy Preference Management** | `/app/customers` & `/app/settings/general` | Consent status toggles, SMS marketing opt-in/opt-out, audit timestamp log |
| **49** | **Dynamic Customer Tagging & VIP Segmentation** | `/app/customers` & `/app/discounts/campaigns` | Customer tag creation, multi-tag assignment, segment-based filter queries |
| **50** | **Multi-Currency Tender Acceptance (USD / EUR with Auto-Conversion)** | `/app/pos` & `/app/payments` & `/app/cashier/shifts` | Currency exchange rates, foreign currency tender, change in base currency IRR |
| **51** | **Multi-Station KDS Simultaneous Split Routing** | `/app/kds` & `/app/operations/kds-configuration` & `/app/pos` | Station routing rules (Grill vs Oven vs Bar), simultaneous ticket distribution |
| **52** | **Kitchen Expediter Screen Ticket Aggregation & All-Ready Bump Flow** | `/app/kds` & `/app/orders` | Expediter station view, partial prep tracking, full order completion bump |
| **53** | **Dine-In VIP Table Reservation & Walk-In Occupancy Transition** | `/app/dine-in/floor` | Table reservation status, guest party count, session transition to active dining |
| **54** | **Diplomatic Tax & Service Charge Exemption with Supervisor PIN** | `/app/pos` & `/app/settings/approvals` | Tax exemption policy, service charge waiver, supervisor PIN authorization, audit log |
| **55** | **Courier Shift Attendance & Mobile POS Terminal Pairing** | `/app/delivery/couriers` & `/app/operations/terminals` | Courier clock-in/out, portable mPOS device binding, availability pool |
| **56** | **Multi-Stop Delivery Order Route Batching & Dispatch** | `/app/delivery/orders` & `/app/delivery/couriers` | Delivery zone matching, multi-order batching, sequential drop-off tracking |
| **57** | **Delivery Failed Attempt & Customer Unreachable Protocol** | `/app/delivery/orders` & `/app/inventory/stock` & `/app/audit` | Failed delivery reasons, cancellation workflow, return to store, food waste log |
| **58** | **Catalog Product & Price Matrix Excel Bulk Export** | `/app/catalog/import-export` & `/app/reports` | XLSX catalog generation, price matrix export, download validation |
| **59** | **Catalog CSV Bulk Import & Duplicate SKU Error Resolution** | `/app/catalog/import-export` & `/app/catalog/products` | CSV staging, row validation, conflict detection, resolution commit |
| **60** | **Corporate Catering Event Contract Order & Credit Account Settle** | `/app/pos` & `/app/credit/accounts` & `/app/kds` & `/app/delivery/orders` | Large B2B catering order, advance deposit, kitchen advance scheduling, delivery dispatch, credit tab settlement |

---

## 🔍 Detailed Scenario Specifications

### Scenario 41: Customer Group Creation & Policy Discount Binding
- **Description**: Store manager configures a new Corporate VIP Customer Group (`GRP-CORP-VIP`) with an automatic 15% discount rule and assigns corporate clients to it.
- **Steps**:
  1. Navigate to `/app/customers`.
  2. Switch to the "Customer Groups" view / dialog.
  3. Click "New Customer Group" and enter:
     - **Code**: `GRP-CORP-VIP`
     - **Name**: `Corporate VIP Accounts`
     - **Default Discount**: Select `15% Corporate Discount`
  4. Click "Save Customer Group".
  5. In the Customer Directory, edit customer `Acme Tech Solutions` (`CUST-003`) and assign their Group to `Corporate VIP Accounts`.
  6. Confirm the group badge reflects `Corporate VIP Accounts` on their profile.
- **Expected Outcome**: Customer Group created successfully with zero database column errors and associated with customer profile.

---

### Scenario 42: Customer Directory Group Filtering & Multi-Factor Search
- **Description**: Cashier queries customer records using group membership filters, phone numbers, and full-text search without performance degradation.
- **Steps**:
  1. Navigate to `/app/customers`.
  2. In the Search input, enter partial phone number `0912`.
  3. In the Group filter dropdown, select `Corporate VIP Accounts`.
  4. Verify that only `Acme Tech Solutions` (`CUST-003`) is displayed in the data grid.
  5. Clear the group filter and search by name `Sara`.
  6. Click the customer row to open the profile details drawer, inspecting contact info, wallet balance, and credit limit.
- **Expected Outcome**: Filter and search queries execute cleanly with exact matches and no `column CustomerGroup.code does not exist` errors.

---

### Scenario 43: Dedicated Price Group Creation & Airport/Downtown Tier Assignment
- **Description**: Pricing manager creates a dedicated Price Group `PG-AIRPORT` for high-overhead locations and assigns branch `TEH-DOWNTOWN` to this group.
- **Steps**:
  1. Navigate to `/app/pricing/price-groups`.
  2. Click "Create Price Group" and enter:
     - **Code**: `PG-AIRPORT`
     - **Name**: `Airport & Express Premium Tier`
     - **Currency**: `IRR`
  3. Click "Save".
  4. In the Branch Assignment section, select Branch `Downtown Express (TEH-DOWNTOWN)`.
  5. Save the branch mapping.
  6. Verify `TEH-DOWNTOWN` is bound to `PG-AIRPORT`, while `TEH-CENTRAL` remains on the default price tier.
- **Expected Outcome**: Dedicated price group created, saved, and linked to branch with zero schema errors.

---

### Scenario 44: Price Group Item-Level Price Overrides via Matrix Editor
- **Description**: Setting custom premium prices for key menu items under Price Group `PG-AIRPORT` without altering central base prices.
- **Steps**:
  1. Navigate to `/app/pricing/price-groups`.
  2. Select `PG-AIRPORT` and open the "Item Overrides" matrix.
  3. For Product `Classic Beef Burger` (`PRD-BURGER-01`, base price `220,000 IRR`), enter Override Price: `260,000 IRR`.
  4. For Product `Fresh Lemon Mint Soda` (`PRD-DRINK-01`, base price `55,000 IRR`), enter Override Price: `70,000 IRR`.
  5. Click "Save Overrides".
  6. Open `/app/pricing/price-book` and verify that the effective price for `PG-AIRPORT` displays the override values.
- **Expected Outcome**: Item overrides saved and accurately prioritized in the pricing engine.

---

### Scenario 45: POS Dynamic Group Price Resolution Across Multiple Branches
- **Description**: Cashier verifies that POS automatically charges branch-specific prices depending on the terminal's assigned branch.
- **Steps**:
  1. Navigate to `/app/pos` under Branch context `Central Kitchen (TEH-CENTRAL)`.
  2. Add `Classic Beef Burger` to cart; verify line price is `220,000 IRR`.
  3. Clear cart and switch active terminal branch context to `Downtown Express (TEH-DOWNTOWN)`.
  4. Add `Classic Beef Burger` to cart; verify line price automatically resolves to `260,000 IRR`.
  5. Add `Fresh Lemon Mint Soda`; verify line price resolves to `70,000 IRR`.
  6. Click "Pay / Checkout" and settle the order via Cash.
- **Expected Outcome**: Pricing engine resolves prices dynamically per branch price group rules at POS checkout.

---

### Scenario 46: Category-Wide Percentage Bulk Price Adjustment with Rounding
- **Description**: Pricing manager executes a 10% price increase on all items in category `CAT-PIZZAS` with mathematical rounding to the nearest 5,000 IRR.
- **Steps**:
  1. Navigate to `/app/pricing/bulk-update`.
  2. Set Target Category: `Pizzas (CAT-PIZZAS)`.
  3. Set Adjustment Type: `Percentage (+10%)`.
  4. Set Rounding Rule: `Nearest 5,000 IRR`.
  5. Click "Generate Preview".
  6. Verify preview calculation for `Truffle Mushroom Pizza` (Base `380,000 IRR` + 10% = `418,000 IRR` ➔ Rounded to `420,000 IRR`).
  7. Click "Commit Bulk Price Update".
  8. Verify updated base price reflects in `/app/catalog/products`.
- **Expected Outcome**: Bulk price changes calculated, rounded, verified via preview diff, and committed transactionally.

---

### Scenario 47: Fixed-Amount Bulk Price Surcharge on Specific Price Group
- **Description**: Adding a flat 20,000 IRR operational surcharge across all items belonging to Price Group `PG-AIRPORT`.
- **Steps**:
  1. Navigate to `/app/pricing/bulk-update`.
  2. Set Target Scope: `Price Group: PG-AIRPORT`.
  3. Set Adjustment Type: `Fixed Amount (+20,000 IRR)`.
  4. Click "Generate Preview".
  5. Review preview diff table showing existing override + `20,000 IRR`.
  6. Click "Commit Bulk Price Update".
  7. Navigate to `/app/pricing/price-groups` and confirm updated overrides for `PG-AIRPORT`.
- **Expected Outcome**: Bulk update applies exclusively to the designated Price Group without affecting global catalog prices.

---

### Scenario 48: Customer Marketing Consent & Privacy Preference Management
- **Description**: Customer requests privacy preference changes to opt out of promotional SMS while maintaining transactional order status notifications.
- **Steps**:
  1. Navigate to `/app/customers`.
  2. Select Customer `Sara Mohammadi` (`CUST-002`) and open details.
  3. Navigate to the "Privacy & Consents" tab.
  4. Toggle `Marketing & Promotional SMS` to `OPTED_OUT`.
  5. Ensure `Transactional Order Notifications` remains `OPTED_IN`.
  6. Click "Save Privacy Preferences".
  7. Open `/app/audit` and verify consent update event is logged with actor stamp and timestamp.
- **Expected Outcome**: Customer consent preferences updated, preventing marketing campaign dispatch while preserving operational notifications.

---

### Scenario 49: Dynamic Customer Tagging & VIP Segmentation
- **Description**: Marketing specialist creates and assigns multi-dimensional customer tags (`CORP_LUNCH`, `HIGH_VALUE`) to enable targeted promotional campaigns.
- **Steps**:
  1. Navigate to `/app/customers`.
  2. Open Customer `Acme Tech Solutions` (`CUST-003`).
  3. In the Tags input field, add tags: `CORP_LUNCH` and `HIGH_VALUE`.
  4. Save customer record.
  5. In the Customer Directory table, click the Tag filter and select `HIGH_VALUE`.
  6. Confirm that the filtered grid lists `Acme Tech Solutions`.
- **Expected Outcome**: Tags persist correctly, enabling targeted CRM segmentation and reporting.

---

### Scenario 50: Multi-Currency Tender Acceptance (USD / EUR with Auto-Conversion)
- **Description**: Foreign guest settles a 500,000 IRR invoice with $10.00 USD cash at the configured exchange rate, receiving change in Iranian Rial.
- **Steps**:
  1. In `/app/pos`, ring up items totaling `500,000 IRR`.
  2. Click "Pay / Checkout" and select `Foreign Currency Cash`.
  3. Select Currency: `USD` (Configured Exchange Rate: `1 USD = 55,000 IRR`).
  4. System prompts Required: `$9.09 USD`. Cashier inputs `$10.00 USD` received.
  5. System calculates Tendered Value: `550,000 IRR` and Change Due: `50,000 IRR`.
  6. Confirm and settle order.
  7. Check `/app/cashier/shifts` cash breakdown: verify `$10.00 USD` foreign cash intake and `-50,000 IRR` domestic change recorded.
- **Expected Outcome**: Accurate multi-currency conversion, tender settlement, and cashier drawer multi-currency ledger tracking.

---

### Scenario 51: Multi-Station KDS Simultaneous Split Routing
- **Description**: An order containing items for the Grill, Pizza Oven, and Beverage Bar is automatically split and routed to three independent kitchen screens simultaneously.
- **Steps**:
  1. In `/app/pos`, create an order with:
     - 1x `Classic Beef Burger` (Category: `CAT-BURGERS` ➔ Route to `KDS-GRILL`)
     - 1x `Truffle Mushroom Pizza` (Category: `CAT-PIZZAS` ➔ Route to `KDS-OVEN`)
     - 1x `Fresh Lemon Mint Soda` (Category: `CAT-DRINKS` ➔ Route to `KDS-BAR`)
  2. Click "Send to Kitchen".
  3. Open `/app/kds?station=KDS-GRILL`: verify only `Classic Beef Burger` appears on this ticket.
  4. Open `/app/kds?station=KDS-OVEN`: verify only `Truffle Mushroom Pizza` appears on this ticket.
  5. Open `/app/kds?station=KDS-BAR`: verify only `Fresh Lemon Mint Soda` appears on this ticket.
- **Expected Outcome**: Single POS order cleanly partitioned across specialized kitchen stations based on category routing rules.

---

### Scenario 52: Kitchen Expediter Screen Ticket Aggregation & All-Ready Bump Flow
- **Description**: Head chef monitors overall prep status on the Expediter screen, verifying that the order remains in preparation until all stations bump their items.
- **Steps**:
  1. Open `/app/kds` with station set to `EXPEDITER`.
  2. Locate the multi-item order ticket from Scenario 51.
  3. Grill cook bumps `Classic Beef Burger` ➔ Expediter screen marks Grill line as `DONE`.
  4. Oven cook bumps `Truffle Mushroom Pizza` ➔ Expediter screen marks Oven line as `DONE`.
  5. Expediter screen indicates overall status: `PARTIALLY_READY` (Bar still preparing).
  6. Barista bumps `Fresh Lemon Mint Soda` ➔ Expediter screen updates to `ALL_ITEMS_READY`.
  7. Expediter clicks "Bump Complete Order".
- **Expected Outcome**: Expediter screen coordinates multi-station fulfillment and updates global order status to `READY` in `/app/orders`.

---

### Scenario 53: Dine-In VIP Table Reservation & Walk-In Occupancy Transition
- **Description**: Host marks Table 10 as Reserved for a VIP dinner party, then transitions the table to Occupied when the guests arrive.
- **Steps**:
  1. Navigate to `/app/dine-in/floor`.
  2. Click `Table 10` (currently `Vacant`) and select "Reserve Table".
  3. Enter Guest Name: `Mr. Farhadi`, Party Size: `6`, Reservation Time: `19:30`.
  4. Confirm: Table 10 renders in `RESERVED` status with badge.
  5. When guests arrive, click `Table 10` and select "Seat Guests / Open Table".
  6. Table status transitions to `OCCUPIED` and dining duration timer begins counting.
- **Expected Outcome**: Floor map manages table reservation lifecycle states accurately with clear visual badges.

---

### Scenario 54: Diplomatic Tax & Service Charge Exemption with Supervisor PIN
- **Description**: Cashier processes a diplomatic tax and service charge exemption on a dine-in check requiring Supervisor PIN authorization.
- **Steps**:
  1. In `/app/pos`, create a dine-in order totaling `1,000,000 IRR` + `90,000 IRR VAT` + `100,000 IRR Service Charge` = `1,190,000 IRR`.
  2. Click "Tax / Surcharge Exemptions".
  3. Select "Diplomatic Official Exemption", Reason: `Official embassy delegation banquet`.
  4. System prompts Supervisor PIN: Enter `9999` (or `2468`).
  5. System waives VAT and Service Charge, recalculating total due to exactly `1,000,000 IRR`.
  6. Settle payment via Card POS and print tax-exempt invoice.
- **Expected Outcome**: Tax and service charge waived with mandatory supervisor authorization and audit trail logging.

---

### Scenario 55: Courier Shift Attendance & Mobile POS Terminal Pairing
- **Description**: Courier clocks in for duty on the delivery board and pairs their shift with a portable mobile POS card reader.
- **Steps**:
  1. Navigate to `/app/delivery/couriers`.
  2. Select Courier `Babak Rad`.
  3. Click "Clock In / Start Shift", select Vehicle: `Motorcycle (Plate 45-123-B)`.
  4. Pair Courier with Portable Payment Device: `TERM-MOBI-01` (Card Reader `SN-88214`).
  5. Courier status changes to `ON_DUTY / AVAILABLE`.
  6. Navigate to `/app/delivery/orders` and confirm `Babak Rad` is listed in the courier assignment dropdown.
- **Expected Outcome**: Courier attendance and hardware terminal pairing successfully registered.

---

### Scenario 56: Multi-Stop Delivery Order Route Batching & Dispatch
- **Description**: Dispatcher groups two proximate delivery orders in Zone 1 into a single batch assigned to one courier.
- **Steps**:
  1. Navigate to `/app/delivery/orders`.
  2. Filter by `Zone: Zone 1 - Central`.
  3. Select Order `ORD-DEL-101` and Order `ORD-DEL-102`.
  4. Click "Batch & Dispatch", select Courier `Babak Rad`.
  5. Both orders transition to `DISPATCHED / EN_ROUTE`.
  6. Record Stop 1 completion (`ORD-DEL-101`) with COD collected: `150,000 IRR`.
  7. Record Stop 2 completion (`ORD-DEL-102`) with COD collected: `230,000 IRR`.
- **Expected Outcome**: Multi-stop delivery route dispatched, tracked sequentially, and COD cash balances accrued to courier shift.

---

### Scenario 57: Delivery Failed Attempt & Customer Unreachable Protocol
- **Description**: Courier arrives at delivery location, but customer does not answer phone; courier marks delivery failed and returns meal to branch.
- **Steps**:
  1. In `/app/delivery/orders`, select active delivery order `ORD-DEL-103`.
  2. Click "Report Delivery Exception", select Reason: `CUSTOMER_UNREACHABLE`.
  3. Add note: `Attempted 3 phone calls over 15 minutes at gate. No response`.
  4. Click "Return to Store".
  5. Order status transitions to `FAILED_DELIVERY_RETURNED`.
  6. Inventory disposition: Perishable cooked food logged to `FOOD_WASTE_LOG`.
- **Expected Outcome**: Delivery failure recorded, courier relieved of cash collection liability, and return event audited.

---

### Scenario 58: Catalog Product & Price Matrix Excel Bulk Export
- **Description**: General manager generates an Excel (.xlsx) export of the full multi-branch product catalog, price books, and modifier options.
- **Steps**:
  1. Navigate to `/app/catalog/import-export`.
  2. Select "Export Catalog & Price Matrix".
  3. Choose Format: `Excel (.xlsx)`, Options: `Include Price Groups & Modifiers`.
  4. Click "Generate Export File".
  5. Background job generates `GNEXT_CATALOG_EXPORT_YYYYMMDD.xlsx`.
  6. Click "Download File" and verify file structure includes SKU, Product Name, Category, Base Price, and Price Group Overrides.
- **Expected Outcome**: Catalog data exported to valid Excel format with complete pricing and modifier hierarchy.

---

### Scenario 59: Catalog CSV Bulk Import & Duplicate SKU Error Resolution
- **Description**: Admin uploads a CSV batch of new products, reviews staging validation errors for a duplicate SKU, fixes the conflict in the UI, and commits the import.
- **Steps**:
  1. Navigate to `/app/catalog/import-export`.
  2. Click "Upload Product CSV", select file `new_beverages.csv`.
  3. System parses 5 rows: 4 valid, 1 error (`Duplicate SKU: PRD-DRINK-01`).
  4. In the Staging Review grid, edit the conflicted row's SKU to `PRD-DRINK-05` (`Matcha Green Tea Latte`).
  5. Status recalculates to `5/5 Rows Valid`.
  6. Click "Commit Import to Catalog".
  7. Verify all 5 new products appear in `/app/catalog/products`.
- **Expected Outcome**: CSV import staging detects duplicate conflict, allows inline correction, and commits cleanly to database.

---

### Scenario 60: Corporate Catering Event Contract Order & Credit Account Settle
- **Description**: Corporate customer books a 50-person catering order with advance cash deposit, scheduled kitchen ticket routing, courier dispatch, and remaining balance settled on corporate credit tab.
- **Steps**:
  1. In `/app/pos`, create a Corporate Catering Order for Customer `Acme Tech Solutions` (`CUST-003`).
  2. Add 50x `Classic Beef Burger` and 50x `Fresh Lemon Mint Soda` (Total `5,000,000 IRR` at corporate contract rate).
  3. Record Advance Deposit Tender: `1,000,000 IRR` Cash.
  4. Schedule Delivery for `Tomorrow 12:30 PM` and route advance prep tickets to KDS.
  5. Settle remaining `4,000,000 IRR` balance via `Customer Credit Account (On-Tab)`.
  6. System validates corporate credit limit (`5,000,000 IRR`), updates tab balance to `4,000,000 IRR`, and completes order.
  7. Navigate to `/app/credit/accounts` and `/app/audit` to verify updated credit ledger and full audit trail.
- **Expected Outcome**: Full end-to-end multi-module operational workflow executes seamlessly across POS, KDS, Delivery, Customer Credit, and Financial Audit.
