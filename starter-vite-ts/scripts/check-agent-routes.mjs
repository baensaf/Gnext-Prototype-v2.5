/**
 * Checks the allow-list of the branch agent's copy of the app (src/config/agent-routes.ts)
 * against the real router (src/routes/sections/index.tsx) and against a table of what must
 * and must not open there. The frontend has no unit-test runner, so this is a plain script:
 *
 *   node scripts/check-agent-routes.mjs
 *
 * It loads the TypeScript file as it is, which needs Node 22.18 or newer.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { AGENT_ROUTES, isAgentRoute } from '../src/config/agent-routes.ts';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;

function check(ok, message) {
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${message}`);
  }
}

// 1. What must open, and what must go to the cloud.
const OPENS = [
  '/',
  '/login',
  '/app/pos',
  '/app/pos/',
  '/app/pos/receipt/123',
  '/app/orders',
  '/app/orders/incoming',
  '/app/orders/9b1c',
  '/app/delivery',
  '/app/delivery/orders',
  '/app/delivery/couriers',
  '/app/delivery/couriers/7',
  '/app/delivery/settlements',
  '/app/delivery/settlements/7',
  '/app/cashier/shifts',
  '/app/cashier/shifts/42',
];
const CLOUD = [
  '/app',
  '/app/dashboard',
  '/app/kds',
  '/app/dine-in/floor',
  '/app/refunds',
  '/app/payments',
  '/app/delivery/zones',
  '/app/delivery/audit',
  '/app/delivery/rollup',
  '/app/delivery/ordersx',
  '/app/cashier/business-days',
  '/app/cashier/rollup',
  '/app/cashier',
  '/app/catalog/products',
  '/app/customers',
  '/app/settings',
  '/app/settings/users',
  '/app/operations/agents',
  '/app/operations/print-queue',
  '/app/reports',
  '/app/posx',
  '/app/orders-archive',
  '/loginx',
  '/kiosk',
];
OPENS.forEach((p) => check(isAgentRoute(p), `${p} should open in agent mode`));
CLOUD.forEach((p) => check(!isAgentRoute(p), `${p} should open on the cloud, not in agent mode`));

// 2. Every entry names a real route: a path in the router, or the parent of one.
const router = fs.readFileSync(path.join(rootDir, 'src/routes/sections/index.tsx'), 'utf8');
const routerPaths = new Set(['/']);
for (const match of router.matchAll(/path:\s*'([^']+)'/g)) {
  const p = match[1];
  if (p === '*' || p === '/app') continue;
  routerPaths.add(p.startsWith('/') ? p : `/app/${p}`);
}
for (const { path: entry } of AGENT_ROUTES) {
  const real = [...routerPaths].some((p) => p === entry || p.startsWith(`${entry}/`));
  check(real, `${entry} is in the allow-list but is no route in the router`);
}

// 3. Every router route the list opens, so a new page is noticed in a diff of this output.
const opened = [...routerPaths].filter((p) => isAgentRoute(p.replace(/:[A-Za-z]+/g, 'x'))).sort();
console.log(`Routes opened in agent mode (${opened.length}):`);
opened.forEach((p) => console.log(`  ${p}`));

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log(`\nOK: ${OPENS.length} open, ${CLOUD.length} go to the cloud, ${AGENT_ROUTES.length} entries match the router.`);
