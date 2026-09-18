# Catalog audit: products, categories, variants, prices, 86 and availability

2026-09-18, against `origin/main` at `ba32010` (the Snappfood-parity catalog commit).
It covers both sides of the chain: HQ builds the menu and branches run service. The floor
is the Phase 1 HAMI scope (§3 Catalog, §4 Pricing), and the ceiling is common POS practice
(Snappfood vendor panel, Toast, Square, Sepidar).

Method: I read the catalog, pricing, order and kiosk code, then walked every catalog
screen on gnextdev.ir read-only (no data changed). Findings marked **code-read** have not
been reproduced at runtime. Per the scope rule, reproduce them before fixing.

---

## 1. Verdict

The **availability side is in good shape** after today's commit. It has 86 until the next
shift or until further notice, stops on a single variant or add-on, daily stock, selling
windows and a per-order cap. The **pricing side mostly doesn't work**: price groups,
branch prices, channel prices, effective dates, menu override prices and the bulk update
all write data that nothing reads when an order is priced. The **kiosk** bypasses every
availability rule. Several screens (categories, pricing, menus) are thin or leftover
scaffolding.

The HAMI coverage pass (`audit/hami-replacement-2026-09-16/PASS-A-COVERAGE.md` §4) marks
Pricing **Built**. It should read **Partial**: the tables and endpoints exist, but they
aren't connected to orders.

### What actually decides the price of a line today

```
order line price = variant.base_price            (if a variant is chosen)
                 | request.unit_price            (if the caller sent one)
                 | product.base_price
                 + Σ option_item.price_delta
```

`order.service.ts:1736`. `PricingService.resolvePrice` is called only by
`GET /products/:id/effective-price` (which no screen uses) and by the bulk preview.

| Data | Written by | Read when pricing an order? |
|---|---|---|
| `product.base_price`, `product_variant.base_price`, `option_item.price_delta` | Product page, import | **Yes** |
| `price_entry` (branch / group / channel / order-type / dated) | Bulk update only | No |
| `price_group_item.override_price` | Pricing page "Save override" | No (not read anywhere) |
| `price_group_branch` | Nothing (`assignBranchToPriceGroup` has no endpoint) | No |
| `menu_product.override_price`, `menu`, `menu_category` | Menus composer | No (POS, kiosk and Snappfood never read menus) |

---

## 2. Correctness findings (ranked)

| # | Finding | Where | Severity | Status |
|---|---|---|---|---|
| C1 | **Price books don't reach orders.** The bulk update says "N prices updated" and nothing changes at the register. Group overrides, branch and channel prices, and effective dates behave the same way (table above). | `pricing.service.ts`, `order.service.ts:1736` | High (misleading) | code-read, high confidence |
| C2 | **Kiosk skips every availability rule.** `createKioskOrder` prices and saves lines itself and never checks the 86, selling windows, daily stock, per-order cap, add-ons excluded from a product, add-on stops or add-on min/max. It has no variants, and it charges a flat 9% tax (`MoneyUtil.multiply(lineTotal,'1.09')`) instead of `product.tax_rate`. The kiosk menu (`bootstrap`) also lists 86'd items. The comment at `order.service.ts:1699` says the kiosk goes through `addItemsToDraft`, but it doesn't. | `kiosk.service.ts:255-300`, `:59-110` | High | code-read |
| C3 | **Stopping every variant doesn't stop the product.** When all variants are 86'd or sold out, the POS adds the product with no variant at `product.base_price` (`order.tsx:446-452`). The server's `getSuspension(variantId=null)` ignores variant-level rows (`catalog.service.ts:791`), so the sale goes through. The same happens when every variant has its own stock count at zero. | POS + server | High | code-read |
| C4 | **Required add-ons are enforced only on combos.** `checkComboChoices` runs only when `product_type === 'COMBO'`, on both the server (`order.service.ts:1748`) and the POS (`order.tsx:500`). A standard product with a required group (bread type, doneness) can be sold without a choice. On standard products the server also doesn't check that a chosen add-on belongs to one of the product's groups, and the add-on lookup has no `tenant_id` (`order.service.ts:1745`). | order.service | Medium-High | code-read |
| C5 | **Bulk commit ends too many prices.** It closes *every* open `price_entry` for the product, including other branches, groups, variants and channels (`pricing.service.ts:281-288`). This is harmless today because of C1, but it's a trap once pricing is wired up. The pricing page also sends the selected price group without saying so, so "all categories" adjusts that group rather than base prices. | pricing | Medium (latent) | code-read |
| C6 | **The POS loads the 86 list once and never refreshes it** (`order.tsx:290`). Stock and selling windows refresh every 60 s, but an 86 set on the availability page or another register doesn't grey the tile until the page reloads. The server still refuses the line, so the cashier finds out from an error. | POS | Medium | code-read |
| C7 | **Chain-wide stops get lost on the branch filter.** With a branch, `getAvailabilities` matches `branch_id = X`, so chain-wide stops (`branch_id NULL`) aren't returned and the POS doesn't grey them. For HQ with no branch it returns every branch's stops, so an item 86'd at one branch greys out everywhere. | `catalog.service.ts:900` | Low | code-read |
| C8 | **Variant price is a copy, not a delta.** Changing the product's base price doesn't update its variants, and the default variant duplicates the product price (Cheeseburger 150,000 / Single Patty 150,000 on screen). Import and bulk update ignore variant and add-on prices. | catalog | Medium (price drift) | seen on screen |
| C9 | **The order API trusts `unit_price` sent by the client** for lines without a variant (`order.service.ts:1738`). The POS doesn't send it; the aggregator simulator does. Any cashier token could set a price. | order | Low for a prototype | code-read |
| C10 | **Inactive products can be sold.** The POS lists them and `addItemsToDraft` doesn't check `is_active`. The kiosk does filter them out. | POS + order | Low | code-read |
| C11 | **Daily stock can oversell.** The check-then-insert has no lock, so two registers can both sell the last unit. | `assertLineSellable` | Low | code-read |
| C12 | **Archiving a category leaves its products behind.** They lose their POS tab but stay orderable on other channels. There's no guard or "move products" step. | `archiveCategory` | Low | code-read |

