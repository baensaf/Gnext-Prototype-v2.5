# Add-ons (modifiers): workflow, features and IA audit — 2026-09-29

Scope: everything a sizes-free product needs to carry add-on groups: setting groups up
(Catalog → Modifiers), putting them on products, and choosing them at the POS. Read from
`main` at 1be225b. Findings come from the code; none were reproduced in a browser.

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

## Target model (simpler, same data)

No schema change is needed; everything below uses the existing tables.

**One name.** "Add-on group" and "add-on" (FA گروه افزودنی / افزودنی). Sizes stay "Sizes".

**One group sheet** used for both create and edit:
- Name.
- **Rule**, picked from presets instead of three fields: *Optional* · *Pick exactly 1*
  (required) · *Up to N* · *Between N and M*. They map onto min/max, and required is always
  `min > 0`, so C1 and C4 go away.
- Items as rows: name, price (default 0), a **Default** tick, drag or ↑↓ to order, and
  "Gives product" under a *Combo slot* toggle so it stays out of the way.
- **Used on**: multi-select products, or "every product in category X". This is also where
  the delete warning gets its list.
- No codes on screen; the server generates them, as the edit path already does.

**Groups page as a table:** Name · Rule ("Pick 1, required") · Items · Price range ·
Used on N products. A row opens the sheet.

**Product → Add-ons tab** stays for per-product work: order the groups, switch items off.
Remove the tune icon on the Products list.

**POS dialog:**
- Pick-one groups become a row of large choice buttons (radio style); pick-many groups
  become toggle tiles with their price.
- Required groups come first, marked, with the unfilled one highlighted.
- The button shows the total: "Add · 245,000".
- **Only open the dialog when it's needed** (a required group or several sizes).
  Optional-only products ring straight through, as HAMI does. The cart line gets an
  *Add-ons* button that opens the same dialog to add or change extras (fixes P3 and P4).
  That lets the demo menu carry add-ons again without a prompt on every burger.

## Plan

Ordered by dependency. Cost = my token spend; risk = chance of breaking something that
works today.

| # | Task | Fixes | Cost | Risk | Impact |
|---|---|---|---|---|---|
| 1 | Required is `min > 0` everywhere: drop the Required box from the create drawer; the server ignores `is_required` | C1, C4 (half) | Low | Low | **Bug** |
| 2 | New add-on price defaults to 0 | C6 | Low | Low | Med |
| 3 | One vocabulary in EN and FA, drop "(V5 Feature)", Variants → Sizes (same keys in both files) | C11 | Low–Med | Low | Med |
| 4 | One group sheet (create = edit): rule presets, item rows with default tick, combo-slot product link, ordering, no codes | C2, C4, C5, C7, C8, C9 | Med | Low–Med | **High** |
| 5 | "Used on" in the sheet with bulk add by product or category (one backend endpoint that sets a group's links, with the existing fillable check); groups page as a table with a used-on count; drop the list's tune icon | C3, C10 | Med | Low–Med | **High** |
| — | **Recommended cut line** — setup is then one sheet on one page | | | | |
| 6 | POS dialog: choice buttons for pick-one, tiles for pick-many, required first, total on the button | P1, P2, P5 | Med | Med (`order.tsx` is 3,271 lines; keyboard and held-order paths) | High |
| 7 | Ring optional-only products straight through; *Add-ons* button on the cart line to edit a line | P3, P4 | Med–High | Med (cart merge key, held-order reload, kiosk parity) | High — a product decision |
| 8 | One shared add-on picker for POS and kiosk | P6 | Med | Med | Low while the kiosk is V3 |

Items 1–3 are cheap. Items 4 and 5 carry most of the cost and most of the gain. Item 7
changes the "the POS asks nothing" behaviour from PR #87, so it needs your call first.

## Questions for you

1. **Build or specify?** Add-ons are V4, and the prototype feeds the scope docs rather than
   production. Should the fixes go into the prototype so the V4 behaviour can be shown, or
   should this target model go into the V4 scope doc as the spec?
2. **Ring-through with optional add-ons (item 7).** Is "tap adds the burger at once, tap the
   line to add extras" acceptable next to HAMI's behaviour? If yes, the demo menu could carry
   its add-ons again.
