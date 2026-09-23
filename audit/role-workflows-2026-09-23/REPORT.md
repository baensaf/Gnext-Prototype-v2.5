# Role workflow validation — 2026-09-23

55 daily workflows were run against the API as the three demo accounts. Each scenario covers a
common task plus its edge cases, invalid inputs and branch or role boundaries. Bugs were fixed
and the full set was run again on the final code.

| Role | Account | Scenarios | Final pass | Fail | Blocked |
|---|---|---|---|---|---|
| Cashier | `cashier.downtown@gnext.local` (Valiasr) | 30 | 30 | 0 | 0 |
| Branch manager ("branch admin") | `manager.downtown@gnext.local` (Valiasr) | 15 | 15 | 0 | 0 |
| System administrator | `admin@gnext.local` (SUPER_ADMIN, head office) | 10 | 10 | 0 | 0 |

**How it was tested.** The API and web app ran locally from this branch against the local
`appdb`. Node scripts signed in as each account and drove the same endpoints the screens call.
Each check asserts the status code and the state in the database afterwards. Cross-branch
checks use Central Plaza (`TEH-CENTRAL`); where they needed a Central record to act on, head
office created one and cancelled it afterwards.

**Not covered.** No scenario was run by clicking through the browser: signing in needs a
password, which the test agent does not type into a page. The one screen change (creating a
dining section) passed lint and build only. Kiosk ordering was not in scope.

"First run" is the result before any fix. "Test error" means the test script was wrong (a wrong
field name, or a mistaken assumption about how a feature works) and the app was right.

## Cashier — 30 scenarios

| # | Scenario | First run | Final |
|---|---|---|---|
| C1 | Sign in as cashier; wrong password refused | PASS | **PASS** |
| C2 | Check own open shift and drawer policy | PASS | **PASS** |
| C3 | Shift change: blind close, short count needs reason + manager PIN, recount to the shown figure refused, next shift opens; a 2nd shift on a busy till refused | FAIL — bug B7 | **PASS** |
| C4 | Takeaway cash sale, exact amount | PASS | **PASS** |
| C5 | Takeaway card sale on the bank terminal | PASS | **PASS** |
| C6 | Split payment: half cash, half card | PASS | **PASS** |
| C7 | Overpayment: card over the due refused; cash over the due handled | PASS | **PASS** |
| C8 | Invalid payment amounts (0, negative, text, exponent) refused | PASS | **PASS** |
| C9 | Invalid order lines (qty 0/neg/text, unknown product, empty cart) refused | FAIL — bug B1 | **PASS** |
| C10 | Tampered unit_price from the client is ignored | PASS | **PASS** |
| C11 | Apply a valid coupon (IB10) at the register | PASS | **PASS** |
| C12 | Unknown coupon code is rejected, no discount given | PASS | **PASS** |
| C13 | 20% manual discount: not granted without approval, applied with manager PIN | FAIL — test error | **PASS** |
| C14 | Wrong or default PINs (0000/1234/9999/empty) cannot approve | PASS | **PASS** |
| C15 | Hold an order, recall it, add items, then send and pay | PASS | **PASS** |
| C16 | Discard a held order: reason needed with items, not when empty | PASS | **PASS** |
| C17 | Dine-in: seat a table, order, move table, pay, release | FAIL — test error | **PASS** |
| C18 | Void a wrongly rung line after sending; reason required; total drops | PASS | **PASS** |
| C19 | Cancel an unpaid sent order within the window, reason required | PASS | **PASS** |
| C20 | Cancel a paid order: refused alone, done with manager approval and money returned | FAIL — bug B2 | **PASS** |
| C21 | A manager's approval for one order cannot cancel a different order | FAIL — bug B3 | **PASS** |
| C22 | Sign up a customer at the counter (dup/invalid phone refused, no credit granted) | FAIL — bug B5 | **PASS** |
| C23 | Delivery order: address + zone fee, courier out and back with the cash | PASS | **PASS** |
| C24 | Settle a courier at end of run (COD in, pay out of the drawer) | PASS | **PASS** |
| C25 | Paid-out and safe drop with reasons; negative/zero/text amounts refused | FAIL — bug B6 | **PASS** |
| C26 | 86 an item from the register, sale refused, then back on | PASS | **PASS** |
| C27 | Kitchen ticket start/bump on KDS, then reprint the customer receipt | PASS | **PASS** |
| C28 | Partial refund (half the bill) with manager PIN; over-refunds refused | FAIL — test error | **PASS** |
| C29 | Cashier cannot read or act on another branch (orders, KDS, prints, shifts, tables) | FAIL — bug B4 | **PASS** |
| C30 | Cashier is refused manager and head-office actions | PASS | **PASS** |

