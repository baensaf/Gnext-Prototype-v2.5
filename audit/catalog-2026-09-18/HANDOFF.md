# Handoff: catalog and pricing work after 2026-09-18

Read `CATALOG-AUDIT.md` in this folder first. It has the findings (C1–C12), the gap tables
and the plan (items 1–15). This file covers what has shipped since the audit, what the user
decided, and what to build next.

## Shipped

| PR | What |
|---|---|
| #53 | The audit itself |
| #54 | Plan items 1–4. **Kiosk**: `KioskService.priceKioskLines` checks and prices the whole basket before saving anything, through `CatalogService.assertBasketSellable` (86 on product, size or add-on, selling windows, daily stock, per-order cap, combo dishes). It needs a size when the product has any, applies VAT at `product.tax_rate`, and `bootstrap` returns `variants` and `is_available`. **Register**: `checkOptionChoices` (`catalog/option-choices.util.ts`) enforces required add-ons and group min/max on every product, not only combos. `VARIANT_REQUIRED`, `PRODUCT_INACTIVE`. The POS offers only the product's attached groups and refreshes 86s every 60 s. **Chain-wide stops** show in branch lists; a branch trying to lift one gets `CHAIN_WIDE_STOP`. |
| this PR | Batch 2 of the pricing work, **the Snappfood price sheet**. The `CHANNEL_PRICING` setting holds `{ SNAPPFOOD: { markup_percent, round_to } }`. `common/utils/channel-price.util.ts` applies the markup and rounds up. `GET/PUT /api/v1/catalog/channel-prices` return the sheet and set or clear a fixed price per item or size (stored as a `price_entry` row with `channel='SNAPPFOOD'`, no branch or group). The page is `/app/pricing/snappfood` ("Snappfood Prices" in the nav). |

## User decisions (2026-09-18)

- Pilots **do** sell at different prices per branch and on Snappfood, so pricing work is in scope.
- **Snappfood:** a markup % with rounding, plus a fixed price per item where needed (built as batch 2).
- **Branches:** a few shared **price lists** (tiers) assigned to branches, with item prices inside each list. A one-off branch gets a list of its own. Branches with no list use the base (HQ) price.
- **Price order:** the branch's list price, else the base price, is the in-store price. On Snappfood, an item's fixed Snappfood price wins, otherwise the markup applies to that in-store price. The markup is chain-wide; per-list markup overrides are optional and later.
- **It's a prototype.** The real Gnext will sync prices to Snappfood. Here the Snappfood price is a reference sheet: Snappfood orders keep the prices Snappfood charged (`simulation.service.ts` `snappfoodLines`), so don't make the order path use the sheet.
- **86 from the POS:** yes. Suggested permissions: any POS user can 86 "until next shift" with a reason picked from a list. "Until further notice", putting an item back on sale, and HQ's chain-wide stops need a manager or the approver PIN (see memory: 2468 authorises). Stops are logged.

## Next: batch 1, branch price lists (plan item 10, high risk)

The goal is that the price charged at a branch comes from its price list.

1. **Data.** Reuse `price_group` (the list), `price_group_branch` (a unique branch→list assignment) and `price_entry` (`price_group_id` + `product_id` + optional `variant_id`, with `effective_from`/`effective_to`). `price_group_item` is legacy and write-only; move its rows into `price_entry` or drop it. `PricingService.assignBranchToPriceGroup` exists but has no endpoint.
2. **One resolver.** Write a small `resolveInStorePrice(tenant, branchId, productId, variantId, at)` that returns the list entry live at `at`, else `variant.base_price`, else `product.base_price`. Don't route it through `PricingService.resolvePrice`: its 12-level scoring mixes branch, group and channel and doesn't handle variants well. Add-on deltas stay as they are.
3. **Use it everywhere money is decided.** `order.service.ts` `addItemsToDraft` (where the price is set near the variant lookup), `kiosk.service.ts` `priceKioskLines`, and `catalog.service.ts` `getChannelPriceSheet` (so the Snappfood rule applies to the branch's price; take a `branchId` param). **Stop trusting client `unit_price`** in `addItemsToDraft` (audit C9); only the Snappfood simulator writes its own lines, and it doesn't go through here.
4. **Show the same price.** The POS grid and cart compute prices client-side (`starter-vite-ts/src/pages/pos/order.tsx`, `addToCart` and the grid tile), and so does the kiosk (`kiosk.tsx`). Add an endpoint that returns resolved prices for a branch (for example `GET /catalog/prices?branchId=`, returning `{product_id, variant_id, price}`) and use it in both. Otherwise the grid shows one price and the order charges another.
5. **Fix `PricingService.bulkCommit` before anything writes `price_entry` for real** (audit C5). It closes every open entry for the product across branches, lists, variants and channels. Scope the close to the same `price_group_id`/`branch_id`/`variant_id`/`channel`.
6. **Screens.** Replace `pages/catalog/pricing.tsx` (English-only, "Slice 5" copy, overrides never read back) with: a list of price lists, branch assignment, and an item×list grid of price inputs that fall back to base. Hide Menus Composer (`/app/catalog/menus`), because nothing reads menus.
7. **Tests.** A unit test for the resolver, and a postgres test that places an order at a branch on a list and checks the line price.

## Then: batch 3, dated price changes and history

- A bulk change ("+10% from Saturday") on base or on a list, with a preview (`PricingService.bulkPreview` exists) that writes `price_entry` rows with `effective_from`. Base prices live on `product` and `variant`, so either write dated entries for base too (resolver already handles them) or run a job that copies them at the date. Dated entries are simpler.
- Price history on the product page, from `price_entry` rows plus audit log `PRODUCT_UPDATED` before/after on `base_price`.

## Other open items from the audit

In rough priority order (details in `CATALOG-AUDIT.md`):
- **86 from the POS tile:** a long-press menu, preset reasons, and PIN rules as decided above.
- **Channel-specific 86** ("stop on Snappfood only"): the `product_availability.channel` column exists but is unused.
- **Categories:** edit, reorder and nesting (the UI only creates and deletes), and block archiving a category that still has products (C12).
- **Products list:** search, thumbnail, status, variant count. Product page: format Rial without `.0000`, and show tax as % instead of `0.0900`.
- **Stock:** daily stock can oversell under concurrency (C11), and sold-out-by-stock isn't shown on the availability page.
- **Kiosk:** it picks one add-on per group only (a map keyed by group), so groups with max > 1 can't take more than one choice there.

## Working notes

- One worktree per task, and PRs only (see `CLAUDE.md`). The main checkout's `backend/node_modules` is missing `ws`, so a junctioned backend fails typecheck and the postgres tests. Run `npm ci --legacy-peer-deps` in the worktree's `backend`. Junctioning the frontend is fine.
- The local Postgres runs in docker (`gnext-postgres`, port 5432), and the full jest suite runs against it.
- `en.json` and `fa.json` must keep identical keys.
