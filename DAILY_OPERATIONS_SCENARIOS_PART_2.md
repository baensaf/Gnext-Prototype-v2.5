# 📋 Gnext Prototype v2 — 20 Daily Operations Test Scenarios (Part 2)

This document specifies 20 advanced, real-world operational scenarios designed to test deep edge cases, financial reconciliations, offline operations, supervisor authorizations, multi-station kitchen routing, delivery adjustments, and audit integrity in **Gnext Prototype v2**.

---

## 📑 Scenario Index (Part 2: Scenarios 21 – 40)

| # | Scenario Title | Primary Module / Path | Key Focus Areas |
|---|---|---|---|
| **21** | **Park / Hold Cart Order & Recall for Later Checkout** | `/app/pos` | Draft order parking, held order drawer, cart resumption |
| **22** | **Split Bill by Line Items Between Dine-In Guests** | `/app/dine-in/floor` & `/app/pos` | Table bill splitting, multi-guest checkout, split tickets |
| **23** | **Offline POS Sync Simulation & Network Recovery** | `/app/simulation/offline-sync` & `/app/pos` | Offline queueing, network toggle, batch replay |
| **24** | **Tara BNPL Installment Payment Flow Simulation** | `/app/simulation/payments-printers` & `/app/payments` | Eligibility check, credit reserve, OTP settle, reverse |
| **25** | **Printer Hardware Fault Injection & Print Job Retry** | `/app/operations/print-queue` & `/app/simulation/payments-printers` | Out-of-paper simulation, failed jobs, retry spooler |
| **26** | **Discount PIN Authorization Exceeding Cashier Threshold** | `/app/pos` & `/app/settings/approvals` | 30% discount override, supervisor PIN (9999), audit record |
| **27** | **Customer Duplicate Profile Detection & Merge** | `/app/customers` | Duplicate phone detection, profile merge, wallet unification |
| **28** | **KDS Multi-Station Routing & Tab Filter Views** | `/app/kds` | Station filters (Grill vs Oven vs Drinks), item checklist |
| **29** | **Dynamic Price Book Activation (Happy Hour Specials)** | `/app/pricing/price-book` & `/app/pos` | Time-based price rules, dynamic POS price resolution |
| **30** | **Delivery Breakdown Rejection & Courier Re-dispatch** | `/app/delivery/orders` | Courier breakdown, assignment cancellation, re-dispatch |
| **31** | **Inventory Safety Stock Depletion & Alert Banner** | `/app/inventory/stock` & `/app/operations/monitoring` | Stock movements, safety stock threshold, system alert |
| **32** | **Itemized Partial Refund with Customer Wallet Credit** | `/app/refunds` & `/app/customer-club/wallet` | Line-item return, quality issue reason, wallet credit |
| **33** | **Customer Tier Upgrade & Cashback Ledger Verification** | `/app/customer-club/discounts` & `/app/customers` | Silver to Gold promotion, 10% cashback ledger entry |
| **34** | **Business Day Reopen & Emergency Audit Adjustment** | `/app/cashier/business-days` & `/app/audit` | Reopen closed day, record late adjustment, close & audit |
| **35** | **Self-Service Kiosk Bilingual (Farsi/English) Ordering** | `/app/kiosk` | RTL/LTR toggle, bilingual catalog rendering, kiosk ticket |
| **36** | **Bulk Product Price Adjustment with Preview Table** | `/app/pricing/bulk-update` | Percentage formula adjustment, preview diff, bulk commit |
| **37** | **Courier Settlement Cash Shortage Penalty & Adjustment** | `/app/delivery/settlements` | Shortage calculation, penalty deduction note, batch close |
| **38** | **Coupon Single-Use Limit Enforcement & Expired Check** | `/app/discounts/coupons` & `/app/pos` | Max usage constraint (1 use), duplicate rejection error |
| **39** | **Branch Emergency Pause & Aggregator Sync Lock** | `/app/operations/branches` & `/app/simulation/snappfood` | Temporary branch closure toggle, vendor closed sync |
| **40** | **Comprehensive Financial Audit Trail & JSON Payload Review** | `/app/audit` & `/app/reports` | Full daily event audit, supervisor override log inspection |

---

## 🔍 Detailed Scenario Specifications

