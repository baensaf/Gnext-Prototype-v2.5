# Handoff: catalog and pricing work after 2026-09-18

Read `CATALOG-AUDIT.md` in this folder first. It has the findings (C1–C12), the gap tables
and the plan (items 1–15). This file covers what has shipped since the audit, what the user
decided, and what is still open.

## Shipped

| PR | What |
|---|---|
| #53 | The audit itself |
| #54 | Plan items 1–4. **Kiosk**: `KioskService.priceKioskLines` checks and prices the whole basket before saving anything, through `CatalogService.assertBasketSellable` (86 on product, size or add-on, selling windows, daily stock, per-order cap, combo dishes). It needs a size when the product has any, applies VAT at `product.tax_rate`, and `bootstrap` returns `variants` and `is_available`. **Register**: `checkOptionChoices` (`catalog/option-choices.util.ts`) enforces required add-ons and group min/max on every product, not only combos. `VARIANT_REQUIRED`, `PRODUCT_INACTIVE`. The POS offers only the product's attached groups and refreshes 86s every 60 s. **Chain-wide stops** show in branch lists; a branch trying to lift one gets `CHAIN_WIDE_STOP`. |
| #55 | Batch 2, **the Snappfood price sheet**. The `CHANNEL_PRICING` setting holds `{ SNAPPFOOD: { markup_percent, round_to } }`. `common/utils/channel-price.util.ts` applies the markup and rounds up. `GET/PUT /api/v1/catalog/channel-prices` return the sheet and set or clear a fixed price per item or size (a `price_entry` row with `channel='SNAPPFOOD'`, no branch or group). Page: `/app/pricing/snappfood`. |
| #56 | Batch 1 (plan item 10), **branch price lists**. `PriceListService.resolveInStorePrice` is the one resolver: the branch list's `price_entry` live now, else the size's base price, else the product's. It prices register lines (`addItemsToDraft`, which no longer trusts client `unit_price`, audit C9), kiosk lines and the Snappfood sheet (which takes a `branchId`). `GET /catalog/prices?branchId=` gives the POS the same prices; the kiosk bootstrap carries `price` per product and size. Lists: `GET/POST/PATCH/DELETE /catalog/price-lists`, `GET/PUT /catalog/price-lists/:id/prices`, `PUT /catalog/branch-price-list`. Setting a price closes the old row rather than deleting it. `bulkCommit` scoped (audit C5). Migration 062 moved `price_group_item` into `price_entry` and dropped it. Page: **Branch Prices**, `/app/pricing/price-lists` (the old Price Book URLs redirect). Menus Composer is off the nav; its route stays. |
| #57 | Batch 3, **dated price changes and price history**. `PriceChangeService`: "+10% from Saturday" on base prices or one list, by percent or amount, rounded up, one category or all, previewed item by item. A change is a `price_bulk_job`; its prices are `price_entry` rows with `bulk_job_id`, starting on its date; the row they replace ends then. A change that has not started can be cancelled (rows deleted, replaced rows restored). Base prices can be dated: the resolver reads base rows (no list, branch, channel, order type or add-on; list rows still win), and a 60 s sweep copies a started base price into `product`/`product_variant.base_price` so every other reader agrees. A base price typed on the product page ends the dated base row in force. `GET /products/:id/price-history`: dated rows plus product-page edits from the audit log. The old `catalog/prices/bulk-update` and `PricingService.bulkPreview/bulkCommit` are gone; migration 063 closed the base rows they wrote. Pages: **Price Changes**, `/app/pricing/changes`; a **Price history** tab on the product page. |
| #58 | **86 from the POS tile.** Long-press, right-click or the tile's stop button opens `PosStopDialog` (`pages/pos/pos-stop-dialog.tsx`): whole product or one size, a preset reason (sold out, ingredient missing, equipment down, quality, other), until the next shift or until further notice; an item already off shows why and offers "Put back on sale". The rules live in `POST availability/pos-stop` and `POST availability/pos-resume` (open to any register user, listed in `chain-config-authority.spec.ts`): until the next shift needs only a reason; until further notice and putting back need an approver role or an approver's PIN (`ApprovalService.authorizeMoneyOut`: same lookup, branch scope and rate limit as refunds). Stops and resumes are audited with `actor_id`, branch, approver and source. Also fixed `cashier-shift.spec.ts`, which failed on CI every night from 20:30 to midnight UTC. |

## User decisions (2026-09-18)

- Pilots **do** sell at different prices per branch and on Snappfood, so pricing work is in scope.
- **Snappfood:** a markup % with rounding, plus a fixed price per item where needed.
- **Branches:** a few shared **price lists** (tiers) assigned to branches, with item prices inside each list. A one-off branch gets a list of its own. Branches with no list use the base (HQ) price.
- **Price order:** the branch's list price, else the base price, is the in-store price. On Snappfood, an item's fixed Snappfood price wins, otherwise the markup applies to that in-store price. The markup is chain-wide; per-list markup overrides are optional and later.
- **It's a prototype.** The real Gnext will sync prices to Snappfood. Here the Snappfood price is a reference sheet: Snappfood orders keep the prices Snappfood charged (`simulation.service.ts` `snappfoodLines`), so don't make the order path use the sheet.
- **86 from the POS:** any POS user can 86 "until next shift" with a reason picked from a list. "Until further notice", putting an item back on sale, and HQ's chain-wide stops need a manager or the approver PIN. Stops are logged. (Built in #58.)

## Still open

In rough priority order (details in `CATALOG-AUDIT.md`):
- **Channel-specific 86** ("stop on Snappfood only"): the `product_availability.channel` column exists but is unused.
- **Categories:** edit, reorder and nesting (the UI only creates and deletes), and block archiving a category that still has products (C12).
- **Products list:** search, thumbnail, status, variant count. Product page: format Rial without `.0000`, and show tax as % instead of `0.0900`.
- **Stock:** daily stock can oversell under concurrency (C11), and sold-out-by-stock isn't shown on the availability page.
- **Kiosk:** it picks one add-on per group only (a map keyed by group), so groups with max > 1 can't take more than one choice there.
- **Pricing leftovers:** add-on prices (`price_delta`) are not part of price changes; `GET /products/:id/effective-price` still uses the old `PricingService.resolvePrice` (no screen calls it); `branch.price_group_id` is unused (assignment is `price_group_branch`); a POS cart line keeps the price it was added at, so a list price changed mid-order shows until the line is re-added.
- **HQ multi-branch 86, 86 by category, lost-sales report** (audit §3, plan item 13).

## Working notes

- One worktree per task, and PRs only (see `CLAUDE.md`). The main checkout's `backend/node_modules` is missing `ws`, so a junctioned backend fails typecheck and the postgres tests. Run `npm ci --legacy-peer-deps` in the worktree's `backend`. Junctioning the frontend is fine.
- The local Postgres for this checkout is the `gnext-v25-local-postgres` container on port **5433** (`backend/.env`). Port 5432 is another checkout's database; don't point this repo at it. `migration:run:fresh` ignores `.env`'s `DB_PORT`, so set the DB variables explicitly when running it.
- The browser preview reads the main checkout's `.claude/launch.json`, so its `gnext-web`/`gnext-api` entries run main's code, not a worktree's. To check a worktree in the browser, add entries whose `--prefix` is the worktree's absolute path, start them, and revert the file.
- `en.json` and `fa.json` must keep identical keys.
