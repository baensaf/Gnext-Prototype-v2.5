# Gnext branch agent — protocol v1

Status: **agreed** (task 0 of `HANDOFF.md`). Protocol version: **1**.

This document is the whole contract between the **cloud** (the Gnext backend, NestJS, on the
VPS) and the **agent** (a Windows service written in Go that runs on one PC in each branch).
You should be able to build the agent from this file alone.

The key words MUST, MUST NOT, SHOULD and MAY mean what RFC 2119 says they mean.

---

## 1. What the agent does

The cloud runs the restaurant: orders, payments, print jobs. It cannot reach the printers and
card terminals in a branch, because they sit on the branch LAN behind NAT. The agent sits on
that LAN, opens a connection **out** to the cloud, takes commands over it, drives the
hardware, and reports what happened.

v1 covers two jobs:

- **Printing** — print a document the cloud rendered on a named branch printer.
- **Card payments** — make a POS terminal charge an amount, and report the result.

v1 has **no offline mode**. If the connection is down, the agent does nothing new, and the
branch's jobs wait for it (§10). v2 (§12) adds a copy of the branch's menu and prices on the
agent, and the upload of orders the branch took while offline; §13 adds the till the branch
takes those orders on.

**Since 2026-10-06 the agent does something else (§19, v3).** The offline selling of v2 is
removed. Instead the agent serves the cashier's pages of the web app on the branch PC and LAN,
cached from the cloud's own build, and passes every API call to the cloud. §12, §13, §16, §17
and §18 are kept for history only.

```
 Branch LAN                                      VPS
┌──────────────────────────────┐              ┌─────────────────────────────┐
│ printers ─┐                  │  WebSocket   │ Arvan CDN → nginx → backend │
│           ├── gnext-agent ───┼─────────────►│   /api/v1/agent/ws          │
│ terminal ─┘   (Windows svc)  │  HTTPS       │   /api/v1/agent/...         │
└──────────────────────────────┘─────────────►└─────────────────────────────┘
        outbound only; the branch opens no inbound port
```

## 2. Transport

| Channel | Used for |
|---|---|
| **WebSocket** `wss://<host>/api/v1/agent/ws` | Commands, acks, results, heartbeats, device status. One connection per agent. |
| **HTTPS** `https://<host>/api/v1/agent/...` | Enrolment, release check, release download; v2: branch snapshot, offline order upload (§12), staff list (§13). *The v2 routes were removed 2026-10-06 (§19).* |

- `<host>` is the public Gnext domain. The agent gets it from its install config
  (§3.1), not from DNS discovery.
- TLS only. The agent MUST verify the server certificate against the Windows system store.
- All paths sit under `/api/`, because that is the only prefix nginx proxies to the backend
  with WebSocket upgrade headers.
- WebSocket frames are **UTF-8 JSON text frames**. One message per frame. No binary frames
  in v1. Maximum frame size: **1 MiB** in both directions; a peer that receives a larger
  frame closes with `1009`.
- HTTPS bodies are `application/json; charset=utf-8` unless stated otherwise.

### 2.1 Common conventions

- **Timestamps**: RFC 3339 in UTC with milliseconds, e.g. `2026-09-17T08:15:30.123Z`.
- **IDs**: UUID strings (lower case). Message IDs the agent creates MUST be UUID v4.
- **Money**: a decimal **string of whole rials**, e.g. `"1250000"`. Never a JSON number,
  never fractional. `currency` is always `"IRR"` in v1.
- **Unknown fields**: both sides MUST ignore JSON fields they do not know. New optional
  fields do not bump the protocol version.
- **Secrets**: the device key and full card numbers MUST NOT appear in logs, URLs or query
  strings — on either side.

## 3. Identity: enrolment and auth

### 3.1 Install

The installer puts the agent at `C:\Program Files\Gnext\Agent\gnext-agent.exe`, registers
it as a Windows service (`GnextAgent`, start type Automatic, recovery "restart on failure"
for all three failures, 10 s delay), and writes the install config:

`%ProgramData%\Gnext\Agent\config.json`

```json
{ "server": "https://app.example.ir" }
```

On first start without a device key, the agent needs an **enrolment code**. v1 takes it from
the command line, run once by the installer or a technician:

```
gnext-agent.exe enrol --code K7QM-4XPD
```

### 3.2 Enrolment code

HQ creates the code on the Agents screen, for one branch. The code:

- is 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no look-alikes), shown as
  `XXXX-XXXX`. The agent MUST strip the hyphen and upper-case it before sending;
- is **single-use** and expires **24 hours** after it is created;
- is stored by the cloud as a hash only.

### 3.3 `POST /api/v1/agent/enrol`

No auth header. Request:

```json
{
  "code": "K7QM4XPD",
  "agent_version": "1.0.0",
  "protocol_version": 1,
  "machine": {
    "hostname": "BRANCH-01-PC",
    "os": "Windows 11 Pro 10.0.26200",
    "machine_id": "3f1c…"
  }
}
```

`machine_id` is `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`. It is informational
(shown to HQ), not a secret and not used for auth.

`200 OK`:

```json
{
  "agent_id": "8d0b3c1e-…",
  "tenant_id": "…",
  "branch_id": "…",
  "branch_name": "Vanak",
  "device_key": "gak_6JzQ…",
  "ws_url": "wss://app.example.ir/api/v1/agent/ws"
}
```

- `device_key` is `gak_` followed by 43 characters of base64url (32 random bytes). The
  cloud returns it **once** and stores only its SHA-256.
- **One agent per branch.** If the branch already has an active agent, redeeming a new code
  **revokes the old agent** (a replaced PC). Its open connection is closed with `4003`.

Errors (§8.2): `400 ENROLMENT_CODE_INVALID`, `400 ENROLMENT_CODE_EXPIRED`,
`400 ENROLMENT_CODE_USED`, `400 PROTOCOL_UNSUPPORTED`, `429 RATE_LIMITED` (5 failed codes
per IP per 15 min).

The agent writes `%ProgramData%\Gnext\Agent\identity.json`:

```json
{ "agent_id": "…", "tenant_id": "…", "branch_id": "…", "branch_name": "Vanak",
  "device_key": "gak_…", "ws_url": "wss://…/api/v1/agent/ws" }
```

The file's ACL MUST allow only `SYSTEM` and `Administrators`. The agent SHOULD encrypt
`device_key` with DPAPI (`CryptProtectData`, machine scope); a plain value under that ACL is
acceptable for v1.

### 3.4 Using the key

Every HTTPS call (except enrol) and the WebSocket upgrade carry:

```
Authorization: Bearer gak_6JzQ…
User-Agent: gnext-agent/1.0.0 (windows)
```

`GET /api/v1/agent/me` returns `{ agent_id, tenant_id, branch_id, status, enrolled_at }` for the
key. The installer calls it after `enrol` to check the key works.

The key identifies the agent, and through it the tenant and branch. **The agent never sends
`tenant_id` or `branch_id` to prove who it is**; the cloud ignores them if it does.

Failures:

| When | HTTPS | WebSocket |
|---|---|---|
| Missing or unknown key | `401 AGENT_KEY_INVALID` | upgrade refused with HTTP `401` |
| Agent revoked | `403 AGENT_REVOKED` | upgrade refused with HTTP `403`; an open socket is closed with `4003` |

On `401`/`403`/`4003` the agent MUST stop reconnecting, log the reason, and wait for a new
`enrol` run. It MUST NOT delete `identity.json` itself (a technician may want to see it).

Revocation takes effect **immediately**: the cloud closes the agent's socket with `4003` in
the same request that revokes it, and rejects the key from then on.

The cloud builds `ws_url` from its `AGENT_PUBLIC_URL` setting when set, otherwise from the
host the agent called. The agent MUST use the `ws_url` it was given.

## 4. WebSocket session

### 4.1 Envelope

Every frame, both directions:

```json
{
  "v": 1,
  "id": "0b7c…",
  "type": "print.job",
  "ts": "2026-09-17T08:15:30.123Z",
  "ref": null,
  "payload": { }
}
```

| Field | Rules |
|---|---|
| `v` | Protocol version, integer. Always `1` in this document. |
| `id` | UUID, unique per message from the sender. For a **command**, it is the command's ID in the cloud and is reused on every redelivery. |
| `type` | Message type (§5). |
| `ts` | When the sender created this message. |
| `ref` | The `id` of the message this one answers (`ack`, `*.result`, `welcome`, `heartbeat.ack`), otherwise `null` or absent. |
| `payload` | Object. Its shape depends on `type`. |

A frame that is not valid JSON, or lacks `v`/`id`/`type`, is answered with an `error`
message (§4.8) and otherwise dropped. The connection stays open.

### 4.2 Handshake

1. Agent opens the WebSocket with the auth header (§3.4).
2. Agent sends `hello` as its first frame, within 10 s, or the cloud closes with `4000`.
3. Cloud answers `welcome`, or closes with `4010`/`4011`.
4. Only after `welcome` may either side send anything else.

`hello` (agent → cloud):

```json
{
  "v": 1, "id": "…", "type": "hello", "ts": "…",
  "payload": {
    "agent_version": "1.0.0",
    "protocol_versions": [1],
    "capabilities": ["print.html", "payment.charge", "payment.query"],
    "started_at": "2026-09-17T08:00:02.000Z",
    "devices": [ /* device.status entries, §6.3 */ ],
    "unacked_results": 2
  }
}
```

*Removed 2026-10-06 (§19): the v2 capabilities `data.pull`, `sync.orders`, `pos.offline`,
`pos.till`, `pos.lan` and `pos.snappfood` are no longer advertised. v3 agents advertise
`app.serve` (§19.3).*

`welcome` (cloud → agent):

```json
{
  "v": 1, "id": "…", "type": "welcome", "ts": "…", "ref": "<hello id>",
  "payload": {
    "protocol_version": 1,
    "session_id": "…",
    "server_time": "2026-09-17T08:15:30.200Z",
    "heartbeat_interval_s": 20,
    "branch": { "id": "…", "name": "Vanak" },
    "config": { /* §6.1 */ },
    "update": { "available": true, "version": "1.0.3" }
  }
}
```

- **Version check.** The cloud picks the highest version in both `protocol_versions` and its
  own supported set. If there is none, it closes with `4010 PROTOCOL_UNSUPPORTED`. If
  `agent_version` is below the cloud's minimum agent version, it closes with
  `4011 UPGRADE_REQUIRED`; the agent MUST then run the update check (§9) at once, and keep
  retrying the update (not the socket) every 5 minutes until it succeeds.
- **Clock.** The agent computes `offset = server_time − local_now` and uses it for every
  `expires_at` comparison (§5.2). It MUST NOT change the Windows clock.
- **One connection per agent.** If the agent already has an open socket, the cloud closes
  the **older** one with `4008 REPLACED` and keeps the new one. An agent that receives `4008`
  MUST NOT reconnect from that socket (its other connection is the live one).
- After `welcome`, the agent first resends every result the cloud has not acked (§4.5), then
  the cloud redelivers every command the agent has not acked (§4.4).

### 4.3 Heartbeats and liveness

- The agent sends `heartbeat` every `heartbeat_interval_s`:

  ```json
  { "type": "heartbeat", "payload": { "in_flight": 1, "unacked_results": 0 } }
  ```

- The cloud answers each with `heartbeat.ack` (`ref` = heartbeat id,
  `payload: { "server_time": "…" }`). The agent refreshes its clock offset from it.
- The cloud marks the agent **offline** when it has received no frame for
  `3 × heartbeat_interval_s`, closes the socket with `1001` (reason `HEARTBEAT_TIMEOUT`),
  and raises an alert.
- The agent treats the connection as dead when it has had no `heartbeat.ack` for
  `2 × heartbeat_interval_s`; it closes the socket and reconnects.
- Both sides MAY also use WebSocket ping/pong; it does not replace `heartbeat`.

The 20 s interval also keeps the Arvan CDN and nginx from closing an idle socket.

### 4.4 Commands, acks and results

A **command** is a cloud → agent message that asks for work (`print.job`,
`payment.charge`, …). The cloud stores every command before sending it.

```
cloud                                          agent
  │ ── print.job (id=C) ───────────────────────► │  record C in the journal
  │ ◄──────────────────────── ack (ref=C, ok) ── │
  │                                              │  … prints …
  │ ◄──────────── print.result (id=R, ref=C) ─── │  record R as unacked
  │ ── ack (ref=R, ok) ────────────────────────► │  mark R acked
```

**Ack** (either direction):

```json
{ "v": 1, "id": "…", "type": "ack", "ts": "…", "ref": "<id being acked>",
  "payload": { "ok": true } }
```

or, when the receiver refuses the message:

```json
{ "type": "ack", "ref": "…",
  "payload": { "ok": false, "error": { "code": "DEVICE_NOT_CONFIGURED", "message": "No printer 4c1e…" } } }
```

Rules for the agent:

1. On receiving a command, the agent MUST write it to its **journal** (§4.6) **before**
   sending `ack ok:true`. `ok:true` means "I have it, and a result will follow".
2. `ok:false` means "I will not run this; no result will follow". The cloud marks the command
   `FAILED` with that code. Use it for: `UNKNOWN_TYPE`, `INVALID_PAYLOAD`, `UNSUPPORTED`,
   `DEVICE_NOT_CONFIGURED`, `EXPIRED`.
3. **Duplicates.** If a command `id` is already in the journal, the agent MUST NOT run it
   again. It sends `ack ok:true` again and, if the result already exists, resends that
   result (same result `id`).
4. Commands for different devices MAY run in parallel. Commands for the **same device** run
   one at a time, in the order received.
5. Every command that was acked `ok:true` ends in exactly one `*.result`.

Rules for the cloud:

1. Command states: `QUEUED → SENT → ACKED → DONE | FAILED`, plus `EXPIRED` when
   `expires_at` passes before the agent acks.
2. The cloud resends a `SENT` command if it has no ack within **15 s**, and resends every
   `QUEUED`/`SENT` command after each `welcome`, oldest first. The `id` never changes.
3. The cloud acks every result with `ack ok:true`, including duplicates. It applies a result
   only once (keyed by the command `id`).

### 4.5 Results from the agent

The agent keeps every result in its journal until the cloud acks it. It resends an unacked
result after **15 s**, and after each `welcome`. A result's `id` is fixed when the agent
creates it and never changes on resend.

### 4.6 The agent journal

Even without offline mode, the agent MUST survive a restart in the middle of a job without
running it twice — above all a card charge. It keeps a small local journal, e.g. a SQLite
file (`modernc.org/sqlite`, no CGO) or bbolt, at
`%ProgramData%\Gnext\Agent\journal.db`, holding for each command:

- the command envelope, when it arrived, its state (`RECEIVED`, `RUNNING`, `DONE`);
- the result envelope, and whether the cloud acked it.

On start, a command found in `RUNNING`:

- `print.job` → report `FAILED` with `AGENT_RESTARTED` (the cloud or a person decides
  whether to reprint; a duplicate chit is worse than a prompt to reprint);
- `payment.charge` → report `UNKNOWN` with `AGENT_RESTARTED` (§7.3). **Never** charge again.

The agent MAY delete journal rows whose result was acked more than 7 days ago.

### 4.7 Reconnecting

After any disconnect other than `4003`, `4008`, `4010`, or an HTTP `401`/`403` on
upgrade, the agent reconnects with exponential backoff: 1 s, 2 s, 4 s … capped at 60 s,
each with ±20 % random jitter. The backoff resets after a `welcome`.

Work already running (a charge on the terminal) continues while the socket is down; its
result waits in the journal.

### 4.8 `error` message

Sent by either side for a frame it cannot handle at the envelope level (bad JSON, missing
fields, a message before `welcome`):

```json
{ "type": "error", "ref": "<offending id or null>",
  "payload": { "code": "BAD_MESSAGE", "message": "missing field: type" } }
```

An `error` is never acked.

### 4.9 Close codes

| Code | Name | Sent by | Agent then |
|---|---|---|---|
| `1000` | normal | either | reconnects (unless it is shutting down) |
| `1001` | going away | either | reconnects |
| `1003` | binary frame | cloud | reconnects; the agent sent a binary frame (a bug) |
| `1009` | message too big | either | reconnects; logs the offending type |
| `1011` | internal error | cloud | reconnects |
| `1012` | service restart | cloud (deploy) | reconnects |
| `4000` | `HANDSHAKE_TIMEOUT` | cloud | reconnects |
| `4001` | `AGENT_KEY_INVALID` | cloud | stops; needs `enrol` |
| `4003` | `AGENT_REVOKED` | cloud | stops; needs `enrol` |
| `4008` | `REPLACED` | cloud | does not reconnect from this socket |
| `4010` | `PROTOCOL_UNSUPPORTED` | cloud | stops the socket; runs update check hourly |
| `4011` | `UPGRADE_REQUIRED` | cloud | updates (§9), then reconnects |
| `4029` | `RATE_LIMITED` | cloud | reconnects after at least 60 s |

## 5. Message types

### 5.1 Catalogue

| Type | Direction | Kind | Answered by |
|---|---|---|---|
| `hello` | agent → cloud | handshake | `welcome` |
| `welcome` | cloud → agent | handshake | — |
| `heartbeat` | agent → cloud | liveness | `heartbeat.ack` |
| `heartbeat.ack` | cloud → agent | liveness | — |
| `ack` | both | ack | — |
| `error` | both | envelope error | — |
| `config.updated` | cloud → agent | command | `ack` only |
| `print.job` | cloud → agent | command | `ack`, then `print.result` |
| `print.result` | agent → cloud | result | `ack` |
| `payment.charge` | cloud → agent | command | `ack`, then `payment.result` |
| `payment.query` | cloud → agent | command | `ack`, then `payment.result` |
| `payment.result` | agent → cloud | result | `ack` |
| `device.status` | agent → cloud | event | `ack` |
| `agent.check_update` | cloud → agent | command | `ack` only |

v2 adds `data.changed` (cloud → agent, command, `ack` only; §12.3), sent only to agents that
advertise `data.pull`. *Removed 2026-10-06 (§19): the cloud no longer sends `data.changed`, and no
agent advertises `data.pull`.* Reserved for later (an agent answers them with
`ack ok:false UNKNOWN_TYPE`): other `sync.*` and `data.*` types, and `order.*`.

### 5.2 Fields common to every command payload

```json
{ "expires_at": "2026-09-17T08:16:30.123Z" }
```

If `now + offset > expires_at` when the command arrives, the agent MUST answer
`ack ok:false EXPIRED` and not run it. Defaults set by the cloud:

| Command | Expires after |
|---|---|
| `print.job` | 30 min |
| `payment.charge` | 60 s (a charge must not start when nobody is at the till) |
| `payment.query` | 10 min |
| `config.updated`, `agent.check_update`, `data.changed` | 24 h |

Expiry is checked **only on arrival**. A command that was acked runs to its end.

## 6. Configuration and devices

### 6.1 Config

The cloud sends the branch's hardware list in `welcome.config`, and again in full in
`config.updated` whenever HQ changes a printer or terminal. The agent replaces its whole
config each time (no merging) and acks. The agent MUST NOT persist config beyond a cache
used for logging; the cloud is the source of truth. (An agent with the offline till keeps the
last config on disk, §13.2.)

```json
{
  "config_version": 17,
  "printers": [
    {
      "id": "4c1e…",
      "code": "KIT1",
      "name": "Kitchen – grill",
      "type": "KITCHEN_IMPACT",
      "paper_width_mm": 80,
      "active": true,
      "connection": { "kind": "windows", "printer_name": "EPSON TM-T20III Receipt" }
    },
    {
      "id": "9a07…",
      "code": "REC1",
      "name": "Front receipt",
      "type": "THERMAL_RECEIPT",
      "paper_width_mm": 80,
      "active": true,
      "connection": { "kind": "tcp", "host": "192.168.1.50", "port": 9100 }
    }
  ],
  "terminals": [
    {
      "id": "e21d…",
      "code": "POS1",
      "name": "Till 1 card reader",
      "active": true,
      "driver": "sep",
      "connection": { "kind": "tcp", "host": "192.168.1.60", "port": 8888 },
      "charge_timeout_s": 90
    }
  ]
}
```

