# Phase 1 — HAMI Replacement Scope

## 1. Organization and Branch Management

- Tenant/company
- Branches
- Branch configuration
- Branch-specific menus, through per-branch availability (86, selling windows, daily stock) and branch price lists on the one chain catalog; there is no separate menu composer
- Branch-specific prices
- Price groups
- Branch operating hours
- Branch heartbeat
- Online/offline status
- Last successful sync
- Branch agent version and health

## 2. Users and Advanced Permissions

- User management
- Roles and permissions
- Branch-scoped access
- POS/cashier permissions
- Manager approvals
- Discount permission
- Maximum allowed discount percentage
- Maximum allowed fixed-price deduction
- Refund/cancellation permission
- Order-edit permission
- Reprint permission
- Credit approval limits
- Shift closing permission
- Audit logs

### Configurable PIN Escalation and Approval Workflow

- Escalation rules are configured at tenant level rather than being permanently assigned to a supervisor.
- Approvers may be specific users, roles, departments, or operational teams.
- Support one-step and multi-step approval workflows.
- Example: Cashier → Supervisor → IT.
- Configure escalation rules by action, amount, discount percentage, branch, order state, and other relevant conditions.
- Trigger escalation when an action exceeds the cashier’s allowed limit, such as a discount above 10%.
- Approvers enter their own PIN to approve or reject the action.
- PINs must be hashed, rate-limited, and never shown to the cashier.
- Record the requester, each approver, action, reason, amount, time, branch, and order in audit logs.
- Support escalation for discounts, fixed-price deductions, refunds, cancellations, reprints, price overrides, credit-limit overrides, payment corrections, and reopening closed orders.
- Approval steps, approvers, and escalation order are managed through centralized tenant settings.

## 3. Catalog and Menu

- Categories
- Products
- Product variants
- Modifier/topping groups
- Modifier minimum/maximum selection
- Combo products
- Packaging charges
- Tax configuration
- Product images
- Product descriptions
- Branch availability
- Channel-specific availability
- Scheduled availability
- Temporary item suspension
- Product eligibility or exclusion from discounts
- Product-level discount configuration
- Non-stackable product discounts
- Import/export
- Aggregator product/category mapping

## 4. Pricing

- Base prices
- Branch prices
- Price groups
- Effective dates
- Channel-specific prices
- Delivery prices
- Packaging prices
- Modifier prices
- Bulk price updates
- Price audit history

## 5. Customer Management

- Multi-million customer database
- High-volume import
- Customer profiles
- Multiple phone numbers
- Multiple addresses
- Custom fields
- Customer tags and segments
- Mapping imported records
- Deduplication
- Merge conflicts
- Bulk updates
- Customer history
- Branch and brand relationships
- Privacy and consent records

## 6. Customer Club and Discounts

- Discount campaigns
- Percentage discounts
- Fixed-amount discounts
- Manual cashier percentage discount
- Manual cashier fixed-price deduction
- Product/category discounts
- Customer-specific discounts
- Branch-specific discounts
- Coupon codes
- Validity periods
- Usage limits
- Discount priority
- Discount conflict rules
- Discount stacking rules
- Maximum cashier percentage discount
- Maximum cashier fixed-price deduction
- Product/category discount exclusions
- Products that are never included in discounts
- Products with their own discount that cannot receive another discount
- Configurable non-stackable discounts
- Free-item promotions
- Free-delivery promotions
- Discount funding/source tracking
- Approval and escalation for discounts above cashier limits

## 7. Customer Credit

- Credit accounts
- Simplified customer-credit mode for operational use
- Employee/customer credit eligibility
- Credit limits
- Optional unlimited or policy-based credit
- Available balance
- Credit purchases
- Repayments
- Manual adjustments
- Approval workflow
- Limit override
- Customer statement
- Aging report
- Credit suspension
- Audit history
- End-of-day cashier report listing customers who used credit
- Credit usage report for handover to accounting
- Credit reporting by cashier, shift, branch, customer, and date

## 8. Order Management

- Dine-in orders
- Delivery orders
- Pickup orders
- Aggregator orders
- Kiosk orders
- Draft/open orders
- Order item modifiers
- Order notes for all order channels
- Aggregator order notes
- Customer assignment
- Table assignment
- Order edit
- Item replacement
- Cancellation
- Refund
- Reopen
- Reprint
- Order history
- Reason codes
- Approval requirements
- Idempotency and duplicate protection
- Tenant-configurable order lifecycle
- Configurable allowed actions for each order state
- Configurable cancellation availability at every lifecycle stage
- Configurable edit and cancellation time window after order submission
- Cashier edit/cancel window defined in minutes at tenant level
- Escalation after the cashier’s allowed time window expires
- Post-payment cancellation handled through refund transactions without deleting the original payment
- Complete history of edits, cancellations, approvals, payments, and refunds

