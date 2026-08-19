# 📋 Gnext Prototype v2 — 20 Daily Operations Test Scenarios

This document outlines 20 end-to-end operational scenarios designed to test every facet of daily restaurant and retail operations within **Gnext Prototype v2**.

---

## 📑 Scenario Index

| # | Scenario Title | Primary Module / Path | Key Focus Areas |
|---|---|---|---|
| **01** | **Morning Day Opening & Cashier Shift Initialization** | `/app/cashier/shifts` & `/app/cashier/business-days` | Opening float, shift start, terminal assignment |
| **02** | **Morning Prep & 86'd / Out-of-Stock Item Suspension** | `/app/catalog/availability` | Item suspension, ingredient stock toggling |
| **03** | **Walk-In Counter Order with Item Modifiers (Cash)** | `/app/pos` | Variant/modifier selection, cash tender, receipt |
| **04** | **Walk-In Counter Order with Split Tender (Cash + Card)** | `/app/pos` & `/app/payments` | Multi-tender checkout, decimal precision |
| **05** | **Dine-In Guest Seating & Multi-Course Table Order** | `/app/dine-in/floor` & `/app/pos` | Floor map seating, table order docking |
| **06** | **Dine-In Order Additions, Table Transfer & Merging** | `/app/dine-in/floor` | Table transfer (T4 -> T6), bill appending |
| **07** | **Kitchen Display System (KDS) Preparation & Bump Flow** | `/app/kds` | Live kanban, item checklist, SLA timers, bump |
| **08** | **High-Priority (VIP/Rush) Ticket Escalation & Recall** | `/app/kds` | Rush priority (P0), ticket recall from bumped |
| **09** | **Customer Registration & Loyalty Cashback Accrual** | `/app/customers` & `/app/pos` | Customer lookup, loyalty club points/cashback |
| **10** | **Wallet Cashback Balance Redemption & Coupon Codes** | `/app/pos` & `/app/discounts/coupons` | Wallet redemption, `WELCOME10` coupon code |
| **11** | **Delivery Phone Order Creation & Courier Dispatch** | `/app/pos` & `/app/delivery/orders` | Delivery fee, customer address, courier assignment |
| **12** | **Courier Delivery Completion & COD Collection** | `/app/delivery/orders` & `/app/delivery/couriers` | Delivery status updates, Cash-On-Delivery marking |
| **13** | **External Food Aggregator (Snappfood) Order Injection** | `/app/simulation/snappfood` & `/app/kds` | Webhook simulation, HMAC signature, kitchen injection |
| **14** | **Mid-Day Cash Drawer Drop & Petty Cash Payout** | `/app/cashier/shifts` | Cash skim to safe, petty cash payout with reason code |
| **15** | **Line-Item Void & Supervisor PIN Override** | `/app/pos` & `/app/settings/approvals` | Manager override, void reason code tracking |
| **16** | **Full & Partial Order Refunds with Wallet Reversal** | `/app/refunds` & `/app/orders` | Itemized refund processing, audit record |
| **17** | **Corporate B2B Dining on Credit Account (On-Tab)** | `/app/pos` & `/app/credit/accounts` | Credit limit check, tab charging, balance statement |
| **18** | **Self-Service Kiosk Customer Order & Self-Checkout** | `/app/kiosk` | Touch-first ordering, add-on prompt, simulated payment |
| **19** | **End-of-Shift Courier Batch Settlement Reconciliation** | `/app/delivery/settlements` | Discrepancy calculation, adjustment, batch close |
| **20** | **End-of-Shift Z-Report & End-of-Day (EOD) Business Close** | `/app/cashier/shifts` & `/app/reports` | Cash drawer reconciliation, Z-Report, EOD close, CSV/XLSX export |

---

## 🔍 Detailed Scenario Specifications

### Scenario 01: Morning Day Opening & Cashier Shift Initialization
- **Description**: The morning store manager arrives, opens the business day, and assigns the cashier with an initial starting float in the cash drawer.
- **Steps**:
  1. Navigate to `/app/cashier/business-days`.
  2. Verify or trigger "Open Business Day" for Branch `Central Flagship (BR-01)`.
  3. Navigate to `/app/cashier/shifts`.
  4. Click "Open Shift", select Cashier `Morteza Kiani`, Terminal `POS-01`, and enter Opening Float `500,000 IRR` (or `$50.00`).
  5. Verify shift status changes to `ACTIVE` with zero recorded sales.