- Until the printer and terminal registers record how the agent reaches each device,
  `connection` and `driver` are `null`. The agent reports such a device as `UNSUPPORTED` and
  refuses commands for it with `DEVICE_NOT_CONFIGURED`.
- `printers[].id` is the cloud `Printer` id. `terminals[].id` is the cloud `PaymentDevice` id.
- `connection.kind`: `windows` (a printer installed in Windows, by its exact name), `tcp`
  (raw socket), or `serial` (`{ "kind": "serial", "port": "COM3", "baud": 115200 }`).
- `driver` names the terminal protocol implementation inside the agent (§7.4). An agent
  that does not have that driver reports the terminal as `status: "UNSUPPORTED"`.

### 6.2 Printing content

`print.job` carries HTML rendered by the cloud (`PrintJob.rendered_html`, about 300 px wide,
UTF-8, may contain Persian RTL text). The agent MUST advertise `print.html` and:

- for `connection.kind = windows`: render the HTML to the printer's page width and print it
  through the Windows driver (for example WebView2 print to the named printer);
- for `tcp` / `serial`: render the HTML to a 1-bit raster at the printer's dot width
  (576 dots for 80 mm, 384 dots for 58 mm) and send it with ESC/POS `GS v 0`, followed by a
  feed and partial cut.

Printing Persian as ESC/POS text is **not** acceptable in v1: code pages do not shape
Arabic script.

A future `content.format` of `escpos` or `raster` MAY be added behind a new capability; the
cloud sends it only to agents that advertise it.

### 6.3 `device.status`

The agent sends `device.status` when a device's status changes, and includes all devices in
`hello.devices`. It SHOULD check each device every 60 s (open the TCP port; for Windows
printers, read the spooler status).

```json
{
  "type": "device.status",
  "payload": {
    "devices": [
      { "kind": "printer", "id": "4c1e…", "status": "ONLINE", "detail": null,
        "checked_at": "…" },
      { "kind": "terminal", "id": "e21d…", "status": "OFFLINE",
        "detail": "dial tcp 192.168.1.60:8888: i/o timeout", "checked_at": "…" }
    ]
  }
}
```

`status`: `ONLINE`, `OFFLINE`, `ERROR` (reachable but faulted: paper out, cover open),
`UNSUPPORTED` (no driver), `UNKNOWN` (not checked yet). The cloud acks it.

For a TCP printer the agent asks the printer for its status (ESC/POS `DLE EOT` 1, 2 and 4)
after connecting. A fault gives `ERROR` with the detail `paper out`, `cover open`,
`printer error` or `printer offline`; paper running low gives `ONLINE` with the detail
`paper low`. A printer that does not answer is `ONLINE` with no detail. A change of detail
is reported like a change of status.

## 7. Commands in detail

### 7.1 `print.job`

```json
{
  "v": 1, "id": "c-…", "type": "print.job", "ts": "…",
  "payload": {
    "expires_at": "…",
    "job_id": "…",
    "attempt_no": 1,
    "printer_id": "4c1e…",
    "document_type": "KITCHEN_TICKET",
    "label": "Grill (1/3)",
    "copies": 1,
    "content": { "format": "html", "html": "<!DOCTYPE html>…" }
  }
}
```

- `job_id` is the cloud `PrintJob` id, `attempt_no` the `PrintAttempt` number. A reprint or
  a retry is a **new command** with a new `id` (and a new job or attempt number).
- The agent prints `copies` copies, each followed by a cut.
- If `printer_id` is not in the current config, or is `active: false`, the agent answers
  `ack ok:false DEVICE_NOT_CONFIGURED`.

### 7.2 `print.result`

```json
{
  "v": 1, "id": "r-…", "type": "print.result", "ts": "…", "ref": "c-…",
  "payload": {
    "job_id": "…",
    "attempt_no": 1,
    "printer_id": "4c1e…",
    "status": "SUCCESS",
    "copies_printed": 1,
    "started_at": "…",
    "finished_at": "…",
    "error": null
  }
}
```

- `status`: `SUCCESS` or `FAILED`.
- On `FAILED`, `error` is `{ "code": "PAPER_OUT", "message": "…" }` with a code from §8.3.
- For a printer that answers status questions, the agent checks it before sending (a fault
  fails the job with nothing printed) and after sending asks `GS r 1`, which the printer only
  answers once everything before it has printed, checking `DLE EOT` every second meanwhile.
  `SUCCESS` then means the printer confirmed the ticket printed; a fault while waiting fails
  it with that code, and the message says the ticket may be partly printed. For a printer
  that does not answer, `SUCCESS` means the printer accepted all copies, as before. The agent
  remembers per printer which questions go unanswered until it restarts, so a silent printer
  is not waited on for every ticket.
- The cloud records the result on `PrintAttempt` and `PrintJob`, and the existing fallback
  and retry rules decide what happens next.

### 7.3 `payment.charge`

```json
{
  "v": 1, "id": "c-…", "type": "payment.charge", "ts": "…",
  "payload": {
    "expires_at": "…",
    "payment_id": "…",
    "attempt_id": "…",
    "attempt_no": 1,
    "terminal_id": "e21d…",
    "amount": "1250000",
    "currency": "IRR",
    "order_number": "V-1024",
    "payment_number": "PAY-000812",
    "timeout_s": 90
  }
}
```

The agent sends the amount to the terminal and waits up to `timeout_s` for the customer and
the bank. `attempt_id` is the cloud `PaymentAttempt` id; the agent SHOULD pass it (or a
number derived from it) to the terminal as the merchant reference, if the terminal's
protocol has one, so `payment.query` can find the transaction later.

**The one rule that matters most:** once the amount has been sent to the terminal, the agent
MUST NOT report `FAILED`. Without a definite answer from the terminal, the result is
`UNKNOWN`. The customer may already have been charged.

### 7.4 `payment.result`

```json
{
  "v": 1, "id": "r-…", "type": "payment.result", "ts": "…", "ref": "c-…",
  "payload": {
    "payment_id": "…",
    "attempt_id": "…",
    "terminal_id": "e21d…",
    "status": "APPROVED",
    "amount": "1250000",
    "rrn": "123456789012",
    "stan": "004512",
    "auth_code": "A1B2C3",
    "terminal_serial": "PAX-8812",
    "card_pan_masked": "603799******1234",
    "bank_response_code": "00",
    "started_at": "…",
    "finished_at": "…",
    "error": null
  }
}
```

| `status` | Meaning | Cloud records |
|---|---|---|
| `APPROVED` | Terminal confirmed the charge. `rrn` is required. | payment `SUCCEEDED`, reference = `rrn` |
| `DECLINED` | Terminal / bank refused it. | attempt `FAILED`, `DECLINED` |
| `CANCELLED` | The customer or cashier cancelled on the terminal before it went to the bank. | attempt `FAILED`, `CANCELLED` |
| `FAILED` | The agent is **sure** the charge never reached the terminal (could not connect, terminal said busy before accepting). | attempt `FAILED` with the error code |
| `UNKNOWN` | Anything else: timeout after sending, connection dropped mid-charge, agent restarted, unparseable reply. | payment stays `PROCESSING`, flagged **needs check**; never auto-failed |

- `card_pan_masked` MUST keep at most the first 6 and last 4 digits. The agent MUST NOT send
  or log a full PAN, track data, PIN block or CVV.
- `amount` echoes the amount the terminal reports, if it reports one. If it differs from the
  requested amount, the agent reports it as is; the cloud flags the mismatch.
- `bank_response_code` and a raw vendor code MAY go in `error.detail` for `DECLINED`.

### 7.5 `payment.query`

Sent by the cloud for an `UNKNOWN` payment — automatically once, 30 s after the `UNKNOWN`
result, and again whenever a cashier presses **Check with terminal**.

```json
{
  "type": "payment.query",
  "payload": {
    "expires_at": "…",
    "payment_id": "…",
    "attempt_id": "…",
    "terminal_id": "e21d…",
    "amount": "1250000",
    "sent_at": "2026-09-17T08:15:31.000Z"
  }
}
```

The agent asks the terminal about that transaction (by merchant reference, or last
transaction if the terminal only supports that) and answers with a `payment.result` whose
`ref` is the **query** command's id. The status is `APPROVED`, `DECLINED`, `CANCELLED`, or
still `UNKNOWN` if the terminal cannot tell. `FAILED` is not allowed for a query.

An agent whose terminal driver cannot query at all does not advertise `payment.query`; the
cloud then leaves the payment for a person to resolve against the terminal's own report.

### 7.6 Terminal drivers

The terminal protocol depends on the bank/PSP that supplied the device. The agent contains
one driver per protocol behind a common interface, for example:

```go
type TerminalDriver interface {
    Charge(ctx context.Context, req ChargeRequest) (ChargeResult, error)
    Query(ctx context.Context, req QueryRequest) (ChargeResult, error) // may return ErrQueryUnsupported
    Probe(ctx context.Context) (DeviceStatus, error)
}
```

`config.terminals[].driver` selects the driver. v1 needs exactly one real driver, `sep`, for
the Saman terminal on the test branch PC (§15), plus a `fake` driver (approves amounts ending in `0`,
declines amounts ending in `1`, times out on `2`) for development.

### 7.7 `config.updated`

Payload is the full config object (§6.1). The agent replaces its config and acks. A job
already running on a device that was removed runs to its end.

### 7.8 `agent.check_update`

Empty payload besides `expires_at`. The agent acks and runs the update check (§9) now.

## 8. Errors

### 8.1 Envelope and ack error codes

| Code | Meaning |
|---|---|
| `BAD_MESSAGE` | Not JSON, or missing `v`/`id`/`type`. |
| `NOT_READY` | A message other than `hello` before `welcome`. |
| `UNKNOWN_TYPE` | The receiver does not know `type`. |
| `INVALID_PAYLOAD` | Payload is missing required fields or has wrong types. |
| `UNSUPPORTED` | Type known, but a capability it needs is missing (e.g. `payment.query`). |
| `DEVICE_NOT_CONFIGURED` | `printer_id` / `terminal_id` not in config, or inactive. |
| `EXPIRED` | Command arrived after `expires_at`. |
| `INTERNAL` | Unexpected failure in the receiver. |

### 8.2 HTTPS errors

Every non-2xx response has the backend's usual problem-details body. The agent reads
`status` and `code`; `detail` is a human-readable message for the log.

```json
{
  "type": "https://gnext.local/problems/internal",
  "title": "Enrolment Refused",
  "status": 400,
  "code": "ENROLMENT_CODE_EXPIRED",
  "detail": "The enrolment code has expired. Ask head office for a new one.",
  "instance": "/api/v1/agent/enrol",
  "correlationId": "…"
}
```

| HTTP | `code` |
|---|---|
| 400 | `ENROLMENT_CODE_INVALID`, `ENROLMENT_CODE_EXPIRED`, `ENROLMENT_CODE_USED`, `PROTOCOL_UNSUPPORTED`, `INVALID_PAYLOAD` |
| 401 | `AGENT_KEY_INVALID` |
| 403 | `AGENT_REVOKED` |
| 429 | `RATE_LIMITED`; wait `context.retryAfter` seconds |

For any other status (404, 5xx) the agent MUST go by the HTTP status alone, not `code`, and
retry 5xx with the §4.7 backoff.

### 8.3 Device error codes (`result.payload.error.code`)

Printing:

| Code | Meaning |
|---|---|
| `PRINTER_UNREACHABLE` | TCP/serial connect failed, or Windows printer not found. |
| `PRINTER_OFFLINE` | The printer (or spooler) reports itself offline for no reason below. |
| `PAPER_OUT` | The printer reports its paper end. |
| `COVER_OPEN` | The printer reports its cover open. |
| `PRINTER_ERROR` | Any other fault the printer reports (cutter jam, overheating). |
| `RENDER_FAILED` | The agent could not turn the HTML into output. |
| `SPOOLER_ERROR` | Windows spooler refused the job. |
| `TIMEOUT` | No completion within 60 s. |
| `AGENT_RESTARTED` | The agent restarted while the job was running. |

Payments (`error.code` next to the `status` in §7.4):

| Code | With status | Meaning |
|---|---|---|
| `TERMINAL_UNREACHABLE` | `FAILED` | Could not connect; nothing was sent. |
| `TERMINAL_BUSY` | `FAILED` | Terminal refused before accepting the amount. |
| `DECLINED` | `DECLINED` | Bank or terminal refused; see `bank_response_code`. |
| `CANCELLED_BY_USER` | `CANCELLED` | |
| `TIMEOUT` | `UNKNOWN` | No final answer within `timeout_s`. |
| `CONNECTION_LOST` | `UNKNOWN` | Link to the terminal dropped mid-charge. |
| `BAD_RESPONSE` | `UNKNOWN` | The terminal's reply could not be parsed. |
| `AGENT_RESTARTED` | `UNKNOWN` | The agent restarted mid-charge. |
| `QUERY_UNSUPPORTED` | `UNKNOWN` | Reply to a query the driver cannot run. |

## 9. Updates

### 9.1 `GET /api/v1/agent/releases/latest`

Auth required. The agent calls it on start, every hour (with ±5 min jitter), on
`agent.check_update`, and after `4011`.

`200 OK`:

```json
{
  "version": "1.0.3",
  "url": "/api/v1/agent/releases/1.0.3/gnext-agent.exe",
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "size": 9876543,
  "released_at": "2026-09-20T10:00:00.000Z",
  "min_agent_version": "1.0.0",
  "bridge": {
    "url": "/api/v1/agent/releases/1.0.3/gnext-saman-bridge.zip",
    "sha256": "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae",
    "size": 84337
  }
}
```

`204 No Content` when no release has been published. `bridge` is the Saman bridge built with
the release (§9.3), or `null` for a release that has none; agents before 1.11.5 ignore it.

`url` and `bridge.url` are relative to the server. A download needs the same auth header and
returns `application/octet-stream` with `Content-Length` and an `X-Content-SHA256` header. An
unknown or unpublished version, or a bridge a release does not have, is `404`.

Every green push to `main` offers the agent CI built to the cloud (`POST
/api/v1/agent-releases/ci`, bearer `AGENT_RELEASE_CI_TOKEN`) once the deploy is done, with its
setup wizard and its bridge zip. It is stored unpublished, and only a new `agent/VERSION` makes
a new release; the same version again only adds a setup wizard or bridge the release still
lacks, and only when its exe is the stored one. A change to the bridge alone therefore needs a
bump of `agent/VERSION` too. Head office can still upload a build by hand on the Branch Agents screen, and
publishes either kind there. Publishing sends `agent.check_update` to every online agent older than the build. A release may set
`min_agent_version`; agents below it are closed with `4011` (§4.2).

### 9.2 Update procedure

If `version` is greater than the agent's own (semver comparison):

1. Wait until the agent has no command in `RUNNING` state. Accept no new `payment.charge`
   during this wait (`ack ok:false UNSUPPORTED` with message `updating`); `print.job` still
   runs.
2. Download to `%ProgramData%\Gnext\Agent\updates\gnext-agent-<version>.exe`.
3. Check `size` and `sha256`. On mismatch, delete the file, log it, and try again at the next
   check. Never run a file that fails the check.
4. Rename the running `gnext-agent.exe` to `gnext-agent.old-<running version>.exe` (Windows
   allows renaming a running executable), move the new file into its place. A file already
   under that name that cannot be removed (a window opened before an earlier update still runs
   from it) is left alone, and the name gets a number: `gnext-agent.old-1.10.2-2.exe`.
5. Close the WebSocket with `1001` and exit with code `3`. The service recovery settings
   (§3.1) restart the service on the new binary.
6. The new binary deletes every `gnext-agent.old*.exe` it can once it has received a
   `welcome`; one still in use goes at a later `welcome`. The settings window closes and opens
   again from the new binary when it sees the agent report the new version. The offline till
   window does not, since its page holds the cart being rung up; it lets go of the old binary
   when the cashier closes it.

If the new binary fails to start three times, an administrator restores the newest
`gnext-agent.old-<version>.exe` by hand. Automatic rollback is not in v1.

### 9.3 Saman bridge

The `sep` driver runs `saman\gnext-saman-bridge.exe` beside the agent (§7.6). The binary update
of §9.2 does not touch that folder. Instead, when `version` equals the agent's own and `bridge`
is set, and `saman\release.sha256` does not hold `bridge.sha256`:

1. Download to `%ProgramData%\Gnext\Agent\updates\gnext-saman-bridge-<version>.zip` and check
   `size` and `sha256` as in §9.2. Charges still run meanwhile.
2. Unpack into `saman.new` beside `saman`. Every entry must stay inside it, and it must hold
   `gnext-saman-bridge.exe`; otherwise nothing changes. Write `bridge.sha256` to
   `saman.new\release.sha256`.
3. Wait as in §9.2 step 1, and for any bridge still running (a status check). Rename `saman`
   to `saman.old` (`saman.old-2` and on when an earlier one cannot be removed) and `saman.new`
   to `saman`; if the second rename fails, `saman.old` goes back. Delete `saman.old`.

So an agent updated by §9.2 takes its bridge at the first check of the new binary, about ten
seconds after it starts, and a PC with the right bridge downloads nothing. The installer
deletes `saman` before it lays down its own bridge, without the marker, so an installed PC takes
the published bridge once. An agent run with `GNEXT_SAMAN_BRIDGE` set (development) leaves its
bridge alone.

No code signing in v1; the SHA-256 comes over the authenticated TLS channel.

## 10. How the cloud uses the agent (for context)

Not part of the wire contract, but it explains the behaviour the agent will see.

- A branch is **agent-online** while its agent has a live socket past `welcome`.
- A printer or terminal with a `connection` belongs to the agent: its jobs always go through
  the agent. While the agent is offline they wait (until `expires_at`), and then fail with
  an alert. A device without a `connection` stays on the in-process simulator, as today.
- A charge started while the agent is online stays with the agent even if it disconnects:
  the cloud waits for the result on reconnect and never retries it through the simulator.
- A `payment.charge` that expires is failed only if it was never written to the socket. One
  that was sent but never acked is treated as `UNKNOWN`: the payment stays `PROCESSING`, flagged
  for a terminal check, and the cloud sends `payment.query` 30 s later if the agent advertises
  it. A manager can also settle it by hand from the terminal's report (charged, with its RRN,
  or not charged).
- An `APPROVED` result without an `rrn`, or for a different amount, is held for a check, not
  booked.
- The cloud raises an `OperationalAlert` when an agent goes offline, and closes it when the
  agent comes back.
- HQ sees on the Agents screen: status, version, last seen, devices and their status, and
  recent commands.

## 11. Worked session

```
→ GET wss://app.example.ir/api/v1/agent/ws   Authorization: Bearer gak_…
← 101 Switching Protocols
→ {"v":1,"id":"a1","type":"hello","ts":"…","payload":{"agent_version":"1.0.0","protocol_versions":[1],"capabilities":["print.html","payment.charge","payment.query"],"devices":[],"unacked_results":0}}
← {"v":1,"id":"s1","type":"welcome","ref":"a1","ts":"…","payload":{"protocol_version":1,"session_id":"…","server_time":"…","heartbeat_interval_s":20,"config":{…},"update":{"available":false}}}
→ {"v":1,"id":"a2","type":"device.status","ts":"…","payload":{"devices":[{"kind":"printer","id":"4c1e…","status":"ONLINE"}]}}
← {"v":1,"id":"s2","type":"ack","ref":"a2","ts":"…","payload":{"ok":true}}
← {"v":1,"id":"C7","type":"payment.charge","ts":"…","payload":{"expires_at":"…","payment_id":"P","attempt_id":"T","attempt_no":1,"terminal_id":"e21d…","amount":"1250000","currency":"IRR","order_number":"V-1024","payment_number":"PAY-000812","timeout_s":90}}
→ {"v":1,"id":"a3","type":"ack","ref":"C7","ts":"…","payload":{"ok":true}}
   … socket drops while the customer enters the PIN; agent reconnects …
→ hello / ← welcome
→ {"v":1,"id":"a4","type":"payment.result","ref":"C7","ts":"…","payload":{"payment_id":"P","attempt_id":"T","terminal_id":"e21d…","status":"APPROVED","amount":"1250000","rrn":"123456789012","card_pan_masked":"603799******1234",…}}
← {"v":1,"id":"s5","type":"ack","ref":"a4","ts":"…","payload":{"ok":true}}
→ {"v":1,"id":"a5","type":"heartbeat","ts":"…","payload":{"in_flight":0,"unacked_results":0}}
← {"v":1,"id":"s6","type":"heartbeat.ack","ref":"a5","ts":"…","payload":{"server_time":"…"}}
```