---

## 3. Feature gaps

### Against the HAMI scope (§3, §4)

| HAMI item | State |
|---|---|
| Categories | Create and delete only. No rename, reorder, nesting (the `parent_id` column exists) or image in the UI |
| Products, variants, images, descriptions, tax, combos | Built |
| Modifier min/max | Built, enforced on combos only (C4) |
| Packaging charges | Stored per product, not billed (known) |
| Branch availability | Built (86 per branch, stock per branch) |
| **Channel-specific availability** | **Missing.** `product_availability.channel` exists and nothing uses it. There's no way to stop Snappfood only when the kitchen is slammed. |
| Scheduled availability | Built (selling windows) |
| Temporary suspension | Built (next shift, until further notice, hours) |
| Import/export | Products and base price only. No variants, add-ons or prices per branch |
| **Base prices** | Built |
| **Branch prices, price groups, channel prices, delivery prices, effective dates** | **Data only, not wired (C1)** |
| Modifier prices | Built (`price_delta`), same across products (no per-product add-on price) |
| **Bulk price updates** | **Doesn't work (C1).** Import does work as a bulk price path. |
| **Price audit history** | Only in the raw audit log (`PRODUCT_UPDATED` before and after). No price-history view |

### Against market POS

- **86 from the POS tile** (long-press, then "86 until next shift"). Today it's a separate admin page, which is fine for a manager but slow mid-service.
- **Preset 86 reasons** (sold out / equipment down / ingredient missing) plus a **lost-sales report**: who 86'd what and for how long, and orders refused because of it.
- **HQ "86 at all branches"**, and **86 by category** ("grill is down").
- **Stock that stops the item visibly.** When a daily count hits 0, the availability page doesn't show it as off. The two pages don't talk to each other.
- **Scheduled price change** ("new prices from Saturday") with a preview and an undo. This is the most common real price workflow in Iran with inflation, and it's more useful than price groups.
- **Channel markup**: Snappfood price = base + x%. Common in Iran, where vendors price higher on aggregators.
- Add-on quantity (extra cheese ×2), per-product add-on price, and nested add-ons.
- Product duplication, product sort order on the POS (it currently sorts by code), and POS tile colour.
- Later: cost and margin (menu engineering), allergens and calories (Snappfood shows them).

---

## 4. UI/UX by screen (as seen on gnextdev.ir)

**Products list**: no search (the API supports `search`), no thumbnails, no variant count or price range, no on-sale status. It leads with the internal code column. Rows have two icons whose meaning isn't clear (tune = attach add-on, pencil = edit). The archive action is a red trash icon. There are no bulk actions (move category, 86, archive).

**Product detail**: good structure (Basics / Variants / Add-ons tabs, a price-in-words helper, an on-sale card linking to availability). The price field shows `150000.0000`; Rial has no decimals. Tax is edited as the fraction `0.0900` while the list shows `9%`. The required Code field comes before Name. The category select truncates.

**Variants tab**: clear, with a default star. Variants are priced as absolutes with no hint that the product price is separate (C8). There's no per-variant on/off switch other than delete.

**Categories**: no edit or rename at all, only delete. No product counts, no drag reorder, no parent.

**Modifiers & Options**: an empty tenant gets a blank page with no empty state or call to action.

**Menus Composer**: it's the **Catalog landing page**, and it has no effect anywhere (see §1). A new user starts here and builds a menu that nothing uses.

**Availability & 86**: the best screen in the area. It follows Snappfood's model with variant rows, search and category tabs, and a clear three-way dialog. Gaps: the reason is free text only, HQ can't act on several branches at once, sold-out-by-stock isn't shown, and when scrolling the page content shows through the translucent top bar.

**Today's Stock**: clear. Sold and remaining counts only appear after a count is saved, and there's no "copy yesterday's counts".

