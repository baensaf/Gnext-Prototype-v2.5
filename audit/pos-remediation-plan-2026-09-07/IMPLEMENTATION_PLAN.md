# POS customer, delivery, and keyboard-shortcut remediation

## Audit scope

- Surface: `/app/pos`
- Goal: make the anonymous walk-in state explicit, complete the delivery customer/address/zone workflow, and remove visible keyboard-shortcut legends while preserving shortcut behavior.
- Evidence: the two user-provided POS screenshots copied beside this document, the live POS DOM/state, and the current frontend/backend implementation.

## Evidence and health by step

1. **Open a new POS cart — needs correction.** The customer select uses `selectedCustomerId === ''` to mean an anonymous guest, but MUI renders the closed select as blank. The menu option exists as `Walk-In Guest`; the missing label is a frontend rendering bug.
2. **Switch to Delivery — incomplete.** The screen still shows only the customer selector. It does not load/select an address or zone, does not show delivery fee/ETA, and does not prevent an address-less delivery.
3. **Submit a delivery — unsafe/incomplete.** The POS payload omits `delivery_address_id` and a zone. `OrderService.createDraft` writes an unknown `delivery_address_id` property instead of `customer_address_id`, submit has no delivery validation, and automatic delivery creation falls back to a dummy `Main St` snapshot while swallowing failures.
4. **Use POS keyboard shortcuts — behavior works, presentation is noisy.** F2 was verified to focus the catalog search. The global listener also handles F4, F6, F8, F9, and Escape. However the dedicated shortcut bar, search placeholder, POS buttons, and checkout buttons expose shortcut text. The current UI also labels both Held Orders and Hold as F4 although F4 only toggles Held Orders.

## Product decisions

1. Treat **Walk-In Customer** as the anonymous POS state (`customer_id` omitted), not as a synthetic CRM customer record. Show the label explicitly whenever no customer is selected. This avoids polluting customer analytics and keeps the existing API semantics.
2. Delivery requires a real customer, one of that customer's addresses, and an active zone for the selected branch, matching the product specification.
3. Address selection behavior:
   - When Delivery is chosen, reveal Customer, Delivery Address, and Delivery Zone controls in the cart context.
   - After customer selection, load addresses. Auto-select the default address; if there is no default and exactly one address, select it; otherwise require an explicit choice.
   - If there are no addresses, show an inline empty state and `Add address` action. Reuse the existing address-create endpoint with title, full address, postal code, and default checkbox; select the new address after save.
   - Resolve a zone by the longest matching postal-code prefix when exactly one active branch zone matches. If there is no unique match, require manual zone selection.
   - Show the selected zone fee and estimated delivery time next to the zone. Include the server-authoritative delivery fee in quote and totals.
4. Do not display shortcut legends. Keep keyboard listeners and add non-visual `aria-keyshortcuts` metadata to the controls they activate.

## Implementation plan

### 1. Frontend POS state and types

- In `starter-vite-ts/src/pages/pos/order.tsx`, add `CustomerAddress` and `DeliveryZone` state: loaded addresses, selected address ID, active branch zones, selected zone ID, loading/error flags, and an add-address dialog model.
- In `starter-vite-ts/src/api/orderApi.ts`, expose `customer_address_id` and `delivery_zone_id` on `OrderHeader` so held drafts can restore delivery context.
- Keep the empty string as the anonymous value, but render it as `Walk-In Customer` in the closed customer Select (`displayEmpty`/`renderValue`). Do not create or seed a fake customer.
- When switching away from Delivery, clear delivery-only validation without erasing a user's current customer. When the customer or branch changes, clear stale address/zone selections and reload the dependent options.
- Extend `handleClearCart` and held-order resume to reset/restore address and zone state.

### 2. Delivery UI workflow

- Render Address and Zone selectors only for `orderType === 'DELIVERY'`.
- Do not offer Walk-In Customer as a valid Delivery customer. If Delivery is selected while anonymous, show `Select a customer for delivery` and focus the customer control rather than silently choosing a customer.
- Address options should show the address title plus a readable, truncated address line. Mark the default address. Provide an inline `Add address` action/dialog using `customerApi.createAddress`, then refresh and select the created address.
- Zone options should show name, fee, and ETA. Filter `deliveryApi.getZones(selectedBranchId)` to active zones for the current branch and apply the postal-prefix auto-match rule above.
- Display loading, empty, and fetch-error states inline. Do not silently fall back to a placeholder address or zone.
- Add a single delivery-readiness predicate used by Hold, Place Order, direct terminal pay, and keyboard-triggered submit/pay. Keep the buttons' ordinary cart/processing disabled rules, and show precise inline validation/toasts when delivery context is incomplete.
- Add `delivery_address_id` and `delivery_zone_id` to every order payload path: hold, place order, direct terminal pay, draft update, and held-order resume.
- Include the selected zone fee as `deliveryFee` in live discount quotes. Track the quote response's delivery fee/grand total and render a Delivery line in totals so free-delivery campaigns and final totals remain correct.

