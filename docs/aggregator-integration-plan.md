# Aggregator integration plan

Written 2026-09-30. Read this before starting the Snappfood build (V3), so that Snappfood is
built as the first of several platforms rather than as a one-off.

| Platform | Version | Market | How |
| --- | --- | --- | --- |
| Snappfood | V3 | Iran | Direct, our own adapter (annex 4.3.0) |
| Talabat | V6 | Oman first | Direct, our own adapter (Delivery Hero POS Middleware) |
| Other Delivery Hero brands (HungerStation, foodpanda, PedidosYa, …) | later | — | Same adapter as Talabat, different config |
| Keeta, Noon Food, Careem | later | GCC | One adapter each |
| Deliveroo, Uber Eats | later | International | One adapter each |

Decision: **direct integration per platform, no middleware** (Deliverect, UrbanPiper, …).
Every platform gets an adapter behind one shared "channel" layer.

## 1. The rule that keeps this cheap

The order, catalog, till, printing and shift code must never branch on a platform name.
Today the prototype does (`channel === 'SNAPPFOOD'` in `incoming-order-policy.util.ts`,
`kds.service.ts`, `call-number.ts`, `reports.service.ts`; `STOP_CHANNELS = ['SNAPPFOOD']` in
`catalog.service.ts`; `order.snappfood` in `agent-sync.service.ts`). That is fine for a
prototype, but the real build should put all of it behind the layer below. Adding a platform
should then mean writing one adapter and one simulator, plus config.

## 2. Shared channel layer

### 2.1 Channel connection (per branch, per platform)

- platform (`SNAPPFOOD`, `TALABAT`, …), external store id (Talabat: `platformRestaurant.id`
  and our `remoteId`; Snappfood: vendor code), chain code where the platform has one.
- Credentials and secrets, stored encrypted, one set per environment (staging/production).
- Enabled/paused flag, and the platform's time limits (auto-cancel window, max prep time),
  since these differ per platform and per country.

### 2.2 Channel order (one model for every platform)

| Field | Meaning | Snappfood | Talabat |
| --- | --- | --- | --- |
| external id | the platform's key for calls back | `code` | `token` |
| display code | what staff read out | `code` | `shortCode` / `code` |
| our id | sent back so the platform can address us | — | `remoteOrderId` (mandatory in the ack) |
| fulfilment | who moves the food | own delivery / Snappfood rider | `expeditionType` + `delivery.riderPickupTime` (see 4.3) |
| promise times | when ready / delivered | deliveryTime or riderPickupTime | `pickup.pickupTime`, `delivery.expectedDeliveryTime`, `delivery.riderPickupTime` |
| accept deadline | auto-cancel point | per annex | `expiryDate` (platform decides) |
| lines | product + add-ons, with our product id | our id on each line | `remoteCode` on products and `selectedToppings` |
| money | platform totals kept as sent | price, tax, delivery, packing, discounts | `price.*` (grandTotal, vatTotal, containerCharge, deliveryFee, collectFromCustomer, payRestaurant, discounts with sponsorships) |
| payment | paid online or collect | CASH / online | `payment.status` pending / paid, `payment.type` |
| test flag | never print or count | — | `test: true` |
| raw payload | stored for audit and replay | yes | yes |

Money rule: **store what the platform sent, don't recompute it.** The prototype ignores
Snappfood's totals (see memory note on annex gaps); the real build must keep them for
reconciliation and payouts, including who funded each discount.

### 2.3 One status machine

`RECEIVED → ACCEPTED | REJECTED → PREPARED → PICKED_UP → DELIVERED`, with `CANCELLED`
reachable from any open state (platform- or customer-initiated). Each adapter maps its
platform's statuses in and out; the core only knows these.

### 2.4 Shared operations (adapter interface)

Every adapter implements what its platform supports and declares the rest as unsupported
(capability flags), so the UI hides the button instead of the core checking the platform name.

