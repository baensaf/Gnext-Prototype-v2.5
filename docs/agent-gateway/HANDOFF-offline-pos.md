# Branch agent — next tasks (offline POS)

Written 2026-09-24. For the session that picks up the branch agent after v2 tasks 10–14.
Read [`HANDOFF.md`](HANDOFF.md) (v1 and v2 history), [`agent-protocol.md`](agent-protocol.md)
§12 (snapshot and offline upload) and [`../../agent/README.md`](../../agent/README.md) first.

## Where things stand

| Piece | State |
|---|---|
| v1: printing, card terminals, enrolment, settings page, tray, self-update, installer | Live on gnextdev.ir |
| v2 §12: branch snapshot, offline order upload, conflict rules, sync status | Merged and deployed (#105–#109). Agent 1.2.0 built by CI, **unpublished** until head office presses Publish |
| Offline POS: a till that takes orders while the internet is down | Contract §13 agreed (#111). P1 done: cloud (#112), agent 1.3.0 (#113). P2 (till binding, PIN sign-in), agent 1.4.0 (#114). P3 (till screen, catalogue and pricing on the agent), agent 1.5.0: this PR; the order is held in the page until P4. Nothing produces offline orders yet |

What the offline POS can already rely on:

- `branch-data\snapshot.json` on the branch PC, kept current (`agent/internal/branchdata`,
  `Keeper.Load()`): this branch's prices, products, sizes, add-ons, stops, selling windows,
  stock, payment methods, tables, zones, tills, open shifts, call-number state (§12.2).
- `offline.Outbox.Add(payload)` (`agent/internal/offline`): hand it a finished order in the
  §12.4 shape and it uploads it, splits bad batches, retries, and reports the backlog.
- The cloud books uploaded orders as the till recorded them and flags differences (§12.6).
  Unconfirmed card charges go to the existing Check terminal / Resolve.
- The agent already drives the printers (`printing.Printer.Print` takes HTML) and the card
  terminal (`payment.Driver.Charge`), and serves a Persian page on `127.0.0.1:47800`
  (`agent/internal/localui`, embedded static files).

## Decisions (confirmed 2026-09-24)

The user took every recommendation below. The contract is §13 of `agent-protocol.md`; where it
differs from this list (a separate staff list rather than users in the snapshot, argon2 hashes
as the cloud stores them, not bcrypt), §13 wins.

1. **Where the offline till runs.** *Recommended:* on the branch PC only, served by the agent
   at `http://127.0.0.1:47800/till` in the settings window or a browser. One till offline.
   *Later:* other tills on the LAN (the agent listens on the LAN, the installer opens the
   firewall, and tills pair with the agent). Most branches run one till at the counter.
2. **How a cashier signs in offline.** *Recommended:* by a 4–6 digit PIN checked on the agent.
   The snapshot gains the branch's POS staff (id, display name, role, PIN hash, bcrypt), stored
   DPAPI-encrypted. This changes §12.2, which says the snapshot has no users or PINs.
   *Alternative:* whoever was signed in at the till when the link dropped carries on, with no
   sign-in offline.
3. **Which till the agent is.** *Recommended:* a manager picks the till once on the agent's
   settings page (the same "device remembers its terminal" rule the web POS follows). The
   offline order then uses that till's open shift from the snapshot.
4. **When the till switches over.** *Recommended:* by hand. When the web POS can't reach the
   cloud, it shows a banner linking to the offline till, and the tray offers it too. There is
   no automatic switch, since two screens taking orders at once would split the queue.
5. **What can be sold offline.** *Recommended:* takeaway and dine-in, cash and card. Delivery
   offline and open tabs that span the outage are out of the first cut. No coupons or
   discounts, and shifts are neither opened nor closed offline (already in §12).

## Task list

Ordered by dependency. Cost = token cost; risk = implementation risk.

| # | Task | Cost | Risk | Importance |
|---|---|---|---|---|
| P0 | **Contract §13, offline POS**: the decisions above, the till's local API, how an order moves from open to finished, which till and shift it uses, call numbering, the printing and card flows. Show the user before building, as with tasks 0 and §12 | Med | Low | Critical, blocks the rest |
| P1 | **Snapshot additions** (cloud + agent): POS staff with PIN hashes (if decision 2 holds), print routes and kitchen stations for the station split, ticket template settings and brand/branch header (name, address, phone) | Med | Med | High |
| P2 | **Till binding and offline sign-in**: pick the till on the settings page; PIN check against the snapshot; a local session with a timeout | Med | Med | High |
| P3 | **Till screen**: Persian, right to left, embedded in the agent like the settings page. Categories and products from the snapshot, sizes and add-ons with the group min/max rules, availability re-checked on the clock (stops, windows, stock), order type, table, cart, totals exactly as §12.4 rounds them | High | Med | Critical |
| P4 | **Local order store**: open orders survive a restart (bbolt), with add/void lines while open. Call numbers continue the `POS` range from `call_number_issued_today`. A finished or cancelled order goes to `Outbox.Add` | Med | Med | Critical |
| P5 | **Offline payments**: cash (amount tendered, change); card through the local `payment.Driver` with no cloud command. A charge cut off mid-way is `UNKNOWN`, never charged twice (reuse the journal rules in §4.6) | Med | **High** | Critical |
| P6 | **Offline printing**: kitchen chits split by station, and the receipt once paid. *Recommended:* port the cloud's `print-render.service.ts` `renderDocument` (pure TypeScript, about 400 lines) into the till bundle so tickets look the same, and send the HTML to `printing.Printer.Print` | High | Med | High |
| P7 | **Switch-over**: the web POS banner when the cloud is unreachable, and the tray/settings entry to the till | Low | Low | Med |
| P8 | **Upload-side leftovers** (cloud): mark the table occupied for an `OPEN` dine-in order, store option group names on offline lines, and a delivery record if delivery is allowed offline | Low | Low | Med |
| ✂️ **Recommended cut line.** Then a real test at a branch: pull the network cable, sell, plug back, and check the orders, cash, flags and Moadian in the cloud |||||
| P9 | Tills on the LAN (listen on the LAN, firewall rule in the installer, pairing) | High | High | Med |
| P10 | Kitchen screens offline (KDS is a cloud web page; offline the kitchen gets printed chits only) | High | Med | Low |

Most of the cost sits in P3, P5 and P6.

## v1 items still open (outside the offline POS)

| Item | Why it's open |
|---|---|
| Test at a real Iran Burger branch | Printer fault paths and the Saman bridge are untested on real hardware; response codes other than `00` are unverified |
| USB / Windows-spooler printers (`connection.kind = windows`) | The user's branch printers may be USB on "POS Printer Driver V7.17"; the user deferred this |
| Saman `payment.query` | Saman's inquiry needs the RRN, which an unknown charge doesn't have; resolved by hand for now |
| Code signing | The user declined it for now; SmartScreen may warn on the setup wizard |
| Printing needs a signed-in Windows user | Edge won't run as SYSTEM; the service starts it in the console session |

## Traps

- **One process owns the files.** `journal.db`, `offline-orders.db` and the snapshot are opened
  by the agent service (bbolt locks the file). The till's API must live inside the agent
  process, served by `localui`, not in a second exe.
- **Totals must match the cloud's.** The cloud recomputes each line and holds anything off by
  more than 1 rial of tax a line (`TOTAL_MISMATCH`). Use §12.4's formula: tax per line on the
  line total, halves rounded up, whole rials.
- **Prices come only from the snapshot.** A price the snapshot never gave is held as
  `PRICE_MISMATCH`. Don't let the till type a price.
- **The shift must be one the snapshot lists.** An order naming another shift is held as
  `SHIFT_UNKNOWN`. With no open shift on the bound till, the offline till can't sell (decision 5).
- **Card charges.** Once the amount has reached the terminal, only `APPROVED` with an RRN, or
  `UNKNOWN`, is honest. Never retry a charge on your own.
- **Edge and SYSTEM.** Offline printing renders HTML in Edge like online printing does, so it
  needs someone signed in to Windows (see the local-agent notes in README).
- **The `/till` page is local only.** `localui` refuses hosts other than 127.0.0.1/localhost
  and cross-site writes; keep that for the till, since it can take money.
- **Contract first.** P0 is its own PR, and the user sees it before code, as with task 0 and §12.
- **Shipping.** Bump `agent/VERSION` in any agent PR; CI uploads the build unpublished; tell the
  user to press Publish. Keep `en.json` and `fa.json` keys identical for any web POS strings.
- **Shared local database.** Several sessions use the same Postgres. Don't run a migration that
  drops or renames something other branches still use; CI runs migrations on a fresh database.
- **Known flaky CI test:** `TestBrowserRendererPersianTicket` sometimes times out at 60 s on the
  runner. Re-run the failed job.

## How to start

1. `CLAUDE.md`: a worktree per task, PRs only, and what CI runs.
2. Ask the user the five decisions above (one message, with the recommendations).
3. Write §13 in `agent-protocol.md` as P0, open it as its own PR, and wait for the user.
4. Build P1–P8 in dependency order, a PR per task or pair of tasks, and stop at the cut line
   for the branch test.
