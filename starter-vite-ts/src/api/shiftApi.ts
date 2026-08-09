import { httpClient } from './httpClient';

export interface CashMovement {
  id: string;
  shift_id: string;
  type: 'OPENING_FLOAT' | 'CASH_PAYMENT' | 'CASH_REFUND' | 'PAID_IN' | 'PAID_OUT' | 'CLOSE_ADJUSTMENT';
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
  expectedCash: string;
  actualCash?: string;
  shortOver?: string;
  previewVersion?: string;
  orderCount: number;
  movements: CashMovement[];
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

export const shiftApi = {
  getShifts: async (params?: Record<string, any>): Promise<{ data: CashierShift[]; total: number }> => {
    const res = await httpClient.get('/api/v1/shifts', { params });
    if (Array.isArray(res.data)) {
      return { data: res.data, total: res.data.length };
    }
    return res.data;
  },

  getCurrentShift: async (terminalId?: string): Promise<CashierShift> => {
    const res = await httpClient.get('/api/v1/shifts/current', { params: { terminalId } });
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
      type: 'PAID_IN' | 'PAID_OUT';
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
    },
  ): Promise<ShiftStatement> => {
    const res = await httpClient.post(`/api/v1/shifts/${shiftId}/close`, data);
    return res.data;
  },

  getShiftStatement: async (shiftId: string): Promise<ShiftStatement> => {
    const res = await httpClient.get(`/api/v1/shifts/${shiftId}/statement`);
    return res.data;
  },

  getBusinessDays: async (params?: Record<string, any>): Promise<{ data: BusinessDayClose[]; total: number }> => {
    const res = await httpClient.get('/api/v1/business-days', { params });
    if (Array.isArray(res.data)) {
      return { data: res.data, total: res.data.length };
    }
    return res.data;
  },

  closeBusinessDay: async (data: {
    branchId: string;
    businessDate: string;
    currencyCode?: string;
  }): Promise<BusinessDayClose> => {
    const res = await httpClient.post('/api/v1/business-days/close', data);
    return res.data;
  },

  reopenBusinessDay: async (
    id: string,
    data: { reason: string; approvalRequestId: string },
  ): Promise<BusinessDayClose> => {
    const res = await httpClient.post(`/api/v1/business-days/${id}/reopen`, data);
    return res.data;
  },
};