### Scenario 21: Park / Hold Cart Order & Recall for Later Checkout
- **Description**: Cashier takes an order for 2 Burgers and Fries. Customer needs to retrieve cash from vehicle. Cashier parks the cart to serve the next customer, then resumes it from the Held Orders drawer.
- **Steps**:
  1. In `/app/pos`, add 2x `Classic Beef Burger` with modifiers and 1x `Crispy French Fries`.
  2. Click "Hold / Park Order", enter note: `Customer stepping to car for cash`.
  3. Verify cart clears and active draft badge displays `1 Held Order`.
  4. Process an unrelated fast single drink order and checkout.
  5. Open "Held Orders" drawer, select the parked draft, and click "Resume Order".
  6. Confirm all items and modifiers are restored, and complete checkout.
- **Expected Outcome**: Cart parked safely, resumed without loss of state, and checked out.

---

### Scenario 22: Split Bill by Line Items Between Dine-In Guests
- **Description**: Two guests seated at Table T-03 request separate bills for their respective meals.
- **Steps**:
  1. In `/app/dine-in/floor`, select active Table `T-03` order.
  2. Click "Split Order".
  3. Assign Burger + Soda to `Sub-Bill A` (`235,000 IRR`) and Pizza + Wings to `Sub-Bill B` (`480,000 IRR`).
  4. Settle `Sub-Bill A` using Cash payment.
  5. Settle `Sub-Bill B` using Card POS terminal.
- **Expected Outcome**: Order successfully split into two invoices with independent payment tenders, and Table T-03 clears.

---

### Scenario 23: Offline POS Sync Simulation & Network Recovery
- **Description**: Network connectivity is severed. POS switches to offline caching mode, takes orders, and syncs upon reconnection.
- **Steps**:
  1. Navigate to `/app/simulation/offline-sync`.
  2. Toggle network status to `OFFLINE`.
  3. Navigate to `/app/pos` and place 2 cash orders. Observe offline queue counter incrementing (`Queue: 2 pending`).
  4. Return to `/app/simulation/offline-sync` and toggle network to `ONLINE`.
  5. Click "Trigger Sync Now".
  6. Verify offline queue processes with 0 conflicts and orders appear in `/app/orders`.
- **Expected Outcome**: Zero data loss during offline periods and automated conflict-free queue reconciliation.

---

### Scenario 24: Tara BNPL Installment Payment Flow Simulation
- **Description**: Customer pays via Tara BNPL installment service at checkout.
- **Steps**:
  1. Navigate to `/app/simulation/payments-printers`.
  2. Input Mobile `09121111111`, National ID `0011223344`, Amount `500,000 IRR`.
  3. Step 1: Click "Check Eligibility" -> Status: `ELIGIBLE (Max Limit: 20,000,000 IRR)`.
  4. Step 2: Click "Reserve Credit" -> Status: `RESERVED (Trace: TR-9821)`.
  5. Step 3: Enter simulated OTP `12345` and click "Settle Transaction".
  6. Verify transaction record logged in `/app/payments`.
- **Expected Outcome**: Multi-step BNPL transaction lifecycle completes and records in ledger.

---

### Scenario 25: Printer Hardware Fault Injection & Print Job Retry
- **Description**: Kitchen printer runs out of paper during a busy rush, causing print job spooler failure, followed by successful reprint.
- **Steps**:
  1. In `/app/simulation/payments-printers`, inject hardware fault `OUT_OF_PAPER` on `PRN-KITCHEN`.
  2. In `/app/pos`, place an order to trigger kitchen ticket printing.
  3. Navigate to `/app/operations/print-queue`.
  4. Verify print job status is `FAILED` with error message "Printer out of paper".
  5. In simulator, clear printer fault (`ONLINE`).
  6. In `/app/operations/print-queue`, click "Retry Job".
- **Expected Outcome**: Job re-spools and status transitions from `FAILED` to `PRINTED`.

---

### Scenario 26: Discount PIN Authorization Exceeding Cashier Threshold
- **Description**: Cashier attempts to apply a 30% discount which exceeds the cashier's 15% allowance, prompting manager override.
- **Steps**:
  1. In `/app/pos`, add items totaling `400,000 IRR`.
  2. Click "Manual Discount", enter `30%`, Reason: `VIP Courtesy`.
  3. System displays Supervisor PIN Authorization dialog ("Requires Manager Approval: Discount > 15%").
  4. Enter Manager PIN `9999`.
  5. Confirm 30% discount (`120,000 IRR` reduction) applied to total.
- **Expected Outcome**: Discount authorized and logged in approval decision audit table.

---