## 9. Dine-In

- Tables
- Sections/floors
- Table status
- Guest count
- Move table
- Merge tables
- Split orders
- Transfer items
- Print guest bill
- Settle separately or together

## 10. Cashier and POS

- Touch-friendly cashier
- Multiple cashier terminals
- Cashier login
- Shift opening
- Opening cash amount
- Cash drawer
- Shift closing
- Expected versus actual totals
- Shortage/overage
- Supervisor or configured approver workflow
- Business-day closing
- Closing statement
- Offline order creation
- Local transaction storage
- Apply coupon or discount code
- Apply manual percentage discount
- Apply manual fixed-price deduction
- Enforce cashier discount and deduction limits
- Request PIN escalation when limits are exceeded
- Edit or cancel orders within the configured time window

## 11. Payments

- Cash
- Customer credit
- Network POS terminal
- Mobile POS terminal
- Online payment
- Bank transfer
- Split/combined payment
- Multiple payment allocations on one order
- Mixed payments such as cash + POS or credit + POS
- Partial payment
- Payment correction
- Refund
- Partial refund
- Full refund
- Payment reversal
- Refund to the original payment method
- Refund through a different payment method when permitted
- Cash refund for an order originally paid by POS
- Bank-transfer refund for an order originally paid by POS
- Permission and approval rules for alternative refund methods
- Mandatory reason and reference for alternative refund methods
- Payment reference/transaction number
- POS terminal/device identifier
- Terminal ownership and settlement account
- Receipt/reference number
- Failed-payment retry
- Payment audit trail
- Immutable relationship between original payment, cancellation, reversal, and refund transactions
- Separate tracking of paid, refunded, and outstanding amounts
- Reconciliation by payment instrument and settlement destination

### Mobile POS Classification

- Mobile POS terminal payments must be recorded as card/POS payments, not cash.
- Company-owned mobile POS receipts are reconciled against the company’s bank or acquiring account.
- Mobile POS receipts are reported separately from physical cash collected by couriers.
- The terminal owner, device, acquiring account, and receipt reference must be recorded.

## 12. Printers and Print Routing

- Network printers
- Receipt printers
- Kitchen printers
- Printer groups
- Routing by branch
- Routing by category/product/station
- Multiple print copies
- Customer receipt
- Kitchen ticket
- Courier receipt
- Reprint
- Print queue
- Retry
- Printer failure detection
- Fallback printer
- Print history

## 13. KDS

- Multiple KDS screens
- Kitchen stations
- Routing by product/category
- New/in-progress/ready statuses
- Preparation timers
- Bump and recall
- Order priority
- Aggregator order identification
- Offline operation

## 14. Delivery and Couriers

- Delivery order workflow
- Delivery zones
- Delivery fees
- Courier profiles
- Courier daily attendance
- Courier available/unavailable-today status
- Courier shift availability
- Courier assignment
- Delivery statuses
- Cash collected by courier
- Company mobile POS terminal assigned to courier
- Mobile POS receipt collection and verification
- Separate settlement of physical cash and POS receipts
- Courier settlement
- Courier compensation
- Shortage/overage
- Settlement batches
- Courier statements
- Adjustments and reversals
- Settlement by payment instrument
- Expected cash to hand over
- Expected mobile POS receipts
- Actual cash received
- Actual POS receipts verified
- Settlement discrepancies and reason codes
- Audit history for courier settlements

## 15. Snappfood Integration

- Per-branch credentials
- Independent branch operation during cloud outage
- Per-branch webhook endpoint
- HMAC validation
- Order webhook processing
- ack
- pick
- accept
- reject
- Decline-reason synchronization
- Recent-order recovery
- Duplicate detection
- Order modification handling
- Order notes handling
- Additional-payment handling
- Cancellation handling
- Customer/address mapping
- Menu/category/product synchronization
- Modifier/topping synchronization
- Product image synchronization
- Price and capacity updates
- Temporary item suspension
- Vendor status
- Delivery zones
- Express courier name/status
- Retry and reconciliation logs

## 16. Tara Pay Integration

- Authentication and credentials
- Payment/credit validation
- Transaction creation
- Confirmation
- Reversal
- Refund
- Settlement
- Reconciliation
- Failure handling
- Audit logs