## Branch manager — 15 scenarios

| # | Scenario | First run | Final |
|---|---|---|---|
| M1 | Manager dashboard and reports show only their own branch | FAIL — test error | **PASS** |
| M2 | 86 an item for today's service, then bring it back; cannot 86 another branch's | PASS | **PASS** |
| M3 | Set a daily stock count of 2; the 3rd portion is refused; negative count refused | FAIL — test error | **PASS** |
| M4 | Approve one cashier request, reject another; wrong PIN and re-deciding refused | PASS | **PASS** |
| M5 | Add, edit and remove a delivery zone; negative/text fee and duplicate code refused; other branch refused | FAIL — bug B11 | **PASS** |
| M6 | Hire a courier, set their pay, check them in; duplicate code, negative pay and other-branch couriers refused | FAIL — test error | **PASS** |
| M7 | Add, rename and retire a register; duplicate code, moving it to another branch and a busy till refused | FAIL — bug B12 | **PASS** |
| M8 | Add and remove a printer; other branch's printer, fallback or group refused; bad paper width refused | FAIL — bug B13 | **PASS** |
| M9 | Set up a kitchen station, screen and routing rule; other branch's station refused; negative target refused | FAIL — bug B14 | **PASS** |
| M10 | Add a dining section and table; duplicate table number, 0 seats and a table on another branch refused | FAIL — bugs B9, B10 | **PASS** |
| M11 | Override order-edit windows for own branch, reset to inherit; bad values, org/chain settings, other branch and cashier refused | FAIL — test error | **PASS** |
| M12 | Manager is refused chain-wide changes (menu, prices, coupons, tenders, users, branches, roll-ups) | PASS | **PASS** |
| M13 | Close yesterday: refused while orders are open, with the orders listed; Central's day, bad/future dates and cashier refused | FAIL — bug B15 | **PASS** |
| M14 | Reopen a closed business day with a reason and close it again; no reason, cashier and other branch refused | FAIL — bug B16 | **PASS** |
| M15 | Review shift statements, audit log and alerts for own branch only | PASS | **PASS** |

## System administrator — 10 scenarios

| # | Scenario | First run | Final |
|---|---|---|---|
| A1 | Create a cashier for a branch who can then sign in; duplicate, unknown role, unknown branch and a branchless cashier refused | FAIL — bug B17 | **PASS** |
| A2 | Deactivate a user: live session and sign-in refused; reactivate works; cannot disable or demote yourself | PASS | **PASS** |
| A3 | Promote a cashier to manager with a PIN that then approves; demoted, the same PIN stops working; 1-digit PIN refused | FAIL — bug B18 | **PASS** |
| A4 | Add a menu item that the register can sell at its price, then take it off; negative/text price, no code, no category refused | FAIL — bug B19 | **PASS** |
| A5 | Issue a one-use 20% coupon: first order gets it, second does not, switched off it is refused; 150% and duplicate code refused | PASS | **PASS** |
| A6 | Change the chain default for order-edit windows: branches without an override follow, Downtown keeps its own; bad values refused | PASS | **PASS** |
| A7 | Add a tender and a reason code; the register sees the code; a switched-off tender is refused at payment; duplicate codes refused | PASS | **PASS** |
| A8 | Head office reads the chain: shift and delivery roll-ups, branch comparison, orders across branches | FAIL — test error | **PASS** |
| A9 | Open a new branch, set its hours, staff it; duplicate code, bad type/hours refused; cannot close a branch with a till open; closing it disables its staff | FAIL — bug B20 | **PASS** |
| A10 | Read the chain audit trail (user changes included); issue and revoke a branch agent enrolment code; reset a manager PIN | FAIL — test error | **PASS** |

