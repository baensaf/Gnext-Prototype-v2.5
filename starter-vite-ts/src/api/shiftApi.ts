import { httpClient } from './httpClient';

export interface CashMovement {
  id: string;
  shift_id: string;
  type: 'OPENING_FLOAT' | 'CASH_PAYMENT' | 'CASH_REFUND' | 'PAID_IN' | 'PAID_OUT' | 'CLOSE_ADJUSTMENT';
  amount: string;
  payment_id?: string;
  refund_id?: string;
  reason_code_id?: string;
  reason_text?: string;
  reference?: string;
  posted_at: string;
}

export interface CashierShift {
  id: string;
  branch_id: string;
  terminal_id: string;
  shift_number: string;
  state: 'OPEN' | 'CLOSED';
  business_date: string;
  opened_at: string;
  closed_at?: string;
  opening_cash: string;
  expected_cash?: string;
  actual_cash?: string;
  short_over?: string;
  movements?: CashMovement[];
}

export interface ShiftStatement {
  shiftId: string;
  shiftNumber: string;
  branchId: string;
  terminalId: string;
  state: string;
  businessDate: string;
  openedAt: string;
  closedAt?: string;
  openingFloat: string;
  cashSales: string;
  cashRefunds: string;
  /** Courier over. */
  paidIn: string;
  /** Courier short. */
  paidOut: string;
  expectedCash: string;
  actualCash?: string;
  shortOver?: string | null;
  /** What the close kept in the drawer for the next shift; the rest was handed over. */
  leftInDrawer?: string | null;
  handedOver?: string | null;
  orderCount: number;
  movements: CashMovement[];
}

export interface ShiftPolicy {
  defaultOpeningFloat: string;
}

/** A business day the system closed once it ended and its shifts were counted. */
export interface BusinessDayClose {
  id: string;
  branch_id: string;
  business_date: string;
  totals: {
    totalSales?: string;
    orderCount?: number;
    autoCompletedOrders?: number;
    carriedOverOrders?: number;
  } | null;
  closed_at: string;
}

/** An order that stops a shift closing. */
export interface DayCloseOpenOrder {
  id: string;
  orderNumber: string;
  callNumber: number | null;
  orderType: string;
  channel: string;
  state: string;
  businessDate: string | null;
  placedAt: string;
  grandTotal: string;
  outstandingTotal: string;
  issue?: 'UNPAID' | 'AWAITING_ACCEPTANCE' | 'DELIVERY_NOT_FINISHED';
  /** Unpaid, and the cash is with a courier or owed by one until the courier settles. */
  awaitingCourier?: boolean;
}

/** A cash payment begun at a drawer and never taken or cancelled. */
export interface PendingCashPayment {
  id: string;
  paymentNumber: string;
  orderId: string;
  orderNumber: string | null;
  amount: string;
  status: string;
  initiatedAt: string;
}

/** What stands in the way of closing a shift. */
export interface ShiftCloseCheck {
  shiftId: string;
  branchId: string;
  businessDate: string;
  /** This till's unpaid orders and the branch's orders waiting to be accepted. The close is refused while any exist. */
  openOrders: DayCloseOpenOrder[];
  /** Cash payments on this drawer that must be finished or cancelled first. */
  pendingCash: PendingCashPayment[];
}

/** One register's shift at a glance. */
export interface ShiftSalesSummary {
  shiftId: string;
  shiftNumber: string;
  registerName: string | null;
  openedBy: string | null;
  openedAt: string;
  closedAt: string | null;
  closed: boolean;
  orderCount: number;
  cancelledCount: number;
  salesTotal: string;
  discountTotal: string;
  deliveryFeeTotal: string;
  unpaidTotal: string;
  byType: Array<{ type: string; count: number; total: string }>;
  tenders: Array<{ kind: string; count: number; amount: string }>;
  refundCount: number;
  refundTotal: string;
  /** Refunds by how the money went back. */
  refunds?: Array<{ kind: string; count: number; amount: string }>;
  cash: {
    openingFloat: string;
    cashSales: string;
    cashRefunds: string;
    /** Courier over: cash a courier handed back beyond what was owed. */
    paidIn: string;
    /** Courier short: cash a courier handed back less than owed. */
    paidOut: string;
    expectedCash: string;
    actualCash: string | null;
    shortOver: string | null;
    leftInDrawer?: string | null;
    handedOver?: string | null;
  };
}

export const shiftApi = {
  getShifts: async (params?: Record<string, any>): Promise<{ data: CashierShift[]; total: number }> => {
    const res = await httpClient.get('/api/v1/shifts', { params });
    if (Array.isArray(res.data)) {
      return { data: res.data, total: res.data.length };
    }
    return res.data;
  },

  /**
   * Null when no drawer is open at this terminal, which is most of the day. Head office
   * working inside a branch names it; a branch account is held to its own by the server.
   */
  getCurrentShift: async (terminalId?: string, branchId?: string): Promise<CashierShift | null> => {
    const res = await httpClient.get('/api/v1/shifts/current', {
      params: { terminalId: terminalId || undefined, branchId: branchId || undefined },
    });
    return res.data || null;
  },

  getShiftById: async (shiftId: string): Promise<CashierShift> => {
    const res = await httpClient.get(`/api/v1/shifts/${shiftId}`);
    return res.data;
  },

  openShift: async (data: {
    terminalId: string;
    openingCash?: string;
    businessDate?: string;
  }): Promise<CashierShift> => {
    const res = await httpClient.post('/api/v1/shifts/open', data);
    return res.data;
  },

  closeShift: async (
    shiftId: string,
    data: {
      actualCash: string;
      /** Of the count, what stays in the drawer for the next shift; left out, it is emptied. */
      leftInDrawer?: string;
    },
  ): Promise<ShiftStatement> => {
    const res = await httpClient.post(`/api/v1/shifts/${shiftId}/close`, data);
    return res.data;
  },

  /** The float a new shift on this register starts with: what the last close left in the drawer. */
  getNextFloat: async (terminalId: string): Promise<{ amount: string; source: 'LEFT_IN_DRAWER' | 'POLICY' }> => {
    const res = await httpClient.get('/api/v1/shifts/next-float', { params: { terminalId } });
    return res.data;
  },

  /** The drawer rules where the caller is working: the float offered. */
  getPolicy: async (branchId?: string): Promise<ShiftPolicy> => {
    const res = await httpClient.get('/api/v1/shifts/policy', { params: { branchId: branchId || undefined } });
    return res.data;
  },

  getShiftStatement: async (shiftId: string): Promise<ShiftStatement> => {
    const res = await httpClient.get(`/api/v1/shifts/${shiftId}/statement`);
    return res.data;
  },

  /** What the register did in the shift. */
  getSummary: async (shiftId: string): Promise<ShiftSalesSummary> => {
    const res = await httpClient.get(`/api/v1/shifts/${shiftId}/summary`);
    return res.data;
  },

  /** Unsettled orders and unfinished cash, read before the close. */
  getCloseCheck: async (shiftId: string): Promise<ShiftCloseCheck> => {
    const res = await httpClient.get(`/api/v1/shifts/${shiftId}/close-check`);
    return res.data;
  },

  getBusinessDays: async (params?: Record<string, any>): Promise<{ data: BusinessDayClose[]; total: number }> => {
    const res = await httpClient.get('/api/v1/business-days', { params });
    if (Array.isArray(res.data)) {
      return { data: res.data, total: res.data.length };
    }
    return res.data;
  },
};
