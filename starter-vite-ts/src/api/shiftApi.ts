import { httpClient } from './httpClient';

export interface CashMovement {
  id: string;
  shift_id: string;
  type: 'OPENING_FLOAT' | 'CASH_PAYMENT' | 'CASH_REFUND' | 'PAID_IN' | 'PAID_OUT' | 'SAFE_DROP' | 'CLOSE_ADJUSTMENT';
  amount: string;
  currency_code: string;
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
  state: 'OPEN' | 'CLOSING_REVIEW' | 'CLOSED';
  status: string; // legacy alias
  currency_code: string;
  business_date: string;
  opened_at: string;
  closed_at?: string;
  opening_cash: string;
  opening_float?: string;
  expected_cash?: string;
  actual_cash?: string;
  short_over?: string;
  over_short_amount?: string;
  closing_note?: string;
  preview_version?: string;
  movements?: CashMovement[];
}

export interface ShiftStatement {
  shiftId: string;
  shiftNumber: string;
  branchId: string;
  terminalId: string;
  state: string;
  currencyCode: string;
  businessDate: string;
  openedAt: string;
  closedAt?: string;
  openingFloat: string;
  cashSales: string;
  cashRefunds: string;
  paidIn: string;
  paidOut: string;
  safeDrops: string;
  /** Null while the shift is open and the viewer is counting blind. */
  expectedCash: string | null;
  actualCash?: string;
  shortOver?: string | null;
  previewVersion?: string;
  orderCount: number;
  movements: CashMovement[];
  /** True when sales, refunds and the expected total were withheld for a blind count. */
  blind?: boolean;
}

export interface ShiftPolicy {
  defaultOpeningFloat: string;
  varianceTolerance: string;
  blindClose: boolean;
}

/** What a close refused with `SHIFT_COUNT_NEEDS_SIGNOFF` hands back. */
export interface ShiftCountSignoff {
  expectedCash: string;
  actualCash: string;
  shortOver: string;
  varianceTolerance: string;
  needsReason: boolean;
  needsApproval: boolean;
}

export interface BusinessDayClose {
  id: string;
  branch_id: string;
  business_date: string;
  currency_code: string;
  status: 'CLOSED' | 'REOPENED';
  totals: any;
  closed_at: string;
  reopened_at?: string;
  approval_request_id?: string;
}

/** An order still open when its branch's day is being closed. */
export interface DayCloseOpenOrder {
  id: string;
  orderNumber: string;
  orderType: string;
  channel: string;
  state: string;
  businessDate: string | null;
  placedAt: string;
  tableNumber: string | null;
  grandTotal: string;
  outstandingTotal: string;
  issue?: 'UNPAID' | 'NOT_SUBMITTED' | 'AWAITING_ACCEPTANCE' | 'DELIVERY_NOT_FINISHED';
}

export interface DayCloseOpenOrders {
  /** Paid orders the close completes. */
  toComplete: DayCloseOpenOrder[];
  /** Orders that block the close unless they are carried over with a reason. */
  needsDecision: DayCloseOpenOrder[];
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

/** What closing a shift would leave behind. */
export interface ShiftCloseCheck {
  shiftId: string;
  branchId: string;
  businessDate: string;
  currencyCode: string;
  /** This till's held, unpaid or unaccepted orders; leaving them open takes a manager PIN. */
  openOrders: DayCloseOpenOrder[];
  /** Cash payments on this drawer that must be finished or cancelled first. */
  pendingCash: PendingCashPayment[];
  /** Other drawers still open at the branch on this business day. */
  otherOpenTills: number;
  dayClosed: boolean;
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
    currencyCode?: string;
    openingCash?: string;
    businessDate?: string;
  }): Promise<CashierShift> => {
    const res = await httpClient.post('/api/v1/shifts/open', data);
    return res.data;
  },

  recordMovement: async (
    shiftId: string,
    data: {
      type: 'PAID_IN' | 'PAID_OUT' | 'SAFE_DROP';
      amount: string;
      reasonCodeId?: string;
      reason?: string;
      reference?: string;
    },
  ): Promise<CashMovement> => {
    const res = await httpClient.post(`/api/v1/shifts/${shiftId}/movements`, data);
    return res.data;
  },

  beginClose: async (shiftId: string): Promise<ShiftStatement> => {
    const res = await httpClient.post(`/api/v1/shifts/${shiftId}/begin-close`, {});
    return res.data;
  },

  returnToOpen: async (shiftId: string, reason?: string): Promise<CashierShift> => {
    const res = await httpClient.post(`/api/v1/shifts/${shiftId}/return-to-open`, { reason });
    return res.data;
  },

  closeShift: async (
    shiftId: string,
    data: {
      actualCash: string;
      reasonCodeId?: string;
      reason?: string;
      approvalRequestId?: string;
      previewVersion?: string;
      /** An approver's pin, when the count is further out than the branch allows. */
      pin?: string;
      /** An approver's pin, when orders this till rang up are left open. */
      openOrdersPin?: string;
    },
  ): Promise<ShiftStatement> => {
    const res = await httpClient.post(`/api/v1/shifts/${shiftId}/close`, data);
    return res.data;
  },

  /** The drawer rules where the caller is working: float offered, tolerance, blind count. */
  getPolicy: async (branchId?: string): Promise<ShiftPolicy> => {
    const res = await httpClient.get('/api/v1/shifts/policy', { params: { branchId: branchId || undefined } });
    return res.data;
  },

  getShiftStatement: async (shiftId: string): Promise<ShiftStatement> => {
    const res = await httpClient.get(`/api/v1/shifts/${shiftId}/statement`);
    return res.data;
  },

  /** Open orders, unfinished cash and other open tills, read before and after the close. */
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

  /** The branch's open orders closing this day would complete, and those it waits on. */
  getDayCloseOpenOrders: async (params: {
    branchId: string;
    businessDate: string;
    currencyCode?: string;
  }): Promise<DayCloseOpenOrders> => {
    const res = await httpClient.get('/api/v1/business-days/open-orders', { params });
    return res.data;
  },

  closeBusinessDay: async (data: {
    branchId: string;
    businessDate: string;
    currencyCode?: string;
    /** Closes the day with its unpaid or unfinished orders left open for the next one. */
    carryOverReason?: string;
  }): Promise<BusinessDayClose> => {
    const res = await httpClient.post('/api/v1/business-days/close', data);
    return res.data;
  },

  reopenBusinessDay: async (
    id: string,
    data: { reason: string },
  ): Promise<BusinessDayClose> => {
    const res = await httpClient.post(`/api/v1/business-days/${id}/reopen`, data);
    return res.data;
  },
};
