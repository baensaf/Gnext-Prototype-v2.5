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
  version: number;
  items: OrderItem[];
}

/** One of Snappfood's reasons a store may give for turning an order down. */
export interface DeclineReason {
  id: number;
  title: string;
  level: number;
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