## Bugs fixed

| # | Found by | What was wrong | Fix |
|---|---|---|---|
| B1 | C9 | An order line could have quantity 0 or -1. It was stored with a negative line total and printed on the kitchen ticket. | `OrderService.addItemsToDraft` refuses a quantity that is not above zero (`INVALID_QUANTITY`). This covers create, update, edit and replace. |
| B2 | C20 | A cashier's plain cancel on a paid, completed takeaway refunded the money with no manager. The policy said FORBID, but paid orders go to `cancelPaidOrder` and never reach the check that enforces it. | `cancelOrder` requires an approved `CANCEL_ORDER` request whenever the order has money on it. |
| B3 | C21 | An approval was not tied to its order. The approval id for order A cancelled and refunded order B within its 10-minute life. | `validateApprovedRequest` takes the order id and refuses a request made for another order (`APPROVAL_FOR_OTHER_ENTITY`). All five order approval checks pass it. |
| B4 | C29 | A Valiasr cashier could act on Central Plaza's order: start a card charge, bump its KDS ticket (the order went to READY), reprint it, and move it onto a Valiasr table. | `@BranchOwned` added to payments (create, read, process, void, reverse, correct, terminal check/resolve), KDS ticket and item actions, order reprint, print-job read/retry/reprint, refunds and cancel-paid, move-table, merge and transfer-items. Move-table also refuses a table in another branch. |
| B5 | C22 | A customer could be signed up with mobile `abc`. Persian digits (`۰۹۱۲…`) were stripped, so a number typed on a Persian keyboard was stored as raw text and never matched as a duplicate. | `normalizePhone` converts Persian and Arabic digits first, and `createCustomer` refuses a number with fewer than 8 digits. |
| B6 | C25 | A pay-out or safe drop larger than the drawer holds was accepted (a 999,999,999,999 IRR pay-out). | `recordMovement` refuses taking out more cash than the drawer holds (`EXCEEDS_DRAWER_CASH`). |
| B7 | C3 | Blind close leaked. A refused count shows the expected cash, and the cashier could then type that figure (or reopen the dialog) and close balanced with no reason or PIN. | The first count submitted for a close is the count. A different recount by a non-approver needs a manager PIN (`BLIND_COUNT_RECORDED`). A return to open starts a fresh count. |
| B8 | C28 | Hitting the PIN rate limit came back with error code `INTERNAL_SERVER_ERROR`. | The error is now `PIN_RATE_LIMITED`. |
| B9 | M10 | The dining floor screen created sections with no branch. A manager's new section belonged to nobody, so they could not add tables to it. | The page sends its branch, and the API defaults a section to the caller's branch. |
| B10 | M10 | Two tables with the same number or code could exist in one branch. Editing a table could move it into another branch's section. | Table number and code are unique per branch. A table cannot move to another branch's section. |
| B11 | M5, M6 | A delivery zone fee or courier pay could be negative. Text reached the database and returned a 500. | The six fee and pay fields must be non-negative amounts. |
| B12 | M7 | A manager could archive a register that had an open shift, which stranded the drawer. The test did this to TERM-02, and it was restored. | `archiveTerminal` refuses while a shift is open (`TERMINAL_HAS_OPEN_SHIFT`). |
| B13 | M8 | A printer could name another branch's printer as its fallback. A print route or printer group could use another branch's group, station or printers. | Printer, group and route create/update check that referenced records are in the same branch. |
| B14 | M9 | A KDS screen could show another branch's stations. | Screen create/update checks every station belongs to the screen's branch. |
| B15 | M13 | A business day in the future (2026-12-31) could be closed. `not-a-date` was treated as a date. | The close requires a `YYYY-MM-DD` date that is not after today. |
| B16 | M14 | Closing a reopened business day failed with a 500 (duplicate key). | The close updates the existing row instead of inserting a second one. |
| B17 | A1 | Head office could create a CASHIER or MANAGER account with no branch. Such an account was confined to nothing and could reach every branch. | Only head-office roles may be without a branch. |
| B18 | A3 | A one-digit approver PIN was accepted. It falls to guessing inside one 15-minute window. | PINs must be 4–8 digits, on the users screen and on `/approvals/user-pin`. |
| B19 | A4 | A product could be created with a negative price. A text price, missing code or missing category returned a 500. | `createProduct` and `updateProduct` check code, name, category and price. |
| B20 | A9 | A branch could be created with type `SPACESHIP`, and a branch could be archived with a till open. | The type must be RESTAURANT, COMMISSARY or OFFICE. Archiving refuses while shifts are open. |

