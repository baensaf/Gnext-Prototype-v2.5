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
agent, and the upload of orders the branch took while offline.

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
| **HTTPS** `https://<host>/api/v1/agent/...` | Enrolment, release check, release download; v2: branch snapshot, offline order upload (§12). |

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
advertise `data.pull`. Reserved for later (an agent answers them with
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
used for logging; the cloud is the source of truth.

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
the Saman terminal on the test branch PC (§14), plus a `fake` driver (approves amounts ending in `0`,
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
  "min_agent_version": "1.0.0"
}
```

`204 No Content` when no release has been published.

`url` is relative to the server. The download needs the same auth header and returns
`application/octet-stream` with `Content-Length` and an `X-Content-SHA256` header. An unknown or
unpublished version is `404`.

Every green push to `main` offers the agent CI built to the cloud (`POST
/api/v1/agent-releases/ci`, bearer `AGENT_RELEASE_CI_TOKEN`) once the deploy is done. It is
stored unpublished, and only a new `agent/VERSION` makes a new release; the same version again
is a no-op. Head office can still upload a build by hand on the Branch Agents screen, and
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
4. Rename the running `gnext-agent.exe` to `gnext-agent.old.exe` (Windows allows renaming a
   running executable), move the new file into its place.
5. Close the WebSocket with `1001` and exit with code `3`. The service recovery settings
   (§3.1) restart the service on the new binary.
6. The new binary deletes `gnext-agent.old.exe` once it has received a `welcome`.

If the new binary fails to start three times, an administrator restores
`gnext-agent.old.exe` by hand. Automatic rollback is not in v1.

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

Status: **draft for review** (HANDOFF tasks 10–13). Protocol version stays **1**: everything
here is new endpoints, a new command and new optional fields, switched on by capabilities.

v2 is built in two steps. This section is the first: the agent keeps a copy of what the
branch sells, and the cloud accepts orders the branch took while it was offline. The second
step, the **offline POS** (a till screen served by the agent that takes orders, prints and
charges while the internet is down), produces those orders. It is specified later; until it
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
    "call_number_issued_today": { "business_date": "2026-09-24", "POS": 37 }
  },
  "categories": [
    { "id": "…", "parent_id": null, "name": "برگر", "sort_order": 1 }
  ],
  "products": [
    {
      "id": "…", "code": "B01", "name": "چیزبرگر", "category_ids": ["…"],
      "price": "2450000",
      "tax_rate": "0.1000",
      "variants": [ { "id": "…", "name": "دوبل", "price": "3100000" } ],
      "option_groups": [
        {
          "id": "…", "name": "نوشیدنی", "min": 0, "max": 1,
          "items": [ { "id": "…", "name": "کوکا", "price_delta": "350000", "product_id": null } ]
        }
      ],
      "is_available": true
    }
  ],
  "availability": {
    "stopped": { "product_ids": [], "variant_ids": [], "option_item_ids": [] },
    "schedules": [ { "product_id": "…", "days": [6, 0, 1, 2, 3, 4], "from": "11:00", "to": "16:00" } ],
    "daily_stock": [ { "product_id": "…", "variant_id": null, "remaining": 12 } ]
  },
  "payment_methods": [ { "id": "…", "code": "CASH", "name": "نقد", "kind": "CASH" } ],
  "order_types": ["TAKEAWAY", "DINE_IN", "DELIVERY"],
  "dining_tables": [ { "id": "…", "area": "سالن", "number": "12", "seats": 4 } ],
  "delivery_zones": [ { "id": "…", "name": "ونک", "fee": "400000" } ],
  "tills": [ { "id": "…", "code": "T1", "name": "صندوق ۱", "payment_device_id": "e21d…" } ],
  "open_shifts": [
    { "id": "…", "terminal_id": "…", "user_id": "…", "shift_number": "S-0412", "opened_at": "…" }
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
- Names are the ones the register shows (Persian for Persian tenants).
- **Not in the snapshot**: customers, coupons and discounts, users and PINs, reports, other
  branches' data, printer and terminal config (that stays in `welcome.config`, §6.1).
- The cloud MUST keep every snapshot it served, by `data_version`, for **30 days**. §12.6
  checks an offline order against the snapshot its till used.

The agent:

- MUST pull after each `welcome` whose `data_version` differs from the one it holds, on
  `data.changed`, and every **15 minutes** while connected. A failed pull is retried with the
  §4.7 backoff; the agent keeps selling from the copy it has.
- MUST store the snapshot atomically (write a temporary file, then rename) in its data
  folder, and keep the previous one. It MUST NOT edit a snapshot.
- Serves the snapshot to the offline POS (second step). Until then it only keeps it and
  reports its version (§12.7).

`welcome` gains one field for agents that advertise `data.pull`:

```json
{ "data_version": "b1f0c9…" }
```

### 12.3 `data.changed` (cloud → agent)

A command, answered by `ack` only. Payload: `{ "expires_at": "…", "data_version": "…" }`.
It expires after 24 h.

The cloud sends it when anything in the branch's snapshot changes: catalog, prices,
availability (stops, schedules, stock), payment methods, tables, delivery zones, tills, call
number settings, or a shift opens or closes on one of the branch's tills. It MAY coalesce
changes and send at most one every 10 s. The agent answers with `ack` and pulls (§12.2). If
it already holds that version, it acks and does nothing.

`data.changed` is a hint. The 15-minute pull catches anything the cloud forgot to announce.

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

The same `id` with **different** content is `HELD` with `ID_REUSED`; the first upload stands.

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
| `shift_id` is open | Closed: booked into that shift anyway, flag `SHIFT_CLOSED` (its cash count changes) |
| `business_date` is not closed | Closed: booked on that date anyway, flag `DAY_CLOSED` |
| Daily stock covers it | Otherwise stock goes below zero, flag `STOCK_NEGATIVE` |
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

For the offline POS step: signing in offline (the snapshot has no users or PINs), rendering
tickets on the agent, and serving the till screen. For later, if at all: coupons, discounts,
refunds and customer lookup offline; opening or closing shifts offline. Snappfood orders keep
arriving in the cloud while a branch is offline, and wait there.

v3: replay protection, batch signing, key rotation, back-pressure, resumable uploads of very
large backlogs.

## 13. Conformance checklist for the agent

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

- [ ] Pulls the snapshot after `welcome` when the version differs, on `data.changed`, and every
      15 min; a `304` changes nothing; a failed pull keeps the old copy.
- [ ] A snapshot is written atomically: killing the agent mid-write leaves the old one readable.
- [ ] An offline order is uploaded once its offline life ends, oldest first, 50 at most a batch.
- [ ] A batch cut off by a network error is resent as is, and the cloud answers `DUPLICATE`
      for the orders it already has; none is booked twice.
- [ ] A `400` batch is split, the good orders go up, and the bad one is kept and logged.
- [ ] Heartbeats carry `sync` with the right backlog.

## 14. Decisions and open questions

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
