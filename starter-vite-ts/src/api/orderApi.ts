import type { ManualDiscount } from './discountsApi';

import { httpClient } from './httpClient';

export interface OrderItemOption {
  id: string;
  option_item_id: string;
  name?: string;
  option_item_name?: string;
  option_group_name?: string;
  price?: string;
  price_delta?: string;
}

export interface OrderItem {
  id: string;
  line_number?: number;
  product_id: string;
  product_code?: string;
  product_name: string;
  variant_id?: string;
  variant_name?: string;
  unit_price: string;
  quantity: string;
  base_total?: string;
  subtotal: string;
  modifier_total?: string;
  discount_total?: string;
  tax_total?: string;
  packaging_total?: string;
  line_total?: string;
  tax_amount?: string;
  discount_amount?: string;
  total_amount?: string;
  notes?: string;
  special_instructions?: string;
  state?: string;
  replaces_item_id?: string;
  options: OrderItemOption[];
}

export interface OrderHeader {
  id: string;
  branch_id: string;
  terminal_id?: string;
  shift_id?: string;
  order_number: string;
  /** The branch's number for the order today (123), given as it goes to the kitchen. */
  call_number?: number | null;
  /** AGENT_OFFLINE when the branch took it while offline and its agent uploaded it later. */
  source?: string | null;
  order_type: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY' | 'AGGREGATOR';
  channel?: string;
  state: 'DRAFT' | 'PENDING_ACCEPTANCE' | 'SUBMITTED' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'OUT_FOR_DELIVERY' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';
  status: string; // legacy alias
  currency_code: string;
  quote_version: string;
  customer_id?: string;
  customer_address_id?: string;
  delivery_zone_id?: string;
  customer_name?: string;
  customer_mobile?: string;
  table_id?: string;
  table_number?: string;
  guest_count?: number;
  coupon_code?: string;
  subtotal: string;
  subtotal_amount?: string;
  modifier_total?: string;
  packaging_total?: string;
  delivery_fee?: string;
  discount_total?: string;
  discount_amount?: string;
  tax_total?: string;
  tax_amount?: string;
  grand_total: string;
  total_amount?: string;
  paid_total?: string;
  paid_amount?: string;
  refunded_total?: string;
  outstanding_total?: string;
  due_amount?: string;
  notes?: string;
  placed_at: string;
  submitted_at?: string;
  completed_at?: string;
  cancelled_at?: string;
  /** Snappfood's preparation time, the minutes it lets the store add, and how the order travels. */
  aggregator_prep_minutes?: number | null;
  aggregator_max_extra_minutes?: number | null;
  aggregator_expedition?: string | null;
  accepted_at?: string | null;
  promised_minutes?: number | null;
  /** Set while an accepted Snappfood order is with Snappfood support. */
  aggregator_issue_at?: string | null;
  aggregator_issue?: string | null;
  version: number;
  items: OrderItem[];
}

/** Where an order sits on the Orders page. The groups don't overlap, so they add up to All. */
export type OrderLifecycle = 'WAITING' | 'OPEN' | 'HELD' | 'COMPLETED' | 'REFUNDED' | 'CANCELLED' | 'OTHER';

/** A row of the order book, with the names and places the list shows beside it. */
export interface OrderListRow extends OrderHeader {
  lifecycle: OrderLifecycle;
  delivery_zone_name: string | null;
  delivery_state: string | null;
  courier_name: string | null;
  delivery_address: string | null;
}

/** The filters the order book understands; everything runs on the server. */
export interface OrderListQuery {
  branchId?: string;
  group?: OrderLifecycle | 'ALL';
  from?: string;
  to?: string;
  type?: string;
  channel?: string;
  q?: string;
  paid?: boolean;
  ids?: string[];
  sort?: 'placed_at' | 'grand_total' | 'outstanding_total' | 'order_number';
  dir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  counts?: boolean;
}

export interface OrderListPage {
  data: OrderListRow[];
  total: number;
  page: number;
  limit: number;
  counts?: Record<OrderLifecycle | 'ALL', number>;
}

const listParams = (query: OrderListQuery) => ({
  branchId: query.branchId || undefined,
  group: query.group && query.group !== 'ALL' ? query.group : undefined,
  from: query.from,
  to: query.to,
  type: query.type || undefined,
  channel: query.channel || undefined,
  q: query.q?.trim() || undefined,
  paid: query.paid ? '1' : undefined,
  ids: query.ids?.length ? query.ids.join(',') : undefined,
  sort: query.sort,
  dir: query.dir,
  page: query.page,
  limit: query.limit,
  counts: query.counts ? '1' : undefined,
});

/** One of Snappfood's reasons a store may give for turning an order down. */
export interface DeclineReason {
  id: number;
  title: string;
  level: number;
}