| Operation | Snappfood | Talabat |
| --- | --- | --- |
| receive order (webhook) | yes | `POST /order/{remoteId}` |
| accept with time | yes | `order_accepted` + `acceptanceTime` + `remoteOrderId` |
| reject with reason | reasonId | `order_rejected` + reason enum (+ `unavailableItems`) |
| mark prepared | ack / pick calls (see annex) | `preparation-completed` (platform-rider orders only) |
| mark picked up | — | `order_picked_up` (own-delivery and pickup only) |
| adjust prep time | no; "report" = reject 153 + minutes | `adjust-preparation-time` within min/max from payload |
| modify order (out of stock) | no | `modifications` on accept, or `modifications/product`; async result |
| receive cancellation | statusCode 54 | `ORDER_CANCELLED` on `posOrderStatus` |
| re-send after support | statusCode 56 | — |
| courier arrived / rider waiting | — | `COURIER_ARRIVED_AT_VENDOR`, `SHOW/HIDE_RIDER_WAITING_WARNING` |
| store open / busy / closed | see annex | `PUT …/availability` (OPEN, CLOSED, CLOSED_UNTIL + minutes, CLOSED_TODAY) with a closing reason |
| item stop / restart | product toggle | `PUT …/catalog/items/availability` |
| push full menu | menu calls | `PUT /v2/chains/{chainCode}/catalog` (full catalog only), async result by callback |
| order report (reconcile) | — | `GET …/orders/ids`, `GET …/orders/{id}` (last 24 h) |

Internal reject reasons (too busy, item unavailable, closed, outside area, no courier,
technical, test order, fraud/prank, …) are mapped by each adapter to its platform's codes.

### 2.5 Reliability (same for all platforms)

- **Ack fast, work async.** Validate, store, answer, then process. Talabat retries on
  429/5xx up to 10 times (≥30 s apart, exponential backoff); a slow answer causes duplicates.
- **Idempotent on external id.** A redelivered order or status must not create a second order.
- **Outbound calls through an outbox with retries.** Talabat asks to retry an accept that
  gets 409 with state `ASSIGNED_TO_TRANSPORT` / `WAITING_FOR_ACKNOWLEDGEMENT` every ~10 s for
  5 min, and to not retry other 409s.
- **Token cache** per connection (Talabat login JWT, `expires_in` ~1800 s).
- **Integration log** per call (the prototype's `IntegrationLog` entity already has a
  `provider` column; keep that shape).
- **Ignore unknown fields** in platform payloads; both platforms add fields over time.
- **A simulator per platform** that drives the real adapter, as the prototype does for
  Snappfood (`/simulation/snappfood/...`).

### 2.6 Catalog mapping

Our product/add-on ids are the platform's `remoteCode`. Ids must be stable forever (Talabat:
"unique across the catalog and consistent over time"). Per-platform prices and stops stay a
channel concern (the prototype has channel price sheets and `product_availability.channel`).

## 3. Snappfood (V3) — what to build now so Talabat fits later

Snappfood facts are in the annex (`snappfoodTechnicalAppendix4-3-0-3.pdf`); the prototype's
known gaps are listed in the memory note on the annex. For this plan the V3 build should:

1. Put Snappfood behind the adapter interface in 2.4, not in the order service.
2. Use the channel-order model in 2.2, including stored platform totals.
3. Keep the internal status machine and reject reasons platform-neutral.
4. Keep "Snappfood-only stop" and "Snappfood prices" (V3 labels) generic: a stop or price
   *per channel*, with Snappfood as the first channel.
5. Make add-on groups able to express Talabat's shape (see 4.4) even if Snappfood doesn't need it.

## 4. Talabat (V6) — facts from the documentation

Talabat runs on Delivery Hero's POS integration. Gnext is the "plugin"; Delivery Hero's
Integration Middleware (now "POS Order Processing Service") is the other side.

### 4.1 Access and security

- Apply via the "Get Credentials" form on developers.deliveryhero.com with a **PGP public key**;
  username, password and secret come back PGP-encrypted.
- **Outbound:** `POST /v2/login` (`grant_type=client_credentials`) → JWT bearer, ~30 min.
- **Inbound:** every call from Delivery Hero carries a JWT (HS512) signed with our secret;
  verify it and check the `service: middleware` claim.
- Plugin must be HTTPS with a valid certificate (no self-signed); a port in the base URL is allowed.
- Whitelist the Middle East/Turkey Middleware IPs: 63.32.225.161, 18.202.96.85, 52.208.41.152
  (staging: 34.246.34.27, 18.202.142.208, 54.72.10.41).

### 4.2 Direct vs indirect — decide before V6