- **Expected Outcome**: Active business day and active cashier shift recorded.

---

### Scenario 02: Morning Prep & 86'd / Out-of-Stock Item Suspension
- **Description**: Morning kitchen inventory check identifies that Almond Milk is unavailable today. The manager updates item availability to prevent ordering.
- **Steps**:
  1. Navigate to `/app/catalog/availability`.
  2. Locate modifier `Almond Milk` or product `Truffle Mushroom Pizza`.
  3. Toggle availability switch to `Unavailable (86'd)`.
  4. Navigate to `/app/pos` and attempt to add the suspended item/modifier.
- **Expected Outcome**: The item is disabled or visually flagged as unavailable in the POS catalog.

---

### Scenario 03: Walk-In Counter Order with Item Modifiers (Cash Payment)
- **Description**: A walk-in customer orders a Classic Beef Burger with custom modifiers (Medium, Cheddar Cheese, Extra Bacon, No Pickles) and pays with exact cash.
- **Steps**:
  1. Navigate to `/app/pos`.
  2. Select category `Burgers & Sandwiches`.
  3. Click `Classic Beef Burger` to open the modifier dialog.
  4. Select `Medium` doneness, `Cheddar Cheese`, and add-on `Extra Bacon`.
  5. Add to cart; verify price includes add-on surcharges.
  6. Click "Pay / Checkout", choose `Cash`, enter received amount, and confirm payment.
- **Expected Outcome**: Order completes with status `COMPLETED`, invoice generated, receipt printed, and ticket routed to KDS.

---

### Scenario 04: Walk-In Counter Order with Split Tender (Cash + Card)
- **Description**: Customer orders two items totaling `335,000 IRR` and splits the bill between `100,000 IRR` Cash and the remainder on Bank POS Card.
- **Steps**:
  1. In `/app/pos`, add `Double Smash Burger` (`260,000 IRR`) and `Crispy French Fries` (`75,000 IRR`).
  2. Click "Checkout".
  3. Under split payments, enter `100,000 IRR` under `Cash Tender`.
  4. Enter remaining balance `235,000 IRR` under `Card / Bank POS`.
  5. Confirm transaction.
- **Expected Outcome**: System validates exact sum balance, records two payment transactions linked to the single invoice, and closes the order.

---

### Scenario 05: Dine-In Guest Seating & Multi-Course Table Order
- **Description**: A party of 4 is seated at Table 4. Server inputs the initial round of drinks, appetizers, and main dishes.
- **Steps**:
  1. Navigate to `/app/dine-in/floor`.
  2. Click `Table 04` (currently `Vacant`) and select "Open Table / New Order".
  3. Table status updates to `Occupied`.
  4. Add 2x `Fresh Lemon Mint Soda`, 1x `Buffalo Chicken Wings`, and 2x `Classic Beef Burger`.
  5. Click "Send to Kitchen" (Fire Order).
- **Expected Outcome**: Table 4 displays active order summary and kitchen receives order tickets.

---

### Scenario 06: Dine-In Order Additions, Table Transfer & Merging
- **Description**: The party on Table 4 decides to move to outdoor Patio Table 6 and orders additional desserts.
- **Steps**:
  1. Navigate to `/app/dine-in/floor`.
  2. Select `Table 04`, click "Transfer Table", and select `Table 06`.
  3. Verify order bill and items transfer to Table 06; Table 04 reverts to `Cleaning/Vacant`.
  4. Append 2x `Chocolate Lava Cake` to the active Table 06 bill.
  5. Click "Update / Send to Kitchen".
- **Expected Outcome**: Bill updated accurately with dessert items under Table 06.

---

### Scenario 07: Kitchen Display System (KDS) Preparation & Bump Flow
- **Description**: The kitchen line cook uses the KDS terminal to prepare dishes and bump finished tickets.
- **Steps**:
  1. Navigate to `/app/kds`.
  2. View incoming tickets under `New` column.
  3. Click ticket header to move ticket to `In Preparation`.
  4. Check off individual item checklist boxes as items are plated.
  5. Click "Bump / Mark Ready" once all items are completed.