/** A branch's rules for orders from Snappfood, the website and the kiosk. */
export interface IncomingOrderPolicy {
  acceptance: Record<'AGGREGATOR' | 'ONLINE' | 'KIOSK', 'MANUAL' | 'AUTO'>;
  timeoutMinutes: number;
  timeoutAction: 'REJECT' | 'ACCEPT';
  defaultPrepMinutes: number;
}

export const orderApi = {
  getOrders: async (branchId?: string | Record<string, any>, status?: string): Promise<OrderHeader[]> => {
    const params = typeof branchId === 'object' ? branchId : { branchId, status };
    const res = await httpClient.get('/api/v1/orders', { params });
    if (res.data && Array.isArray(res.data.data)) {
      return res.data.data;
    }
    if (Array.isArray(res.data)) {
      return res.data;
    }
    return [];
  },

  /** One page of the order book, with the tab counts when asked. */
  listOrders: async (query: OrderListQuery): Promise<OrderListPage> => {
    const res = await httpClient.get('/api/v1/orders', { params: listParams(query) });
    return res.data;
  },

  /** Saves the filtered order book (up to 5,000 rows) as a CSV file. */
  exportOrders: async (query: OrderListQuery): Promise<void> => {
    const { page: _page, limit: _limit, counts: _counts, ...filters } = query;
    const res = await httpClient.get('/api/v1/orders/export', { params: listParams(filters), responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },

  getOrderById: async (id: string): Promise<OrderHeader> => {
    const res = await httpClient.get(`/api/v1/orders/${id}`);
    return res.data;
  },

  /** Aggregator and website orders waiting for this branch to accept or reject them, oldest first. */
  getIncomingOrders: async (branchId: string): Promise<OrderHeader[]> => {
    const res = await httpClient.get('/api/v1/orders', {
      params: { branchId, state: 'PENDING_ACCEPTANCE', limit: 100 },
    });
    const list: OrderHeader[] = Array.isArray(res.data?.data) ? res.data.data : [];
    return [...list].sort((a, b) => String(a.placed_at).localeCompare(String(b.placed_at)));
  },

  /** The branch's time limit for answering, what happens after it, and the default prep time. */
  getIncomingPolicy: async (branchId: string): Promise<IncomingOrderPolicy> => {
    const res = await httpClient.get('/api/v1/orders/incoming-policy', { params: { branchId } });
    return res.data;
  },

  /** Snappfood's decline reasons. A reject must name one. */
  getDeclineReasons: async (): Promise<DeclineReason[]> => {
    const res = await httpClient.get('/api/v1/orders/decline-reasons');
    return Array.isArray(res.data) ? res.data : [];
  },

  /**
   * Take an incoming order: it is confirmed, sent to the kitchen and printer, and the
   * aggregator is told. 409 when another till answered it first.
   */
  acceptIncomingOrder: async (id: string, prepMinutes: number): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/accept`, { prepMinutes });
    return res.data;
  },

  /** Turn an incoming order down. Nothing reaches the kitchen; the aggregator is told why. */
  rejectIncomingOrder: async (id: string, reasonId: number, comment?: string): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/reject`, { reasonId, comment: comment || undefined });
    return res.data;
  },

  /**
   * Hand an accepted Snappfood order to Snappfood support: it needs more time (reason 153,
   * with the extra minutes) or cannot be made. Only within an hour of accepting.
   */
  reportToSnappfood: async (
    id: string,
    report: { reasonId: number; extraMinutes?: number; comment?: string }
  ): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/report-to-snappfood`, {
      ...report,
      comment: report.comment || undefined,
    });
    return res.data;
  },

  createOrder: async (data: any): Promise<OrderHeader> => {
    const res = await httpClient.post('/api/v1/orders', data);
    return res.data;
  },

  updateDraft: async (id: string, data: any): Promise<OrderHeader> => {
    const res = await httpClient.patch(`/api/v1/orders/${id}`, data);
    return res.data;
  },

  quoteOrder: async (id: string, data?: any): Promise<any> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/quote`, data || {});
    return res.data;
  },

  submitOrder: async (
    id: string,
    data?: { quoteVersion?: string; approvalRequestIds?: string[]; manualDiscount?: ManualDiscount }
  ): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/submit`, data || {});
    return res.data;
  },

  confirmOrder: async (id: string, data?: any): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/confirm`, data || {});
    return res.data;
  },

  startPreparation: async (id: string, data?: any): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/start-preparation`, data || {});
    return res.data;
  },

  markReady: async (id: string, data?: any): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/mark-ready`, data || {});
    return res.data;
  },

  dispatchOrder: async (id: string, data?: any): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/dispatch`, data || {});
    return res.data;
  },

  completeOrder: async (id: string, data?: any): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/complete`, data || {});
    return res.data;
  },

  /**
   * Cancel an order. Throws 403 APPROVAL_REQUIRED once the cancel window has
   * elapsed or preparation has started; retry with the approval request id.
   */
  cancelOrder: async (
    id: string,
    reasonCodeId?: string,
    reason?: string,
    approvalRequestId?: string,
  ): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/cancel`, {
      reasonCodeId,
      reason,
      approvalRequestId,
    });
    return res.data;
  },

  /** Reopen a cancelled order. Always requires an approved request. */
  reopenOrder: async (
    id: string,
    reasonCodeId?: string,
    reason?: string,
    approvalRequestId?: string,
  ): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/reopen`, {
      reasonCodeId,
      reason,
      approvalRequestId,
    });
    return res.data;
  },

  /**
   * Apply line changes to an order past DRAFT. Lines are never deleted: a void
   * marks the original struck and leaves it on the order, an add appends.
   *
   * Throws 403 APPROVAL_REQUIRED when the change is outside the cashier window,
   * and 409 REFUND_PLAN_REQUIRED when it would drop the total below money
   * already collected. Both carry the detail needed to retry.
   */
  editOrder: async (
    id: string,
    changes: {
      add?: any[];
      void?: { orderItemId: string; reasonCodeId?: string; reason?: string }[];
    },
    options?: { approvalRequestId?: string; reasonCodeId?: string; reason?: string; quoteVersion?: string; refundPlan?: any },
  ): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/edit`, { changes, ...options });
    return res.data;
  },

  /**
   * The order was rung up as the wrong kind — a walk-in that turns out to be a delivery, a
   * delivery the guest decides to collect.
   *
   * The delivery fee moves with the type, so this goes through the same authority as a line
   * edit: 403 APPROVAL_REQUIRED past the cashier window or once money has landed, and 409
   * REFUND_REQUIRED when dropping the fee would take the total below what was collected.
   */
  changeOrderType: async (
    id: string,
    orderType: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY',
    options?: {
      deliveryAddressId?: string;
      deliveryZoneId?: string;
      tableId?: string;
      quoteVersion?: string;
      approvalRequestId?: string;
      reason?: string;
    },
  ): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/change-type`, { orderType, ...options });
    return res.data;
  },

  /** Supersede a line. The replacement is priced from the catalog, not the client. */
  replaceItem: async (
    id: string,
    orderItemId: string,
    replacement: { productId?: string; variantId?: string; quantity?: string; options?: any[]; notes?: string },
    options?: { reasonCodeId?: string; reason?: string; approvalRequestId?: string; quoteVersion?: string; refundPlan?: any },
  ): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/replace-item`, {
      orderItemId,
      replacement,
      ...options,
    });
    return res.data;
  },

  getOrderHistory: async (id: string): Promise<any> => {
    const res = await httpClient.get(`/api/v1/orders/${id}/history`);
    return res.data;
  },

  splitOrder: async (id: string, lines: { orderItemId: string; quantity: number | string }[], targetTableId?: string): Promise<{ source: OrderHeader; newOrder: OrderHeader }> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/split`, { lines, targetTableId });
    return res.data;
  },

  transferItems: async (sourceOrderId: string, targetOrderId: string, lines: { orderItemId: string; quantity: number | string }[], reason?: string): Promise<{ source: OrderHeader; target: OrderHeader }> => {
    const res = await httpClient.post('/api/v1/orders/transfer-items', { sourceOrderId, targetOrderId, lines, reason });
    return res.data;
  },

  getGuestBill: async (id: string, locale?: string): Promise<{ html: string; order: OrderHeader }> => {
    const res = await httpClient.get(`/api/v1/orders/${id}/guest-bill`, { params: { locale } });
    return res.data;
  },

  // Legacy compatibility helper
  updateOrderStatus: async (
    id: string,
    status: string,
    cancellation_reason_code_id?: string,
  ): Promise<OrderHeader> => {
    if (status === 'CANCELLED') {
      const res = await httpClient.post(`/api/v1/orders/${id}/cancel`, {
        reasonCodeId: cancellation_reason_code_id,
      });
      return res.data;
    }
    const actionMap: Record<string, string> = {
      CONFIRMED: 'confirm',
      KITCHEN_PREPARING: 'start-preparation',
      PREPARING: 'start-preparation',
      READY: 'mark-ready',
      OUT_FOR_DELIVERY: 'dispatch',
      COMPLETED: 'complete',
    };
    const action = actionMap[status] || status.toLowerCase();
    const res = await httpClient.post(`/api/v1/orders/${id}/${action}`, {});
    return res.data;
  },
};