## 17. Local Branch Agent

- Rust local service
- Local database
- Autonomous branch operation
- Snappfood connectivity
- POS/KDS/printer connectivity
- Local API for web applications
- Durable queues
- Offline writes
- Retry engine
- Conflict handling
- Encrypted credentials
- Automatic startup
- Remote updates
- Health monitoring
- Cloud synchronization

## 18. Cloud–Branch Synchronization

- Incremental sync
- Menu and price sync
- Customer sync
- Order sync
- Payment sync
- Refund sync
- Approval workflow sync
- Configuration and policy sync
- Courier attendance and settlement sync
- Event queue
- Retry and dead-letter queue
- Idempotency
- Conflict resolution
- Last-sync status
- Manual resync
- Sync logs

## 19. Kiosk

- Web-based kiosk
- Menu browsing
- Modifiers
- Cart
- Dine-in/takeaway selection
- Configurable customer-identification policy
- Required login/identification policy
- Optional login/identification policy
- Guest checkout when optional identification is enabled
- Network POS payment
- Receipt printing
- Local branch-agent connection
- Offline-safe behavior where possible

## 20. Reports

- DataGrid-based reports
- Branch-level reports
- Consolidated multi-branch reports
- Sales reports
- Product/category sales
- Payment-method reports
- Mixed-payment reports
- Mobile POS terminal reports
- Alternative-refund-method reports
- Discounts
- Manual cashier discounts and deductions
- Discount exclusions and stacking reports
- Cashier shifts
- Cash discrepancies
- Customer credit
- End-of-day credit usage by cashier
- Customer activity
- Aggregator orders
- Aggregator order notes
- Snappfood reconciliation
- Courier attendance
- Courier settlements
- Courier cash and mobile POS reconciliation
- Tax and packaging
- Export to Excel/CSV
- Saved filters and column layouts

## 21. Audit and Operational Monitoring

- User activity logs
- Order change history
- Payment history
- Discount approvals
- Credit changes
- Refund/cancellation logs
- Alternative refund-method logs
- Multi-step approval history
- PIN approval attempts and rate-limit events
- Courier attendance history
- Courier settlement history
- Mobile POS receipt verification history
- Printer logs
- Integration logs
- Branch heartbeat dashboard
- Sync failures
- Offline duration
- Alerting and notifications

## 22. Centralized Tenant Settings and Localization

- Centralized settings engine under Dashboard / Settings
- Tenant-level configuration
- Branch-level overrides only for a fixed list of setting groups (decided 2026-09-25). Everything else is set once at head office and inherited by every branch, and a group added later stays chain-wide until it is deliberately opened up. A branch manager may override these for their own branch, and head office for any branch; clearing an override returns the branch to the chain value:
  - Tax (local tax treatment)
  - POS (how the register behaves)
  - Order actions (cashier order-edit and cancellation windows)
  - Order workflow (including incoming-order acceptance)
  - Kiosk customer identity policy
  - Shift policy (drawer float and count)
  - Courier pay (new-courier pay rule, pay for a failed ride)
  - Business day (turnover time and opening hours)
- Discount authorizations, financial settings, loyalty economics and all other groups are chain-wide and cannot be overridden by a branch
- Configurable order lifecycle and allowed actions by order state
- Configurable order cancellation stages
- Configurable cashier order-edit time window in minutes
- Configurable cashier order-cancellation time window in minutes
- Configurable escalation actions and thresholds
- Configurable single-step and multi-step approval workflows
- Configurable approver users, roles, departments, or teams
- Configurable discount percentage and fixed-deduction limits
- Configurable discount exclusions, priority, conflicts, and stacking
- Configurable refund methods and alternative-refund permissions
- Configurable customer-credit operating mode and limits
- Configurable kiosk identification policy: required or optional
- Multi-currency support
- Tenant default/base currency
- Tenant-enabled currencies
- Currency code, symbol, decimal precision, and rounding configuration
- Currency recorded on prices, orders, payments, refunds, customer credit, settlements, and reports
- Multi-language support
- Tenant default language
- Tenant-enabled languages
- Translation management
- Frontend and operational UI translations
- Receipt, invoice, kiosk, and customer-facing text translations
- RTL and LTR layout support
- Tenant time zone
- Time-zone-aware storage and display of dates and times
- Localized date formats
- Localized time formats
- Localized number formats
- Localized currency formats
- Localized decimal and thousands separators
- Localized calendar and first-day-of-week settings