### Scenario 27: Customer Duplicate Profile Detection & Merge
- **Description**: Customer directory identifies duplicate customer accounts with identical mobile numbers and merges them.
- **Steps**:
  1. Navigate to `/app/customers`.
  2. Click "Duplicate Explorer" tab.
  3. Select duplicate pair: `Ali Rezaei (CUST-001)` and `A. Rezaei (CUST-004)`.
  4. Select `CUST-001` as primary record.
  5. Click "Merge Customer Profiles".
- **Expected Outcome**: Profiles merged into single master profile, combining wallet points and order histories.

---

### Scenario 28: KDS Multi-Station Routing & Tab Filter Views
- **Description**: Kitchen staff switches between dedicated station tabs to only view relevant items on their line.
- **Steps**:
  1. In `/app/pos`, place an order containing `Classic Beef Burger`, `Crispy French Fries`, and `Fresh Lemon Mint Soda`.
  2. Navigate to `/app/kds`.
  3. Click tab `Main Kitchen (Grill & Sides)`. Verify Burger and Fries are displayed; Soda is hidden.
  4. Click tab `Beverage & Bar`. Verify Soda is displayed; Burger is hidden.
  5. Mark items prepared at each station.
- **Expected Outcome**: Category-to-station routing filters tickets accurately per kitchen station.

---

### Scenario 29: Dynamic Price Book Activation (Happy Hour Specials)
- **Description**: Store activates a Happy Hour Price Book offering promotional rates on drinks and sides.
- **Steps**:
  1. Navigate to `/app/pricing/price-book`.
  2. Activate price group `GRP-HAPPY-HOUR` (Appetizers 20% off, Beverages 15% off).
  3. Navigate to `/app/pos`.
  4. Add `Crispy French Fries` and `Fresh Lemon Mint Soda`.
  5. Verify unit prices automatically reflect discounted Happy Hour rates.
- **Expected Outcome**: POS dynamically resolves effective prices based on the active Price Book.

---

### Scenario 30: Delivery Breakdown Rejection & Courier Re-dispatch
- **Description**: Assigned courier reports a vehicle breakdown; dispatcher re-assigns the delivery order to another driver.
- **Steps**:
  1. Navigate to `/app/delivery/orders`.
  2. Select active dispatched order under Courier `Reza Moradi`.
  3. Click "Report Issue / Re-queue", Reason: `Vehicle Breakdown`.
  4. Order reverts to `READY_FOR_PICKUP`.
  5. Assign order to Courier `Hamid Kazemi` and click "Dispatch".
- **Expected Outcome**: Seamless re-dispatch with complete delivery event timeline audit trail.

---

### Scenario 31: Inventory Safety Stock Depletion & Alert Banner
- **Description**: High sales volume depletes stock below minimum threshold, triggering an operational alert.
- **Steps**:
  1. Navigate to `/app/inventory/stock`.
  2. Record stock usage transaction reducing `Beef Patties` to 5 units (Safety minimum: 10 units).
  3. Verify stock level badge turns `RED (LOW STOCK)`.
  4. Check AppShell Operational Alerts drawer (bell icon in header).
- **Expected Outcome**: `LOW_STOCK_WARNING` alert triggered and visible across manager dashboard.

---

### Scenario 32: Itemized Partial Refund with Customer Wallet Credit
- **Description**: Customer receives defective item and cashier issues an itemized refund credited directly to the customer's wallet balance.
- **Steps**:
  1. Navigate to `/app/refunds`.
  2. Click "New Refund", look up completed Order `ORD-20260819-0002`.
  3. Select only `Crispy French Fries` (`75,000 IRR`).
  4. Set Refund Target: `Customer Wallet Credit`, Reason: `Food Quality Complaint`.
  5. Confirm refund.
  6. Navigate to `/app/customer-club/wallet` and verify customer wallet increased by `75,000 IRR`.
- **Expected Outcome**: Item-level refund processed with instant wallet cashback credit.

---

### Scenario 33: Customer Tier Upgrade & Cashback Ledger Verification
- **Description**: Customer's total cumulative spend qualifies them for Gold Tier upgrade with 10% cashback.
- **Steps**:
  1. Navigate to `/app/customers`.
  2. Open customer `Sara Mohammadi`, update loyalty tier to `Gold (10% Cashback)`.
  3. In `/app/pos`, place order for `Sara Mohammadi` totaling `300,000 IRR`.
  4. Settle order.
  5. Check customer wallet ledger: verify `30,000 IRR` cashback (10%) credited.
- **Expected Outcome**: Tier rules accurately calculate and credit higher percentage cashback.

