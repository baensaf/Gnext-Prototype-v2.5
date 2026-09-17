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

v1 has **no offline mode**. If the connection is down, the agent does nothing new; the
cloud falls back to its simulator for that branch. (Offline orders are v2; see §12.)

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
| **HTTPS** `https://<host>/api/v1/agent/...` | Enrolment, release check, release download. (v2: data pull, sync upload.) |

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

Reserved for v2 and later (a v1 agent answers them with `ack ok:false UNKNOWN_TYPE`):
`sync.*`, `data.*`, `order.*`.

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
| `config.updated`, `agent.check_update` | 24 h |

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
- `SUCCESS` means the printer or spooler accepted all copies. The agent does not claim the
  paper came out; few printers can say so.
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
| `PRINTER_OFFLINE` | Spooler reports the printer offline. |
| `PAPER_OUT` | |
| `COVER_OPEN` | |
| `PRINTER_ERROR` | Any other fault the printer reports. |
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
`application/octet-stream`.

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

## 12. Reserved for v2 and later

Named here so v1 does not collide with them. Not specified yet.

- `GET /api/v1/agent/data/...` — paged, versioned pull of menu, prices, tax, printers,
  terminals (task 10).
- `POST /api/v1/agent/sync/orders` — idempotent batch upload of offline orders, payments and
  print records with agent-generated IDs (task 11).
- WebSocket types `sync.*`, `data.*`, `order.*`.
- v3: replay protection, batch signing, key rotation, back-pressure, resumable sync.

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

## 14. Decisions and open questions

Decided by the product owner (2026-09-17):

1. **Terminal**: the test branch PC has a **Saman (SEP)** terminal. The one real driver in
   §7.6 is `sep`. Whether its protocol can query a past transaction is still to be checked
   against Saman's integration document; until then the driver does not advertise
   `payment.query`.
2. **Printer**: the test printer is on the **LAN, raw TCP port 9100**. The first agent build
   MUST support `connection.kind = tcp` (§6.2 raster over ESC/POS); `windows` and `serial`
   MAY follow later.
3. **Replacing an agent** (§3.3): redeeming a new code **revokes** the branch's old agent.

Still open:

4. **Arvan WebSocket**: WebSocket must be enabled for the domain in the Arvan panel, and its
   idle timeout must exceed 20 s. nginx already forwards upgrade headers on `/api/`.