## Regression

After the last fix, all 55 scenarios ran again in one pass and passed. The scenarios that use
wrong PINs ran last, so the PIN lockout could not affect the others. CI's own checks were also
run: backend `typecheck` and `jest`, frontend `lint` and `build` (results in the pull request).

## Remaining issues (not fixed)

1. **The POS hardcodes the manual-discount limits** in `pages/pos/order.tsx`: 10% / 50,000 IRR for
   a cashier and a 30% / 300,000 IRR ceiling. The server reads its limits from head office's
   discount-authorization settings. If head office changes them, the POS and the server disagree.
   Also, 300,000 IRR is about 3% of one burger, so a manager cannot give a fixed goodwill amount of any size.
2. **Submit drops an unapproved manual discount without saying so.** The customer is charged the
   full price, which is safe, but a client that skips the POS dialog gets no error.
3. **Refund `items` is accepted but ignored.** The refund body takes `items`, but the service refunds only `amount`/`full`.
   The refunds screen sends only amounts, so no screen is affected.
4. **Another branch's id is silently replaced, not refused.** A branch account naming another
   branch in a body or query gets its own branch instead (`BranchScopeInterceptor`), with a 200.
   Nothing leaks, but the reply says success for something other than what was asked.
5. **`GET /approvals/requests` is tenant-wide** (known since PR #82). Only Valiasr had requests in
   this run, so the leak could not be seen.
6. **Valiasr has 13 unfinished orders from 2026-09-22.** They block closing that day, which is correct.
   They are demo data from earlier sessions.
7. **The browser was not used**, as noted above.

## Test data left in the demo database

The test data is at Valiasr unless stated otherwise:

- **Orders:** about 90 test orders from today, including cancelled, refunded and delivered ones.
- **Shifts:** SHF-20260922-5058 and SHF-20260923-2026 were closed 2,000,000 short, as part of C3. SHF-20260923-4920 is open on TERM-02.
- **Customers:** several "تست گردش‌کار" customers on 0935… numbers, each with one address.
- **Inactive records:** couriers `CR-T*`; users `rw.cashier.*` and `rw.staff.*`; products `RW*`; coupons `RW*`; tenders `RW_VOUCHER_*`; reason codes `RW_SPILL_*`.
- **Archived branches:** `RW-*`.
- **Business days:** 2026-09-22 is REOPENED; the test closed it and then reopened it. 2026-09-20 was reopened and closed again.
- **Settings:** ORDER_ACTIONS and SHIFT_POLICY were changed during the tests and restored to their original values.
