# Orders Directory IA audit, benchmarked against restaurant POS order lists

> **Status:** every item in §5 (1–13), the Kanban removal and the Refunds fix shipped in
> PR #93 on MUI X DataGrid, deployed 2026-09-23. Still open: a cancelled order with a
> total of 0 reads "Fully paid" in the payment column.

2026-09-23, against `origin/main` at `aead9ff`. Scope is the **Orders Directory** only
(`/app/orders`, `starter-vite-ts/src/pages/orders/workflow.tsx`): the table, its filters,
row actions, the Kanban toggle and the detail drawer. Incoming Orders, the Delivery & Fleet
Hub and KDS are out of scope.

Benchmarks: the order and check lists in **Toast** (POS "Orders"/check search and Toast Web
order details), **Square for Restaurants** (Dashboard Orders and Transactions), **Lightspeed
Restaurant K-Series** (Back Office receipts) and **Oracle Simphony** (check search). The
benchmark column summarises their public help docs. It was not re-checked live in this pass.

Method: I read the page, its API client and `OrderService.getOrders`, and I measured the order
volume in the local database (Iran Burger seed). I didn't sign in to the UI, so findings are
**code-read + DB**. Per the scope rule, reproduce an item on screen before fixing it.

---

## 1. Verdict

The row content is good. Payment state, the Snappfood promise time, call numbers, HQ
read-only mode and the branch column for HQ all match or beat the benchmarks. The
**information architecture around the rows** is the problem.

1. **The directory only ever holds the newest 50 orders.** The page calls `GET /orders`
   without `page` or `limit`, and the server defaults to 50 (`order.service.ts:181-183`).
   The tab counts, the search and the Kanban all run on those 50 in the browser. Local data
   has 84–202 orders per branch over 14 days and ~1,850 chain-wide. A cashier can't find
   last Tuesday's order, and HQ sees 50 orders for the whole chain, labelled "All (50)".
2. **There is no time axis.** Rows show only the time (`fTime`) with no date, and there's no
   date or business-day filter. Every benchmark opens on *today / current business day* and
   offers a date range.
3. **The table can't answer "where did this order come from, and where is it going?"**
   Channel (POS / kiosk / online / Snappfood) is never shown. A delivery shows no address or
   courier, and the "Table / Notes" column reads "Counter takeaway" for any delivery without
   a note.

Everything else is polish: action overload, labels, drawer contents, Kanban.

---

## 2. Current IA

| Layer | What it is today |
|---|---|
| Header | Title, Table/Kanban toggle, manual Refresh |
| Filters | Lifecycle tabs: All · Waiting · Open · Completed · Cancelled (counts from the loaded 50), free-text search (client-side) |
| Columns (10, 11 for HQ) | Order # (+ call no.) · [Branch] · Customer (+ mobile) · Type · Table/Notes · Items (every line) · Total · Paid/Due/Refunded · Placed (time only) · Status (+ progress + Snappfood chips) · Actions |
| Row actions | Details · Receipt · Reprint · Pay · Complete · Report to Snappfood · Cancel (up to 7 buttons) |
| Row click | Opens the right drawer (same as "Details") |
| Drawer | Header chips → tabs *Summary* (customer, lines, money) and *Audit* (state events + audit log JSON) → footer with up to 8 actions |
| Kanban | Waiting / Open / Completed columns of the same 50 orders, no drag, no Cancelled column |
| Also exists | `/app/orders/:id` full page, linked from customer profile, business days and Moadian. It isn't linked from here |

---

## 3. Benchmark comparison

