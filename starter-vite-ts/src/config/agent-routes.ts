/**
 * Gnext Prototype — what the branch agent's copy of the app opens (agent-protocol.md §19.9).
 *
 * A register opens the app from the branch PC's agent, and the agent serves the cashier only:
 * the pages a CASHIER account reaches today (`CASHIER_PATHS` in role-access.ts), narrowed to
 * the register, orders, delivery, incoming orders and the shift and cash pages. Everything
 * else (the manager's and head office's screens) opens on gnext.top, and in agent mode the
 * app shows a link to it instead of the page.
 *
 * Kept free of `src/` imports so scripts/check-agent-routes.mjs can load it as it is.
 */

export interface AgentRoute {
  /** A path in the router (src/routes/sections), without the query. */
  path: string;
  /** Only this exact path. Without it the path also covers everything below it. */
  exact?: boolean;
}

/**
 * The one list. A path is allowed when it equals an entry, or sits below it (`/app/orders`
 * covers `/app/orders/incoming`). A path that is on no entry opens on gnext.top.
 *
 * Add a page here only when a cashier needs it at the register; every other screen stays on
 * the cloud, where it already works.
 */
export const AGENT_ROUTES: AgentRoute[] = [
  // Sign-in and the redirect at the root, which sends a signed-in account to its start page.
  { path: '/', exact: true },
  { path: '/login', exact: true },

  // The register. Below it: /app/pos/receipt/:id, where checkout ends.
  { path: '/app/pos' },

  // The orders directory (/app/orders, an order opens in its drawer as ?order=<id>), incoming
  // orders (/app/orders/incoming) and the old /app/orders/:id address, which redirects.
  { path: '/app/orders' },

  // The delivery hub. /app/delivery itself only redirects to the dispatch board. Zones, the
  // delivery audit and the fleet roll-up are the manager's and head office's.
  { path: '/app/delivery', exact: true },
  { path: '/app/delivery/orders' },
  // Below it: a courier's page (/app/delivery/couriers/:courierId).
  { path: '/app/delivery/couriers' },
  // Below it: one settlement (/app/delivery/settlements/:settlementId).
  { path: '/app/delivery/settlements' },

  // The cashier's shifts and drawer. Below it: one shift (/app/cashier/shifts/:shiftId).
  // Business days and the roll-up are not the cashier's.
  { path: '/app/cashier/shifts' },

  // Counter work a cashier does today: refunds, which a manager's PIN approves.
  { path: '/app/refunds' },
];

function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/** True when the agent's copy of the app opens this path itself. The query is not part of it. */
export function isAgentRoute(pathname: string): boolean {
  const path = stripTrailingSlash(pathname);
  return AGENT_ROUTES.some((route) =>
    route.exact ? path === route.path : path === route.path || path.startsWith(`${route.path}/`)
  );
}