| | Indirect | Direct |
| --- | --- | --- |
| Who accepts | staff on Delivery Hero's tablet | staff in Gnext |
| What Gnext gets | only accepted orders | every order, must accept/reject in time |
| Must build | order dispatch webhook (+ cancellation) | all of 2.4 marked for Talabat |
| Approval | standard | case-by-case by Delivery Hero; tablet stays as fallback |

Recommendation: **start V6 indirect** (orders appear in Gnext for printing, shifts and reports
with little risk), then move to direct once the adapter is proven. Direct requires: accept,
reject with reason, handle cancellation after accept, mark ready, report closed/busy.

### 4.3 Order types

- `expeditionType = pickup` → customer pickup.
- `expeditionType = delivery` and `delivery.riderPickupTime = null` → **vendor delivery**
  (our couriers; address included).
- `expeditionType = delivery` with a rider pickup time → **Talabat rider** (address is null;
  `acceptanceTime` is legacy, the rider pickup time is what counts).

### 4.4 Catalog rules that affect our catalog design

- JSON, flat map of items (Menu, Category, Product, Topping, Image, ScheduleEntry) keyed by id;
  **full catalog per push only** (partial updates "planned"); one push can cover several
  vendors sharing a menu. Async validation; result via our callback or `menu-import-logs`.
- Every product and variant must be in a category; a product and its variant can't share a
  category; at least one category.
- Variants are Products with a `parent`.
- **Talabat toppings: at most 2 levels, and the first level must be a mutually exclusive
  choice (min 1, max 1), even with a single option** (e.g. Size → Grande / Venti, then
  Extra shot / Milk under each size). Our add-on groups (PR #181) must be exportable to this
  shape.
- Images: ≤20 MB, ≤16 Mpx, and **URLs must be immutable** (new image → new URL).
- The legacy XML Menu Import is closed to new integrations; use Catalog Import.

### 4.5 Operating rules Delivery Hero enforces

- Accept/reject window varies by platform (ask the Talabat contact); unanswered orders are
  cancelled with `NO_RESPONSE` (typically ~15 min) and repeated misses auto-close the store.
- Proper reject reasons, correctly formatted RFC 3339 times, a working cancellation endpoint,
  24 h notice before maintenance, an escalation contact. Delivery Hero can disable the
  integration if these slip.
- Onboarding: credentials → build on staging → end-to-end test with the Talabat contact →
  production → pilot vendors → roll out.

### 4.6 Oman specifics (not Talabat-specific, but V6 needs them)

- **Currency OMR, 3 decimal places (baisa).** Gnext stores integer Rial today; money must
  become currency-aware with minor units. The register has multi-currency as F with "V7 adds
  Omani rial" — **this conflicts with Talabat Oman in V6** and needs a decision.
- VAT 5%; Arabic and English menus (Talabat titles are localised); timezone Asia/Muscat.
- Hosting: Delivery Hero must reach our plugin URL from AWS eu-west-1, and we must reach them.
  Serving Oman from the Iranian VPS is unlikely to work; plan a non-Iran deployment for V6.

## 5. Future platforms

- **Delivery Hero brands** (HungerStation, foodpanda, PedidosYa, foodora, …): same API as
  Talabat — reuse the Talabat adapter with per-platform config (`platformKey`, region IPs,
  topping support differs: toppings are only supported on Pandora, Talabat and HungerStation).
- **Keeta, Noon Food, Careem, Deliveroo, Uber Eats**: each has its own partner API; not
  researched yet. Before building one, fill in a column of the table in 2.4 for it and note
  anything the shared model can't express. That gap list is the real cost of the platform.

## 6. Open questions

1. Talabat Oman in V6 vs Omani rial in V7 — move currency support to V6?
2. V6 Talabat: indirect first (recommended) or direct from day one?
3. Where does the Oman deployment run?
4. Do we push menus to Talabat (Catalog Import) in V6, or let Talabat's team load them
   manually at first?
5. Talabat's accept window and prep-time limits for Oman — ask the Talabat contact.

## Sources

- Talabat POS integration: https://integration.talabat.com/en/documentation/
- Delivery Hero Restaurant Integration API: https://developers.deliveryhero.com/documentation/pos.html
- Middleware API (Gnext calls): https://integration-middleware.stg.restaurant-partners.com/apidocs/pos-middleware-api
- Plugin API (Gnext hosts): https://integration-middleware.stg.restaurant-partners.com/apidocs/pos-plugin-api