### 3. Backend persistence, validation, and delivery creation

- Add nullable `delivery_zone_id` to `OrderHeader` and a migration such as `1700000000044-AddDeliveryZoneToOrder.ts`. Add the field to create/update DTOs and both draft create/update mappings.
- Fix the existing create mapping bug: map `dto.delivery_address_id` to `customer_address_id`.
- On delivery draft create/update, resolve the active zone for the same tenant and branch and set `order.delivery_fee` from its fee. Never trust a client-provided fee.
- Before a DELIVERY order can submit, require `customer_id`, `customer_address_id`, and `delivery_zone_id`; verify the active customer address belongs to that tenant/customer and the active zone belongs to that branch. Return stable 400 errors such as `DELIVERY_CUSTOMER_REQUIRED`, `DELIVERY_ADDRESS_REQUIRED`, `DELIVERY_ZONE_REQUIRED`, and mismatch/not-active variants.
- Create the Delivery record atomically with submission (or use the same transaction/entity manager). Build an immutable `address_snapshot` from the selected customer/address fields and attach the validated zone and fee. Remove the `Main St` fallback for normal delivery submission and do not swallow delivery-creation failures.
- Keep the public `POST /delivery/orders/:orderId` path compatible, but make it apply the same ownership/branch validation and reject missing context rather than fabricating data.

### 4. Remove visible shortcut text, preserve keyboard access

- Delete the `Keyboard Shortcuts Fast-Action Bar` Paper from `order.tsx`.
- Remove shortcut tokens from the catalog placeholder and visible labels: `[F2]`, `[F4]`, `[F6]`, `[F8]`, `[F9]`, `Esc`, and `⌘F`.
- Update the visible labels in `starter-vite-ts/src/components/CheckoutModal.tsx` as well.
- Preserve the existing keydown handlers. Add `aria-keyshortcuts` only to the actual targets: search (F2 and supported Ctrl/Meta combinations), held orders (F4), discount (F6), place/submit (F8), terminal pay (F9), and dialogs where Escape closes them.
- Do not assign F4 to Hold; the existing F4 behavior is Held Orders. This removes the present duplicate/conflicting legend.
- Ensure shortcuts do not fire while a conflicting modal owns the key and keep native typing behavior intact.

### 5. Tests and verification

- Backend unit/integration coverage:
  - draft create/update persists `customer_address_id` and `delivery_zone_id`;
  - DELIVERY submit rejects each missing field and tenant/customer/branch mismatches;
  - zone fee is server-derived and reaches order totals;
  - successful submit creates one Delivery with the selected zone and an immutable real address snapshot;
  - idempotent resubmission does not duplicate Delivery;
  - no delivery record is created if submission rolls back.
- Frontend Playwright coverage at `/app/pos`:
  - new cart visibly reads `Walk-In Customer`;
  - Delivery reveals required controls and blocks incomplete submission;
  - default/single address selection, new-address creation, zone auto-match/manual selection, fee/ETA display, and payload persistence across hold/resume;
  - shortcut bar and bracketed key legends are absent;
  - F2, F4, F6, F8, F9, and Escape still perform their intended actions.
- Run frontend TypeScript/build, targeted Playwright tests, backend typecheck, targeted Jest suites, and any migration checks available in the repository.
- Visually verify desktop LTR and RTL states at the current POS viewport; confirm the added delivery fields fit the cart without covering totals/actions and that focus/error messages are perceivable.

## Acceptance criteria

- A fresh non-delivery cart visibly shows `Walk-In Customer` without persisting a fake customer ID.
- A DELIVERY order cannot be held, placed, or paid without a registered customer, owned address, and valid branch zone.
- Default address selection is automatic when unambiguous; adding an address is possible without leaving POS.
- The delivery fee and ETA are visible before checkout, the fee is included in totals, and submitted Delivery records contain the correct zone and real immutable address snapshot.
- No normal path creates a `Main St` placeholder delivery.
- The shortcut bar and all visible shortcut suffixes are gone, while shortcut behavior still passes automated and manual checks.
- Held delivery drafts restore customer, address, zone, and totals correctly.

## Evidence limits

- The screenshots establish the visible missing/default states but cannot prove screen-reader announcements, focus order, or responsive reflow. Those require implementation-time browser/assistive-technology checks.
- The live browser check verified F2 focus only; the remaining shortcuts are confirmed from source and must be exercised in the implementation tests.
