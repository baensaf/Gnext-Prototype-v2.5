# Catalog audit against Snappfood Food Partner (2026-10-11)

**Goal.** Make our menu screens feel familiar to people who already run a menu in Snappfood's
vendor panel (Food Partner), and shape the catalog data so Snappfood can be the first aggregator
we connect to (V3).

**Sources.**
- Food Partner (`partner.snappfood.ir`), read-only, on a live vendor account (a café with
  13 categories, sizes and add-on groups). Nothing was changed.
- Snappfood technical annex 4.3.0 (`D:\Sources\snappfoodTechnicalAppendix4-3-0-3.pdf`), the
  Vendor Automation API.
- Our code at `1ea278d`, plus `docs/catalog.md` in the product-management repo.

---

## 1. How Snappfood models a menu

| Thing | Food Partner panel | API (annex 4.3.0) |
| --- | --- | --- |
| Category | Title and a **display time** ("full time" or custom start and end hours). Snappfood suggests category names. New categories are **reviewed by Snappfood staff** before they show. Ramadan adds a "sahar to iftar" menu. | `menu`: `id` (our integer), `orderIndex`, `title`, `active` |
| Category order | Drag to reorder ("ترتیب دسته‌بندی‌ها") | `orderIndex` |
| Product | Name (≤ 64 chars), description (≤ 256 chars, with a Snappfood-suggested text), photo, one category. New products are reviewed by Snappfood staff (about 6 hours). | `productId` (our integer, ≤ 10 digits), `title`, `description`, `vat`, `containerPrice`, `schedules`, `position` |
| Product order | Drag within a category ("ترتیب محصولات") | `position` |
| Sizes / types | "قیمت و انواع": one price, or several **types** ("نوع اول", "نوع دوم"…), each with a title and its own price. Types are used for sizes (75 g / 150 g) and for **flavours** (latte classic / caramel / vanilla). | Each type is a separate product row with its own `productId` and price, grouped by `productTitle` |
| Price rules | Price 1,000 Toman up to 10–20 million Toman. A warning on every price field says the Snappfood price **must equal the in-store price and other channels' prices**, or the contract fines the vendor. | `price`, whole Toman |
| Add-on groups | The product's add-ons page lists **every** group of the vendor, each topping with its own on/off switch **for this product**. Editing a group: title, toppings (name and price), "selection limit" min and max. | `toppingGroup` with min, max and position; toppings with `id` (our integer, never equal to a product ID), `price` and `containerPrice`; linked one topping at a time to a product (`add-to-product`) |
| Packaging | This vendor models packaging as a **required add-on group** ("بسته بندی": min 1, max 1: sandwich pack or drink pack). The panel caps a packaging price at 50,000 Toman. | `containerPrice` on products and toppings; `packingPrice` on the order |
| Extras | Also sold as products in their own "اضافات" category (sauces, syrup shots), often with types | Plain products |
| On/off | Product **active / inactive**, separate from stock | `active` (stays off until turned back on) |
| Stock status | For each type: **Available**, **Unavailable until next shift** (comes back by itself), **Unavailable until further notice** | `disable` + optional `disableUntil` (without a date it comes back tomorrow) |
| Daily stock | "تعیین موجودی <date>": a count for each type, **today only**. A blank count means unlimited. The panel warns that wrong stock costs the vendor rating points. | `stock`, `capacity` (most per order) |
| Review status | Each photo, product and category is in review, approved or rejected (with a reason, e.g. "low quality and blurry") | `isReviewed` |
| Filters | Has a photo or not; stock status; review status | — |
| Branches | Each branch is its own vendor with its own menu; the header picks the vendor | `vendorCode` on every call |

## 2. How ours compares

### Data