## 12. Branch data and offline sync (v2)

*Removed 2026-10-06 (§19). Kept for history; nothing here is built any more.*

Status: **draft for review** (HANDOFF tasks 10–13). Protocol version stays **1**: everything
here is new endpoints, a new command and new optional fields, switched on by capabilities.

v2 is built in two steps. This section is the first: the agent keeps a copy of what the
branch sells, and the cloud accepts orders the branch took while it was offline. The second
step, the **offline POS** (a till screen served by the agent that takes orders, prints and
charges while the internet is down), produces those orders. It is specified in §13; until it
lands, the only offline orders are the ones tests make.

### 12.1 Capabilities

| Capability | Means |
|---|---|
| `data.pull` | The agent keeps the branch snapshot (§12.2) and handles `data.changed` (§12.3). |
| `sync.orders` | The agent uploads offline orders (§12.5) and reports `sync` in heartbeats (§12.7). |

The cloud sends `data.changed` only to an agent that advertises `data.pull`. A v1 agent
advertises neither and sees no change.

### 12.2 Branch snapshot: `GET /api/v1/agent/data/snapshot`

Everything the branch needs to sell without the cloud, in one JSON document for the agent's
branch. The menu is hundreds of rows, not millions, so there is no paging and no deltas: the
agent fetches the whole snapshot when it changes.

Request headers: the usual auth (§3.4), `Accept-Encoding: gzip`, and
`If-None-Match: "<data_version>"` when the agent already holds one.

- `200` with the snapshot and `ETag: "<data_version>"`.
- `304` when the agent's copy is current.

`data_version` is a hash of the snapshot's content (not a counter), so two identical
snapshots have the same version and a pull that changes nothing is a `304`.

```json
{
  "data_version": "b1f0c9…",
  "generated_at": "2026-09-24T08:00:00.000Z",
  "branch": {
    "id": "…", "code": "CP", "name": "Central Plaza",
    "currency_code": "IRR", "time_zone": "Asia/Tehran"
  },
  "settings": {
    "call_numbers": { "POS": { "start": 100, "end": 399 } },
    "call_number_issued_today": { "business_date": "2026-09-24", "POS": 37 },
    "business_day": {
      "business_date": "2026-09-24", "cutoff": "04:00", "time_zone": "Asia/Tehran",
      "opens_at": "08:00", "closes_at": "04:00", "ends_at": "2026-09-25T00:30:00.000Z"
    }
  },
  "categories": [
    { "id": "…", "parent_id": null, "name": "برگر", "sort_order": 1 }
  ],
  "products": [
    {
      "id": "…", "code": "B01", "name": "چیزبرگر", "category_id": "…",
      "price": "2450000",
      "tax_rate": "0.1000",
      "max_per_order": null,
      "variants": [ { "id": "…", "name": "دوبل", "price": "3100000" } ],
      "option_groups": [
        {
          "id": "…", "name": "نوشیدنی", "min": 0, "max": 1, "required": false,
          "items": [ { "id": "…", "name": "کوکا", "price_delta": "350000", "product_id": null } ]
        }
      ],
      "is_available": true
    }
  ],
  "availability": {
    "stopped": [
      { "product_id": null, "variant_id": null, "option_item_id": "…", "until": "2026-09-24T12:00:00.000Z" }
    ],
    "schedules": [
      { "product_id": "…", "windows": [ { "days": [6, 0, 1, 2, 3, 4], "from": "11:00", "to": "16:00" } ] }
    ],
    "daily_stock": [ { "product_id": "…", "variant_id": null, "remaining": 12 } ]
  },
  "payment_methods": [ { "id": "…", "code": "CASH", "name": "نقد", "kind": "CASH" } ],
  "order_types": ["TAKEAWAY", "DINE_IN", "DELIVERY"],
  "dining_tables": [ { "id": "…", "area": "سالن", "number": "12", "seats": 4 } ],
  "delivery_zones": [ { "id": "…", "name": "ونک", "fee": "400000" } ],
  "tills": [ { "id": "…", "code": "T1", "name": "صندوق ۱", "payment_device_id": "e21d…" } ],
  "open_shifts": [
    {
      "id": "…", "terminal_id": "…", "user_id": "…", "shift_number": "S-0412",
      "business_date": "2026-09-24", "opened_at": "…"
    }
  ]
}
```

- **Prices are this branch's in-store prices** (its price list, else the base price), the
  same numbers the register shows. Money is whole rials as strings (§2.1). `tax_rate` is a
  fraction as a decimal string.
- `products` holds active products only. A product that is stopped, outside its selling
  window or sold out right now is still listed, with `is_available: false`, so the offline
  till can show it greyed out. `availability` gives the rules behind that flag, so the
  offline till can re-evaluate them as the day goes on.
- An option item a product leaves out of its group is not listed under that product.
- `stopped` holds the stops that apply to a sale in store: a whole product, one size
  (`variant_id`) or one add-on (`option_item_id`), until `until` (`null`: until someone puts it
  back). A stop on Snappfood only is left out.
