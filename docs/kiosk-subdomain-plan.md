# Kiosk on its own subdomain — implementation plan

Date: 2026-10-05. Branch: `feat/kiosk-subdomain`. Worktree: `D:\VibeCode\ClaudeCode\Gnext-kiosk-subdomain`.

## Decisions (from the user)

| Question | Answer |
|---|---|
| Address | `kiosk.gnext.top` only (not gnextdev.ir) |
| Device sign-in | A manager signs in on the device once; the existing session cookie keeps it signed in. No new auth. |
| Lockdown | The subdomain shows the kiosk screen only — no sidebar, no way into `/app`. |
| `/app/kiosk` | Removed (follow-up, same day): the kiosk lives only on the kiosk host. No route, no `paths.app.kiosk`, no "Kiosk preview" sidebar item (`nav.kiosk`), and it is out of `CASHIER_PATHS` and `SHOP_FLOOR_PATHS`. |
| Who may run it | MANAGER, OWNER, ADMIN, SUPER_ADMIN. A cashier who signs in on the kiosk host sees "not available for your role" with a Sign Out button (no PIN). |
| Sign out | The kiosk's setup dialog has a Sign Out button that needs a manager PIN (`ApprovalModal`, action `SIGN_OUT_KIOSK`). |
| Idle sign-out | `IdleLogout` does not run on the kiosk host. |
| Build | Same frontend bundle; the app picks its routes by hostname. One container, one deploy. |
| Shipping | Commit locally on the branch. Do not push, open a PR or merge. The user adds DNS in Arvan. |

## How it works today (verified)

- (Before this work) the kiosk was `/app/kiosk` inside `AppShell`, behind `ProtectedRoute` and `RequiresBranch`
  (`starter-vite-ts/src/routes/sections/index.tsx:141`).
- `BranchProvider` wraps the whole app (`src/app.tsx:27`), so the kiosk page works outside `AppShell`.
- Auth is the host-only `gnext_session` cookie (HttpOnly, Lax, 7 days) set by
  `backend/src/modules/auth/auth.controller.ts:37`. A login on `kiosk.gnext.top` gets its own cookie
  for that host — exactly what we want.
- Production builds with `VITE_SERVER_URL=""` (`starter-vite-ts/Dockerfile:7`), so API calls are same-origin.
  On `kiosk.gnext.top` they go to `kiosk.gnext.top/api/...` and hit the same nginx.
- `starter-vite-ts/nginx.conf` uses `server_name _`, so it already serves any host. **No nginx change needed.**
- The kiosk page remembers its terminal in `localStorage` (`gnext_kiosk_terminal`) and has a settings
  button that opens `DeviceTerminalDialog` (`src/pages/pos/kiosk.tsx:404-409`).
- Login navigates to `homePathForRole(role)` (`src/pages/login.tsx:49,60`).

## Work

### 1. Host detection — new `starter-vite-ts/src/config/kiosk-host.ts`

- `isKioskHost(): boolean` — `window.location.hostname` starts with `kiosk.`
  (covers `kiosk.gnext.top` and `kiosk.localhost` for local testing).
- (A `kioskUrl()` helper for the `/app/kiosk` redirect existed in the first commit and was removed with it.)

### 2. Kiosk-host routes

In `src/routes/sections/index.tsx`, export a second route list used when `isKioskHost()` is true
(choose it where the router is created — find where `routesSection` is consumed):

- `/login` → `LoginPage`
- `/` → `ProtectedRoute` → `RequiresBranch` → `KioskPage`, rendered full-screen with no `AppShell`
  and no `IncomingOrdersProvider`.
- `*` → `<Navigate to="/" replace />` (so `/app/...` is unreachable on this host).
- If the signed-in role is not MANAGER, OWNER, ADMIN or SUPER_ADMIN, show the "not available for your
  role" message and a sign-out button instead of the kiosk.

`LoginPage`: on a kiosk host, navigate to `/` after login instead of `homePathForRole(...)`.

Check the kiosk page looks right without the shell (full height, no leftover padding that assumed the
shell). Branch selection for head-office users must still be possible — `RequiresBranch` already shows
a branch picker for head office; confirm it renders sensibly outside the shell.

### 3. Sign-out on the kiosk

The device needs a way back out (e.g. to switch the account). Add a "Sign out" action to the kiosk's
existing settings dialog/area (next to `DeviceTerminalDialog`). Don't add a new PIN gate; reuse whatever
already guards the settings button. Only show it on the kiosk host if it would be confusing inside `/app`.

### 4. `/app/kiosk` removed

The `/app/kiosk` route, the `KioskEntry` redirect, `paths.app.kiosk`, `kioskUrl()` and the sidebar item
are gone; there is no redirect from the main site. The kiosk host checks the role itself (MANAGER and
above) instead of `canReachPath`. The Playwright kiosk steps (`r27-workflow.spec.ts` journey 3 removed,
`section-16-3-acceptance.spec.ts` §16.3.6a/b skipped) need a kiosk-host sign-in that the localhost run
cannot do; try the kiosk by hand on `http://kiosk.localhost:<port>/`.

### 5. Local testing support

- Vite dev server: allow `kiosk.localhost` (`server.allowedHosts` in `vite.config.ts`, Vite 8).
- Dev `.env` has `VITE_SERVER_URL=http://localhost:3100`, so the browser calls the backend
  cross-origin from `http://kiosk.localhost:<port>`. Either test with `VITE_SERVER_URL` empty and the
  existing Vite `/api` proxy (`vite.config.ts:36`), or extend the backend CORS regex in
  `backend/src/main.ts:36` to accept `http://<sub>.localhost(:port)`. Prefer the proxy (no backend change);
  only touch the backend if the proxy route doesn't work. Check the session cookie actually sticks.

### 6. Strings

Any new UI text goes into both `src/locales/en.json` and `src/locales/fa.json` with identical keys
(`backend/test/r27-e2e.spec.ts` checks this; a mismatch turns `main` red).

### 7. Verify

- `npm run lint` and `npm run build` in `starter-vite-ts`. If the backend was touched: `npm run typecheck`
  and `npx jest` in `backend` (copy `backend/.env` from the main checkout; delete the copy afterwards).
- In the browser: `http://kiosk.localhost:<port>/` → login → kiosk full-screen, place a cash order,
  `/app/dashboard` on that host lands back on `/`, sign out asks for a manager PIN. A cashier sees the
  not-available screen. `http://localhost:<port>/app/kiosk` no longer renders the kiosk.

### 8. Commit

One or a few commits on `feat/kiosk-subdomain`. Use `git commit -F <file>` (PowerShell breaks `-m` with
quotes). **Do not push.** Remove any copied `.env` files and any `node_modules` junctions
(`cmd /c rmdir <path>`) only if the user later asks to remove the worktree — leave the worktree in place.

## For the user (after merge)

1. Arvan → gnext.top → DNS: add an `A` record `kiosk` → `195.234.80.33`, proxied (cloud on), like the apex.
2. Arvan → SSL: make sure the certificate covers `kiosk.gnext.top` (issue one or use a wildcard).
3. Nothing on the VPS: nginx already answers any host.

## Known limits (left as-is)

- The session cookie lasts 7 days, so the kiosk needs a manager sign-in about weekly. (Idle sign-out is off on the kiosk host, so only the cookie expiry ends the session.)
- gnextdev.ir and LAN addresses have no kiosk subdomain, so the kiosk is not reachable there. The only way to see it locally is `kiosk.localhost`.