**Price Book & Bulk Updates**: English-only inside the Persian UI, with developer copy ("Slice 5 — Multi-level pricing rules…"). Override inputs never show the saved override (there's no read endpoint for group items). The bulk dialog has no preview, although `bulkPreview` exists. There's no branch-to-group assignment and no effective date. The success message claims updates that don't take effect (C1).

---

## 5. Information architecture

**Today**, under Business Management: *Catalog* → Menus Composer (landing), Products, Categories, Modifiers, Availability & Suspensions, Today's Stock. A separate top-level item, *Price Book & Groups*.

Problems:
1. The build-once HQ screens and the every-shift branch screens are mixed in one group. A branch manager has to open "Catalog", which is mostly HQ-only, to 86 an item.
2. It lands on a screen that does nothing.
3. Prices live in three places: the product page, variant rows, and the price book. Only the first two are real.
4. Selling windows (HQ-only writes) sit at the bottom of the branch's 86 page.

**Proposed**

```
Operations (branch, every shift)
  ├─ On sale today     ← today's 86 board + stock count merged: one row per item/variant,
  │                      status = on / 86'd until… / sold out (n left)
  └─ (POS tile long-press → 86)

Menu (HQ, build)
  ├─ Products          ← landing; search, thumbnails, status, bulk actions
  │    └─ product: Basics | Variants & prices | Add-ons | When it sells (windows, per-branch status) | History
  ├─ Categories        ← edit, reorder, nest
  ├─ Add-ons
  └─ Prices            ← one grid: product/variant × (base | branch | Snappfood), scheduled changes, history
```

Hide Menus Composer and price groups until they're wired up. Don't delete them; the data model is sound.

---

## 6. Recommended plan

Ordered by dependency, with cost, risk and impact. **Demo** marks what a demo would hit.

| # | Task | Token cost | Risk | Impact | Demo? |
|---|---|---|---|---|---|
| 1 | Kiosk orders go through the shared line checks: 86, windows, stock, cap, add-ons, required choices, product tax. Hide 86'd items in `bootstrap` | Med | Med: kiosk has its own order and payment flow | High | Yes |
| 2 | Treat "all variants stopped or sold out" as the product being off, on server and POS. Require a variant when a product has any | Low | Low | High | Yes |
| 3 | Enforce required add-ons and add-on membership on all products, on server and POS (generalise `checkComboChoices`); add `tenant_id` to the add-on lookup | Low | **Med: the Snappfood simulator and some tests send lines with no options, so check them first** | High | Yes |
| 4 | POS refreshes the 86 list with stock and windows (60 s); include chain-wide stops; scope HQ to the selected branch | Low | Low | Med | Yes |
| 5 | Make pricing honest: bulk update writes `product` and `variant.base_price` directly (with preview and confirm, variants and add-ons optional); hide price groups, menu override and Menus Composer | Low-Med | Low | High | Yes |
| 6 | Pricing page: i18n, drop developer copy, formatting; product page: Rial formatting, tax as % | Low | Low | Med | Yes |
| 7 | Categories: edit, reorder, product count, block archiving a category that still has products | Low | Low | Med | — |
| 8 | Products list: search, thumbnail, status, variant count | Low | Low | Med | — |
| 9 | Price history on the product page (from the audit log) | Low | Low | Med | — |
| — | **Recommended cut line** | | | | |
| 10 | Wire `resolvePrice` into order pricing and every price display (POS grid, kiosk, quote, Snappfood simulator, reports): branch and channel prices, effective dates | **High** | **High: touches every money path; fix C5 first** | High only if a pilot runs different prices per branch or channel | — |
| 11 | Scheduled price change ("from Saturday") | Med | Med (needs 10, or a simpler scheduled job on base prices) | High for the Iranian market | — |
| 12 | Channel-specific 86 (Snappfood only) | Med | Med | Med | — |
| 13 | 86 from a POS tile, preset reasons, HQ multi-branch 86, lost-sales report | Med | Low | Med | — |
| 14 | IA restructure (§5) | Med | Low | Med | — |
| 15 | Add-on quantities, per-product add-on price, cost and margin, allergens | High | Med | Low now | — |

Most of the cost sits in **item 10**. Before building it, decide whether any pilot actually
needs different prices per branch or channel. If not, items 5 and 11 (bulk and scheduled
changes to base prices) cover the real workflow at a fraction of the cost.

**Traps**
- Wiring `resolvePrice` (10) changes every price shown and charged. The POS cart computes its own prices (`order.tsx:463`), so the grid and the server would disagree until both are changed.
- `bulkCommit` ends every open entry for the product (C5). Fix it before anything writes to `price_entry` for real.
- Variant prices are absolute (C8). A "+10%" bulk update that skips variants leaves the variants of the best-selling items at the old price.
- Requiring add-on choices (3) can break simulator orders and existing tests. Grep `backend/test` for orders on products with required groups first.
- Stock is counted per variant (`soldOn`). A product-level count and per-variant counts together must not double-block.

## 7. Questions before building

1. Does any pilot branch sell at a different price from HQ, or charge more on Snappfood? This decides item 10.
2. Is the kiosk in the demo? If not, item 1 can move below the cut line.
3. Should branch managers be able to 86 straight from the POS, or only managers on the admin page?