| Topic | Ours | Fit |
| --- | --- | --- |
| IDs | UUIDs | **Gap (blocks V3).** Snappfood needs a stable integer ID for each category, each sellable type and each add-on choice, all in our own numbering. |
| Category | code (required), name, order, on/off, `image_asset_id` (no screen) | OK. Snappfood has no code; ours stays internal. No display hours. |
| Product order | Sorted by name; no order field | **Gap.** Snappfood and the till both need a set order. |
| Sizes | `product_variant` (name, price, default, order) | Can be mapped: one Snappfood row per size. The default size is ours only. |
| Add-on groups | min / max / required, ask at POS, category inheritance, default choice, combo slot pointing at a product, per-product excluded choices | Can be mapped: Snappfood's per-topping links = our link minus excluded choices. Default, ask-at-POS and combo slot stay on our side. |
| Packaging | Packaging price removed 2026-10-11 | Fine **if** packaging is a required add-on group, which is what this vendor does already. No new field needed. |
| Most per order | `max_per_order` (labelled V4) | = `capacity` |
| Tax | `tax_rate` | = `vat` |
| Photos | Main photo plus gallery | OK. Snappfood's review status isn't stored (V3). |
| Off menu / stop | `is_active`; stops: available or until further notice; stops per size and per add-on already work in the backend; Snappfood-only stops (V3) | Close. Missing: **"until next shift"**, which comes back by itself (a `suspended_until` column exists but the screens dropped durations on 2026-10-10). |
| Daily stock | Removed 2026-10-11 (S-11) | Gap, but a decided removal |
| Selling hours | Removed | Gap, but a decided removal |
| Prices | Rial; Snappfood price sheet = markup % with rounding, fixed prices per item, "fake" shown discount | **Conflicts with Snappfood's price-parity rule** (see S8) |
| Inbound order lines | The webhook reads a non-standard `product_id` UUID, falls back to a placeholder product and **drops `toppings[]`** | **Gap (blocks V3).** |
| Catalog sync | Simulator endpoints return hard-coded samples; "catalog sync" only writes a log entry | Nothing maps our menu to Snappfood's yet |

### Screens

| Screen | Ours | Food Partner |
| --- | --- | --- |
| Product list | Table: photo, name, code, category, price, sizes count, tax, on/off switch, edit / archive | One card per product listing each type with its price and switch; category tabs; search; filters; "+ New product" floating button |
| New product | One drawer: category, name, type (standard / combo), price, tax, photo, code, barcode | 6-step wizard: info → types → price → photo → category (pick, or create one with display hours) → review |
| Product page | 4 tabs: General / Sizes (table + dialog) / Add-ons (attached groups only) / Price history | One scrolling page: photo → info → category → **price and types inline** → **stock per type** → add-ons → one Save button |
| Add-ons on a product | Attach dialog to pick a group; detach; reorder | Every group listed; a switch per topping |
| Add-on group | One sheet: name, rule, ask at POS, choices (name, price, default, combo product), used on categories / products | Title, toppings (name, price), min / max |
| Category order | Up / down arrows | Drag |
| Stock | Separate Availability page: 2 states, scope by branch, Snappfood-only option | On the product page: 3 states for each type; daily counts on their own page |
| Words (fa) | "سایزها", "اندازه‌ها", "تنوع محصول و اندازه‌ها (Variants)", "در منو / خارج از منو", "کاتالوگ" | "انواع / تنوع", "موجود / ناموجود", "فعال / غیرفعال", "محصولات" |

What we do better, and should keep: one sheet for an add-on group with category inheritance;
ask-at-POS; code and barcode; branch scope; the Snappfood-only stop.

## 3. Findings

- **S1 — No integer IDs.** Snappfood keys categories, products/types and toppings by our own
  integers. Toppings share the number space with products. *(V3 blocker)*
- **S2 — Inbound lines lose items and add-ons.** The webhook matches lines by a non-standard
  UUID and drops `toppings[]`, so add-ons never reach the order or the chit. *(V3 blocker)*
- **S3 — No way to match an existing Snappfood menu.** Every pilot restaurant already has a
  Snappfood menu. Onboarding needs "read Snappfood menu → match to ours → save the sync codes"
  (`GET /va/v1.1/product`, `category/sync`, `product/sync`). *(V3)*
- **S4 — No product order.** Products are sorted by name on the till and in lists. Snappfood
  (and staff used to it) set the order by hand.
- **S5 — Words differ from Food Partner.** Three names for sizes; "on/off menu" vs Snappfood's
  active/inactive and available/unavailable. Snappfood's "انواع" also covers flavours, which
  "size" doesn't.
- **S6 — The product page is split into tabs**, and stock lives on another page. Food Partner
  puts everything on one scrolling page with stock per type.
- **S7 — Add-ons on a product only show attached groups.** Food Partner lists every group with a
  switch per choice. Our backend already stores the same thing (link + excluded choices).
- **S8 — Price parity.** Food Partner warns that Snappfood prices must equal in-store prices,
  under contract penalty. Our Snappfood price sheet is built around a markup. It is a policy
  question, not a bug: many vendors do mark up, but the tool shouldn't encourage breaking the
  contract silently.
