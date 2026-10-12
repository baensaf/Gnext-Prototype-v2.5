# Snappfood menu sync: what to build

**Status:** simulated in the prototype (2026-10-12). Nothing is sent to Snappfood; every call
is written to the integration log with the body a live connection would send. This doc is for
the developers who build the real connection in V3. Source: Snappfood technical annex 4.3.0
(`D:\Sources\snappfoodTechnicalAppendix4-3-0-3.pdf`) and Food Partner, the vendor panel,
browsed on 2026-10-11 (`audit/snappfood-catalog-2026-10-11`).

Try it: Simulation → Snappfood → **Menu sync** tab. The code is
`backend/src/modules/simulation/snappfood-catalog.service.ts`; the test that walks it end to end
is `backend/test/snappfood-menu-sync-postgres.spec.ts`.

## 1. The model on each side

| Ours | Snappfood | Notes |
| --- | --- | --- |
| Branch | Vendor (`vendorCode`) | Each branch has its own menu, prices, stock and webhook on Snappfood |
| Category | Menu (`menus[].id`, `orderIndex`, `title`) | Order = our category order |
| Product without types | Product (`productId`, `title`) | |
| Product with types (sizes, flavours) | One product per type, grouped by `productTitle`; `title` is the type's name | Each type has its own id, price, stock and toppings |
| Add-on group | Topping group (`toppingGroup.title/min/max/position`) | Snappfood answers with its own `toppingGroupId`; later sends pass it to update the group |
| Add-on | Topping (`toppings[].id/title/price/containerPrice`) | |
| Add-on switched on for a product | `POST /va/v1/topping/add-to-product` pair `{productId, toppingId}` | Sent for every type of the product |
| Stop "until the next shift" | `disable: true` with `disableUntil` = the next business-day start | |
| Stop "until further notice" | `disable: true` with `disableUntil` far in the future | Snappfood's `disable` without a date ends tomorrow, so a date is always sent |
| Product off the menu | `active: false` | Only reactivated by our own call |
| Most per order | `capacity` (`POST /va/v1/product/productDetails`) | |
| Tax rate | `vat`, whole percent | |
| Price (Rial) | `price`, whole Toman | The branch's price group's Snappfood price, else its in-store price plus the channel markup (see "Prices" below). Snappfood's contract wants the in-store price |
| Packaging | `containerPrice: 0` | We charge packaging as a required add-on group, as Food Partner vendors do |
| Selling hours, daily stock | `schedules: []`, `stock: null` | Removed from our product (S-11); always sent as full-time and unlimited |

## 2. Our ids

Snappfood keys menus, products and toppings by **our integers** ("ID in your dataset", at most
10 digits). A topping id may never equal a product id. We use one sequence per tenant and channel
for every record, starting at 1001, in the table `channel_item_map`:

| Column | Meaning |
| --- | --- |
| `channel` | `SNAPPFOOD` (Talabat and others get their own numbers) |
| `entity_type`, `entity_id` | `CATEGORY`, `PRODUCT` (no types), `VARIANT`, `OPTION_GROUP`, `OPTION_ITEM` and our UUID |
| `external_id` | The integer we send. Never reused, never changed |
| `channel_codes` | Per branch: Snappfood's own code for the record (`productCode`, `categoryCode`, or the `toppingGroupId`) |
| `synced_at` | Per branch: when it was last sent |

A product that later gets types keeps its old id on its `PRODUCT` row (Snappfood is told it is
inactive), and each type gets a new id.

## 3. Onboarding a branch: match its existing menu

Every pilot restaurant already sells on Snappfood, so its products exist there with Snappfood's
own codes. Before the first send:

