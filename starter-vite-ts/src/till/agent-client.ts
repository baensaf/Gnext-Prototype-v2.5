// The branch agent's local till API (agent-protocol.md §13.13), as the offline till screen
// calls it: same origin, the page's own header on every change, and the till session.

import type { UserState, TenantState } from 'src/store/useAuthStore';

// ----------------------------------------------------------------------

/** A refusal from the agent: `{code, detail}`, with `detail` in Persian for the cashier. */
export type AgentError = Error & { code: string; detail: string; status: number };

const SESSION_KEY = 'gnext_till_session';

let token: string | null = readToken();
let onSignedOut: (() => void) | null = null;

function readToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

/** Keeps the session for this tab, so a reload does not sign the cashier out. */
export function setTillToken(next: string | null) {
  token = next;
  try {
    if (next) sessionStorage.setItem(SESSION_KEY, next);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked: the session lasts until the page is reloaded.
  }
}

/** The till session, for the page's cloud calls through the agent (§16.4). */
export function getTillToken(): string | null {
  return token;
}

/** Called when the agent no longer knows the session (auto-logout, another sign-in). */
export function onTillSignedOut(handler: (() => void) | null) {
  onSignedOut = handler;
}

export async function agentRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'X-Gnext-Local': '1' };
  if (token) headers['X-Gnext-Till-Session'] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw agentError(0, 'AGENT_UNREACHABLE', 'برنامهٔ جی‌نکست روی این رایانه پاسخ نمی‌دهد.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = agentError(res.status, data.code || 'ERROR', data.detail || res.statusText);
    if (res.status === 401 && err.code === 'UNAUTHENTICATED') {
      setTillToken(null);
      onSignedOut?.();
    }
    throw err;
  }
  return data as T;
}

export function agentError(status: number, code: string, detail: string): AgentError {
  return Object.assign(new Error(detail), { code, detail, status });
}

// ---- the agent's shapes ----------------------------------------------

export type TillUser = { id: string; display_name: string; role: string };

/** The cashier's cloud session as the page sees it (§16.3): who, never the token. */
export type CloudSession = { user: UserState; tenant: TenantState | null };

/** Whether the till sells through the cloud (§16.5), and the cashier's cloud session. */
export type TillCloud = { reachable: boolean; since: string; session: CloudSession | null };

export type TillState = {
  mode: 'ONLINE' | 'OFFLINE' | 'HANDOVER';
  branch: { id: string; code: string; name: string } | null;
  binding: { terminal_id: string } | null;
  till: { id: string; code: string; name: string } | null;
  shift: { id: string; terminal_id: string; shift_number: string; business_date: string; opened_at: string } | null;
  staff: TillUser[];
  snapshot_generated_at?: string;
  problems: string[];
};

export type MenuProduct = {
  id: string;
  code: string | null;
  name: string;
  category_id: string | null;
  price: string;
  tax_rate: string;
  max_per_order: number | null;
  available: boolean;
  reason?: 'STOPPED' | 'OUT_OF_HOURS' | 'SOLD_OUT';
  variants: { id: string; name: string; price: string; available: boolean; reason?: string }[];
  option_groups: {
    id: string;
    name: string;
    min: number;
    max: number | null;
    items: { id: string; name: string; price_delta: string; available: boolean }[];
  }[];
};

export type Menu = {
  categories: { id: string; parent_id: string | null; name: string }[];
  products: MenuProduct[];
  tables: { id: string; area: string | null; number: string; seats: number | null }[];
  payment_methods: { id: string; code: string; name: string; kind: string }[];
};

export type AgentLine = {
  id: string;
  product_id: string;
  product_name: string;
  variant_id: string | null;
  variant_name: string | null;
  quantity: string;
  unit_price: string;
  options: { option_item_id: string; name: string; group_name: string; price_delta: string }[];
  tax_rate: string;
  line_total: string;
  tax: string;
  notes: string | null;
  sent_at: string | null;
};

