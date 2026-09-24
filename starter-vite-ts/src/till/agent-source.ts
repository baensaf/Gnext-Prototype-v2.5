import type { DiningTable } from 'src/api/dineInApi';
import type { PaymentRecord } from 'src/api/paymentApi';
import type { PosSource } from 'src/contexts/pos-source';
import type { PaymentMethod } from 'src/api/settingsApi';
import type { OrderItem, OrderHeader } from 'src/api/orderApi';
import type { DiscountQuoteResult } from 'src/api/discountsApi';
import type { Menu, AgentOrder, MenuProduct } from './agent-client';
import type {
  Product,
  Category,
  OptionGroup,
  BranchPrices,
  DailyStockLine,
  ProductVariant,
  OffScheduleProduct,
  ProductAvailability,
} from 'src/api/catalogApi';

import i18n from 'src/locales/i18n';

import { toast } from 'src/components/snackbar';

import { tillApi, agentError } from './agent-client';
import { useAgentRegisterShift } from './till-context';

// ----------------------------------------------------------------------

/**
 * The offline till's data source: the web POS's screens, reading and writing through the
 * branch agent (HANDOFF-offline-pos.md, decision 6). The agent keeps every rule: what sells
 * now, the prices, the call number, the edit windows. This only puts its answers in the shapes
 * the screens already read, and turns a placed cart into one call.
 */

const unavailable = () => agentError(422, 'NOT_AVAILABLE_OFFLINE', i18n.t('pos.offline.unavailable'));

// The menu changes only with a new snapshot or the clock; the screen asks for it in pieces, several
// at once and again each minute, so one answer serves a few seconds of questions.
let menuCache: { at: number; menu: Promise<Menu> } | null = null;

function menu(): Promise<Menu> {
  if (!menuCache || Date.now() - menuCache.at > 5_000) {
    const pending = tillApi.menu();
    menuCache = { at: Date.now(), menu: pending };
    pending.catch(() => {
      if (menuCache?.menu === pending) menuCache = null;
    });
  }
  return menuCache.menu;
}

async function product(id: string): Promise<MenuProduct> {
  const found = (await menu()).products.find((p) => p.id === id);
  if (!found) throw agentError(404, 'NOT_AVAILABLE', i18n.t('pos.offline.notOnMenu'));
  return found;
}

// ---- money (agent-protocol.md §12.4): whole rials, tax per line, halves up ----

function rials(amount: string | number | undefined | null): bigint {
  const [whole] = String(amount ?? '0').trim().split('.');
  return BigInt(whole || '0');
}

function taxOf(lineTotal: bigint, rate: string): bigint {
  const [int, frac = ''] = (rate || '0').trim().split('.');
  const num = BigInt(`${int || '0'}${frac}`);
  const den = 10n ** BigInt(frac.length);
  return (2n * lineTotal * num + den) / (2n * den);
}

// ---- the agent's shapes, as the screens read them ----

const toVariants = (p: MenuProduct): ProductVariant[] =>
  p.variants.map((v, i) => ({
    id: v.id,
    product_id: p.id,
    code: '',
    name: v.name,
    base_price: v.price,
    is_default: i === 0,
    sort_order: i,
    is_active: true,
  }));

const toProduct = (p: MenuProduct): Product => ({
  id: p.id,
  code: p.code || '',
  name: p.name,
  category_id: p.category_id || '',
  unit_of_measure: 'PCS',
  tax_rate: p.tax_rate,
  is_active: true,
  base_price: p.price,
  max_per_order: p.max_per_order,
  variants: toVariants(p),
});

const toGroups = (p: MenuProduct): OptionGroup[] =>
  p.option_groups.map((g) => ({
    id: g.id,
    code: '',
    name: g.name,
    min_selection: g.min,
    max_selection: g.max ?? 0,
    is_required: g.min > 0,
    excluded_item_ids: [],
    items: g.items.map((it, i) => ({
      id: it.id,
      option_group_id: g.id,
      code: '',
      name: it.name,
      price_delta: it.price_delta,
      is_default: false,
      sort_order: i,
    })),
  }));

function tableNumber(m: Menu | null, id: string | null): string | undefined {
  if (!id || !m) return undefined;
  return m.tables.find((t) => t.id === id)?.number;
}

function paidOf(o: AgentOrder): bigint {
  return o.payments.filter((p) => p.status !== 'FAILED').reduce((sum, p) => sum + rials(p.amount), 0n);
}