- **Expected Outcome**: Ticket moves to `Ready` status, sound chime triggers, and timer reflects preparation duration against target SLA.

---

### Scenario 08: High-Priority (VIP/Rush) Ticket Escalation & Recall
- **Description**: An order marked as VIP/Rush requires expedited preparation, and an accidentally bumped ticket is recalled.
- **Steps**:
  1. In `/app/kds`, observe a ticket tagged with `Rush (P0)`.
  2. Verify the rush ticket is sorted to the top of the queue with highlighted visual styling.
  3. Go to "Recall History" drawer in KDS.
  4. Locate previously bumped ticket from Scenario 07 and click "Recall".
- **Expected Outcome**: Rush ticket prioritized; recalled ticket returns to `In Preparation` column.

---

### Scenario 09: Customer Registration & Loyalty Cashback Accrual
- **Description**: Cashier registers a new customer during checkout to start earning loyalty club points/cashback.
- **Steps**:
  1. Navigate to `/app/customers`.
  2. Click "Add Customer", enter Name: `Ali Rezaei`, Phone: `09121111111`, Tier: `Silver`.
  3. Open `/app/pos`, search and attach customer `Ali Rezaei` to the cart.
  4. Add items totaling `200,000 IRR` and complete checkout.
- **Expected Outcome**: Customer profile is credited with 5% cashback (`10,000 IRR`) to their digital wallet ledger.

---

### Scenario 10: Wallet Cashback Balance Redemption & Coupon Codes
- **Description**: Returning customer redeems their earned wallet balance alongside promotional coupon code `WELCOME10`.
- **Steps**:
  1. In `/app/pos`, attach customer `Ali Rezaei`.
  2. Add items totaling `150,000 IRR`.
  3. Apply coupon code `WELCOME10` (10% discount -> `15,000 IRR` off).
  4. Apply Wallet Balance deduction (`10,000 IRR`).
  5. Settle the remaining net balance (`125,000 IRR`) via Card POS.
- **Expected Outcome**: Discount quote accurately reflects coupon discount + wallet deduction; remaining payable is calculated decimal-safe.

---

### Scenario 11: Delivery Phone Order Creation & Courier Dispatch
- **Description**: Phone order received for home delivery. Cashier creates order, adds delivery fee, and assigns an active courier.
- **Steps**:
  1. In `/app/pos`, select order mode `Delivery`.
  2. Select Customer `Sara Mohammadi`, confirm delivery address: `No 42, Valiasr Ave`.
  3. Add items and delivery packaging surcharge.
  4. Submit order.
  5. Navigate to `/app/delivery/orders`, select the prepared order, and assign to Courier `Reza Moradi`.
  6. Click "Dispatch / Out for Delivery".
- **Expected Outcome**: Order state transitions to `OUT_FOR_DELIVERY`, and courier status shows active delivery run.

---

### Scenario 12: Courier Delivery Completion & COD Collection
- **Description**: Courier delivers order to customer, collects cash upon delivery (COD), and confirms delivery in the system.
- **Steps**:
  1. Navigate to `/app/delivery/orders`.
  2. Locate Courier `Reza Moradi`'s active assignment.
  3. Click "Mark Delivered".
  4. Confirm payment collection method: `Cash on Delivery (COD)` with amount `210,000 IRR`.
- **Expected Outcome**: Order marked `DELIVERED`; `210,000 IRR` COD cash recorded under Courier `Reza Moradi` pending end-of-shift settlement.

---

### Scenario 13: External Food Aggregator (Snappfood) Order Injection
- **Description**: Simulated external online platform order (Snappfood) is received via webhook, authenticated via HMAC, and pushed directly to the kitchen.
- **Steps**:
  1. Navigate to `/app/simulation/snappfood`.
  2. Configure sample aggregator payload (Vendor ID, Item Codes, Delivery Address).
  3. Click "Inject Test Order".
  4. Navigate to `/app/kds` and `/app/orders`.
- **Expected Outcome**: Snappfood order appears with aggregator badge, correct items, and immediate routing to KDS.

---

