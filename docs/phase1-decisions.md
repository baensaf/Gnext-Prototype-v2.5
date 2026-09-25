# Phase 1 decisions

**Status:** draft, 2026-09-25. Each section gives the question, what the prototype does today
and a proposed answer. Nothing here is decided until the product owner confirms it. Once an
answer is confirmed, mark it **Decided**, add the date, and update the scope document.

Already decided on 2026-09-25:

- **Menus.** The catalog is the live menu. A branch's menu comes from availability (86,
  selling windows, daily stock) and branch price lists. The separate menu composer is gone.
- **Branch overrides.** A branch may override eight setting groups. Everything else is
  chain-wide. The list is in section 22 of `Phase 1-- HAMI Replacement Scope_rev3.md`.
- **Order export.** Only a manager or head office can export the order book.

## 1. What a branch manager may change during service

**Today** (`starter-vite-ts/src/config/role-access.ts`, `CHAIN_ONLY_PATHS`), a branch
manager runs their own site: shifts and business days, delivery (couriers, zones, pay),
terminals, printers, KDS, availability, reports, audit and the overridable settings. Head
office keeps users and roles, products, categories, modifiers, prices, discounts, customers
and credit, tenders, reason codes, approval rules and discount authorizations.

A manager cannot add a staff member, fix a product's price or name, or give a customer
credit mid-service. They can 86 an item, approve a cashier's discount, refund or cancellation
with their PIN, and change their branch's order-edit windows.

**Proposed:** keep the split. The chain owns anything with no branch column (a product, a
price, a coupon, a customer); a branch owns its live service. Add one route for urgent
changes: a manager raises a request ("price wrong on X", "new cashier Y") that appears on
head office's approvals screen. Don't let branches edit chain records directly.

## 2. Where Phase 1 stops: warehouse and accounting

**Today** the prototype includes these, although warehouse and accounting are deferred:

| Feature | What it does | Proposed |
|---|---|---|
| Today's Stock | Counts portions left today (`daily_stock`); the till refuses the next sale at zero | **Keep.** It is availability, not inventory: no stock ledger, no suppliers, no costing |
| Moadian e-invoices | Sends each sale to Iran's tax system; head office configures it, branches read their own invoices | **Keep for Iran.** It is a legal requirement for selling there, not accounting |
| Credit accounts | One limit and ledger per customer, paid through the payment module | **Keep**, as a tender. Aging and statements stay reports; no general ledger |
| Courier settlement | Cash-on-delivery counted back in, net of courier pay, from the drawer | **Keep.** It is drawer cash, closed with the shift |
| Reports | Sales, shift, delivery, manual-discount and branch roll-ups | **Keep** operational reports; no profit and loss, no journal export |

**Proposed rule:** Phase 1 covers what a shift or business day needs in order to close.
Stock ledgers, purchasing, recipes, costing and journals are Phase 2.

## 3. First market

**Today** the prototype is Iran-specific in several places: IRR is hard-coded on the POS and
Orders screens, and it integrates Snappfood, Tara Pay, Moadian and Persian digits. Time zone and
business-day turnover are already set per branch. Currency is one per tenant (`base_currency`),
and the interface switches between English and Persian with RTL/LTR layout.

**Proposed:** launch in Iran first, with Iran Burger as the pilot. Treat Snappfood, Tara Pay
and Moadian as Iran integrations that are switched on per tenant. Keep currency, language,
time zone and receipt format as tenant or branch settings, so a second market is a matter
of configuration plus its own integrations. The product owner should name that second
market before international work starts.

## 4. Who owns each step of an order

**Today** the screens and roles give this split (not yet walked end to end on screen):

| Step | Owner today | Proposed |
|---|---|---|
| Accept or decline an incoming Snappfood or web order | Branch staff (cashier or manager) at the shop it was sent to | Cashier; manager if the order was declined or is late |
| Kitchen progress | KDS at the branch (cashier and manager can bump) | Kitchen; manager watches the timers |
| Hand to courier, count COD back in | Cashier | Cashier |
| Couriers, zones, courier pay | Manager | Manager |
| Refund, paid cancellation | Cashier starts, an approver's PIN releases | Same |
| Failed or retried payment | Cashier, on the order | Cashier; manager if a payment is stuck as pending |
| Shift close | Cashier (blind count; a short count needs a reason and a manager PIN) | Same |
| Business-day close | Manager; refused while shifts are open, and unfinished orders need a decision | Keep the separate manager close, because the day's figures need a sign-off. Open item in the readiness review, decision 7 |

**Next step:** walk each row on screen with the three demo accounts, as the Phase 1
readiness review proposes, and confirm the owners above.