function toOrder(o: AgentOrder, m: Menu | null): OrderHeader {
  const grand = rials(o.totals.grand_total);
  const paid = paidOf(o);
  const due = grand > paid ? grand - paid : 0n;
  const items: OrderItem[] = o.lines.map((l, i) => ({
    id: l.id,
    line_number: i + 1,
    product_id: l.product_id,
    product_name: l.product_name,
    variant_id: l.variant_id || undefined,
    variant_name: l.variant_name || undefined,
    unit_price: l.unit_price,
    quantity: l.quantity,
    subtotal: l.line_total,
    line_total: l.line_total,
    tax_amount: l.tax,
    notes: l.notes || undefined,
    options: l.options.map((opt) => ({
      id: opt.option_item_id,
      option_item_id: opt.option_item_id,
      name: opt.name,
      option_item_name: opt.name,
      option_group_name: opt.group_name,
      price_delta: opt.price_delta,
    })),
  }));
  const state = o.state === 'OPEN' ? 'SUBMITTED' : o.state;
  return {
    id: o.id,
    branch_id: '',
    terminal_id: o.terminal_id,
    shift_id: o.shift_id,
    // Offline orders get their cloud number when they are uploaded; until then the call number
    // and the start of the id tell them apart.
    order_number: `OFF-${o.id.slice(0, 8).toUpperCase()}`,
    call_number: o.call_number,
    order_type: o.order_type,
    channel: 'POS',
    state,
    status: state,
    currency_code: 'IRR',
    quote_version: '',
    table_id: o.table_id || undefined,
    table_number: tableNumber(m, o.table_id),
    guest_count: o.guest_count ?? undefined,
    subtotal: o.totals.subtotal,
    discount_total: o.totals.discount_total,
    delivery_fee: o.totals.delivery_fee,
    tax_total: o.totals.tax_total,
    grand_total: o.totals.grand_total,
    total_amount: o.totals.grand_total,
    paid_total: paid.toString(),
    paid_amount: paid.toString(),
    due_amount: due.toString(),
    outstanding_total: due.toString(),
    notes: o.notes || undefined,
    placed_at: o.placed_at,
    submitted_at: o.placed_at,
    completed_at: o.completed_at || undefined,
    cancelled_at: o.cancelled_at || undefined,
    version: 1,
    items,
  };
}

async function currentMenu(): Promise<Menu | null> {
  return menu().catch(() => null);
}

// ---- card charges: the agent answers at once and charges in the background ----

const CARD_KINDS = ['CARD_POS', 'CARD', 'POS'];