---

### Scenario 34: Business Day Reopen & Emergency Audit Adjustment
- **Description**: Store manager reopens a prematurely closed business day to enter an omitted transaction.
- **Steps**:
  1. Navigate to `/app/cashier/business-days`.
  2. On closed day, click "Reopen Business Day".
  3. Input Supervisor PIN `9999` and justification: `Late night delivery reconciliation`.
  4. Day status changes to `REOPENED`.
  5. Record adjustment and re-close business day.
- **Expected Outcome**: Business day state cycle handled with mandatory reason audit log.

---

### Scenario 35: Self-Service Kiosk Bilingual (Farsi/English) Ordering
- **Description**: Customer interacts with the Kiosk in English and navigates full ordering and customization.
- **Steps**:
  1. Navigate to `/app/kiosk`.
  2. Click language switcher button `EN / FA` in the top corner to switch to English.
  3. Verify catalog categories, product names, and modifier dialog render in English (LTR).
  4. Select `Double Smash Burger`, pick add-ons, and proceed to checkout.
  5. Complete simulated payment and print Kiosk ticket.
- **Expected Outcome**: Flawless bilingual rendering and touch-friendly ordering.

---

### Scenario 36: Bulk Product Price Adjustment with Preview Table
- **Description**: Manager applies a 5% general price increase across all items in category `CAT-BURGERS`.
- **Steps**:
  1. Navigate to `/app/pricing/bulk-update`.
  2. Filter by Category: `CAT-BURGERS`, Formula: `+5%`, Rounding: `Nearest 1,000 IRR`.
  3. Click "Generate Preview".
  4. Review old price vs proposed new price table.
  5. Click "Commit Bulk Price Update".
  6. Verify updated prices in `/app/catalog/products`.
- **Expected Outcome**: Bulk price update previewed, verified, and committed accurately.

---

### Scenario 37: Courier Settlement Cash Shortage Penalty & Adjustment
- **Description**: Courier returns from shift with a cash shortage against expected COD collections.
- **Steps**:
  1. Navigate to `/app/delivery/settlements`.
  2. Select Courier `Hamid Kazemi` (Expected COD Cash: `210,000 IRR`).
  3. In Settlement dialog, input Counted Cash: `190,000 IRR`.
  4. System computes Discrepancy: `-20,000 IRR (Shortage)`.
  5. Add Settlement Adjustment Line: `Shortage deduction from courier deposit`, Amount: `20,000 IRR`.
  6. Finalize settlement batch.
- **Expected Outcome**: Discrepancy reconciled via ledger adjustment and batch closed cleanly.

---

### Scenario 38: Coupon Single-Use Limit Enforcement & Expired Check
- **Description**: A promotional single-use coupon is restricted to one redemption per campaign.
- **Steps**:
  1. In `/app/discounts/coupons`, create coupon `SINGLE100` with `Max Usage: 1`.
  2. In `/app/pos`, apply coupon `SINGLE100` on Order A -> Discount applied successfully.
  3. Complete checkout on Order A.
  4. Open new cart in POS, enter coupon `SINGLE100`.
  5. Verify system rejects coupon with message: "Coupon has reached its maximum usage limit".
- **Expected Outcome**: Strict coupon redemption constraint enforcement.

---

### Scenario 39: Branch Emergency Pause & Aggregator Sync Lock
- **Description**: Store temporarily pauses accepting new incoming online orders during kitchen peak.
- **Steps**:
  1. Navigate to `/app/operations/branches`.
  2. Select Branch `BR-01` and toggle status to `BUSY / PAUSED`.
  3. Navigate to `/app/simulation/snappfood`.
  4. Verify vendor status reflects `PAUSED` and new webhook injections are throttled.
  5. Switch branch back to `OPEN / NORMAL`.
- **Expected Outcome**: Branch operational state cascades to external integration simulator.

---

### Scenario 40: Comprehensive Financial Audit Trail & JSON Payload Review
- **Description**: Auditor inspects the complete operational audit log of all daily events.
- **Steps**:
  1. Navigate to `/app/audit`.
  2. Filter by Event Category: `FINANCIAL` & `APPROVALS`.
  3. Inspect audit events: Cash Skims, Manager PIN Overrides, Price Book Updates, and Refund Allocations.
  4. Click on any event row to open the formatted JSON payload inspection dialog.
  5. Verify correlation IDs, user stamps, and timestamps are recorded.
- **Expected Outcome**: Full traceability and compliance verification across all operational activities.