- **S9 — No "until next shift" stop.** Snappfood's everyday stop comes back by itself. Ours never
  does (decided 2026-10-10).
- **S10 — Packaging.** Snappfood vendors already model packaging as a required add-on group.
  Ours can do the same with no new field, so the removal on 2026-10-11 still holds.
- **S11 — Removed features Snappfood has:** daily stock counts, selling hours (category display
  time, product schedules, Ramadan menu). Both removals were decided (S-10/S-11). Listed only so
  the V3 adapter knows to send "unlimited" and "full time".
- **S12 — Field limits.** Snappfood: name ≤ 64, description ≤ 256, price 1,000 Toman to about
  15 million Toman. Ours: name ≤ 160, no description limit. A longer name would be refused on
  push.

## 4. Plan

Ordered by dependency. Cost = tokens; risk = chance of breaking something that works now.

| # | Task | Findings | Cost | Risk | Impact | When |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Use Food Partner's words in fa (and en): "انواع" for sizes everywhere, "موجود / ناموجود", "فعال / غیرفعال", "محصولات" | S5 | Low | Low | Medium | Now |
| 2 | Product order inside a category: `sort_order` on product, arrows or drag on the products list (filtered by category); the till, the kiosk and the Snappfood price sheet read it | S4 | Medium | Low–Med (three places sort products) | High | Now |
| 3 | Stop per type on the product page and the Availability page (the backend already accepts `variant_id`) | S6 | Low | Low | Medium | Now |
| 4 | Product page as one scrolling page in Food Partner's order: photo → info → category → price and types inline → stock per type → add-ons; one Save. Price history moves to a link. | S6 | Medium | Medium (962-line page) | High | Now |
| 5 | Product add-ons like Food Partner: every group listed, a switch per choice (writes the link + `excluded_item_ids`); keep "inherited from category" | S7 | Medium | Low–Med | Medium | Now |
| 6 | Seed and doc: packaging as a required add-on group in the demo menu (non-prompting, so the POS still rings through) | S10 | Low | Low | Low | Now, if wanted |
| 7 | "Unavailable until next shift" = until the next business-day cutoff, comes back by itself | S9 | Low–Med | Low | High for Iran staff | **PM call** (reverses 2026-10-10) |
| 8 | Price sheet: default markup 0, with Food Partner's parity warning shown on the sheet | S8 | Low | Low | Medium | **PM call** |
| 9 | Integer `channel_id` on category, product (no types), variant and add-on choice; one sequence shared by products and add-ons | S1 | Medium | Medium (migration on every catalog table) | V3 blocker | V3 |
| 10 | Inbound lines: match by integer ID, map `toppings[]` to order item options, flag unknown lines | S2 | Medium | Medium | V3 blocker | V3 |
| 11 | "Match Snappfood menu" screen: read their menu, auto-match by name, confirm, save sync codes | S3 | High | Medium | High for onboarding | V3 |
| 12 | Push adapter: menu, product, topping, toggle and price calls; review status shown back | S1, S11, S12 | Very high | High | V3 core | V3 |
| 13 | Snappfood limits checked on push (name ≤ 64, description ≤ 256, price range) | S12 | Low | Low | Low | V3, with 12 |

**Recommended cut line: items 1–5.** They make the screens read like Food Partner and fill the
two data gaps worth having before V3 (product order, stop per type). Most of the cost is in
items 2 and 4. Trap in 2: products are sorted in three places, each its own way
(`catalog.service` getProducts by name for the till, `kiosk.service` by name, the Snappfood
price sheet by code). All three have to change together, or the till and the kiosk will
disagree.
Items 7 and 8 are your decisions. Items 9–13 belong to the V3 Snappfood build. Item 9 can go
early if you want IDs fixed before the menu grows, since adding them later means a backfill.

## 5. Questions for the PM

1. **"Until next shift" (item 7):** add Snappfood's self-clearing stop back, timed to the
   business-day cutoff? It reverses the 2026-10-10 decision that a stop never clears itself.
2. **Price parity (item 8):** Snappfood's contract wants the same price as in-store. Keep the
   markup sheet as it is, default it to 0 with a warning, or remove the markup?
3. **Types vs add-ons for flavours:** Food Partner vendors use types for flavours (latte
   classic / caramel). Fine for us too (sizes are just named types), or should flavours be a
   required add-on group?
4. **Wizard vs one form for a new product:** Food Partner's 6-step wizard suits a phone. Our
   head office works on a desktop. Recommendation: keep one form, in Food Partner's section
   order.