1. `GET /va/v1.1/product` (with the branch's `vendorCode`) lists the vendor's products, each
   with `productCode`, `title`, price and `menuCategory.categoryCode`.
2. Match each to one of ours. The simulator suggests a match when the names are equal after
   normalising them: Arabic ي/ك as Persian, half-spaces and brackets as spaces, one space, lower
   case. Snappfood's title for a type is "product name + type name". A person confirms each
   match; Snappfood products with no match stay theirs (the simulator adds two).
3. `POST /va/v1/product/sync/productId` with `{vendorCode, products: [{productId, productCode}]}`
   links each code to our id. Categories match by name and go to
   `POST /va/v1/category/sync/categoryId` with `{categoryId, categoryCode}`.
4. Our products with no match are created on the first send and wait for Snappfood's review
   (Food Partner shows "در حال بررسی"; about 6 hours).

## 4. Sending the menu

In this order, for one branch (`buildMenu` returns the bodies; `pushMenu` logs them as sent):

| # | Call | Body |
| --- | --- | --- |
| 1 | `POST /va/v1/menu/` | `{vendorCode, menus: [{id, orderIndex, title}]}` (live categories) |
| 2 | `POST /va/v1.1/product/` | `{vendorCode, products: [{productTitle?, title, menuCategoryId, productId, position, description, price, vat, containerPrice, schedules}]}` (one per type) |
| 3 | `POST /va/v1/topping/` | One call per group: `{vendorCode, toppingGroupId?, toppingGroup: {title, min, max, position}, toppings: [{id, title, price, containerPrice}]}` |
| 4 | `POST /va/v1/topping/add-to-product` | `{vendorCode, toppings: [{productId, toppingId}]}` |
| 5 | `PUT /va/v1/product/` | `{vendorCode, products: [{id, active, disable, disableUntil?}]}`: every product's stock, products taken off our menu, and toppings |
| 6 | `PUT /va/v1/menu/` | `{vendorCode, menus: [{id, active: false}]}` for categories taken off the menu |
| 7 | `POST /va/v1/product/productDetails` | `{vendorCode, products: [{id, price, capacity}]}` for products with a per-order cap |

### Prices

Snappfood prices belong to the **price group** (2026-10-12), not the branch and not the whole
chain. Each group has two prices per item: in store and Snappfood (`price_entry` rows with
`price_group_id`, and `channel = 'SNAPPFOOD'` for the Snappfood one; dated, the old price is
closed, not deleted). `getChannelPriceSheet(tenant, 'SNAPPFOOD', branch)` resolves a branch's
Snappfood price for each product or type:

1. the branch's group's Snappfood price, if the group sets one;
2. else the group's in-store price (the base price when the group does not price the item)
   with the channel markup rule (`CHANNEL_PRICING`: `markup_percent`, `round_to`) applied and
   rounded up to its step;
3. a branch with no group: the base price with the markup.

`buildMenu` sends exactly this sheet, so two branches on different groups get different prices
for the same product, and a branch on a group with no Snappfood price follows its own in-store
price. Add-ons follow the markup rule only.

Prices are whole Toman: our Rial divided by ten, rounded. The send is refused item by item where
Snappfood would refuse it, and the simulator lists those as warnings first:

| Check | Limit (Food Partner) |
| --- | --- |
| Product, type, category or topping-group title | 64 characters |
| Description | 256 characters |
| Price | 1,000 to 20,000,000 Toman (the panel caps some products at 10 or 15 million) |

When to send: the simulator sends on demand. The live connection should send a branch's changes
when head office saves the menu (debounced), and stock at once when a branch stops or resumes an
item, since a stale "available" on Snappfood costs the restaurant rating points.

## 5. Orders back

A Snappfood order (webhook, `statusCode` 56) names each line by our id (`products[].id`, also
`vmsFoodId`), with its `quantity`, `price` (Toman, one item, toppings not included) and
`toppings[]`, each `{id, title, price, quantity}`. `resolveIncoming` reads them back through
`channel_item_map`:

- `PRODUCT` id: the product. `VARIANT` id: the product with that type.
- Each topping id: the add-on, kept on the line as an order-item option with its group's name and
  price, so the chit and the order show it the way the till's own lines do.
- An id we never sent: the line keeps Snappfood's title, and its note says "ناشناخته در منو" with
  the id, so the kitchen still makes it and someone fixes the match.

The line's price is `(price + toppings) × quantity`, in Rial. The order total is Snappfood's
`price`, as before (see `audit/incoming-orders-2026-09-11`).

## 6. To confirm with Snappfood before going live

1. **Topping stock.** The annex has no topping toggle. We send topping stops through
   `PUT /va/v1/product/` because Snappfood keeps toppings in the product id space.
2. **"Until further notice".** We send a far `disableUntil` (2099-12-31). Ask whether Food
   Partner's "ناموجود تا اطلاع بعدی" is that or `active: false`.
3. **The topping object in the webhook.** The annex says only "Array of topping objects". We read
   `id` (or `vmsFoodId`), `title`, `price` and `quantity`.
4. **Whether `price` on an order line includes its toppings.** The annex's sample has `price`,
   `toppingPrice` and `totalPrice`; we read `price` as the item alone.
5. **The `disableUntil` format.** The annex's sample is a date ("2022-01-01"); we send
   `YYYY-MM-DD HH:mm:ss` so "until the next shift" ends at the cutoff, not at midnight.
6. **Webhook auth and answer.** Still open from the 2026-09-13 check: `Authorization: HMAC
   snappfood:<ts>:<base64(hmac('POST'+ts))>`, and answer 200/204, not 201.