/** Follows the order until the charge has left the terminal: the customer, then the bank. */
async function chargeEnded(orderId: string, paymentId: string): Promise<AgentOrder> {
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const { order } = await tillApi.order(orderId);
    const attempt = order.card_attempts?.find((a) => a.payment_id === paymentId);
    if (!attempt || attempt.status !== 'RUNNING') return order;
    // The agent always ends a charge, UNKNOWN at worst; this only stops a screen left waiting.
    if (Date.now() > deadline) return order;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// ---- carts: the screen makes a draft and submits it; the agent takes the whole cart at once ----

type CartPayload = {
  order_type?: string;
  table_id?: string;
  table_number?: string;
  notes?: string;
  items?: { product_id: string; variant_id?: string; quantity: number; options?: { option_item_id: string }[] }[];
};

const carts = new Map<string, CartPayload>();
let cartSeq = 0;

function draftHeader(id: string, payload: CartPayload): OrderHeader {
  return {
    id,
    branch_id: '',
    order_number: '',
    order_type: (payload.order_type as OrderHeader['order_type']) || 'TAKEAWAY',
    state: 'DRAFT',
    status: 'DRAFT',
    currency_code: 'IRR',
    quote_version: '',
    subtotal: '0',
    grand_total: '0',
    placed_at: new Date().toISOString(),
    version: 1,
    items: [],
  };
}

async function place(payload: CartPayload): Promise<OrderHeader> {
  const m = await menu();
  let tableId = '';
  if (payload.order_type === 'DINE_IN') {
    tableId = payload.table_id || m.tables.find((t) => t.number === payload.table_number)?.id || '';
    // A table typed by hand is not one the cloud knows; offline the table comes from the list.
    if (!tableId && payload.table_number) throw agentError(422, 'INVALID_ORDER', i18n.t('pos.offline.tableFromList'));
  }
  const { order } = await tillApi.place({
    order_type: payload.order_type || 'TAKEAWAY',
    table_id: tableId,
    guest_count: 0,
    notes: payload.notes || '',
    lines: (payload.items || []).map((item) => ({
      product_id: item.product_id,
      variant_id: item.variant_id || '',
      quantity: Number(item.quantity) || 1,
      options: (item.options || []).map((o) => o.option_item_id),
      notes: '',
    })),
  });
  menuCache = null; // today's stock moved
  return toOrder(order, m);
}

// ----------------------------------------------------------------------

export const agentPosSource: PosSource = {
  kind: 'agent',
  features: {
    delivery: false,
    customers: false,
    discounts: false,
    park: false,
    stop: false,
    shiftActions: false,
    receipt: false,
  },

  catalog: {
    getCategories: async () =>
      (await menu()).categories.map<Category>((c, i) => ({
        id: c.id,
        code: '',
        name: c.name,
        parent_id: c.parent_id,
        sort_order: i,
        is_active: true,
      })),
    getProducts: async () => (await menu()).products.map(toProduct),
    getProductById: async (id: string) => {
      const p = await product(id);
      return { ...toProduct(p), optionGroups: toGroups(p) };
    },
    getProductVariants: async (productId: string) => toVariants(await product(productId)),
    getNoteTemplates: async () => [],
    getOffScheduleProducts: async () =>
      (await menu()).products
        .filter((p) => p.reason === 'OUT_OF_HOURS')
        .map<OffScheduleProduct>((p) => ({ product_id: p.id, windows: '—' })),
    getAvailabilities: async () => {
      const out: ProductAvailability[] = [];
      for (const p of (await menu()).products) {
        if (p.reason === 'STOPPED') out.push({ id: `p:${p.id}`, product_id: p.id, is_suspended: true });
        for (const v of p.variants) {
          if (v.reason === 'STOPPED') out.push({ id: `v:${v.id}`, product_id: p.id, variant_id: v.id, is_suspended: true });
        }
        for (const g of p.option_groups) {
          for (const it of g.items) {
            if (!it.available) out.push({ id: `o:${it.id}`, product_id: null, option_item_id: it.id, is_suspended: true });
          }
        }
      }
      return out;
    },
    getBranchPrices: async () => {
      const items: BranchPrices['items'] = [];
      for (const p of (await menu()).products) {
        items.push({ product_id: p.id, variant_id: null, price: p.price });
        for (const v of p.variants) items.push({ product_id: p.id, variant_id: v.id, price: v.price });
      }
      return { branch_id: null, price_list: null, items };
    },
    getDailyStock: async () => {
      const out: DailyStockLine[] = [];
      const soldOut = (productId: string, variantId: string | null): DailyStockLine => ({
        id: `${productId}:${variantId || ''}`,
        product_id: productId,
        variant_id: variantId,
        business_date: '',
        quantity: 0,
        sold: 0,
        remaining: 0,
      });
      for (const p of (await menu()).products) {
        if (p.reason === 'SOLD_OUT') out.push(soldOut(p.id, null));
        for (const v of p.variants) if (v.reason === 'SOLD_OUT') out.push(soldOut(p.id, v.id));
      }
      return out;
    },
    posStop: async () => {
      throw unavailable();
    },
    posResume: async () => {
      throw unavailable();
    },
  },

  orders: {
    // Held drafts are not kept offline; the list the screen asks for is empty.
    getOrders: async (query?: { state?: string }) => {
      if (query?.state === 'DRAFT') return [];
      const [{ orders }, m] = await Promise.all([tillApi.orders(), currentMenu()]);
      return orders.map((o) => toOrder(o, m));
    },
    getOrderById: async (id: string) => {
      const [{ order }, m] = await Promise.all([tillApi.order(id), currentMenu()]);
      return toOrder(order, m);
    },
    createOrder: async (payload: CartPayload) => {
      cartSeq += 1;
      const id = `cart-${cartSeq}`;
      carts.set(id, payload);
      return draftHeader(id, payload);
    },
    updateDraft: async (id: string, payload: CartPayload) => {
      carts.set(id, payload);
      return draftHeader(id, payload);
    },
    submitOrder: async (id: string) => {
      const payload = carts.get(id);
      if (!payload) throw agentError(404, 'ORDER_UNKNOWN', i18n.t('pos.offline.notOnMenu'));
      const placed = await place(payload);
      carts.delete(id);
      return placed;
    },
    cancelOrder: async (id: string, _reasonCodeId?: string, note?: string) => {
      if (carts.delete(id)) return draftHeader(id, {});
      const { order } = await tillApi.cancel(id, note || '');
      return order ? toOrder(order, await currentMenu()) : draftHeader(id, {});
    },
  } as unknown as PosSource['orders'],

  tables: {
    getTables: async () =>
      (await menu()).tables.map<DiningTable>((t) => ({
        id: t.id,
        dining_area_id: '',
        code: t.number,
        table_number: t.number,
        seating_capacity: t.seats ?? 0,
        shape: 'RECTANGLE',
        pos_x: 0,
        pos_y: 0,
        is_active: true,
        status: 'AVAILABLE',
        guest_count: 0,
        elapsed_minutes: 0,
      })),
  },

  settings: {
    getReasonCodes: async () => [],
    getPaymentMethods: async () =>
      (await menu()).payment_methods.map<PaymentMethod>((pm, i) => ({
        id: pm.id,
        code: pm.code,
        name: pm.name,
        kind: pm.kind,
        currency_code: 'IRR',
        requires_reference: false,
        requires_device: false,
        allows_refund: false,
        allows_alternative_refund: false,
        is_active: true,
        sort_order: i,
      })),
  },

  payments: {
    getOrderPayments: async (orderId: string) => {
      const { order } = await tillApi.order(orderId);
      return order.payments.map<PaymentRecord>((p, i) => ({
        id: p.id,
        order_id: order.id,
        payment_number: String(i + 1),
        method_id: p.method_id,
        method_kind: p.method_kind,
        // A charge at the terminal, or one whose result the terminal never gave (UNKNOWN: it counts
        // as paid, and the cloud resolves it after upload), shows as still in progress.
        status: p.status === 'APPROVED' ? 'SUCCEEDED' : 'PROCESSING',
        amount: p.amount,
        currency_code: 'IRR',
        reference: p.card?.rrn,
        business_date: order.business_date,
        failure_message: p.status === 'UNKNOWN' ? i18n.t('pos.offline.cardUnknown') : undefined,
        initiated_at: p.at,
        recorded_at: p.at,
      }));
    },
    // Cash or card by the method the screen chose (§13.7). The screen already keeps change for cash
    // it was handed, so the agent is given what is paid.
    postPayment: async (data: { order_id: string; payment_method_id: string; amount: string }) => {
      const method = (await menu()).payment_methods.find((m) => m.id === data.payment_method_id);
      const kind = (method?.kind || '').toUpperCase();
      if (kind === 'CASH') {
        const { order } = await tillApi.payCash(data.order_id, String(rials(data.amount)));
        return { payment: undefined as unknown as PaymentRecord, order: toOrder(order, await currentMenu()) };
      }
      if (!CARD_KINDS.includes(kind)) throw unavailable();
      const started = await tillApi.payCard(data.order_id, String(rials(data.amount)));
      const order = await chargeEnded(data.order_id, started.payment_id);
      const attempt = order.card_attempts?.find((a) => a.payment_id === started.payment_id);
      if (attempt?.status === 'RUNNING') {
        throw agentError(409, 'TERMINAL_BUSY', i18n.t('pos.offline.cardStillRunning'));
      }
      if (attempt?.status === 'UNKNOWN') {
        toast.warning(attempt.message || i18n.t('pos.offline.cardUnknown'), { duration: 20000 });
      } else if (attempt?.status !== 'APPROVED') {
        throw agentError(402, attempt?.status || 'FAILED', attempt?.message || i18n.t('pos.offline.cardFailed'));
      }
      return { payment: undefined as unknown as PaymentRecord, order: toOrder(order, await currentMenu()) };
    },
    // No refunds offline; the cloud handles money after upload.
    voidPayment: async () => {
      throw unavailable();
    },
  } as unknown as PosSource['payments'],

  customers: {
    getCustomers: async () => [],
    getAddresses: async () => [],
    createCustomer: async () => {
      throw unavailable();
    },
    createAddress: async () => {
      throw unavailable();
    },
  },

  delivery: { getZones: async () => [] },

  // The live quote: the tax the agent will charge, line by line (§12.4). No discounts offline.
  discounts: {
    quoteDiscounts: async (payload: {
      orderDraft: { items: { productId: string; variantId?: string; unitPrice: string; quantity: string }[] };
    }) => {
      const m = await menu();
      let subtotal = 0n;
      let tax = 0n;
      const items = payload.orderDraft.items.map((item) => {
        const lineTotal = rials(item.unitPrice) * rials(item.quantity);
        const rate = m.products.find((p) => p.id === item.productId)?.tax_rate || '0';
        subtotal += lineTotal;
        tax += taxOf(lineTotal, rate);
        return { ...item, subtotal: lineTotal.toString(), discountTotal: '0', grandTotal: lineTotal.toString() };
      });
      const result: DiscountQuoteResult = {
        quoteVersion: 'offline',
        currencyCode: 'IRR',
        items,
        subtotal: subtotal.toString(),
        deliveryFee: '0',
        discountTotal: '0',
        taxTotal: tax.toString(),
        grandTotal: (subtotal + tax).toString(),
        consideredDiscounts: [],
        warnings: [],
      };
      return result;
    },
  } as unknown as PosSource['discounts'],

  approvals: {
    createRequest: async () => {
      throw unavailable();
    },
    approveRequest: async () => {
      throw unavailable();
    },
    verifyPin: async () => {
      throw unavailable();
    },
  },

  printing: {
    reprintOrder: async () => {
      throw unavailable();
    },
  },

  useRegisterShift: useAgentRegisterShift,
};