| IA element | Toast / Square / Lightspeed / Simphony (common pattern) | Gnext | Gap |
|---|---|---|---|
| Default scope | Today or current business day. All four have a date or date-range picker | Newest 50, any date | **Major** |
| Paging / totals | Server-side paging or infinite scroll with a true total | None. Hard cap of 50 | **Major** |
| Search | Server-side by check/order #, customer, phone, sometimes card last-4 | Client-side over 50 rows. Server `q` only matches number and notes | **Major** |
| Date on row | Date + time (or grouped by day) | Time only | **Major** |
| Status model | Open / Closed(Paid) / Voided, with refunds as their own filter | Waiting / Open / Completed / Cancelled. `DRAFT` (held) and `REFUNDED` fall into no tab | Medium |
| Source / channel | Square "Source", Toast dining option + source (online, 3rd-party), all filterable | Not shown, not filterable (the API supports `channel`) | Medium |
| Fulfilment detail | Dining option + table *or* address/driver state | Type chip. Table *or* notes, "Counter takeaway" fallback for deliveries | Medium |
| Employee / terminal | Server/employee and device/revenue centre on the row or in details | Not shown. The drawer audit says "Authenticated user". `GET /orders/:id` already returns `people.taken_by` and `people.courier`, but the drawer doesn't render them | Medium |
| Payments in detail | Tender list (method, amount, time), refunds, tips | Only totals: paid / outstanding | Medium |
| Row density | One line per check. Item count or short summary | Every line item stacked → very tall rows | Medium |
| Row actions | Row opens detail. One contextual primary action, the rest in an overflow menu or in detail | Up to 7 buttons. "Details" duplicates row click. "Receipt" shows on unpaid orders | Medium |
| Sorting | Sortable columns (time, amount) | None | Low |
| Filters beyond status | Dining option, source, employee, device, location | None (the API supports `type`, `channel`, `shift`) | Medium |
| Live updates | Open-check views update live on device | Manual Refresh. SSE exists for KDS, delivery and print queue but not here | Low–Med |
| Deep link / URL state | Detail has its own URL. Filters survive reload | Drawer isn't addressable. Filters reset | Low |
| Export | CSV export (Square, Toast Web, Lightspeed) | None | Low (HQ/back-office need) |
| Board view | Toast Orders Hub / KDS are boards. The *order list* is a list | Kanban toggle duplicating KDS/Delivery, read-only | Low (remove, don't build) |
| HQ read-only | Enterprise/back-office views are read-only | Same. Well done | — |

### Smaller defects found on the way

- `getOrderTypeLabel` (`workflow.tsx:201`) has no case for `PICKUP` or `AGGREGATOR`. The local
  DB has 12 `PICKUP` and 3 `AGGREGATOR` orders, which render as raw English codes in the
  Persian UI.
- Takeaway and delivery share one type-chip colour (`info`). Only dine-in differs.
- The "IRR" suffix is hard-coded rather than translated.
- The page loads **every customer** (`customerApi.getCustomers()`) to resolve names for 50
  rows. Most orders already carry `customer_name`.
- Drawer audit tab: the tab count shows "1" when there are no events (`|| 1`), and the actor
  shows "Authenticated user" instead of a name.

---

## 4. Target IA (proposed)

```
Orders Directory
├─ Scope bar:   [Business day ▾ Today | Yesterday | Custom range]   [Branch ▾ HQ only]
├─ Status tabs: Open · Waiting · Held · Completed · Cancelled/Refunded · All   (server counts)
├─ Filters:     Type ▾  Channel ▾  Shift/terminal ▾        Search (server: #, call no., name, phone)
├─ Table (one line per order, sortable):
│   Call/Order # · [Branch] · Placed (date+time) · Channel · Type · Where (table | zone/address · courier state)
│   · Customer · Items (count + first item) · Total · Payment (Paid / Due / Refunded) · Status · ⋯
│   └─ ⋯ menu: one contextual primary (Pay | Complete | Report) + overflow (Receipt, Reprint, Change type, Cancel)
├─ Pager: 25/50/100 · total N
└─ Row click → drawer (URL ?order=<id>): Summary · Payments · Timeline (named actors) · "Open full page"
```

Kanban goes away. The boards that move orders are KDS and the Delivery Hub.

---

## 5. Ranked fix list

Cost is token/implementation effort. Risk is the chance of breaking an existing path.
**Demo** marks items that a walkthrough with more than 50 orders visibly hits.

| # | Fix | Cost | Risk | Impact | Demo |
|---|---|---|---|---|---|
| 1 | **Server-side list:** send `page`/`limit` and show a pager with the real total; move status, search, type and channel to the API; add `from`/`to` (or `business_day`) and lifecycle-group filters to `getOrders`; extend `q` to customer name, mobile and call number; return per-tab counts | Med | Med: `getOrders` is also called by Refunds (`refunds.tsx:70`) and the POS held-orders list (`pos/order.tsx:312`, `state: 'DRAFT'`) | **Very high** | Yes |
| 2 | **Date scope:** default to today/business day, add Yesterday and Custom range; show the date on rows outside today | Low (with #1) | Low | **High** | Yes |
| 3 | **Channel column + filter**, and add the missing `PICKUP`/`AGGREGATOR` type labels | Low | Low | High | Yes |
| 4 | **Held and Refunded buckets:** give `DRAFT` and `REFUNDED` a home in the tabs so the counts add up | Low | Low | Medium | — |
| 5 | **Row density:** item count + first item instead of every line; a "Where" column (table, or zone + courier state for delivery) replacing "Table/Notes" | Low | Low | Medium | Yes |
| 6 | **Action rationalisation:** row click only; one primary action + an overflow menu; hide Receipt until paid | Low | Low | Medium | — |
| — | **Recommended cut line** | | | | |
| 7 | Drawer: render the `people` it already receives (taken by, courier), terminal, channel, delivery address; a Payments section (tenders + refunds); named actors in the timeline | Med | Low | Medium | — |
| 8 | Live updates on the Open/Waiting tabs via the existing SSE hook | Low | Low–Med (re-fetch churn with paging) | Medium | — |
| 9 | URL state: `?order=` for the drawer, filters in the query string, "Open full page" link to `/app/orders/:id` | Low | Low | Low–Med | — |
| 10 | Sortable columns (placed, total, due) | Low | Low | Low | — |
| 11 | Remove the Kanban toggle | Low | Low (check nobody demos it) | Low | — |
| 12 | CSV export of the filtered list (HQ) | Low–Med | Low | Low | — |
| 13 | Drop the all-customers fetch; rely on `customer_name` + detail fetch | Low | Low | Low (perf) | — |

**Where the cost sits:** #1 carries most of it and unlocks #2–#4. Everything above the cut
line is one PR touching `workflow.tsx`, `orderApi.getOrders` and `OrderService.getOrders`.

**Trap:** `OrderService.getOrders` treats `status` as `o.state = :s OR o.status = :s` for a single
value. The tabs are *lifecycle groups* (Open = six states). Add a group parameter rather than
repurposing `status`, or other callers that pass one status will change behaviour.

**Same bug outside scope:** Refunds (`refunds.tsx:70`) makes the identical unpaged call, so it
can only refund one of the newest 50 orders. The POS held-orders list is also capped at 50,
though a branch rarely holds that many.

**Not recommended:** building a customisable-columns / saved-views system (Toast/Square-grade)
for a prototype. The fixed column set above covers the demo.