- `schedules` lists each product that sells only in set windows (its own, else its
  category's); a product not listed sells all day. `days`: 0 = Sunday … 6 = Saturday, on the
  branch's clock. A window whose `to` is at or before its `from` runs past midnight.
- `daily_stock.remaining` is today's count less what was sold when the snapshot was made.
- `call_number_issued_today.POS` is how many POS call numbers the cloud has handed out today.
- `business_day` is how the branch dates what it sells: the business day turns over at
  `cutoff` on `time_zone`'s clock, not at midnight, so a sale at 01:30 belongs to the day
  before. `business_date` is the day in progress when the snapshot was made and `ends_at` the
  instant it turns over. The offline till dates each order and call number the same way.
- `tills` holds the branch's cashier tills, not kiosks.
- Names are the ones the register shows (Persian for Persian tenants).
- **Not in the snapshot**: customers, coupons and discounts, users and PINs (the offline till
  gets its own staff list, §13.3), reports, other branches' data, printer and terminal config
  (that stays in `welcome.config`, §6.1). §13.11 adds settings and print routing.
- The cloud MUST keep every snapshot it served, by `data_version`, for **30 days**. §12.6
  checks an offline order against the snapshot its till used.

The agent:

- MUST pull after every `welcome`, on `data.changed`, and every **15 minutes**. It sends the
  version it holds in `If-None-Match`, so a pull that finds nothing new is a `304`. A failed pull is retried with the
  §4.7 backoff; the agent keeps selling from the copy it has.
- MUST store the snapshot atomically (write a temporary file, then rename) in its data
  folder, and keep the previous one. It MUST NOT edit a snapshot.
- Sells from the snapshot on the offline till (§13). An agent without it only keeps the
  snapshot and reports its version (§12.7).

### 12.3 `data.changed` (cloud → agent)

A command, answered by `ack` only. Payload: `{ "expires_at": "…", "data_version": "…" }`.
It expires after 24 h.

The cloud sends it when anything in the branch's snapshot changes: catalog, prices,
availability (stops, schedules, stock counts), payment methods, tables, delivery zones, tills,
settings, or a shift opens or closes on one of the branch's tills. It coalesces changes into
at most one notice every 10 s, and skips the notice when the agent last fetched that very
version. The agent answers with `ack` and pulls (§12.2).

`data.changed` is a hint. Stock sold and call numbers drawn change with every order and are
not announced; they, a price that takes effect at a set time, and anything else the cloud did
not announce reach the agent with its 15-minute pull.

### 12.4 Offline orders

An offline order is one the branch took while the agent could not reach the cloud. The agent
gives it a UUID v4, which becomes the cloud order's `id`, so an order uploaded twice is still
one order.

The agent uploads an order **once**, when its offline life ends:

- `COMPLETED`: paid in full, and handed over.
- `CANCELLED`: voided before it was paid.
- `OPEN`: still open when the link returned (a table still eating). The cloud takes it over as
  an ordinary submitted order, and staff finish it on the normal POS.

After an order is uploaded the agent never changes it. Anything that happens later happens in
the cloud.

```json
{
  "id": "7d3c…",
  "data_version": "b1f0c9…",
  "state": "COMPLETED",
  "terminal_id": "…",
  "shift_id": "…",
  "created_by": "…",
  "channel": "POS",
  "order_type": "DINE_IN",
  "table_id": "…",
  "guest_count": 2,
  "delivery_zone_id": null,
  "call_number": 138,
  "business_date": "2026-09-24",
  "placed_at": "2026-09-24T09:12:40.000Z",
  "completed_at": "2026-09-24T09:40:02.000Z",
  "cancelled_at": null,
  "cancellation_note": null,
  "notes": null,
  "lines": [
    {
      "id": "…",
      "product_id": "…", "product_name": "چیزبرگر",
      "variant_id": "…", "variant_name": "دوبل",
      "quantity": "2",
      "unit_price": "3100000",
      "options": [ { "option_item_id": "…", "name": "کوکا", "price_delta": "350000" } ],
      "tax_rate": "0.1000",
      "line_total": "6900000",
      "tax": "690000",
      "notes": "بدون پیاز"
    }
  ],
  "totals": {
    "subtotal": "6900000",
    "delivery_fee": "0",
    "discount_total": "0",
    "tax_total": "690000",
    "grand_total": "7590000"
  },
  "payments": [
    {
      "id": "…",
      "method_id": "…", "method_kind": "CARD",
      "amount": "7590000",
      "status": "APPROVED",
      "card": {
        "terminal_id": "e21d…", "rrn": "123456789012", "stan": "004512",
        "card_pan_masked": "603799******1234", "response_code": "00"
      },
      "at": "2026-09-24T09:39:50.000Z"
    }
  ],
  "prints": [
    { "printer_id": "4c1e…", "kind": "KITCHEN", "status": "PRINTED", "at": "2026-09-24T09:12:43.000Z" }
  ]
}
```

- `quantity` is a whole number. `line_total = (unit_price + Σ price_delta) × quantity`;
  `tax = line_total × tax_rate`, rounded to the nearest rial, halves up. Totals are the sums.
  `grand_total = subtotal + delivery_fee − discount_total + tax_total`.
- Names travel with the line, so an order stays readable if its product is deleted later.
- `discount_total` is always `"0"` in v2: no coupons or manual discounts offline.
- `payments[].status`: `APPROVED`, or `UNKNOWN` for a charge whose result the terminal never
  gave (§7.4). Declined and cancelled attempts are not uploaded. Cash payments have no `card`.
- A voided line is left out. A `CANCELLED` order has no payments.
- `shift_id` is the shift that was open on that till when the order was taken
  (`open_shifts` in the snapshot). The offline POS does not open or close shifts.
- `call_number` continues the day's `POS` range from `call_number_issued_today` in the
  snapshot, wrapping back to the range's start when it runs out, as the cloud does.

### 12.5 Upload: `POST /api/v1/agent/sync/orders`

Body: `{ "orders": [ … ] }`, **at most 50 orders and 1 MiB** before gzip
(`Content-Encoding: gzip` is accepted). Oldest `placed_at` first.

Once the cloud answers `200`, **it owns every order in the batch**. It saves each one as
received, before it tries to turn it into an order, so nothing the agent sent is lost if the
processing fails. The agent marks them uploaded.

```json
{
  "results": [
    { "id": "7d3c…", "result": "ACCEPTED", "order_number": "ORD-20260924-0183", "flags": ["PRICE_CHANGED"] },
    { "id": "8e11…", "result": "DUPLICATE", "order_number": "ORD-20260924-0170", "flags": [] },
    { "id": "9a02…", "result": "HELD", "order_number": null, "flags": ["TOTAL_MISMATCH"] }
  ]
}
```

| `result` | Means |
|---|---|
| `ACCEPTED` | Now a cloud order. `flags` lists anything a person should look at (§12.6). |
| `DUPLICATE` | The same `id` with the same content was already uploaded. Nothing changed. |
| `HELD` | Saved but not booked; a person fixes the cause and retries it from the cloud (§12.7). |

Whole-batch errors (§8.2): `400 INVALID_PAYLOAD` (not JSON, over the limits, or an order
without `id`), `401`/`403` as usual. On a `400` the agent MUST split the batch to find the bad
order, upload the rest, and keep the bad one with the error for the logs. On `5xx` or a network
error it retries the same batch with the §4.7 backoff.

The agent:

- keeps offline orders in its data folder (bbolt) until the cloud answers `200` for them, and
  then for 7 more days (for reprints and support);
- starts uploading after each `welcome`, and keeps one batch in flight at a time;
- MUST NOT upload an order before its offline life has ended (§12.4).

The same `id` with **different** content is `HELD` with `ID_REUSED`; the first upload stands, and
the second is kept only in the audit trail. A resend of a `HELD` order stays `HELD` until head office
retries it.

`HELD` reasons, in `flags`: `TOTAL_MISMATCH`, `PRICE_MISMATCH` (§12.6), `ID_REUSED`, `SHIFT_UNKNOWN`
(`shift_id` is not a shift of this branch), `INVALID_ORDER` (the order does not have the §12.4 shape,
or names a payment method the tenant does not have), `PROCESSING_FAILED` (anything else; the
cloud logs it).

### 12.6 What the cloud does with an uploaded order

The cloud takes the branch's word for what happened: the food went out and the money was
taken. It never refuses a sale that was made. It books the order as the till recorded it and
**flags** anything that disagrees with the cloud, so a person can look. It never rewrites a
number silently.

| Check | Outcome |
|---|---|
| Arithmetic: line totals, tax (±1 rial a line) and totals add up | Otherwise `HELD` `TOTAL_MISMATCH` |
| The price charged matches the snapshot the till used (`data_version`) | Otherwise `HELD` `PRICE_MISMATCH`: the till charged a price the cloud never gave it |
| The snapshot's price matches today's cloud price | Otherwise booked at the charged price, flag `PRICE_CHANGED` |
| `data_version` is one the cloud still keeps | Otherwise the price check is skipped, flag `SNAPSHOT_UNKNOWN` |
| Product, variant or option still exists and is active | Otherwise booked with the names from the order, flag `ITEM_REMOVED` |
| `shift_id` is a shift of this branch | Otherwise `HELD` `SHIFT_UNKNOWN` |
| `shift_id` is open | Closed: booked into that shift anyway, flag `SHIFT_CLOSED` (its cash count changes) |
| `business_date` is not closed | Closed: booked on that date anyway, flag `DAY_CLOSED` |
| `business_date` is the one the branch's cutoff gives `placed_at` | Otherwise booked on the till's date anyway, flag `BUSINESS_DATE_DIFFERS` |
| Daily stock covers it | Otherwise stock goes below zero, flag `STOCK_NEGATIVE` |
| `table_id`, if any, is one of this branch's tables | Otherwise booked without a table, flag `TABLE_UNKNOWN` (staff seat an open one again) |
| A card payment is `APPROVED` with an `rrn` | `UNKNOWN`: the payment is `PROCESSING` with `needs_terminal_check`, and a manager resolves it as today (§10) |

A booked order:

- keeps its `id`, `call_number`, `placed_at`, `business_date` and the till's prices, and gets an
  `order_number` from the cloud's sequence at upload time;
- is marked as taken offline (`source = AGENT_OFFLINE`), and shows so in the order directory;
- is **not** sent to the kitchen screens or printed again, since the branch already made it;
- has its payments posted to its shift, and enters the Moadian sweep like any completed order;
- moves the day's `POS` call-number counter up to at least its `call_number`;
- is audited under `created_by`, with the agent as the source.

`OPEN` orders are booked as submitted orders, in the same way, and continue on the normal POS.

### 12.7 Sync status

An agent with `sync.orders` adds this to every `heartbeat`:

```json
{
  "sync": {
    "data_version": "b1f0c9…",
    "data_pulled_at": "2026-09-24T08:00:03.000Z",
    "pending_orders": 3,
    "oldest_pending_at": "2026-09-24T09:12:40.000Z",
    "last_upload_at": "2026-09-24T09:50:00.000Z",
    "last_upload_error": null
  }
}
```

The cloud shows it on the Agents screen, with a warning when the agent's `data_version` is
older than the current snapshot for more than 30 minutes, or when orders have waited more than
10 minutes while the agent is online.

Head office also sees the orders each agent uploaded: flagged ones, with **Mark reviewed**, and
held ones, with **Retry** (the saved order goes through §12.6 again, for example after the
missing product is restored).

### 12.8 Not in v2

The offline POS step (§13): signing in offline, rendering tickets on the agent, and serving the
till screen. For later, if at all: coupons, discounts,
refunds and customer lookup offline; opening or closing shifts offline. Snappfood orders keep
arriving in the cloud while a branch is offline, and wait there; while the cloud itself is away,
the till takes them (§17).

v3: replay protection, batch signing, key rotation, back-pressure, resumable uploads of very
large backlogs.

## 13. Offline POS (v2, second step)

*Removed 2026-10-06 (§19). Kept for history; nothing here is built any more.*

Status: **draft for review** (P0 of `HANDOFF-offline-pos.md`). Protocol version stays **1**:
one new endpoint, new optional fields, and a local page, switched on by a capability.

When the branch loses the internet, the cashier goes on selling on a **till screen the agent
serves on the branch PC**. The till sells from the snapshot (§12.2), prints and charges through
the agent's own devices, and hands each order to the upload (§12.5) when its offline life ends
(§12.4). The cloud books it by §12.6. Nothing in §12 changes; this section is what produces the
orders §12 accepts.

### 13.1 Decisions

Confirmed by the product owner on 2026-09-24. §16 (2026-09-25) makes the till the branch PC's
register online too, and replaces decisions 2 and 4: sign-in by PIN also opens a cloud session,
and the till switches by itself.

1. **Where.** The till runs on the branch PC only, at `http://127.0.0.1:47800/till`, in the
   agent's settings window or a browser on that PC. One offline till a branch. Tills on the
   LAN come later, if at all.
2. **Sign-in.** A cashier signs in by picking their name and typing their PIN, which the agent
   checks against a staff list it keeps from the cloud (§13.3).
3. **Which till.** A manager binds the agent to one of the branch's tills once (§13.4). Offline
   orders are rung up on that till and its open shift.
4. **Switching.** By hand. The web POS shows a banner when it cannot reach the cloud, and the
   tray has an entry; nothing switches on its own, so two screens never take orders at once.
5. **Scope.** Takeaway and dine-in; cash and card. Not offline: delivery, coupons and
   discounts, refunds, customer lookup, opening or closing a shift, and orders that were open in
   the cloud when the link dropped (they wait there).

### 13.2 Capability

| Capability | Means |
|---|---|
| `pos.offline` | The agent serves the offline till (§13.5), keeps the staff list (§13.3), and reports `till` in heartbeats (§13.10). |

The cloud serves `GET /api/v1/agent/data/staff` and adds `call_numbers` to `heartbeat.ack`
(§13.9) only for an agent that advertises `pos.offline`. It requires `data.pull` and
`sync.orders`.

An agent with `pos.offline` MUST keep the last config (§6.1) on disk and load it at start, so
an agent restarted while offline still reaches its printers and terminal. This replaces §6.1's
"MUST NOT persist config" for such an agent. The cloud stays the source of truth: every
`welcome` and `config.updated` overwrites the copy.

### 13.3 Staff list: `GET /api/v1/agent/data/staff`

Who may sign in at this branch's offline till, with their PIN hashes. It is a separate document
from the snapshot on purpose: the cloud keeps every served snapshot for 30 days (§12.2), and PIN
hashes must not pile up there.

Same request rules as the snapshot: auth (§3.4), `If-None-Match: "<staff_version>"`, `200` with
`ETag`, or `304`.

```json
{
  "staff_version": "5e2a…",
  "generated_at": "2026-09-24T08:00:00.000Z",
  "users": [
    {
      "id": "…", "display_name": "سارا احمدی", "role": "CASHIER",
      "pin_hash": "$argon2id$v=19$m=65536,t=3,p=4$…"
    }
  ]
}
```

- `users` holds the active users whose branch is this branch and who have a PIN, in the roles
  `CASHIER`, `SUPERVISOR`, `MANAGER`, `ADMIN` and `OWNER`. Head office users without a branch are
  left out. A user without a PIN cannot sign in offline.
- `pin_hash` is the hash the cloud already stores (`admin_user.pin_hash`, argon2id in PHC form).
  The agent verifies with the same algorithm (`golang.org/x/crypto/argon2`). A PIN is 4 to 8
  digits, as online.
- The cloud sends `data.changed` (§12.3) when the list changes: a user added, deactivated, moved
  to another branch, a role or PIN changed. To an agent with `pos.offline` its payload also
  carries `staff_version`: `{ "expires_at": "…", "data_version": "…", "staff_version": "…" }`.
  The agent pulls the staff list whenever it pulls the snapshot, with its own `If-None-Match`,
  so an unchanged list costs a `304`.
- The agent MUST store the list encrypted with DPAPI (machine scope), in its data folder, and
  MUST NOT log a PIN or a hash. It replaces the list whole, and keeps the last one while offline.

Known risk, accepted for the prototype: a 4-digit PIN falls to a brute force of its hash, and a
manager's PIN is also their approver PIN online. Someone with administrator rights on the branch
PC could recover it. DPAPI keeps a copied file useless elsewhere; it does not stop an
administrator on that PC.

Cashiers have no PIN today (the users screen gives one to approvers). P1 lets a manager set one
for any role on the users screen. A cashier's PIN signs them in offline and approves nothing:
approval online still looks only at approver roles.

### 13.4 Till binding

The agent sells as one till: one of the snapshot's `tills` (`terminal` in the cloud). A manager
chooses it on the settings page, signed in there as today (online). While offline, anyone whose
staff-list role is an approver (`SUPERVISOR`, `MANAGER`, `ADMIN`, `OWNER`) can choose it with
their PIN. The agent keeps the choice in its data folder until it is changed.

- An offline order's `terminal_id` is the bound till, its `shift_id` the till's open shift in
  the snapshot (`open_shifts`, by `terminal_id`), and its `business_date` that shift's
  `business_date`.
- With no till bound, or no open shift on it in the snapshot, the till sells nothing and says
  why (`NO_TILL`, `NO_SHIFT`). A shift cannot be opened offline.
- The card terminal is the till's `payment_device_id` in the snapshot, found in the config by id.
  With none, the till takes cash only.
- Binding the agent to a till does not stop that till's web POS; the two just must not sell at
  the same time (decision 4).

### 13.5 Modes

| Mode | When | The till |
|---|---|---|
| `ONLINE` | The agent has a WebSocket session and holds no unfinished offline order | Sells nothing of its own. With `pos.till` (§16.5) the till sells through the cloud. |
| `OFFLINE` | The agent has no session (never had one since start, or lost it) | Sells. |
| `HANDOVER` | The agent has a session again and still holds unfinished offline orders | Starts no new order. Unfinished orders can be continued: lines added, sent, paid, finished, cancelled. |

`HANDOVER` ends when the cashier presses **Hand over**, or on its own once the session has lasted
**15 minutes** without a break. Then each unfinished order:

- that was never sent to the kitchen and has no payment (a cart nobody paid for) is dropped: it
  was never a sale. The till lists what it drops before a manual hand-over, and logs it;
- otherwise goes to the upload as `OPEN` (§12.4), with the payments it has. An order whose card
  charge is still running waits for the charge to end.

Losing the session during `HANDOVER` returns the till to `OFFLINE`.

### 13.6 Orders on the till

An offline order lives **on the agent** from the moment it is started: the page shows it and
asks the agent to change it. Nothing about an order is kept only in the browser, so a crash or a
closed window loses nothing. Orders are kept in the agent's data folder (bbolt) and survive a
restart.

| Step | What happens |
|---|---|
| **New order** | Order type (`TAKEAWAY` or `DINE_IN`), and for dine-in a table from `dining_tables` and optionally a guest count. The agent gives it a UUID v4 (its `id` in §12.4), `created_by` = the signed-in user, `placed_at` = now. |
| **Add line** | Product, size, add-ons, quantity, note. Checked against the snapshot as the cloud checks the register (below). Prices come only from the snapshot; the till cannot type a price. |
| **Void line** | Removes a line. Before the kitchen has it, freely. After, see the edit rules below; the kitchen gets a VOID chit. |
| **Send to kitchen** | Gives the order its call number (§13.9) if it has none, and prints the kitchen chits for the lines the kitchen does not have yet (§13.8). Later lines go the same way, as ADD chits. |
| **Pay** | Cash or card (§13.7), for all or part of what is outstanding. An order is paid when its payments cover `grand_total`. |
| **Finish** | Allowed when paid. A takeaway finishes on its own when it is paid; it is sent to the kitchen first if it was not. A dine-in order is finished by the cashier when the table leaves. The receipt prints when the order becomes paid. The order then goes to the upload as `COMPLETED`. |
| **Cancel** | Only with no payments (there are no refunds offline). An order the kitchen has gets a CANCELLED chit and goes to the upload as `CANCELLED`. One the kitchen never had and that has no call number is simply dropped. |

Line checks, all against the snapshot, re-evaluated on the branch clock (`branch.time_zone`)
when the line is added:

- the product is listed and active; the size (`variants`) and add-ons are the product's own;
- it is not stopped (`availability.stopped`, product, size or add-on, `until` not passed), it is
  inside its selling window (`availability.schedules`), and `daily_stock.remaining` covers it,
  less what the till itself sold offline today;
- each option group's `min`, `max` and `required` hold, and `max_per_order` is not exceeded.

A line that fails is refused with `NOT_AVAILABLE` and the reason. A product that turns
unavailable after it was added stays on the order.

Money is §12.4's, exactly: `line_total = (unit_price + Σ price_delta) × quantity`, `tax =
line_total × tax_rate` rounded to whole rials, halves up, per line; totals are the sums;
`discount_total` and `delivery_fee` are `"0"`. The till shows the totals the upload will carry.

**Edit rules** (the cloud's `order-edit-policy`, cut down to what exists offline), for a line or
order the kitchen already has:

- Adding lines: always, while the order is open.
- Voiding a line or cancelling the order, with no payment on it: the cashier alone within the
  tenant's edit or cancel window from when the order was first sent (`settings.order_actions`,
  §13.11); after it, only with an approver's PIN.
- With any payment on the order: no line can be voided and the order cannot be cancelled. The
  cloud handles it after upload.

An approver's PIN is checked against the staff list like a sign-in. The order records who
voided what and who approved it (§13.12).

### 13.7 Payments

The payment method is the snapshot's first `payment_methods` entry of kind `CASH`, or for a card
of kind `CARD_POS`, `CARD` or `POS` (the kinds the web POS takes as a card reader). The upload
carries that method's id and kind. The card terminal is the bound till's `payment_device_id`; a
till without one takes cash only (`NO_TERMINAL`).

**Cash.** The cashier types what the customer handed over; the till shows the change. The
payment is the smaller of that and what is outstanding. No drawer is opened (the agent drives no
drawer).

**Card.** The agent charges the bound till's terminal through the same driver and the same
per-device queue as a cloud `payment.charge` (§7.3, §7.6), with no cloud command. The amount is
what is outstanding unless the cashier types less (to split with cash).

- Before the amount goes to the terminal, the agent records the charge (id, order, amount) as
  `RUNNING` on disk, on the order in `till-orders.db`. While it runs the order takes no other
  payment, cannot be finished, cancelled or handed over (`TERMINAL_BUSY`), and an update waits. §4.6 holds: a charge found `RUNNING` after a restart is `UNKNOWN` with
  `AGENT_RESTARTED`, and is **never** charged again.
- The charge's id is its merchant reference (`AttemptID`), as `attempt_id` is online.
- `APPROVED` with an `rrn`: a payment, uploaded as `APPROVED` with its `card` block.
- `DECLINED`, `CANCELLED`, `FAILED`: no payment. The till says so; the cashier may try again or
  take cash. Nothing of it is uploaded.
- `UNKNOWN`: a payment, uploaded as `UNKNOWN`, which the cloud leaves for **Check terminal** /
  **Resolve** (§12.6). On the till it **counts as paid**, so nobody charges the card again; the
  till tells the cashier to keep the terminal's slip, if any. The till never retries a charge
  on its own.

### 13.8 Printing

The agent renders offline tickets itself and prints them with the printer it already uses for
`print.job` (§6.2), on the same per-printer queue. A ticket printed offline looks like the one the
cloud prints for the same order: the same document types, the same templates, the same heading.
The agent's renderer (`internal/till/render.go`) is a port of the cloud's `PrintRenderService`;
`internal/till/testdata/tickets` holds pages the cloud renders for a set of cases, and both sides'
tests must produce them byte for byte, so neither can change alone.

| Document | When | Where |
|---|---|---|
| `KITCHEN_TICKET` | Send to kitchen: the new lines. Void after sending: VOID lines. Cancel after sending: every line under a STOP heading. | Split by station, as the cloud does |
| `CUSTOMER_RECEIPT` | When the order becomes paid | The receipt route |
| `GUEST_BILL` | On request, for an open dine-in order | The bill route |

Routing comes from the snapshot's `printing` block (§13.11):

- Each line goes to its product's kitchen route (`kitchen_routes[product_id]`), or to the
  fallback when it has none. Lines that share a printer group share one chit, labelled with the
  group's name, and `(1/3)` when the order makes several chits, as the cloud labels them.
- A chit prints on every printer of its group, each `route copies × member copies` times. A
  group with no active printer in the config, and lines with no route, fall back to
  `fallback.KITCHEN_TICKET`. With no fallback either, the chit fails and the till says so.
- A receipt or bill goes to its document route's group, else to `fallback.OTHER`.

A ticket that fails stays on the till with **Reprint**, to the same printer or another one the
cashier picks, for a day after the order ended. Every attempt goes into the order's `prints` (§12.4), `PRINTED` or `FAILED`. A
reprint is marked as a copy on the paper, as the cloud marks one.

Printing needs a signed-in Windows user (Edge renders the HTML), exactly as online.

### 13.9 Call numbers

An offline order is numbered in the day's `POS` range (`settings.call_numbers.POS`), for its
`business_date`, on **Send to kitchen** or when it becomes paid, whichever comes first. The next
number continues from the highest count the agent knows for that date:

- `call_number_issued_today` in the snapshot;
- `call_numbers` in the last `heartbeat.ack` (below), which is at most one heartbeat old when the
  link drops, so the offline till does not repeat numbers the web POS gave just before;
- the numbers the till itself gave offline;
- with `pos.till`, the numbers the cloud gave the orders the till placed through the agent (§16.4):
  the agent reads `call_number` and `business_date` off each `POST /api/v1/orders/{id}/submit`
  answer it passes on, so an order taken offline right after one placed online does not repeat
  its number when the link drops before the next heartbeat.

The count maps to a number as the cloud maps it (`start + (n − 1) mod size`), wrapping at the end
of the range. On upload, the cloud raises its counter to at least the offline numbers (§12.6).

For an agent with `pos.offline`, `heartbeat.ack` carries the counter:

```json
{ "type": "heartbeat.ack", "payload": { "server_time": "…",
  "call_numbers": { "business_date": "2026-09-24", "POS": 41 } } }
```

`POS` is the count handed out (not the last number), as in `call_number_issued_today`.

### 13.10 Heartbeat

An agent with `pos.offline` adds `till` to every `heartbeat`:

```json
{ "till": { "terminal_id": "…", "mode": "HANDOVER", "open_orders": 2 } }
```

`terminal_id` is the bound till (`null` when none); `open_orders` counts unfinished offline
orders. The Agents screen shows which till the agent sells as, and warns while open orders wait.

### 13.11 Snapshot additions

The snapshot (§12.2) gains, for every agent (a v1.2 agent ignores them):

```json
{
  "settings": {
    "order_actions": { "edit_window_minutes": 10, "cancel_window_minutes": 10 },
    "auto_logout_minutes": 15
  },
  "printing": {
    "heading": {
      "brand_name": "…", "branch_name": "…", "branch_address": "…", "branch_phone": "…",
      "calendar": "JALALI"
    },
    "groups": [
      { "id": "…", "name": "گریل", "ticket_template": "COMPACT",
        "printers": [ { "printer_id": "4c1e…", "copies": 1 } ] }
    ],
    "kitchen_routes": { "<product id>": { "group_id": "…", "copies": 1 } },
    "documents": { "CUSTOMER_RECEIPT": null, "GUEST_BILL": null, "COURIER_SLIP": null },
    "fallback": { "KITCHEN_TICKET": "4c1e…", "OTHER": "9a07…" }
  },
  "tills": [
    { "id": "…", "code": "T1", "name": "صندوق ۱", "payment_device_id": null,
      "receipt_printer_id": "9a07…", "receipt_copies": 1, "receipt_template": null }
  ]
}
```

- `order_actions` is the tenant's `ORDER_ACTIONS` setting, resolved over its defaults.
  `auto_logout_minutes` is `SYSTEM.auto_logout_minutes`; `0` means the till's own default of
  15 minutes.
- A "group" is a **prep station** (the KDS station, since cloud 2026-09-26): the same station
  the kitchen screen shows the line on. `kitchen_routes` is the cloud's station lookup done in
  advance: for each product, its own KDS rule's station, else its category's. A product no
  station makes, or whose station is out of service, is left out. `copies` is the station's.
- `groups[].printers` lists the station's printers in order. The agent skips a printer that is
  not active in its config; a station with none left prints on `fallback.KITCHEN_TICKET`.
- A receipt, guest bill or courier slip prints at the bound till: `tills[].receipt_printer_id`,
  with the till's `receipt_copies` and `receipt_template`; without a printer of its own, or with
  it off, on `fallback.OTHER`, still with the till's copies. `documents` is always `null` for
  each; it is kept so an agent before 1.11.3 prints them on `fallback.OTHER`.
- `fallback` is the printer the cloud falls back to for that kind (§6.1 ids), or `null`.
- The cloud sends `data.changed` when prep stations, KDS rules, tills, printers, the branch's
  name, address or phone, or these settings change.

### 13.12 Upload additions

§12.4's order gains optional fields. The cloud MUST accept orders without them.

| Field | Means |
|---|---|
| `lines[].options[].group_name` | The option group's name, kept on the cloud's order line as the till sold it. Without it, the group's name in the cloud stands in. |
| `voided_lines` | Lines voided after the kitchen had them (a voided line is otherwise left out, §12.4): `{ product_name, variant_name, quantity, line_total, voided_by, approved_by, at }`. Kept in the order's history and audit, not booked. |
| `cancelled_by`, `approved_by` | Who cancelled the order, and who approved it when the edit rules asked. Kept in the order's history and audit; the history names `cancelled_by` for a cancelled order. |
| `prints[].document_type`, `prints[].copies`, `prints[].error` | What was printed, and why an attempt failed. `prints` is kept in the order's history and audit. |

A `voided_lines` or `prints` that is not a list of objects, or a `cancelled_by` or
`approved_by` that is not a UUID, holds the order as `INVALID_ORDER`.

The cloud books a dine-in order with its table's number. An `OPEN` one keeps its table
occupied on the floor plan until staff finish it on the web POS, like a check rung up there;
no table session is opened for it. A table that is not one of the branch's is dropped and
flagged `TABLE_UNKNOWN` (§12.6).

Delivery is not sold offline (§13.1), so an upload never needs a delivery record. The field
`delivery_zone_id` stays in §12.4's shape, and the till sends `null`.

### 13.13 The till's local API

The till page and its API are part of the settings server (`localui`, `127.0.0.1:47800`), inside
the agent process: the agent owns the order, journal and snapshot files, and a second process
could not open them. The settings page's local-only rules hold for the till too: a request for
another host is refused, and every request that changes something needs `X-Gnext-Local: 1` and
a local `Origin`. The till takes money, so these rules MUST NOT be relaxed for it.

Every `/api/till/*` request other than `state` and `login` needs the till session,
`X-Gnext-Till-Session: <token>`, which `login` returns. One session at a time; signing in
ends the previous one. It ends after `auto_logout_minutes` without a request.

| Request | Does |
|---|---|
| `GET /till/` | The page: the web POS's own register, built from `starter-vite-ts` (`npm run build:till`) and embedded in the agent, reading and writing through these routes. Persian, right to left, by default, with the web POS's fa/en switch and light/dark theme. Anything under `/till/` is the page; `/till` redirects to it. Its policy adds inline styles (`style-src 'self' 'unsafe-inline'`); scripts still come only from the agent. |
| `GET /api/till/state` | Mode, bound till and shift, snapshot age, the staff names (no hashes), who is signed in. |
| `POST /api/till/login` `{user_id, pin}` / `POST /api/till/logout` | Sign in or out. |
| `POST /api/till/binding` `{terminal_id, user_id?, pin?}` | Bind the till (§13.4): with the settings page's manager session, or an approver's PIN. |
| `GET /api/till/menu` | Categories, products (each with its tax rate and its availability now, with the reason when not: `STOPPED`, `OUT_OF_HOURS`, `SOLD_OUT`), dining tables and payment methods, from the snapshot. `state` also names the branch. |
| `POST /api/till/price` `{lines: [{product_id, variant_id, quantity, options[], notes}]}` | Checks and prices lines as one order without keeping it: `{lines, totals}` in the §12.4 shape, or `NOT_AVAILABLE` with `line`, the index of the line refused. The till screen shows only what this says. |
| `GET /api/till/orders` | Unfinished orders, and those that ended in the last day, for reprints. |
| `POST /api/till/orders` `{order_type, table_id?, guest_count?}` | New order. Order changes answer `{order}`. |
| `POST /api/till/orders/place` `{order_type, table_id?, guest_count?, notes?, lines: [...]}` | A whole cart at once, as the web POS places it: checked and priced as one order, started, numbered and sent to the kitchen, or refused whole (`NOT_AVAILABLE` with `line`), keeping nothing and drawing no number. `notes` go up with the order. |
| `GET /api/till/orders/{id}` | One order the till holds. |
| `POST /api/till/orders/{id}/info` `{order_type, table_id?, guest_count?}` | Change the order's type, table or guests while it is open. |
| `POST /api/till/orders/{id}/lines` `{product_id, variant_id?, quantity, options[], notes?}` | Add a line. The same thing again, before the kitchen has it, adds to that line. |
| `POST /api/till/orders/{id}/lines/{line}/quantity` `{quantity}` | Change how many of a line the kitchen does not have yet (`0` removes it); a sent line is `LINE_SENT`, voided instead. |
| `POST /api/till/orders/{id}/lines/{line}/void` `{approver_id?, pin?}` | Void a line. |
| `POST /api/till/orders/{id}/send` | Send to kitchen. |
| `POST /api/till/orders/{id}/payments` `{kind: "CASH", tendered}` or `{kind: "CARD", amount?}` | Pay. Cash answers `{order, change}`. A card charge answers `202` `{order, payment_id}` at once; the page follows the order (`GET /api/till/orders/{id}`) until `card_attempts[]` for that payment leaves `RUNNING`: `APPROVED`, `UNKNOWN` (paid; keep the slip), or `DECLINED`, `CANCELLED`, `FAILED` with a `message` and no payment. `amount` defaults to what is outstanding. A takeaway paid in full finishes. |
| `POST /api/till/orders/{id}/finish` | Finish. |
| `POST /api/till/orders/{id}/cancel` `{note, approver_id?, pin?}` | Cancel. A cart dropped before the kitchen had it answers `{order: null, dropped: true}`. |
| `POST /api/till/orders/{id}/print` `{document?, print_id?, printer_id?}` | Print on request: `GUEST_BILL`, `CUSTOMER_RECEIPT` (a copy, marked, once one printed), or `KITCHEN_TICKET` (every chit again, marked); or `print_id`, one ticket again, marked, to its printer or `printer_id`. Answers `{prints}` queued; the order's `prints` show each `PRINTED` or `FAILED` with the printer's error. |
| `GET /api/till/printers` | The printers the agent can reach, for a reprint elsewhere. |
| `POST /api/till/handover` | End `HANDOVER` now (§13.5): `{dropped, handed}`. An order sent to the kitchen whose every line was then voided goes up `CANCELLED`, since the cloud books no order without lines. |

Errors are `{code, detail}`, with `detail` in Persian for the cashier: `TILL_ONLINE`,
`HANDOVER` (no new orders), `NOT_ENROLLED`, `NO_SNAPSHOT`, `NO_STAFF`, `NO_TILL`, `NO_SHIFT`,
`UNKNOWN_TILL`, `UNKNOWN_USER` (not on the staff list, or no PIN), `UNAUTHENTICATED`,
`PIN_WRONG`, `PIN_LOCKED` (5 wrong PINs for one user in 15 minutes lock that user for 15
minutes, as online), `NOT_AVAILABLE`, `APPROVAL_REQUIRED`, `ORDER_PAID` (no void or cancel with
payments), `ORDER_CLOSED`, `TERMINAL_BUSY`, `NO_TERMINAL`, `NO_PAYMENT_METHOD`, `NO_PRINTER`.

### 13.14 The web POS and the tray

- The web POS shows a banner when its requests to the cloud have failed for 30 s: the internet
  is down, and on the branch PC the offline till is at `http://127.0.0.1:47800/till/` (a link,
  in a new tab). A request with no answer, or a gateway's 502, 503 or 504, counts as a failure;
  any other answer clears it, and the banner goes. It does not probe the agent; the link is all
  it offers, and nothing opens or moves on its own.
- The tray menu gains **Offline till**, and the installer a Start-menu (and desktop) shortcut
  **Gnext Offline Till**; both run `gnext-agent till`, which opens `/till/` in a window of its
  own (WebView2, one per user, as the settings window). The settings page's till card links to it.
- When the link returns, the offline till shows that it is back and points to the web POS
  (§13.5); orders it hands over appear on the web POS as ordinary open orders.

### 13.15 Not in the offline POS

Delivery, courier slips and zones; coupons, discounts and manual prices; refunds and paid
cancellations; customer lookup and credit; kitchen screens (the kitchen gets chits only); a
cash drawer; opening, closing or counting a shift; more than one till; seeing or changing orders
that were open in the cloud before the outage. Tills on the LAN (listening beyond 127.0.0.1, a
firewall rule, pairing) are a later step. §17 adds Snappfood orders, with courier slips.

## 14. Conformance checklist for the agent

*Void since 2026-10-06: the checks below for §12, §13, §16, §17 and §18 no longer apply (§19.15
replaces them for v3). The v1 checks stay.*

An agent build is ready for the branch PC when it passes all of these against the cloud's
test harness (task 9) or a real staging server:


- [ ] `enrol` with a valid code writes `identity.json`; used, expired and wrong codes fail
      with the right `code`.
- [ ] Connects, sends `hello` first, handles `welcome`, keeps heartbeats every interval.
- [ ] Reconnects with backoff after the server drops the socket; stops on `4003`; stays
      down on `4008`.
- [ ] Acks a command only after journalling it; the same command id twice prints once.
- [ ] Refuses an expired command with `EXPIRED`, using the server clock offset.
- [ ] Prints Persian text correctly on a `windows` and a `tcp` printer.
- [ ] Reports `PRINTER_UNREACHABLE` when the printer is unplugged.
- [ ] Charge: approved, declined, cancelled on the terminal, terminal unplugged before the
      charge (`FAILED`), cable pulled during the charge (`UNKNOWN`).
- [ ] Killing the service mid-charge yields `UNKNOWN AGENT_RESTARTED` on restart, and the
      terminal is not charged a second time.
- [ ] Results produced while disconnected are delivered after reconnect, and each is applied
      once.
- [ ] `payment.query` turns an `UNKNOWN` into `APPROVED`/`DECLINED` when the terminal knows.
- [ ] Update: a bad SHA-256 is rejected; a good release swaps the binary and the service
      comes back on the new version.
- [ ] No device key, full PAN or PIN data in any log file.

v2 (§12), for an agent that advertises `data.pull` and `sync.orders`:

- [ ] Pulls the snapshot after every `welcome`, on `data.changed`, and every 15 min, sending
      the version held; a `304` changes nothing; a failed pull keeps the old copy.
- [ ] A snapshot is written atomically: killing the agent mid-write leaves the old one readable.
- [ ] An offline order is uploaded once its offline life ends, oldest first, 50 at most a batch.
- [ ] A batch cut off by a network error is resent as is, and the cloud answers `DUPLICATE`
      for the orders it already has; none is booked twice.
- [ ] A `400` batch is split, the good orders go up, and the bad one is kept and logged.
- [ ] Heartbeats carry `sync` with the right backlog.

Offline POS (§13), for an agent that advertises `pos.offline`:

- [ ] Restarted with the network unplugged, the agent still knows its printers and terminal
      (config from disk) and its till, shift, menu and staff.
- [ ] The till sells only in `OFFLINE`; in `HANDOVER` it finishes open orders but starts none;
      in `ONLINE` it sells nothing.
- [ ] A wrong PIN five times locks that user for 15 minutes; no PIN or hash reaches a log.
- [ ] Every total the till shows equals what the cloud recomputes on upload (no
      `TOTAL_MISMATCH`, no `PRICE_MISMATCH`).
- [ ] Killing the agent mid-charge gives `UNKNOWN AGENT_RESTARTED`, counted as paid, and the card
      is not charged again.
- [ ] Kitchen chits split by station as the cloud splits the same order; a void prints a VOID
      chit to the line's station only.
- [ ] Call numbers continue after the last `heartbeat.ack` without repeating one.
- [ ] Hand-over uploads open orders as `OPEN`, drops unpaid carts the kitchen never had, and
      the cloud books each order once.

The till online (§16), for an agent that advertises `pos.till`:

- [ ] Signing in online opens a cloud session; the page never sees its token; signing out or
      the idle timeout ends it.
- [ ] A proxied request carries the session, the CSRF token and the bound till, and nothing the
      page set; `/api/v1/agent/*` and `/api/v1/auth/*` (but `GET me`) are refused.
- [ ] Pulling the cable mid-sale switches the till to `OFFLINE` on the next request, keeps the
      cart, and the order sells on the agent; plugging it back asks for the PIN only when the
      cloud session is gone, and the next order goes to the cloud.
- [ ] A place that got no answer is not sent offline without the cashier confirming it.

Snappfood orders offline (§17), for an agent that advertises `pos.snappfood`:

- [ ] The Snappfood order type shows only in `OFFLINE`, needs a code, and refuses one the till
      already holds.
- [ ] A line is priced from the snapshot's `snappfood` block; a stopped or sold-out item gets a
      warning, not a refusal.
- [ ] Placing prints the kitchen chits and, for the store's own courier, the courier slip with
      the address and the courier's name; the number comes from the `ONLINE` range without
      repeating one the cloud gave.
- [ ] Hand-over uploads it `OPEN` with no payments, and the cloud books it once, whether
      Snappfood's record came before it or after.

## 15. Decisions and open questions

Decided by the product owner (2026-09-17):

1. **Terminal**: the test branch PC has a **Saman (SEP)** terminal. The one real driver in
   §7.6 is `sep`, built on Saman's own PC-POS SDK (`SSP1126.PcPos.dll` 1.4.11.2) through a
   .NET bridge (`agent/saman-bridge`). It reaches the terminal over the LAN (`tcp`, by IP; the
   SDK chooses the port) or a COM port (`serial`). Saman's SDK can look a transaction up only
   by RRN (`Inquiry`), which an `UNKNOWN` charge does not have, so a `payment.query` for a `sep`
   terminal answers `UNKNOWN` with `QUERY_UNSUPPORTED` and a person resolves the payment.
   (`GetReport` by date may allow a real query later; its format is not documented to us.)
2. **Printer**: the test printer is on the **LAN, raw TCP port 9100**. The first agent build
   MUST support `connection.kind = tcp` (§6.2 raster over ESC/POS); `windows` and `serial`
   MAY follow later.
3. **Replacing an agent** (§3.3): redeeming a new code **revokes** the branch's old agent.

Still open:

4. **Arvan WebSocket**: WebSocket must be enabled for the domain in the Arvan panel, and its
   idle timeout must exceed 20 s. nginx already forwards upgrade headers on `/api/`.

## 16. The till online (local-first, v2 third step)

*Removed 2026-10-06 (§19). Kept for history; nothing here is built any more.*

Status: **agreed** (product owner, 2026-09-25). Protocol version stays **1**: one new cloud
route, a local proxy, new optional fields, switched on by a capability.

§13 built a till that sells only while the internet is down, beside the web POS. Here the till
becomes the branch PC's register **all the time**. While the cloud answers, it sells through the
cloud with everything the web POS can do. When the cloud stops answering, it tells the cashier
and goes on selling through the agent (§13), on the same screen. When the cloud is back, it
tells the cashier again and goes back to the cloud. The cashier never changes screen.

### 16.1 Decisions

Confirmed by the product owner on 2026-09-25. They replace §13.1 decisions 2 and 4 and §13.5's
`ONLINE` row; the rest of §13 holds.

1. **One register.** On the branch PC the cashier uses the till (`http://127.0.0.1:47800/till/`,
   the *Gnext Offline Till* window) online and offline. The web POS stays for every other device.
2. **Online, the cloud is the source of truth.** An order rung up while the cloud answers is
   the cloud's from the first request, exactly as on the web POS: the kitchen screens, the other
   registers, delivery and reports see it at once. The agent's order book (§13.6) is used only
   while the cloud does not answer.
3. **Sign-in by PIN, online too.** The cashier signs in once, by name and PIN. The agent checks
   the PIN against the staff list (§13.3), and while the cloud answers it also gets the cashier a
   cloud session with that PIN (§16.3). The agent never keeps a PIN.
4. **Switching is automatic, and said.** The till moves between the cloud and the agent by
   itself (§16.5) and tells the cashier each time (§16.7).
5. **The cart goes along.** A cart not yet placed moves to the other side as it is, when the till
   switches (§16.6).
6. **Online, everything.** Delivery, customers, discounts, parked orders, 86, shift open and
   close: whatever the cashier's role may do on the web POS. Offline, §13.15 still holds.

### 16.2 Capability

| Capability | Means |
|---|---|
| `pos.till` | The agent's till sells online through the cloud (§16), and may ask for a PIN session (§16.3). Requires `pos.offline`. |

The cloud serves `POST /api/v1/agent/local/pin-login` only to an agent whose live session
advertised `pos.till`, as it serves the staff list (§13.3).

### 16.3 Cloud session by PIN: `POST /api/v1/agent/local/pin-login`

Device key (§3.4), as every `/api/v1/agent/local` route. Body `{ "user_id": "…", "pin": "1234" }`.

The cloud checks, and answers `403 FORBIDDEN_ROLE` or `401 PIN_WRONG` otherwise:

- the user is active, in the agent's tenant, **with the agent's branch** as their branch, in a
  role the staff list carries (`CASHIER`, `SUPERVISOR`, `MANAGER`, `ADMIN`, `OWNER`), and has a
  PIN: the staff list's rule (§13.3), so nobody gets a session here who could not sign in
  offline;
- the PIN matches `pin_hash` (argon2). There is **no** default PIN, unlike the approval
  fallback.

Wrong PINs:

- are counted in `pin_attempt_log` (action `TILL_SIGN_IN`), with the approval PINs. Five wrong
  PINs for one user in 15 minutes answer `423 PIN_LOCKED` for that user until the window passes,
  whatever the PIN;
- 20 wrong `TILL_SIGN_IN` PINs across the branch's users in 15 minutes answer `423
  TILL_SIGN_IN_LOCKED` for every user of that branch until the window passes: a stolen device key
  cannot walk the staff list;
- each is audited `AUTH_LOGIN_FAILED` with `{ method: "TILL_PIN", agent_id, reason }`. Neither
  the PIN nor its hash is logged.

On success the cloud opens an ordinary session for the user, as `POST /api/v1/auth/login`
does (user agent `gnext-till/<agent id>`), sets `last_login_at`, audits `AUTH_LOGIN_SUCCESS`
with `{ method: "TILL_PIN", agent_id }`, and answers `200`:

```json
{
  "session_token": "…", "csrf_token": "…",
  "user": { "id": "…", "username": "…", "displayName": "…", "role": "CASHIER",
            "tenantId": "…", "branchId": "…", "isHeadOffice": false, "preferredLocale": "fa" },
  "tenant": { "id": "…", "code": "…", "name": "…", "baseCurrency": "IRR", "defaultLocale": "fa" }
}
```

`user` and `tenant` are `POST /api/v1/auth/login`'s shapes, so the till fills the web app's
sign-in state with them. The session ends like any other: idle timeout, sign-out
(`POST /api/v1/agent/local/logout` with it in `X-Gnext-User-Session`), or deactivating the user.

### 16.4 The cloud path through the agent

The till page talks only to the agent. The agent passes the page's cloud calls on, with the
cashier's cloud session, so the page never holds a cloud credential and the browser never calls
the internet (no mixed content, no local-network prompt).

**Route.** `/api/v1/*` on the settings server (`127.0.0.1:47800`), every method, is proxied to the
cloud's same path. §13.13's local-only rules hold: a foreign `Host` is refused, and a request
that changes something needs `X-Gnext-Local: 1` and a local `Origin`.

**Who may use it.** A request needs the till session (§13.13), sent as `X-Gnext-Till-Session`
or as the cookie `gnext_till` that `POST /api/till/login` also sets (`HttpOnly`, `SameSite=Strict`,
`Path=/`), since an `EventSource` cannot send a header. Without it: `401 UNAUTHENTICATED`. With
it, but no cloud session for it: `401 CLOUD_SIGN_IN_REQUIRED`.

**Not passed on.** `/api/v1/agent/*` (the agent's own routes), and `/api/v1/auth/*` except
`GET /api/v1/auth/me`: `403 NOT_PROXIED`. The till signs in and out through §13.13.

**Request.** The agent sends the page's method, path, query and body (at most 1 MB) with the
page's `Content-Type`, `Accept`, `Accept-Language`, `X-Correlation-Id` and `X-Skip-Toast`
headers, and sets:

| Header | Value |
|---|---|
| `Authorization` | `Bearer <session_token>` |
| `X-CSRF-Token` | the session's `csrf_token` |
| `X-Terminal-Id` | the bound till (§13.4), so cash lands in its drawer as on the web POS |
| `User-Agent` | `gnext-agent/<version> till` |

Anything else the page sent (cookies, `Authorization`, `X-Gnext-*`) is dropped. Redirects are
not followed.

**Answer.** The cloud's status, body and headers, less `Set-Cookie`. A request that takes over
30 s is cut off; `GET /api/v1/live/stream` (Server-Sent Events) is exempt and flushed as it
arrives. Then:

- a `POST /api/v1/orders/{id}/submit` the cloud accepted: the agent notes its call number
  (§13.9);
- the cloud answered `401`: the agent forgets that cloud session (the till session stays) and
  answers `401 CLOUD_SIGN_IN_REQUIRED`;
- no answer (connection refused, DNS, TLS, timeout) or the cloud's gateway answered `502`,
  `503` or `504`: the agent answers `502 CLOUD_UNREACHABLE`, and marks the cloud unreachable
  (§16.5).

### 16.5 Modes

§13.5's modes, with the cloud's reachability decided by the agent:

| Mode | When | New orders go to | The agent's own orders |
|---|---|---|---|
| `ONLINE` | The cloud is reachable | The cloud, through §16.4 | None |
| `OFFLINE` | It is not | The agent (§13.6) | Taken, sent, paid, finished |
| `HANDOVER` | It is reachable again and the agent still holds unfinished offline orders | The cloud | Finished on the agent; handed over as §13.5 says |

The cloud is **reachable** when the agent's WebSocket session has lasted **10 s**, and no proxied
request has found the cloud unreachable in the last **30 s** since the later of the session's
start and the last proxied request that got an answer. It is **unreachable** from the moment the
session drops, or a proxied request gets no answer. So a cashier's request that finds the cloud
gone switches the till at once, without waiting for the heartbeat to notice; and a failure on the
HTTP side alone, with the session still up, holds the till offline for 30 s, not for the rest of
the day.

`HANDOVER` no longer stops the till selling: new orders go to the cloud; only the agent refuses
new orders of its own (`HANDOVER`, as §13.13 says).

`GET /api/till/state` adds:

```json
{ "cloud": { "reachable": true, "since": "2026-09-25T10:12:03Z",
             "session": { "user": { … }, "tenant": { … } } } }
```

`session` is `null` when the signed-in user has no cloud session; `user` and `tenant` are
§16.3's, for a page that reloads. `since` is when `reachable` last changed.

### 16.6 Signing in, and switching

**Sign-in** (`POST /api/till/login {user_id, pin}`):

1. The agent checks the PIN against the staff list (§13.3). A wrong or locked PIN is refused
   there; the cloud is not asked.
2. If the cloud is reachable, the agent asks it for a session (§16.3) with the same PIN, and
   keeps it with the till session. If the cloud refuses (`PIN_WRONG`, `PIN_LOCKED`,
   `FORBIDDEN_ROLE`: a stale staff list), the sign-in is refused with the cloud's code. If the
   cloud does not answer, the cashier is signed in offline, and the till is `OFFLINE`.
3. The answer adds `cloud_session` (`{user, tenant}` or `null`).

**Back online without a cloud session** (signed in offline, or the session ended): the page asks
for the PIN again, once, and sends `POST /api/till/cloud-login {pin}` for the signed-in user, which
does step 2. Until then the till sells nothing new; the cart waits.

**Sign-out** and the till's idle timeout end the cloud session too (`POST
/api/v1/agent/local/logout`), and clear the cookie.

**Switching** is done by the page, on the mode in `GET /api/till/state`, which it asks every 5 s
and at once after a `CLOUD_UNREACHABLE`:

- `ONLINE`/`HANDOVER` → `OFFLINE`: the register starts selling through the agent. The unplaced
  cart moves to the agent. Every line is re-priced by `POST /api/till/price`; a line the agent
  refuses stays on the cart marked with the reason, for the cashier to take off. What does not
  exist offline is taken off the cart with a notice: the customer and delivery address (a
  delivery order becomes takeaway, and the cashier is told), discounts and coupons. Parked
  orders, and orders already placed in the cloud, stay in the cloud.
- `OFFLINE` → `ONLINE`/`HANDOVER`: once the cloud session is there (above), the register sells
  through the cloud. The unplaced cart moves to the cloud as it is and is quoted there; a line
  the cloud refuses is marked the same way.
- A **place** the cloud may have received but never answered (the answer was `CLOUD_UNREACHABLE`
  after the request went out): the cart stays, marked *may already be in the kitchen*, and
  sending it offline needs the cashier to confirm it. When the cloud is back, the till looks the
  order up by its draft id (`GET /api/v1/orders/{id}`) and drops the cart if the cloud has it
  submitted.
- A **card charge** running in the cloud when the link drops stays the cloud's: the agent's
  journal delivers its result after reconnect (§4.6). The order waits in the cloud; the till
  says so and tells the cashier to keep the slip.

### 16.7 What the cashier sees

- **Offline**: an amber bar across the top, *No internet — selling on this PC. Delivery,
  customers, discounts and parked orders are paused* (Snappfood orders are typed in, §17.4), and the controls §13.15 leaves out
  disabled, as §13 draws them. A toast when it starts.
- **Back**: a toast *Internet is back*, the PIN prompt if needed, then the bar turns green for a
  moment, *Online again — N offline orders are being sent*, from the upload backlog (§12.7)
  until it is empty.
- The bar says which side a new order goes to, always, so nobody wonders.

### 16.8 The till as the register

- The agent opens the till window when a Windows user signs in, if a till is bound and the
  settings page's *Open the till at sign-in* (on by default) is on. Kept in `till.json` as
  `open_at_sign_in`, set by `POST /api/till/open-at-sign-in {on}` with the settings page's
  manager session. Not at the service's own start: after an update that would pull a till
  already open to the front, mid-sale.
- The web POS's offline banner (§13.14) stays, for every other device.
- **Branch Agents** shows, per agent, whether the branch is **ready to sell offline**, while it
  is online: the agent advertises `pos.till`; a till is bound and has an open shift; the staff
  list has at least one user; the snapshot is under 30 minutes old; the upload backlog is empty.
  Each missing piece is named, so it is fixed before the internet goes, not during.
  `GET /api/v1/agents` gives each agent `offline_ready`: `null` while it is not connected, else
  `{ ready, problems }` with `AGENT_TOO_OLD`, `NO_TILL`, `NO_SHIFT`, `NO_STAFF`,
  `SNAPSHOT_STALE`, `UPLOADS_WAITING`.

### 16.9 Not in this step

Tills on the LAN (every register on the agent: §13.15); KDS offline; an order placed in the cloud
finished on the agent while offline; installing updates only outside business hours.

### 16.10 One name, one screen per register (2026-10-04)

The product owner did not want two tills on the branch PC, one online and one offline. The
till is **Gnext POS** (*صندوق جی‌نکست*) everywhere a cashier meets it: the window, the tray, the
Start-menu and desktop shortcuts (an install removes the old *Gnext Offline Till* ones), and the
settings page. "Offline" names only the state, in the till's amber bar.

The web POS does not sell on a register that Gnext POS serves. `GET /api/v1/terminals/{id}/agent-till`
(any signed-in user) answers `{ "served_by_agent": true }` when a connected agent with `pos.till`
reports that register in its heartbeat's `till.terminal_id` (§13.10). The web POS asks for its
device's register on load and every minute; while the answer is yes it shows, in place of the
register, *This register is Gnext POS on the branch PC* with a link to `/till/`. An error reads
as no, so a failed check never stops a sale. This replaces §13.4's "binding does not stop that
till's web POS".

## 17. Snappfood orders while the cloud is away (v2, fourth step)

*Removed 2026-10-06 (§19). Kept for history; nothing here is built any more.*

Status: **agreed** (product owner, 2026-09-26). Protocol version stays **1**: new optional
snapshot and upload fields, one new capability, and cloud-side matching.

The cloud runs in a datacenter inside the country, so a national outage does not cut a branch off
it. The datacenter itself has bad spells instead, sometimes for two days: up for an hour, down for
the next. While the cloud is away, Snappfood keeps taking orders, and the branch sees them on
Snappfood's own vendor panel. Today they never reach Gnext: no kitchen chit, no courier slip, no
sale in the books. This section lets the cashier ring such an order up on the till, and has the
cloud fetch Snappfood's own record once it is back and pair the two, so each Snappfood order is
booked **once**, with Snappfood's lines and money.

Phone delivery orders are not part of it: offline they still become takeaway (§16.6).

### 17.1 Decisions

Confirmed by the product owner on 2026-09-26.

1. **Every Snappfood order ends up in Gnext.** While the cloud answers, nothing changes: the
   webhook brings it. While it does not, the cashier types it on the till (§17.4), which prints
   its kitchen chit and, for the store's own courier, its courier slip.
2. **The cloud pulls what it missed.** Once it answers again it fetches Snappfood's orders for
   the branch (§17.8) and pairs each with the till's order of the same code. It does so every few
   minutes, so each short window of service catches up on its own.
3. **The Snappfood order code is required** on the till. It is how the two records meet.
4. **Snappfood's version is booked.** Snappfood owns the lines and the money. Where the till's
   order says something else, Snappfood's stands and the order is flagged for a person
   (`SNAPPFOOD_DIFFERS`).
5. **A pulled order with no till order never prints.** It goes to *Missed while offline*
   (§17.9), where a manager says it was made or links it to a till order whose code was mistyped.
6. **Couriers: assign and slip.** For an order the store delivers itself, the cashier picks one
   of the branch's couriers on the till; the slip prints with the courier's name. Delivered,
   failed and the courier's cash are recorded on Dispatch once the cloud is back.

### 17.2 Capability

| Capability | Means |
|---|---|
| `pos.snappfood` | The till takes Snappfood orders offline (§17.4) and uploads them (§17.6). Requires `pos.offline`. |

The cloud books an uploaded Snappfood order from any agent (§17.7); the capability tells Branch
Agents which agents can take one.

### 17.3 Snapshot additions

```json
{
  "settings": {
    "call_numbers": { "POS": { "start": 100, "end": 399 }, "ONLINE": { "start": 500, "end": 599 } },
    "call_number_issued_today": { "business_date": "2026-09-26", "POS": 37, "ONLINE": 12 }
  },
  "snappfood": {
    "prices": [ { "product_id": "…", "variant_id": null, "price": "2820000" } ],
    "add_ons": [ { "option_item_id": "…", "price_delta": "400000" } ]
  },
  "couriers": [ { "id": "…", "name": "رضا کریمی", "phone": "0912…", "checked_in": true } ]
}
```

- `snappfood.prices` is the channel price sheet (Catalog → Snappfood prices) for this branch:
  per product, or per size of a product sold in sizes, the price that applies on Snappfood (a
  fixed channel price, else the markup rule on the branch's in-store price). `add_ons` gives each
  add-on's price on Snappfood (the markup rule on its in-store price). An item missing from the
  sheet is not sold on Snappfood.
- `couriers` are the branch's active couriers; `checked_in` says who is on shift now, for the till
  to list them first. A courier who is not checked in can still be picked.
- `call_numbers.ONLINE` and `call_number_issued_today.ONLINE` are the Snappfood range (§17.5).
- The cloud sends `data.changed` when the price sheet, the markup rule or the branch's couriers
  change. A courier checking in or out is not announced; it reaches the agent with the 15-minute
  pull.

### 17.4 The Snappfood order on the till

Offered only while the till sells on the agent (`OFFLINE`, §16.5) and the snapshot has a
`snappfood` block. While the cloud answers, Snappfood's orders come by webhook, and typing one
would book it twice, so the order type is not shown.

The cashier chooses **Snappfood** as the order type and fills in, from Snappfood's panel:

| Field | Rule |
|---|---|
| `code` | Required. Snappfood's order code as the panel shows it, 3 to 40 letters, digits and `-`. The till refuses a code it already holds from the last two days (`SNAPPFOOD_CODE_USED`). |
| `expedition` | `DELIVERY` (the store's own courier), `RIDER` (a Snapp Express rider collects it) or `PICKUP` (the customer collects it). |
| `payment` | `ONLINE` (paid to Snappfood) or `CASH` (the customer pays at the door). Only printed on the slip; Snappfood's record decides the money. |
| `customer` | For `DELIVERY`: `name`, `phone` and `address`, as the panel shows them. `address` is required. |
| `courier_id` | For `DELIVERY`: one of the snapshot's `couriers`. Optional; the order can leave without one and be assigned on Dispatch later. |

**Lines** are the menu's products, sizes and add-ons, priced from `snappfood.prices` and
`snappfood.add_ons`; an item not in the sheet is refused `NOT_ON_SNAPPFOOD`. Snappfood has already
sold the order, so the till does **not** refuse a line for a stop, a selling window, today's stock
or an option group's limits; it shows a warning on the line and lets it through. The line still
counts against today's stock. Money is §12.4's, with `delivery_fee` `"0"`: the till does not know
Snappfood's delivery or packing charges, which come with Snappfood's record.

**Place** (`POST /api/till/orders/place` with `order_type: "SNAPPFOOD"` and a `snappfood` block of
the fields above) checks and prices the cart, gives the order its call number (§17.5), prints its
kitchen chits (§13.8), and for `DELIVERY` a `COURIER_SLIP` at the till's receipt printer (§13.11,
else `fallback.OTHER`) with the call number, the Snappfood code, the customer, the address, the
courier's name, the lines, and either *Paid online* or *Collect `<grand_total>` in cash*. No
payment is taken, and the order is never finished on the till: it is delivered and closed in the
cloud (§17.7). While it waits on the till:

- lines may be added, and a line voided or the order cancelled, under §13.6's edit rules
  (Snappfood cancelling an order on its panel is the usual reason);
- **Reprint** reprints the chits or the slip;
- the courier can be changed (`POST /api/till/orders/{id}/info` with `snappfood.courier_id`), and
  the slip prints again, marked as a copy.

At hand-over (§13.5) a Snappfood order goes up `OPEN`, or `CANCELLED` if it was cancelled. It is
never dropped as an unpaid cart: it was placed, so the kitchen has it.

### 17.5 Call numbers

A Snappfood order takes its number from the day's `ONLINE` range, as the cloud numbers Snappfood
orders, counted as §13.9 counts `POS`: the highest of the snapshot's
`call_number_issued_today.ONLINE`, the `ONLINE` count in the last `heartbeat.ack`, and the
numbers the till gave itself. `heartbeat.ack` gains `ONLINE`:

```json
{ "call_numbers": { "business_date": "2026-09-26", "POS": 41, "ONLINE": 12 } }
```

On upload the cloud raises its `ONLINE` counter to at least the order's number (§12.6).

### 17.6 Upload additions

A Snappfood order in §12.4's shape, with:

```json
{
  "channel": "AGGREGATOR",
  "order_type": "AGGREGATOR",
  "shift_id": null,
  "state": "OPEN",
  "call_number": 507,
  "snappfood": {
    "code": "SF-4821",
    "expedition": "DELIVERY",
    "payment": "ONLINE",
    "customer": { "name": "حمید بیانک", "phone": "0912…", "address": "…" },
    "courier_id": "…"
  },
  "payments": []
}
```

- `shift_id` is `null`: a Snappfood order is not a register sale and lands in no drawer.
  `terminal_id` is still the bound till, for the record.
- `state` is `OPEN` or `CANCELLED`, never `COMPLETED`; `payments` is empty.
- Prices are checked against the snapshot's `snappfood` block, not the in-store prices; the
  §12.6 arithmetic and snapshot checks hold otherwise.
- A Snappfood order without a valid `snappfood.code`, or with `payments`, is `HELD`
  `INVALID_ORDER`.

### 17.7 One order per code

The cloud keeps one order per Snappfood code, numbered `SNP-<code>` as today. Whichever record
arrives first creates it: the till's upload, the webhook, or the pull (§17.8). The other is
matched to it. The order records how far it has got in `aggregator_match`:

| `aggregator_match` | Means |
|---|---|
| `null` | An ordinary Snappfood order: the webhook brought it while the cloud answered. |
| `TILL_ONLY` | The till's upload came; Snappfood's record has not yet. |
| `PULLED` | The pull brought it while the cloud was away, and no till order carries its code yet. |
| `MATCHED` | Both records are in: the till's and Snappfood's. |

**The till's upload, no order with its code yet.** Booked from the till: `SNP-<code>`, channel and
type `AGGREGATOR`, the expedition as `aggregator_expedition` (`DELIVERY` → `DELIVERY`, `RIDER` →
`ZF_EXPRESS`, `PICKUP` → `PICKUP`), state `CONFIRMED` (accepted at `placed_at`) or `CANCELLED`, the
till's lines, call number, prints and history, no payments, `TILL_ONLY`. For `DELIVERY` it goes on
the delivery board with the typed address and, if the till picked one, the courier assigned. It
is not sent to the kitchen screens or printed. It waits for Snappfood's record, and shows on
*Missed while offline* after two hours without it (§17.9).

**The till's upload, an order with its code already there** (`PULLED`, or `null` because the
webhook came while only the branch was cut off): matched. Snappfood's lines, money and customer
stay. From the till it takes what Snappfood cannot know: the call number (if the order has none),
the accept (a `PENDING_ACCEPTANCE` order becomes `CONFIRMED` at the till's `placed_at`, with no
kitchen screen or print), the courier (if none is assigned), the prints and history. Flags:
`SNAPPFOOD_DIFFERS` if the till's lines are not Snappfood's (same product, size, add-ons and
quantity); `SNAPPFOOD_ACCEPTED_TWICE` if the cloud had already accepted it, since the kitchen may
have made it twice; `SNAPPFOOD_CANCELLED` if one side cancelled it and the other did not.
`MATCHED`.

**Snappfood's record for a `TILL_ONLY` order** (the webhook's new-order message or the pull):
matched. Snappfood's lines replace the till's (the till's are voided, not deleted, and kept in the
history), its money and customer are applied as for any Snappfood order, and its cancel (54)
cancels. Nothing goes to the incoming-order queue, the kitchen screens or the printers, and the
branch's acceptance policy is not applied: the branch already made it. `SNAPPFOOD_DIFFERS` if the
lines were not the same. `MATCHED`.

The upload's result (§12.5) is `ACCEPTED` with `order_number` `SNP-<code>` in every case, and the
flags; head office sees them on the uploaded-orders screen (§12.7) like any other.

### 17.8 The pull

The cloud asks Snappfood for each branch's orders of the last **six hours**, every **five
minutes**, and at once when someone presses **Pull now** (on *Missed while offline*). It goes
through one adapter, `SnappfoodOrders.list(branch, since)`, which answers each order as the
webhook would carry it, with its current status. In the prototype the Snappfood simulator answers
it (below); the live product needs Snappfood's API to list a vendor's orders, which is not yet
confirmed.

For each order the cloud does not have:

- still waiting for the store's answer (Snappfood's status is new, 56, and nobody accepted it on
  the panel): handled as if the webhook had just brought it, into the incoming-order queue;
- accepted on the panel, delivered or cancelled: booked **pulled**. It is matched to a
  `TILL_ONLY` order of the same code if there is one (§17.7). Otherwise it is booked with
  Snappfood's lines, money and customer, `CONFIRMED` (or `CANCELLED` for 54), `PULLED`, without
  the incoming-order queue, the kitchen screens or the printers.

An order the cloud already has is left to the webhook's own rules, except that Snappfood's cancel
reaches a `TILL_ONLY` order as above.

**The simulator** gains *Gnext unreachable* per branch. While it is on, the orders it makes are
not sent to the webhook: Snappfood keeps them, as its panel would. The simulator's panel view lets
someone accept or cancel them there, as the branch would on Snappfood's panel. The pull reads
them from there.

### 17.9 Missed while offline

A list for branch managers and head office:

- `PULLED` orders more than **20 minutes** after the pull brought them (time for the till's
  hand-over upload to arrive);
- `TILL_ONLY` orders more than **two hours** after their upload.

Each row shows the code, the branch, when it was placed, the lines and the total. Actions:

| Action | For | Does |
|---|---|---|
| **Made** | `PULLED` | The branch made it from the panel: it stays `CONFIRMED`, leaves the list, and for the store's own courier goes on the delivery board for a courier to be assigned. |
| **Link** | a `PULLED` and a `TILL_ONLY` order of the same branch | The two are one order whose code was mistyped on the till: matched as §17.7, the till's order folded into Snappfood's (its number, courier and history move over; the till's order is voided). |
| **Not Snappfood's** | `TILL_ONLY` | Snappfood has no such order (typed by mistake): the order is cancelled, with the reason. |

Each action is audited.

### 17.10 Not in this step

Phone delivery orders offline (still takeaway); answering Snappfood from the till (reject, report
to support, more time); a Snappfood order changed by Snappfood support while the cloud is away (it
arrives changed with the pull, and `SNAPPFOOD_DIFFERS` says so); courier delivered, failed and
cash on the till.

## 18. Every register on the agent (v2, fifth step)

*Removed 2026-10-06 (§19). Kept for history; nothing here is built any more.*

Status: **agreed** (product owner, 2026-10-04). Protocol version stays **1**: a second local
listener, new optional heartbeat fields, and a cloud field, switched on by a capability.

§16 made Gnext POS the branch PC's register, online and offline. The branch's other registers
(a second PC at the counter, a tablet, a phone) still ran the web POS, which stops when the
internet does. Here **every register in the branch opens Gnext POS from the branch agent**, over
the branch LAN. Online, each sells through the cloud by the agent (§16.4); offline, each sells on
the agent (§13). There is one POS, on every device, online and offline.

### 18.1 Decisions

Confirmed by the product owner on 2026-10-04. They replace §13.1 decision 1 ("one offline till
a branch") and §13.15's "more than one till" and "tills on the LAN".

1. **Any device on the LAN.** A PC, tablet or phone opens `http://<branch PC>:47801/till/` in a
   browser. Plain HTTP on the shop's network; no app to install.
2. **Paired once, by code.** A device sells only once a manager has paired it: on the branch
   PC's settings page the manager picks a register and gets a six-digit code; on the device they
   type the code. The device keeps a token; from then on cashiers sign in by PIN, as on the PC.
3. **The branch PC must be on.** It is the branch's server. If it is off, the other registers say
   so and sell nothing; with the internet up, staff can still open the web POS by hand.
4. **One device a register.** A register is served by one device at a time: the PC (§13.4) or
   one paired device. Pairing a register that is taken is refused until the other is unpaired.
5. **The settings page stays on the PC.** Only the till and pairing are served on the LAN.

### 18.2 Capability

| Capability | Means |
|---|---|
| `pos.lan` | The agent serves Gnext POS to paired devices on the LAN (§18). Requires `pos.till`. |

### 18.3 The LAN listener

The agent listens on **TCP 47801, every interface**, beside the settings server on
`127.0.0.1:47800`. On start, the service adds a Windows Firewall rule *Gnext POS* (inbound, TCP
47801, remote addresses `localsubnet`, every profile) if it is missing, so an agent that updated
itself needs no installer run. The installer adds the same rule.

The LAN listener serves only:

- `GET /till/` (the page), `GET /till` (redirect);
- `GET /api/till/state`, `POST /api/till/pair`, and, for a paired device, every other
  `/api/till/*` route of §13.13 and §16 and the cloud path `/api/v1/*` (§16.4), except
  `POST /api/till/binding` and `POST /api/till/open-at-sign-in`, which are the PC's.

Anything else is `404`. Its rules, in place of §13.13's local-only ones (the `Host` of a LAN
address is not known in advance):

- A request that changes something needs `X-Gnext-Local: 1`, and an `Origin`, if sent, whose
  host is the request's `Host`.
- A paired device is known by the cookie `gnext_device` (`HttpOnly`, `SameSite=Strict`,
  `Path=/`, ten years), set by `pair`. A request without a known device token: `401
  NOT_PAIRED` (the page shows the pairing screen).
- The responses carry §13.13's headers and the till's policy.

On the loopback listener nothing changes: the PC's own register is the bound till (§13.4).

### 18.4 Registers

A **register** is one of the branch's tills (`terminal` in the cloud) served by the agent: the
bound till (the PC), and each paired device's till. Each register has its own:

| | Per register |
|---|---|
| Sign-in | One till session a register; signing in ends that register's previous session only. A session token is good only on the register it was issued for. |
| Cloud session | §16.3, one per till session. The cloud path sends that register as `X-Terminal-Id`. |
| Shift | The register's open shift in the snapshot (`open_shifts`, by `terminal_id`). Without one: `NO_SHIFT` on that register. |
| Card terminal | The register's `payment_device_id` in the snapshot. |
| Receipts | The register's receipt printer and copies (§13.8). |

Shared by all registers: the mode (§16.5: the agent decides once for all), the order book (every
register sees and can continue every offline order, as the web POS lists the branch's open
orders; an order keeps the register it was started on), the call-number counter (§13.9), daily
stock, the staff list, and the hand-over.

### 18.5 Pairing

**Code.** `POST /api/pairing-codes {terminal_id}` on the settings server, with the settings
page's manager session (§13.4's rule). The terminal must be one of the snapshot's tills, and not
the bound till nor a paired device's (`TILL_TAKEN`). Answers `{code, terminal_id, expires_at}`:
six digits, good for **10 minutes**, once. A new code for the same register replaces the old.

**Pair.** `POST /api/till/pair {code, device_name}` on the LAN listener. A right code answers
`{register: {terminal_id, code, name}, device_id}` and sets `gnext_device`. A wrong or used code:
`PAIR_CODE_WRONG`; ten wrong codes in 15 minutes, from anywhere: `PAIR_LOCKED` for 15 minutes.
`device_name` (at most 60 characters) is what the settings page lists; the page suggests the
browser's platform.

**Kept.** `pairings.json` in the data folder: per device `device_id`, the SHA-256 of its token
(never the token), `terminal_id`, `device_name`, `paired_by`, `paired_at`, `last_seen_at`.

**Listed and removed** on the settings page: `GET /api/pairings`, `DELETE /api/pairings/{id}`
(manager session). Removing a device ends its till session; it shows the pairing screen.

### 18.6 State

`GET /api/till/state` describes the register the request came from: `binding`, `till` and
`shift` are that register's. It adds:

```json
{ "register": { "kind": "PC", "device_id": null },
  "lan": { "urls": ["http://192.168.1.10:47801/till/"] } }
```

`kind` is `PC` on the loopback listener, `DEVICE` for a paired device, and `null` (with
`problems: ["NOT_PAIRED"]`, and no staff list) for a device not paired yet. `lan.urls` are the
PC's IPv4 addresses on private networks, for the settings page and the pairing screen.

### 18.7 Heartbeat and cloud

`heartbeat.till` adds the registers:

```json
{ "till": { "terminal_id": "…", "mode": "ONLINE", "open_orders": 0,
            "registers": [ { "terminal_id": "…", "kind": "PC" },
                           { "terminal_id": "…", "kind": "DEVICE", "device_name": "Tablet 1" } ],
            "lan_url": "http://192.168.1.10:47801/till/" } }
```

§16.10's `GET /api/v1/terminals/{id}/agent-till` answers yes for every register of a connected
agent, and adds `url`: `http://127.0.0.1:47800/till/` for the PC's, `lan_url` for a device's.
The web POS's notice links there. **Branch Agents** lists each agent's registers.

### 18.8 The page

- Served from a LAN address and not paired: the pairing screen (code, device name), then the
  sign-in.
- The bar says which register this is, beside the mode.
- *Branch PC unreachable*: a request that gets no answer from the agent says so (on a device:
  the branch PC is not answering; check it is on and the device is on the branch network), and
  the page asks again every 5 s.
- The web POS's notice (§16.10) on a device's register links to `lan_url`.

### 18.9 Not in this step

HTTPS on the LAN (and so what a browser keeps for secure pages: install as an app, camera);
finding the PC by name or QR code (the settings page shows the address; it is typed once and
bookmarked);
another PC taking over when the branch PC dies; KDS screens on the agent.

## 19. The agent serves the cashier (v3)

Status: **agreed** (product owner, 2026-10-06). Protocol version stays **1**: one new
capability, new optional heartbeat fields, and local HTTP routes on the agent. The plan this
section is the contract for is `PLAN-agent-serves-cashier.md`; its slices S1 to S7 build what
is written here, and each subsection says which slice builds it.

§16 and §18 made the till a screen of its own that switched between the cloud and the agent,
beside the cloud's web app. A short interruption moved the cart, dropped delivery, customers
and discounts, and asked for the PIN again. The cashier still went to gnext.top for orders,
delivery, incoming orders and shift close: two screens.

Here **the agent always serves the cashier**. Every register opens one address on the agent and
uses the cashier pages of the web app from there, online or not. Nothing switches. For now the
agent only **passes every API call to the cloud**; offline features come back later, one at a
time, inside this same app (§19.14).

```
register browser ── http://127.0.0.1:47800/        (branch PC)
                 └─ http://<branch-pc-ip>:47801/   (any other register on the LAN)
                          │
                    gnext-agent
                    ├─ /             cached cloud frontend build (SPA fallback to index.html,
                    │                with <meta name="gnext-agent" …> injected)
                    ├─ /api/*        proxied to the cloud, headers passed through
                    ├─ /uploads/*    proxied to the cloud
                    ├─ /agent/       the agent's own settings page (loopback listener only)
                    └─ /agent/api/*  the settings page's API, and /agent/api/status for the app
                          │
                    https://gnext.top  (frontend origin = API origin in production)
```

Printing and card terminals do not change: the cloud still drives them over the agent's
WebSocket (§4, §7).

### 19.1 Decisions

Decided by the product owner on 2026-10-06. They replace §13, §16, §17 and §18 (§19.2).

1. **The agent always serves the cashier.** Every register opens one address on the agent
   (§19.4) and uses the cashier pages from there, online or not. Nothing switches.
2. **First versions only proxy.** The agent passes every API call to the cloud (§19.6).
3. **Cashier pages only.** POS, orders, delivery, incoming orders, shift and cash. Manager and
   head-office pages stay on gnext.top; the agent-served app links out to them (§19.9).
4. **The page is the cloud's own build, cached.** The agent downloads the cloud's current
   frontend build after each deploy, serves it from disk, and keeps the previous one. It is the
   same version as the cloud's, and it still opens after a reboot with no internet (§19.7).
5. **Normal sign-in, passed through.** The same username and password screen as gnext.top. The
   agent has no PIN sign-in for now.
6. **Interruptions: hold and retry.** The screen stays as it is, with a *Reconnecting* bar. The
   agent retries reads; it retries writes only when they carry an idempotency key. Card
   charges are never retried (§19.10, §19.11).
7. **The offline selling built so far is removed**, all of it (§19.2). Offline will be rebuilt
   later on this base.

How the page authenticates does not change, so the proxy holds no session. The bearer token is
in `sessionStorage`, the CSRF token in memory and `X-Terminal-Id` in `localStorage`, all in the
page. The login also sets the cookie `gnext_session` (host-only, `HttpOnly`, `SameSite=Lax`),
which the live-update `EventSource` needs, since it cannot send a header. The proxy passes
`Cookie` through, and passes `Set-Cookie` back with its `Domain=` and `Secure` attributes removed
(§19.6). A production
build of the page uses `VITE_SERVER_URL=""` (same origin), so a cached build already calls
`/api/...` on whatever served it: the agent.

### 19.2 What is removed

Built by S1 (the agent) and S2 (the cloud and the web app). §12, §13, §16, §17 and §18 stay in
this file for history, each marked removed at its top. Nothing in them is built any more.

| Part | What goes |
|---|---|
| Agent: till | The till, its PIN staff list, pairing of LAN devices, the automatic switch between cloud and agent, the branch snapshot and its `data.changed` handling, the offline order book, the upload and its conflict rules, offline Snappfood matching, call numbers kept by the agent. |
| Agent: protocol | Capabilities `data.pull`, `sync.orders`, `pos.offline`, `pos.till`, `pos.lan` and `pos.snappfood`; the `till`, snapshot and backlog fields of the heartbeat; `data.changed`. `print.html`, `payment.charge` and `payment.query` stay. |
| Agent: files | `branch-data\`, `offline-orders.db`, `till.json`, `till-orders.db`, `till-devices.json` and `call-numbers.json` are deleted once, at service start, and the log says what was removed. `devices.json` stays. |
| Agent: shell | The `till` command, the tray's till item, open-at-sign-in of the till, the *Gnext POS* shortcuts and the firewall rule handling for 47801 (S3 and S7 bring new ones). At service start the agent deletes the old *Gnext POS* firewall rule if it is there. |
| Cloud | The branch snapshot, offline upload and sync admin routes; `POST /api/v1/agent/local/pin-login` and the staff list; `GET /api/v1/terminals/{id}/agent-till`; `offline_ready` in `GET /api/v1/agents`; Snappfood offline matching and the *missed while offline* list; `AgentSyncOrder`; the code that creates orders with source `AGENT_OFFLINE`; and, in one migration, the tables, triggers and columns made only for them. |
| Web app | The till build (`src/till/`, `till.html`), the POS's switch between cloud and till (`pos-source`, `PosFeatureGate`, the cart carry), the offline banner, and the offline cards of Branch Agents. The POS calls the cloud API directly, as the web POS did before. |

What stays: enrolment, the WebSocket session, the journal, printing, card payments (`sep`,
`fake`), updates and the Saman bridge update, the tray, the settings page with its manager
sign-in, the LAN scan, and `devices.json` (the last printer and terminal config, used when the
agent restarts with no cloud). On the cloud, `agent-local`'s `login`, `logout`, printers and
terminals stay for the settings page.

Agents 1.x lose their offline routes on the cloud when the cloud side (S2) deploys. This is a
prototype and no branch relies on them; publish agent 2.x after S1.

The error code `AGENT_OFFLINE` of the agent payments (an agent that is not connected, §8) has
nothing to do with the removed order source of the same name, and stays.

### 19.3 Capability

| Capability | Means |
|---|---|
| `app.serve` | The agent serves the cloud's cached frontend build and proxies the API (§19). |

An agent advertises `app.serve` in `hello` (§4.2) from version 2.1.0 on. It needs no other
capability. The cloud changes no behaviour for it; the Branch Agents page shows it (§19.12). A
cloud that does not know the word ignores it (§2.1).

### 19.4 Listeners

| | Loopback | LAN |
|---|---|---|
| Address | `127.0.0.1:47800` | `0.0.0.0:47801` |
| Serves | The app and the settings page | The app only |
| `Host` | A foreign `Host` is refused (the DNS-rebinding guard stays) | Any `Host` |
| `/agent/` | The settings page and `/agent/api/*` | Only `GET /agent/api/status`; everything else under `/agent/` is `404` |
| Default | On | On |
| For | The register on the branch PC | Every other register: a PC, tablet or phone on the branch network |

- The LAN listener is on by default. The service adds the Windows Firewall rule *Gnext* (inbound,
  TCP 47801, private and domain profiles) when it starts, and the installer removes it on
  uninstall. If the port is taken the agent logs it and goes on with the loopback listener alone.
  For development `GNEXT_AGENT_UI_ADDR` and `GNEXT_AGENT_LAN_ADDR` (`off` for none) move the
  listeners.
- The page is plain HTTP on the shop's network, so it is not a secure context on the LAN (no
  `crypto.randomUUID`, no install-as-app). §19.11 says what the page does about it.
- A browser keeps `sessionStorage` and `localStorage` per origin. `127.0.0.1:47800` and
  `192.168.1.10:47801` are two origins: a register that uses both signs in and picks its till
  twice.

### 19.5 Routes

| Path | Method | Does | Loopback | LAN |
|---|---|---|---|---|
| `/` and any path not listed below | `GET`, `HEAD` | A file of the current build, else `index.html` (the SPA fallback) (§19.7) | yes | yes |
| `/api/*` | every method | Proxied to the cloud (§19.6) | yes | yes |
| `/uploads/*` | every method | Proxied to the cloud (§19.6) | yes | yes |
| `/agent/` | `GET` | The agent's settings page | yes | no |
| `/agent/api/*` | as before | The settings page's API: what `/api/*` was on the settings server before v3 | yes | no |
| `/agent/api/status` | `GET` | §19.8 | yes | yes |
| `/agent/api/app/refresh` | `GET` | Checks the cloud for a newer build now (§19.7); needs the settings page's manager session | yes | no |

- The settings page moves from `/` to `/agent/` and its API from `/api/*` to `/agent/api/*`.
  The settings page's script, the WebView window, `gnext-agent open` and the tray links follow.
  Its local-only rules (§13.13: `X-Gnext-Local: 1` and a local `Origin` on a request that
  changes something) belong to `/agent/api/*`. The proxied `/api/*` is the cloud's, and the
  page does not send them.
- Any other method on an app path (not `/api/`, `/uploads/` or `/agent/`) is `405`, with `Allow: GET, HEAD`.
- As built in 2.1.0 (S3): `/agent` redirects to `/agent/`. On the loopback listener,
  `/agent/api/status` also carries the agent's own fields that the settings page and the tray
  read (`enrolled`, `server`, `agent_id`, `branch_name`, `stopped`, `user`, `agent`); the LAN
  listener answers exactly §19.8. `/agent/api/app/refresh` answers `{ "ok": true, "changed":
  bool, "files_fetched": n, "bytes": n, "app": {…}|null }`, `401 UNAUTHENTICATED` without the
  manager session, and `502 APP_DOWNLOAD_FAILED` when the check failed. The agent's own
  `/agent/*` answers carry the settings page's security headers (`X-Frame-Options`, a CSP,
  `no-store`); the app and the proxied answers do not, they are the cloud's.

### 19.6 The proxy (S3)

`/api/*` and `/uploads/*`, every method, go to the cloud's same path and query. The cloud is
the agent's `server` (§3.1).

**Request.** Every header the page sent is passed on, except the hop-by-hop ones (`Connection`,
`Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`,
`Transfer-Encoding`, `Upgrade`) and `Host`. The agent also:

| Header | Value |
|---|---|
| `X-Forwarded-For` | The register's address, added to any value the page sent |
| `X-Forwarded-Proto` | `http` |
| `User-Agent` | The page's own, then ` gnext-agent/<version>` |

The body is passed on, at most **16 MB** (photo uploads). Redirects are not followed; the page
gets the cloud's `3xx` as it is.

**Response.** The cloud's status, headers (less the hop-by-hop ones) and body, **streamed**.
`Set-Cookie` is passed back with its `Domain=` and `Secure` attributes removed: the agent is
plain HTTP on another host, and a browser would drop the cookie otherwise. The page's `Cookie` is
passed on like any other header.

**Time.** The cloud has 30 s to answer a request (S3 counts it from the start of the attempt, to the
cloud's response headers; an answer that has begun then streams with no further limit). `GET
/api/v1/live/stream` (Server-Sent Events) has no time limit and is flushed event by event as it
arrives; any answer of unknown length is flushed as it arrives too. A body cut off by the cloud
after its headers ends the page's request as a failure, not as a short answer.

**Failures.** When the cloud does not answer, the agent answers by the table in §19.10, with
the web app's problem body:

```json
{ "type": "…", "title": "Cloud unreachable", "status": 502, "code": "CLOUD_UNREACHABLE",
  "detail": "…", "instance": "/api/v1/orders", "correlationId": "…" }
```

`correlationId` is the page's `X-Correlation-Id`. S3 builds the first row of the table and the
`504` row without retries; S5 adds the read retries.

As built in 2.1.0 (S3):

- A `502`, `503` or `504` from the cloud counts as its gateway's failure only when its body is not
  JSON: nginx and the CDN answer HTML or plain text, the application always answers JSON, and a
  route that answers `503` on purpose is passed on to the page as it is.
- A request body over 16 MB is `413 PAYLOAD_TOO_LARGE` (at once when `Content-Length` says so,
  else when the 16 MB are reached); a body the page's connection could not deliver is `400`.
- An agent with no `server` answers `503 AGENT_NOT_CONFIGURED`. The page's `Accept-Encoding` goes
  to the cloud and the answer comes back as the cloud sent it (the agent does not compress or
  unpack).
- The problem body is built by one function and the attempt to the cloud by another
  (`localui/upstream.go`: `Attempt`, `classify`, `gatewayKind`, `answerFor`), so the retries of S5 and
  S6 repeat an attempt and ask `answerFor` for the answer without touching the proxy.

**Not proxied.** `/api/v1/agent/*` (the agent's own routes) and `/api/v1/agent-releases/*` are
refused with `403` (`AGENT_ROUTE_BLOCKED`), on both listeners. A page of the agent's origin must not
reach them. The path is decoded, cleaned of dot segments and doubled slashes and lower-cased
before it is compared, as the cloud's nginx and Express would read it, so `/api/v1/%61gent/…` and
`/api/v1/AGENT/…` are refused too, and so is a path that cannot be decoded.

### 19.7 The frontend cache (S3)

The agent serves the cloud's own frontend build from disk. It downloads the build, so the page
is the same version as the cloud's, and it opens with no internet.

**Origin.** The frontend's origin is the agent's `server`: in production the frontend and the API
come from one host. An optional `app_url` in the agent's config (`config.json`, §3.1) overrides
it, for local development where the frontend is `vite preview` on another port. The API target
is always `server`.

**`build-manifest.json`.** `npm run build` in `starter-vite-ts` writes `dist/build-manifest.json`,
and the frontend serves it at `/build-manifest.json`:

```json
{ "build_id": "9f2c41d7ab03e5c8",
  "built_at": "2026-10-06T09:30:00.000Z",
  "files": [ { "path": "index.html", "sha256": "…", "size": 1234 } ] }
```

| Field | Means |
|---|---|
| `build_id` | The first 16 hex characters of the SHA-256 of the sorted file list with their hashes. The agent compares it for equality and never recomputes it. |
| `built_at` | When the build was made (§2.1 timestamp). |
| `files[]` | Every file in `dist` except the manifest itself. `path` is relative to `dist`, with `/`. `sha256` is lower-case hex. `size` is bytes. |

The frontend's `nginx.conf` serves `/build-manifest.json` and `/index.html` with
`Cache-Control: no-cache`. The hashed files under `assets/` keep their long cache.

**When the agent checks.** Every 5 minutes, after each WebSocket connect (§4.2), and on
`GET /agent/api/app/refresh`. Each check fetches `<origin>/build-manifest.json`.

**What it does.** If `build_id` is the one it already serves, nothing. Otherwise:

1. Take every file of the manifest. A file the agent already holds (the current or previous
   build has a file with the same `sha256`) is copied or hard-linked. Each other file is
   downloaded from `<origin>/<path>`, so a deploy that changes three chunks downloads three
   chunks.
2. Check each downloaded file against its `sha256` (and `size`). A mismatch rejects the whole
   build. A manifest `path` that leaves the build's folder (`..`, an absolute path) rejects it
   too.
3. Write the new build to `<data>\app\<build_id>\` and switch to it **atomically**: the
   folder is complete before `<data>\app\current.json` names it, and the file is replaced in one
   step. `current.json` also records when the switch happened (`downloaded_at`). A request never sees a half-written build.
4. Keep the current and the previous build. Delete older ones.
5. Log the switch: the old id, the new id, files fetched and bytes.

A failed check or download keeps the current build and tries again with backoff. A build the
agent serves is never changed while it serves it.

As built in 2.1.0 (S3):

- A failed check is tried again after 5 s, then 10 s, 20 s… up to the 5-minute interval; with no
  `server` configured the agent looks again every 30 s. Checks run one at a time; the refresh route
  waits for one in progress.
- A new build is assembled in `<data>pp.tmp-<build_id>-…` and renamed to `<data>pp<build_id>`
  only when every file is there and checked. Each build folder also holds the manifest as the
  cloud sent it (`.manifest.json`), and **only the paths that manifest lists are ever served**;
  `.manifest.json` and `build-manifest.json` themselves are not files of the app (the app routes
  answer `index.html` for them). A file the agent already holds is hard-linked from the current or
  previous build, or copied and checked against its hash where the disk does not allow a link.
- A manifest is refused whole if a `path` is empty, absolute, has `..` or `.` elements, a backslash
  or a colon, or is listed twice; if `sha256` is not 64 lower-case hex characters; if `size` is
  negative; if `build_id` is not 1 to 64 letters, digits, `_` or `-`; or if there is no
  `index.html`. A file is refused if its size or hash differs from the manifest.
- `current.json` is `{ "build_id", "built_at", "downloaded_at", "previous" }`. If the cloud goes back
  to the previous build, the agent switches to it from disk with no download. At start a build
  with a file missing or of the wrong size is dropped and fetched again; folders an interrupted
  download left are removed.
- The `Content-Type` of a file comes from a table in the agent (`.js` is `text/javascript`, and so
  on), not from the Windows registry.

**Serving.** A path that is a file of the current build is that file. Any other path (not
`/api/`, `/uploads/` or `/agent/`) is `index.html`, so the app's own routes work on reload.

- `index.html` is sent with `Cache-Control: no-cache`, and right after `<head>` the agent
  injects, once:

  ```html
  <meta name="gnext-agent" content='{"version":"<agent version>","cloud_url":"https://gnext.top","lan":false}'>
  ```

  The content is JSON, HTML-escaped. `version` is the running agent's version. `cloud_url` is the
  frontend's origin, a string: `app_url` if set, else `server` (the *Origin* paragraph above). `lan` is `true` on the LAN listener. The cached file on
  disk is the cloud's own, without the tag.
- Files under `assets/` are sent with `Cache-Control: public, max-age=31536000, immutable`.
  Any other file carries no cache header of its own.

**No build yet.** On a fresh install that has never been online, the app routes answer a small
Persian page: *Gnext has not been downloaded to this PC yet; connect it to the internet once.*
The settings page and `/agent/api/status` still work.

### 19.8 `GET /agent/api/status`

On both listeners, no authentication. For the app, which polls it (§19.10). On the loopback
listener the answer also carries the agent's own fields for the settings page and the tray (§19.5);
the LAN listener answers only what is below. Both send `Cache-Control: no-store`.

```json
{ "version": "2.2.0",
  "cloud": { "connected": true, "since": "2026-10-06T08:15:30.123Z",
             "reachable": true, "reachable_since": "2026-10-06T08:15:31.004Z" },
  "app": { "build_id": "9f2c41d7ab03e5c8", "built_at": "2026-10-06T09:30:00.000Z",
           "downloaded_at": "2026-10-06T09:41:12.000Z" } }
```

| Field | Means |
|---|---|
| `version` | The agent's version. |
| `cloud.connected` | The state of the agent's WebSocket session (§4). |
| `cloud.since` | When `connected` last changed. |
| `cloud.reachable` | Whether the cloud answers HTTP from this PC (2.2.0 on). The agent decides it (below); the app's bar uses it, not `connected`. |
| `cloud.reachable_since` | When `reachable` last changed. |
| `app` | The build being served; `null` while there is none. `built_at` is from the manifest; `downloaded_at` is when the agent switched to it. |

**Reachable (2.2.0).** The WebSocket's state is noticed only after missed heartbeats, and says nothing
of the plain requests the app makes, so the agent keeps a second, HTTP-level answer, once for the
whole branch:

- Every 3 s (from the end of one probe to the start of the next) it asks `GET <server>/health/live`,
  the backend's liveness check, which nginx serves under `/health/`, needs no sign-in and touches no
  database. A probe has 5 s to be answered; the cloud's gateway turning it away (502, 503, 504 with a
  page that is not JSON) is no answer. **Two failures in a row** make the cloud unreachable; **one
  success** makes it reachable.
- What becomes of the requests it passes on feeds the same state: one that gets no answer (not sent,
  or written and not answered, §19.10) makes the cloud unreachable at once, and any answer from the
  cloud makes it reachable at once, so a busy register finds out before the next probe. A request the
  page itself gave up on says nothing.
- It starts out reachable. With no `server` configured nothing is probed.

### 19.9 Agent mode in the app (S4)

The page knows it is served by an agent from the meta tag of §19.7. `src/utils/agent-mode.ts`
reads it once and exports `agentMode`: `null` outside the agent, else `{ version, cloud_url, lan }`.
Outside agent mode nothing changes.

In agent mode:

- **Routes.** Only the cashier's: POS (`/app/pos`), the orders directory and order detail, the
  delivery hub, incoming orders, the shift and cash pages the cashier role already sees, the
  profile and sign-out drawer, and the login page. They are listed in one array in the code,
  with a comment. Any other route shows a small page, *This page opens on gnext.top*, with a
  button to `<cloud_url><same path>` in a new tab.
- **Navigation.** Only the allowed items, and one *Open Gnext* link to `cloud_url`.
- **After sign-in** the app lands on the POS.
- **A chip** in the header: *Branch PC*, or *Register on the branch network* when `lan` is true.
  Its tooltip carries the agent version.

### 19.10 Interruptions: reconnecting and retries (S5)

**Answers.** What the agent answers when the cloud does not (S3 builds these; S5 adds the retries,
S6 the keyed writes):

| What happened | Read (`GET`, `HEAD`) | Write | Write with `Idempotency-Key` (S6) |
|---|---|---|---|
| Not sent: connection refused, DNS, TLS, connection reset before the request was written; or the cloud's gateway answers `502` or `503` | Retried (S5), then `502 CLOUD_UNREACHABLE` | `502 CLOUD_UNREACHABLE` | Retried |
| Written, but no answer within the timeout; or the cloud's gateway answers `504` | Retried (S5), then `502 CLOUD_UNREACHABLE` | `504 CLOUD_NO_ANSWER`: the write may have happened | Retried |

A keyed write that runs out of retries ends `504 CLOUD_NO_ANSWER` if any of its attempts was
written and unanswered, else `502 CLOUD_UNREACHABLE`. The live stream is never retried by the
agent.

**Retries.** A retried request has a window counted from when it arrived at the agent: an
attempt every 2 s, no new attempt after 20 s, and each attempt has its own timeout of
min(30 s, time left + 10 s). If the client goes away, the agent stops.

**The app, in agent mode.**

- **Reachability** is the status route's `cloud.reachable` (§19.8), polled every 3 s, combined
  with the requests that got no answer (`cloud-reachability.ts`). Outside agent mode today's
  behaviour stays.
- Unreachable for more than 2 s: a thin amber bar at the top, *Reconnecting to Gnext… your
  screen and cart are kept*. After 2 minutes: *No internet. Orders can't be sent until it is
  back.* While the bar shows, the `NETWORK_ERROR` and `CLOUD_UNREACHABLE` toasts are
  suppressed.
- Back: the bar turns green for 3 s, *Connected again*, and the app refetches what is on screen.
  It dispatches the window event `gnext:cloud-back`; the POS (menu, shift, open orders), the
  orders directory, the delivery hub and incoming orders listen to it. The live stream
  reconnects on its own.
- A write that failed with `CLOUD_UNREACHABLE` shows, where the button was pressed, *Not sent.
  Try again when connected.* One that failed with `CLOUD_NO_ANSWER` shows *We couldn't confirm
  this was saved. Check the order before trying again.* The cart is never cleared on either.

Persian text: *در حال اتصال دوباره به جی‌نکست… صفحه و سبد خرید سر جایش است*. Every new string has
an `en` and an `fa` value.

As built in 2.2.0 (S5), the agent:

- `(*Proxy).retryable` is the one place that decides what is repeated: a `GET` or `HEAD`, except
  `/api/v1/live/stream`. Since 2.3.0 (S6) it also allows a write that carries `Idempotency-Key`, except
  the card-charge routes of §19.11. A request that may be repeated has its body (a read rarely has one)
  read once and sent again with each attempt.
- The attempts keep to a clock that starts when the request arrives: one at 0, 2, 4 ... 20 s. The next
  one is due at the next tick, at once if the attempt used up its whole tick, and is made only if it is
  due at 20 s or earlier (so a dead cloud is tried at 0, 2 ... 20 s and the page is answered at about
  20 s). The attempt's own time is `min(30 s, 20 s - time since arrival + 10 s)`: the first attempt
  has 30 s, and a cloud that takes the request and never answers ends a read at 30 s, not 20.
- A page that closes its request ends the retries at once, between two attempts or in the middle of
  one; nothing more is sent to the cloud. `answerFor` is asked once, with whether any attempt was
  written and not answered, so a keyed write (S6) ends `504` if any of its attempts was.
- The timing is `localui.Retry{Every, Window, Grace}` (2 s, 20 s, 10 s); the tests shorten it.
- `localui.Reach` (`reach.go`) is the probe and its state machine of §19.8; `Proxy` tells it what
  became of each attempt. `cloud.reachable` and `cloud.reachable_since` are on both listeners.

The app, in agent mode:

- `src/components/cloud-status-bar.tsx` is the bar: fixed at the top, 28 px, amber *Reconnecting* from
  2 s out of reach and the *No internet* line from 2 minutes, green *Connected again* for 3 s. While it
  shows the page is moved down by its height (the sticky header and the side menu start under it) and a
  `resize` is sent so the register measures itself again.
- "Out of reach" (`src/utils/cloud-link.ts`, `agent-link.ts`) is the earlier of two signals: the status
  route's `cloud.reachable` polled every 3 s (or the route not answering), and the requests that got no
  answer (`cloud-reachability.ts`). The page makes no requests of its own to find out: the agent probes
  once for the branch (§19.8), and a request that fails marks it at once. A poll that finds `reachable`
  true after the page's requests failed clears them, so a screen that has asked nothing since does not
  keep the bar up. An agent older than 2.2.0, whose status has no `reachable`, leaves the requests alone
  to say. A window that is hidden does not poll.
- The outage ends when neither says so. If the bar was up, the app sends the window event
  `gnext:cloud-back` (`src/utils/cloud-back.ts`, `useCloudBack`). The POS reads the menu, the stops and
  stock, the open shift and the held orders again, quietly (it keeps the category the cashier is on and
  the cart); the incoming-orders queue and its policy are read again; the orders directory, the delivery
  hub, the kitchen screen and the print queue do it through `useLiveRefresh`, which also listens.
- `useLiveRefresh`: a browser closes an event stream for good when its reconnect is answered with an
  error status, and that is what the agent (`502`, the stream is never retried) or the cloud's gateway
  answers while the cloud is down. A stream that finds itself closed is now opened again, after 1 s,
  2 s ... up to 15 s, and at once on `gnext:cloud-back`; the next `ready` re-reads the board.
- The words for a request the agent could not get answered are put in the problem's `detail` by the
  HTTP client (the agent's own text goes to `technicalDetail`), where every screen already shows it:
  `CLOUD_UNREACHABLE` on a write is *Not sent. Try again when connected.*, `CLOUD_NO_ANSWER` is *We
  couldn't confirm this was saved. Check the order before trying again.*, and a read is *Couldn't reach
  Gnext. Try again when connected.* The POS drops the first when the cloud is back and keeps the second.
  A cart, a form or an open order is never cleared by either.
- `showErrorToast` makes no toast for `CLOUD_UNREACHABLE`, `CLOUD_NO_ANSWER` or `NETWORK_ERROR` in agent
  mode, whether the bar is up yet or not; the bar and the inline message say it. Incoming orders, which
  has no place for a message, toasts the `detail` of a failed accept or reject itself.
- A reload during an outage does not sign anyone out. The session is an HttpOnly cookie the page cannot
  see, so while a tab is signed in it keeps `gnext_session_hint` in `sessionStorage`. When
  `/auth/me` then gets no answer (`CLOUD_UNREACHABLE`, `CLOUD_NO_ANSWER`, `NETWORK_ERROR`, or a gateway
  502/503/504, which the HTTP client turns into a `GATEWAY_ERROR` problem when the body is not JSON)
  and the hint is there, the session is *unknown*, not signed out: the app shows a full-page
  *Connecting to Gnext…* (`src/components/connecting-page.tsx`; the bar sits above it) and asks
  `/auth/me` again every 3 s, one at a time, and at once on `gnext:cloud-back`
  (`useSessionRetry`). A `200` goes on as normal, a `401` goes to sign-in, as before. A tab already signed
  in stays so when a later `/auth/me` gets no answer, and without the hint (never signed in) the
  sign-in page shows as before. This is the same code path outside agent mode (the cloud's own
  site), where it also covers a reload during a deploy or with the network down.

### 19.11 Idempotency (S6)

A write the agent may retry must be safe to repeat. The cloud's `IdempotencyInterceptor` and the
`@RequireIdempotency(scope, { optional })` decorator (`backend/src/common`) make it so for the routes
that use them. As built in 2.3.0:

**Cloud.** The interceptor is global; a route opts in with the decorator. The routes the register's
Place, Hold and payment use carry it, all with `optional: true`:

| Route | Scope | Used for |
|---|---|---|
| `POST /api/v1/orders` | `ORDER_CREATE` | Place and Hold make the draft |
| `PATCH /api/v1/orders/:id` | `ORDER_UPDATE_DRAFT` | Place and Hold of a draft that was resumed |
| `POST /api/v1/orders/:id/submit` | `ORDER_SUBMIT` | Place: the kitchen ticket, the print jobs and the call number |
| `POST /api/v1/payments` | `PAYMENT_CREATE` | the first of the two calls of a payment (cash, card, credit): makes the intent |

- The payment is two calls: this one makes the intent, `POST /api/v1/payments/:id/process` takes the
  money. Only the intent is keyed. `process` is never retried by the agent (below), and a payment that
  is already `SUCCEEDED` is answered as it is when it is processed again, so a cash payment is taken
  once.
- The POS's quote is `POST /api/v1/discount-quotes`, a preview that writes nothing; it has no key. The
  POS makes no other write on *Place*.
- **Same key, same body**: the first answer again, status and body, with `X-Cache-Replay: true`. The
  answer is stored before it is sent, so a repeat that arrives as the first answer does finds it.
  **Same key, another body** (the hash covers the scope, the URL and the body): `409
  IDEMPOTENCY_CONFLICT`. **Same key while the first request is still running** (its record is
  `PENDING`, or two requests arrive together): `409 IDEMPOTENCY_IN_PROGRESS`. This is an answer from the
  application, so the agent passes it on and stops retrying; the app words it as a write that may have
  been saved (`agent.reconnect.notConfirmed`).
- A request that **fails** (a refusal or an error before it answers) frees its key at once, so a repeat
  with the same key runs; a stored answer is never removed. A request whose answer could not be stored
  stays `PENDING` for the day rather than free, so it is never run twice.
- **No key** is allowed: `optional` runs the request as if the route had no decorator (the kiosk and
  Snappfood intake send none). An empty or blank key counts as none. A decorator without `optional`
  still answers `400 IDEMPOTENCY_KEY_REQUIRED` for a missing key; a key over 160 characters is `400
  IDEMPOTENCY_KEY_INVALID`.
- Keys are kept **per tenant**, route scope and key, for 24 hours (`idempotency_record`). One key may
  serve every call of one press of *Place*, since the scopes differ.
- The agent trusts the page: it retries any write that carries the header, though only the routes above
  honour it. A page must send the key only on those.

**App.** The POS makes a UUID (`generateUuid`: `crypto.randomUUID`, else `crypto.getRandomValues`, else
`Math.random`, because the LAN listener is plain HTTP and not a secure context, §19.4) when a button is
pressed, and sends it as `Idempotency-Key` on every one of that press's calls above: Place (create or
update, then submit), Hold (create or update), a payment's intent (`postPayment`), and the direct card
button (create or update, submit and the intent, one key). The next press makes another. The app does
not repeat a write by itself; what repeats it is the agent, which sends the key it was given. A cashier
who presses the button again after `CLOUD_NO_ANSWER` starts a new action with a new key, and is told to
check the order first.

**Agent.** A write (any method but `GET` and `HEAD`) with a non-blank `Idempotency-Key` is retried like a
read (§19.10), also after an attempt that was written and never answered, with the same body and key.
Its final answer is in the table of §19.10: `504 CLOUD_NO_ANSWER` if any attempt was written and
unanswered, else `502 CLOUD_UNREACHABLE`. A write without the key is unchanged: one attempt. The
cloud's own answers (`409`, `4xx`, `500`, a JSON `503`) are answers, not failures, and end the retries.
The agent sends the key to the cloud under a lower-case header name: Go's HTTP client repeats by itself,
and unseen, a request that carries `Idempotency-Key` when a kept-alive connection breaks after the
request was written, which would hide a written attempt (and repeat a card charge). Header names are
not case-sensitive, so the cloud reads it as before.

**Card charges are never retried by the agent**, key or not. The agent excludes, by path, every route of
`payment.controller.ts` that starts, checks or settles a charge on a card terminal, all of the form
`POST /api/v1/payments/:id/<route>`:

| Route | Why |
|---|---|
| `process` | Starts the charge on the terminal (cash and credit too: the agent cannot tell the tender from the path) |
| `check-terminal` | Asks the terminal how an unconfirmed charge ended |
| `correct` | Reverses a payment and takes a replacement through `process`, which may be a new card charge |
| `resolve-terminal` | A manager settles an unconfirmed charge by hand from the terminal's report |

The path is read decoded, cleaned of dot segments, doubled slashes and a trailing slash, and lower-cased,
as the cloud's Express reads it, so `/API/V1/payments/1/%70rocess` is the same route; one that cannot be
decoded counts as a charge route. `void` and `reverse` start nothing on a terminal and are not excluded
(the page sends them no key). No other controller starts or checks a terminal charge: the kiosk calls
`processPayment` itself, not through the agent.

### 19.12 Shortcuts, window and Branch Agents (S7)

- `gnext-agent app` opens `http://127.0.0.1:47800/` in the WebView2 window (the browser if there
  is none), the way `open` opens the settings page. The installer puts a Start-menu and a
  desktop shortcut *Gnext* on `gnext-agent.exe app`. The tray has *Open Gnext* first, then
  *Agent settings*.
- The app opens at Windows sign-in, on by default. `app_at_sign_in` in the agent's `config.json`
  (through `internal/store`) turns it off, from the settings page. Not at the service's own start: an update would pull a
  register already open to the front, mid-sale.
- The settings page has a card *Registers on this network*: `http://<each LAN IPv4>:47801/`
  with a copy button, the current app build id and when it was downloaded, and *Download now*
  (`/agent/api/app/refresh`).
- **Heartbeat.** An agent with `app.serve` adds to every `heartbeat` (§4.3):

  ```json
  { "app_build_id": "9f2c41d7ab03e5c8",
    "lan_urls": ["http://192.168.1.10:47801/"] }
  ```

  | Field | Means |
  |---|---|
  | `app_build_id` | The build being served, or `null` while there is none. |
  | `lan_urls` | The PC's IPv4 addresses on private networks, as LAN URLs; an empty list if there are none. |

- **Cloud.** The backend stores `app_build_id` and `lan_urls` from the heartbeat and returns
  them in `GET /api/v1/agents`.
- **Operations → Branch Agents** shows, per agent: its version, whether it has `app.serve`, the
  build it serves against the cloud's current one (*up to date* or *behind*), and its LAN
  address. The page learns the cloud's current build by fetching its own
  `/build-manifest.json`.

### 19.13 Files and config

| Where | What |
|---|---|
| `%ProgramData%\Gnext\Agent\config.json` | The install config (§3.1), with an optional `app_url` (§19.7). |
| `config.json`, through `internal/store` | Also `app_at_sign_in` (§19.12). |
| `<data>\app\<build_id>\` | A downloaded build. The current and the previous one are kept. |
| `<data>\app\current.json` | Names the build being served and when it was switched to. |
| `devices.json` | Kept: the last printer and terminal config (§19.2). |

`<data>` is the agent's data folder, `%ProgramData%\Gnext\Agent`.

### 19.14 Not in v3, and what comes later

Not in v3: any offline selling, sign-in by PIN, a snapshot or order book on the agent, HTTPS on
the LAN, finding the PC by name or QR code, another PC taking over when the branch PC dies.

Offline features come back later, one at a time, and only when the product owner asks. The
order is: queue *Place* and print the kitchen ticket locally; the menu from the agent; cash
offline; sign-in offline; card offline.

### 19.15 Conformance checklist for the agent

For an agent that advertises `app.serve`:

- [ ] `GET /` on the loopback listener serves the current build's `index.html` with the
      `gnext-agent` meta injected once; an unknown path serves it too; `/api/` and `/uploads/`
      never fall back to it.
- [ ] `/api/*` passes headers and body both ways, drops the hop-by-hop headers, adds
      `X-Forwarded-For`, `X-Forwarded-Proto` and the `User-Agent` suffix, and answers `502
      CLOUD_UNREACHABLE` for a dead upstream.
- [ ] `GET /api/v1/live/stream` is flushed event by event with no time limit.
- [ ] `/api/v1/agent/*` and `/api/v1/agent-releases/*` answer `403` on both listeners.
- [ ] The LAN listener answers `404` for `/agent/` except `GET /agent/api/status`, and accepts any
      `Host`; the loopback listener refuses a foreign one.
- [ ] A new `build_id` downloads only the files whose hash is not held, rejects a file with a bad
      hash, switches atomically, and keeps two builds.
- [ ] A restart with no internet still serves the last build; a fresh install with no build
      answers the *not downloaded yet* page.
- [ ] `Set-Cookie` from the cloud reaches the page without `Domain=` and `Secure`; `Cookie` goes
      through.
- [ ] A write the cloud never answered gets `504 CLOUD_NO_ANSWER`; a request that was not sent
      gets `502 CLOUD_UNREACHABLE`.
- [ ] A read is retried every 2 s for 20 s (counted from arrival) and stops when the client goes
      away; a write is not retried without `Idempotency-Key`; a card charge is never retried.
- [ ] A write with `Idempotency-Key` is retried after a drop mid-request and answered when the cloud
      comes back; its answer after the window is `504 CLOUD_NO_ANSWER` if any attempt was written and
      unanswered, else `502 CLOUD_UNREACHABLE`; `process`, `check-terminal`, `correct` and
      `resolve-terminal` of a payment are never retried, however the path is spelled; the key reaches
      the cloud under a lower-case header name.
- [ ] `GET /agent/api/status` reports the WebSocket state and the served build.