export type AgentOrder = {
  id: string;
  state: 'OPEN' | 'COMPLETED' | 'CANCELLED';
  terminal_id: string;
  shift_id: string;
  business_date: string;
  order_type: 'TAKEAWAY' | 'DINE_IN';
  table_id: string | null;
  guest_count: number | null;
  call_number: number | null;
  notes: string | null;
  placed_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  lines: AgentLine[];
  totals: { subtotal: string; delivery_fee: string; discount_total: string; tax_total: string; grand_total: string };
  payments: {
    id: string;
    method_id: string;
    method_kind: string;
    amount: string;
    /** RUNNING while at the terminal, then APPROVED or UNKNOWN. */
    status: string;
    card?: { terminal_id?: string; rrn?: string; card_pan_masked?: string };
    at: string;
  }[];
  /** Every card charge tried, and how it ended; one that left no payment says why. */
  card_attempts?: { payment_id: string; amount: string; status: string; message?: string; at: string }[];
  /** Every ticket printed for the order (§13.8): QUEUED at the printer, then PRINTED or FAILED. */
  prints?: TillPrint[];
  handed_over: boolean;
};

export type TillPrint = {
  id: string;
  document_type: 'KITCHEN_TICKET' | 'CUSTOMER_RECEIPT' | 'GUEST_BILL';
  label?: string;
  printer_id?: string;
  copies: number;
  status: 'QUEUED' | 'PRINTED' | 'FAILED';
  error?: string;
  reprint?: boolean;
  at: string;
};

export type TillPrinter = { id: string; code: string; name: string };

export type PlaceInput = {
  order_type: string;
  table_id: string;
  guest_count: number;
  notes: string;
  lines: { product_id: string; variant_id: string; quantity: number; options: string[]; notes: string }[];
};

export const tillApi = {
  state: () => agentRequest<{ state: TillState; user: TillUser | null; cloud?: TillCloud }>('GET', '/api/till/state'),
  login: (userId: string, pin: string) =>
    agentRequest<{ token: string; user: TillUser; cloud_session?: CloudSession | null }>('POST', '/api/till/login', {
      user_id: userId,
      pin,
    }),
  /** The PIN again, for a cloud session when the link is back or the last one ended (§16.6). */
  cloudLogin: (pin: string) => agentRequest<{ cloud_session: CloudSession }>('POST', '/api/till/cloud-login', { pin }),
  logout: () => agentRequest<{ ok: boolean }>('POST', '/api/till/logout', {}),
  menu: () => agentRequest<Menu>('GET', '/api/till/menu'),
  orders: () => agentRequest<{ orders: AgentOrder[] }>('GET', '/api/till/orders'),
  order: (id: string) => agentRequest<{ order: AgentOrder }>('GET', `/api/till/orders/${encodeURIComponent(id)}`),
  place: (input: PlaceInput) => agentRequest<{ order: AgentOrder }>('POST', '/api/till/orders/place', input),
  cancel: (id: string, note: string, approverId = '', pin = '') =>
    agentRequest<{ order: AgentOrder | null; dropped: boolean }>('POST', `/api/till/orders/${encodeURIComponent(id)}/cancel`, {
      note,
      approver_id: approverId,
      pin,
    }),
  /** Cash answers with the change; a card charge answers at once, and the order shows how it ended. */
  payCash: (id: string, tendered: string) =>
    agentRequest<{ order: AgentOrder; change: string }>('POST', `/api/till/orders/${encodeURIComponent(id)}/payments`, { kind: 'CASH', tendered }),
  payCard: (id: string, amount: string) =>
    agentRequest<{ order: AgentOrder; payment_id: string }>('POST', `/api/till/orders/${encodeURIComponent(id)}/payments`, { kind: 'CARD', amount }),
  /** A document on request, or one ticket again (print_id), to its printer or another. */
  print: (id: string, body: { document?: string; print_id?: string; printer_id?: string }) =>
    agentRequest<{ prints: TillPrint[] }>('POST', `/api/till/orders/${encodeURIComponent(id)}/print`, body),
  printers: () => agentRequest<{ printers: TillPrinter[] }>('GET', '/api/till/printers'),
  finish: (id: string) => agentRequest<{ order: AgentOrder }>('POST', `/api/till/orders/${encodeURIComponent(id)}/finish`, {}),
  handover: () => agentRequest<{ dropped: number; handed: number }>('POST', '/api/till/handover', {}),
  /** The settings page's status: the cloud's address, for the way back to the web POS. */
  status: () => agentRequest<{ server?: string; branch_name?: string }>('GET', '/api/status'),
};
