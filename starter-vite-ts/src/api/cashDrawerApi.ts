import { httpClient } from './httpClient';

export interface CashDrawerShift {
  id: string;
  tenant_id: string;
  branch_id: string;
  terminal_id: string;
  user_id: string;
  shift_number: string;
  opened_at: string;
  closed_at?: string;
  opening_float: string;
  expected_cash: string;
  actual_cash?: string;
  over_short_amount?: string;
  status: string;
  notes?: string;
}

export interface CashDrawerTransaction {
  id: string;
  tenant_id: string;
  shift_id: string;
  transaction_type: string;
  amount: string;
  reason_code_id?: string;
  note?: string;
  recorded_at: string;
}

export interface ShiftSummary {
  opening_float: string;
  cash_sales: string;
  pay_in: string;
  pay_out: string;
  safe_drop: string;
  expected_cash: string;
}

export interface ActiveShiftResponse {
  shift: CashDrawerShift;
  transactions: CashDrawerTransaction[];
  summary: ShiftSummary;
}

export const cashDrawerApi = {
  getActiveShift: async (branchId?: string, terminalId?: string): Promise<ActiveShiftResponse | null> => {
    const res = await httpClient.get('/api/v1/cash-drawer/shifts/active', {
      params: { branchId, terminalId },
    });
    return res.data;
  },
  openShift: async (data: {
    branch_id: string;
    terminal_id: string;
    user_id: string;
    opening_float: string;
    notes?: string;
  }): Promise<CashDrawerShift> => {
    const res = await httpClient.post('/api/v1/cash-drawer/shifts/open', data);
    return res.data;
  },
  postTransaction: async (
    shiftId: string,
    data: {
      transaction_type: string;
      amount: string;
      reason_code_id?: string;
      note?: string;
    },
  ): Promise<CashDrawerTransaction> => {
    const res = await httpClient.post(`/api/v1/cash-drawer/shifts/${shiftId}/transactions`, data);
    return res.data;
  },
  closeShift: async (
    shiftId: string,
    data: {
      actual_cash: string;
      notes?: string;
    },
  ): Promise<{ shift: CashDrawerShift; summary: ShiftSummary; overShort: string }> => {
    const res = await httpClient.post(`/api/v1/cash-drawer/shifts/${shiftId}/close`, data);
    return res.data;
  },
};
