# Add-ons (modifiers): workflow, features and IA audit — 2026-09-29

Scope: everything a sizes-free product needs to carry add-on groups: setting groups up
(Catalog → Modifiers), putting them on products, and choosing them at the POS. Read from
`main` at 1be225b. Findings come from the code; none were reproduced in a browser.

**Status (2026-09-30):** items 1–7 of the plan are built in PR #181, with two changes taken from Toast (see Benchmarks).

Label context: add-on groups, the add-ons page and combos are **V4** (PR #170). The demo
menu carries no add-on groups on purpose (PR #87), so nobody meets this flow in the demo
until they build a group by hand, and that is where it feels complicated.

## Why it feels complicated

1. **Three editors for one thing.** A group is created in a side drawer, its items are added
   one at a time in a second dialog, and it is edited in a third dialog. Each asks for
   different fields.
2. **Setup is spread across three pages.** Build the group on Modifiers, then open every
   product one by one to attach it. The groups page never shows where a group is used.
3. **The rules are raw numbers.** Min, Max and a separate Required box describe one idea
   ("the guest must pick one") three ways, and they can disagree.
4. **Codes and internal words leak out.** Every group and item needs a typed code
   (`OPT-EXTRACHEESE`) that no cashier ever sees. The same thing is called modifier, option
   group, option item, add-on and modifier group.
5. **The POS dialog is a list of checkboxes.** Pick-one groups look like pick-many, there is
   no running total, and a line's add-ons can't be changed once it's in the cart.

## Current workflow

Setting up "Burger: extras (optional, up to 3)" for 10 burgers:

| Step | Where | What the user does |
|---|---|---|
| 1 | Catalog → Modifiers & Options | New Option Group → drawer: **code**, name, min, max, Required box → Create |
| 2 | same page, group card | Add Option Item → dialog: **code**, "Gives product", name, price (prefilled **15,000 Toman**) → Add. Dialog closes; repeat for each item |
| 3 | Catalog → Products → a burger → Add-ons tab | Attach Modifier Group → pick from a dropdown → Attach. **Repeat for all 10 burgers** |
| 4 | same tab | Optionally switch off items this burger does not offer |

About 40 clicks and 12 page or dialog changes. A combo adds one group per slot, each item
must be linked to its dish in step 2 (the edit dialog can't set that link), and its
"usual drink" can't be preselected at all (C5).

## Findings

Severity: **Bug** = wrong result · **High** = main reason it feels hard · **Med** · **Low**.

### Setup (Catalog → Modifiers & Options, product page)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| C1 | **Bug** | Saving a group in the edit dialog recalculates Required as `min > 0`. A group created with Required ticked and Min 0 (the drawer allows it) turns **optional** the first time anyone renames it or edits a price. | `catalog.service.ts:1230`; the drawer sends `is_required` separately, `options.tsx:101` |
| C2 | High | Three editors: the create drawer (code, name, min, max, Required, no items), the add-item dialog (code, product link, name, price, one item at a time), and the edit dialog (name, min, max, many items; no code, Required, product link or default). | `options.tsx:278`, `options.tsx:335`, `option-group-edit-dialog.tsx` |
| C3 | High | Setup needs three pages and one product at a time. The groups page doesn't show which products use a group, and there is no way to add a group to a category or several products at once. Delete warns "comes off every product that has it" without saying which ones. | `options.tsx:165`, `options.tsx:199`; `product-detail.tsx:329` |
| C4 | High | Rules are Min / Max / Required. Min 0 + Required shows "Min: 0 \| Max: 1" next to a Required chip. Max 0 means "no limit" on the server, but the create drawer turns 0 into 1 (`\|\| 1`) and nothing explains it. | `options.tsx:177`, `options.tsx:314`; `option-choices.util.ts:47` |
| C5 | Med | The default choice (`is_default`) has no control anywhere. The POS pre-ticks defaults "so the common order is one tap", but only the API can set one, so a combo always opens with its drink empty. | `order.tsx:604`; `catalog.service.ts:1309` |
| C6 | Med | New add-on price is prefilled with 15,000 Toman (`'150000'` Rial). A free "no onions" is charged unless the user clears the field. The label says "+/-" but nothing about negative amounts. | `options.tsx:66` |
| C7 | Med | Codes are required for groups and items, typed in uppercase. The edit dialog already generates codes, so the typed ones do nothing for the user. | `options.tsx:288`, `options.tsx:344`; `catalog.service.ts:1244` |
| C8 | Med | "Gives product" (a combo slot's dish) can be set only when adding an item, isn't shown in the group's table, and can't be changed afterwards. | `options.tsx:352`; `option-group-edit-dialog.tsx` |
| C9 | Low | No ordering: groups on a product are always sort 0; items keep the order they were added in. | `product-detail.tsx:333` (no sort order sent) |
| C10 | Low | Two ways to attach: the tune icon on the Products list and the product's Add-ons tab. The list's dialog shows groups already attached; attaching one again silently does nothing and still reports success. | `products.tsx:372`; `catalog.service.ts:779` |
| C11 | Med | Words: EN uses Modifiers, Option Group, Option Item, Add-on, Modifier Group, Price Delta; FA uses گروه انتخابی, دسته افزودنی, افزودنی, آیتم, and "(Modifiers)" in the page title. The EN product-tab subtitle still says "(V5 Feature)". The product tab says "Variants" where the list says "Sizes". | `en.json` / `fa.json` → `catalog.optionsPage`, `catalog.productDetailPage.modifiers`, `tabs` |

### POS (cashier)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| P1 | High | Every group is a column of checkboxes. A pick-one group (bread, drink) swaps its tick silently instead of looking like a choice of one. Required shows only as "(required)" after the name. | `order.tsx:2982–3019` |
| P2 | Med | No running price in the dialog; only each add-on's own "+price". The "Add to cart" button doesn't show the line total. | `order.tsx:3025–3039` |
| P3 | High | A cart line's add-ons can't be changed: the line has only − / +. A wrong choice means removing the line and starting again. | `order.tsx:2395–2430` |
| P4 | High | The dialog opens whenever a product has any group, even optional-only ones. That is why the demo menu dropped its add-ons: HAMI rings a burger straight through (PR #87). Add-ons and ring-through can't coexist today. | `order.tsx:618` |
| P5 | Low | Chosen add-ons show on the line as one truncated "+ a, b, c" row with no prices. | `order.tsx:2401` |
| P6 | Low | The kiosk has its own copy of the dialog and cart logic (V3/V4), so every POS change has to be made twice. | `kiosk.tsx:212–266` |

### IA (where add-on things live)

| Task | Page today |
|---|---|
| Build a group and its items | Catalog → Modifiers & Options |
| Put a group on a product; hide items per product | Product → Add-ons tab (or the tune icon on the list) |
| Stop an add-on today | Catalog → Availability & Suspensions (chain-wide only) |
| Change add-on prices by % | Price Changes → Add-ons |
| Snappfood add-on prices | Snappfood Prices |
| 86 history | 86 report |

The last four are fine where they are: they sit with the other availability and price
tools. The problem is the first two: building a group and deciding where it's used belong
together, and right now they're split across pages with no link back.

## Benchmarks: Snappfood partner panel and Toast

Snappfood from the earlier parity work (ba32010) and its vendor API (topping groups,
add-to-product); the live panel was not opened for this audit. Toast from its own docs:
[modifier behavior](https://support.toasttab.com/en/article/Required-Optional-Modifiers),
[modifier groups](https://doc.toasttab.com/doc/platformguide/adminAddingModifierGroupsAndModifiers.html),
[menu hierarchy](https://doc.toasttab.com/doc/platformguide/adminMenuHierarchy.html).

| | Snappfood partner panel | Toast | Gnext now (this PR) |
|---|---|---|---|
| Group editor | One sheet: title, min/max, items with name and price | One sheet, items entered in the table, drag to order | One sheet for create and edit ✓ |
| Codes | None on screen | None | None; the server makes them ✓ |
| Required | Min above 0 is required; no separate flag | Required or Optional; a minimum only on required groups; a maximum on both | Optional/Required + One/Several; required = min > 0 ✓ |
| Default choice | No | Yes, added automatically when the item is rung up | Yes, a Default tick per add-on ✓ |
| Hiding one add-on on one product | Yes, a switch per add-on | No, use another group | Kept ✓ |
| Attaching to many products | Link groups to products | On a menu group: every item in it inherits, per-item opt-out; group page lists where it is used | On a category: every product in it, new ones too; products take it off one by one; "Used on" list ✓ |
| Does the POS ask? | Not a POS | Per group: Required (must choose), Optional + force show (pops up, skippable), Optional (staff open it) | Per group: required always asks; optional has "Ask at POS", off by default for a new group ✓ |
| Pricing | A price per add-on | No charge, a price per option, or one price for the group; No/Extra/On-side prefixes | A price per add-on only (not taken over) |

Two Toast ideas changed the plan: **ask at the POS is set per group** (instead of one rule
for every product), and **a group can sit on a category** and reach every product in it,
new ones included. Toast's group pricing, pre-modifiers and size-based prices were left out;
the "بدون" (without) group already covers "no onions".

## Target model

**One name.** "Add-on group" and "add-on" (FA گروه افزودنی / افزودنی). Sizes stay "Sizes".

**One group sheet** used for both create and edit:
- Name.
- **Rule**: *Optional* or *Required*, then *One* or *Several* (with *at least* when required
  and *at most*, blank = no limit). It maps onto min/max; required is always `min > 0`, so
  C1 and C4 go away.
- **Ask the cashier when the item is rung up**, for optional groups. Required groups always ask.
- Add-ons as rows: name, price (default 0), a **Default** tick (a radio in a pick-one group),
  ↑↓ to order, and "Menu item" under a *Combo slot* switch so it stays out of the way.
- **Used on**: categories and products. A category gives the group to every product in it
  and to products added later; the sheet lists the products that have it through a category.
  Delete warns how many products it comes off.
- No codes on screen.

**Groups page as a table:** Group · Rule ("Required · pick 1") · Add-ons · Price ·
Used on (N products, category chips) · Asks at POS. A row opens the sheet.

**Product → Add-ons tab** for per-product work: ↑↓ to order the groups, switch add-ons off,
the rule and "from category" shown on each group. The attach list hides groups already on.
The tune icon on the Products list is gone.

**POS dialog:**
- Sizes and add-ons are large choice buttons; a pick-one group behaves as a radio (a required
  one can be changed, not cleared), a pick-many group as toggles, each with its price.
- Required groups come first, with the rule chip turning green once filled.
- The button shows the price as picked: "Add · 245,000 Toman".
- The dialog opens only for several sizes, a required group, or a group set to ask. Otherwise
  the item rings straight through, as HAMI does, with its default add-ons.
- Every line with sizes or add-ons has an **Add-ons** button that opens the same dialog with
  the line's choices ticked and updates the line in place.

## Plan and status

| # | Task | Fixes | Cost | Risk | Impact | Status |
|---|---|---|---|---|---|---|
| 1 | Required is `min > 0` everywhere; migration sets min 1 on groups marked required with min 0 | C1, C4 | Low | Low | **Bug** | Built |
| 2 | New add-on price defaults to 0 | C6 | Low | Low | Med | Built |
| 3 | One vocabulary in EN and FA, drop "(V5 Feature)", Variants → Sizes | C11 | Low–Med | Low | Med | Built |
| 4 | One group sheet (create = edit): rule, ask at POS, add-on rows with default tick, combo-slot menu item, ordering, no codes | C2, C4, C5, C7, C8, C9 | Med | Low–Med | **High** | Built |
| 5 | "Used on" in the sheet by product or category (category inheritance, as Toast); groups page as a table; group order on the product; drop the list's tune icon | C3, C10 | Med | Low–Med | **High** | Built |
| 6 | POS dialog: choice buttons, required first, price on the button | P1, P2, P5 | Med | Med | High | Built |
| 7 | Per-group "ask at POS" (Toast) instead of a global rule; ring through with defaults; *Add-ons* button on the cart line | P3, P4 | Med–High | Med | High | Built |
| 8 | One shared add-on picker for POS and kiosk | P6 | Med | Med | Low while the kiosk is V3 | Not built |

## What was built

Backend (`catalog.service.ts`, migration 084 `AddonGroupSetup`):
- `selectionRule()`: min/max checked in one place; max 0 = no limit; required = min > 0.
  Migration 084 gives groups marked required with min 0 a min of 1 and recomputes the flag.
- `option_group.prompt_at_pos` (existing groups keep asking; the sheet defaults a new
  optional group to off).
- `category_option_group` and `product_option_group.from_category_id`: a category's groups are
  copied onto its products as links that remember the category. A new product, or one moved
  into the category, gets them; one moved out loses them; taking the category off removes
  those links and leaves direct ones. Readers of product links (orders, kiosk, agent snapshot)
  are unchanged.
- `POST /option-groups` with `items` creates a group in one save; `PUT /option-groups/:id`
  also takes `prompt_at_pos`, `is_default` and `product_id` per item;
  `PUT /option-groups/:id/links` sets products and categories;
  `PUT /products/:id/option-groups/order` orders a product's groups; codes are optional.
- Tests: `test/addon-group-setup-postgres.spec.ts`.

Frontend: `pages/catalog/options.tsx` (table), `pages/catalog/addon-group-sheet.tsx` (sheet,
replaces `option-group-edit-dialog.tsx`), `pages/catalog/product-detail.tsx`,
`pages/catalog/products.tsx`, `pages/pos/order.tsx`, `utils/addon-rule.ts`, EN/FA strings.

Left as they were:
- **Kiosk** (V3) keeps its own dialog and always shows add-on groups, as a guest-facing screen should.
- **Tills running through the local agent** get the menu from the agent's snapshot, which
  carries neither "ask at POS" nor default add-ons, so they keep asking for every group and
  start with nothing ticked. Changing that needs an agent release.
- The demo menu still has no add-on groups (PR #87). Whether to seed them back is the next decision.
- The flow was not checked in a browser; typecheck, lint, build and the backend suite pass.