### Scenario 14: Mid-Day Cash Drawer Drop & Petty Cash Payout
- **Description**: Cash drawer reaches high cash volume. Cashier performs a cash drop to the store safe, and logs a petty cash expense for emergency ice.
- **Steps**:
  1. Navigate to `/app/cashier/shifts`.
  2. Select active shift, click "Cash Movement".
  3. Action: `Cash Drop / Skim`, Amount: `1,000,000 IRR`, Reason: `Safe Drop`.
  4. Action: `Petty Cash Payout`, Amount: `50,000 IRR`, Reason: `Emergency Ice Purchase`.
- **Expected Outcome**: Drawer expected balance decreases by `1,050,000 IRR` with audit log entries created.

---

### Scenario 15: Line-Item Void & Supervisor PIN Override
- **Description**: A customer cancels one item after order entry. Cashier requests manager authorization to void the item.
- **Steps**:
  1. In `/app/pos`, with active cart containing multiple items, click delete on `Truffle Mushroom Pizza`.
  2. Supervisor approval modal appears.
  3. Enter Manager PIN `9999` and select Reason Code `Customer Changed Mind`.
- **Expected Outcome**: Item is removed from cart, and an approval decision audit log is recorded.

---

### Scenario 16: Full & Partial Order Refunds with Wallet Reversal
- **Description**: Customer returns a damaged item from a previous invoice requesting a partial refund.
- **Steps**:
  1. Navigate to `/app/refunds` (or `/app/orders`).
  2. Locate target completed order.
  3. Click "Process Refund".
  4. Select item to refund, input refund reason `Wrong Item Delivered`, and choose refund target `Customer Wallet` (or `Original Payment Method`).
  5. Confirm refund.
- **Expected Outcome**: Refund record created, invoice net balance adjusted, and wallet credited.

---

### Scenario 17: Corporate B2B Dining on Credit Account (On-Tab)
- **Description**: Corporate client `Acme Tech Solutions` dines in and charges the full invoice to their monthly credit facility.
- **Steps**:
  1. In `/app/pos`, create order for party from `Acme Tech Solutions`.
  2. Select Customer `Acme Tech Solutions` (Credit Limit: `5,000,000 IRR`, Current Balance: `0 IRR`).
  3. In checkout, select payment method `Corporate Credit Account`.
  4. Complete transaction.
  5. Navigate to `/app/credit/accounts` and review account ledger.
- **Expected Outcome**: Transaction approved without cash/card; corporate credit balance updated and aging statement recorded.

---

### Scenario 18: Self-Service Kiosk Customer Order & Self-Checkout
- **Description**: Customer interacts with the touch kiosk, browses categories, selects customized combo, and pays at kiosk card reader.
- **Steps**:
  1. Navigate to `/app/kiosk`.
  2. Select "Dine-In" mode.
  3. Browse category `Burgers`, select `Double Smash Burger`, pick drink add-on.
  4. Review cart and proceed to pay.
  5. Complete simulated card payment.
  6. Collect kiosk order number ticket (e.g. Ticket #104).
- **Expected Outcome**: Order created with channel `KIOSK`, routed to kitchen KDS, and kiosk screen resets to welcome attractor.

---

### Scenario 19: End-of-Shift Courier Batch Settlement Reconciliation
- **Description**: Courier returns to the branch at the end of the shift. Cashier reconciles collected COD cash and card slips.
- **Steps**:
  1. Navigate to `/app/delivery/settlements`.
  2. Select Courier `Reza Moradi` (Shows pending COD `210,000 IRR`).
  3. Click "Start Settlement".
  4. Enter counted cash `210,000 IRR`, card slips `0 IRR`.
  5. Verify variance is `0.00 IRR` (Balanced).
  6. Finalize settlement batch.
- **Expected Outcome**: Courier status resets to settled; printable settlement voucher generated.

---

### Scenario 20: End-of-Shift Z-Report & End-of-Day (EOD) Business Close
- **Description**: Closing cashier counts cash drawer, prints Z-Report, and store manager closes the business day.
- **Steps**:
  1. Navigate to `/app/cashier/shifts`.
  2. Select active shift and click "Close Shift".
  3. Enter counted cash, counted card terminal totals.
  4. Review discrepancy report (Over/Short) and confirm shift closure (Z-Report).
  5. Navigate to `/app/cashier/business-days` and click "Close Business Day".
  6. Navigate to `/app/reports/sales-summary` to view daily financial summary and export to XLSX/CSV.
- **Expected Outcome**: Shift and business day formally closed; final financial reports locked and exported.
