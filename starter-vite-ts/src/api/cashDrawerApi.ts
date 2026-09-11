import { shiftApi } from './shiftApi';

export interface CashDrawerShift {
  id: string;
  tenant_id?: string;
  branch_id: string;
  terminal_id: string;
  user_id?: string;
  shift_number: string;
  opened_at: string;
  closed_at?: string;
  opening_float: string;
  expected_cash: string | null;
  actual_cash?: string;
  over_short_amount?: string;
  status: string;
  notes?: string;
}

export interface CashDrawerTransaction {
  id: string;
  tenant_id?: string;
  shift_id: string;
  transaction_type: string;
  amount: string;
  reason_code_id?: string;
  note?: string;
  recorded_at: string;
}

export interface ShiftSummary {
  opening_float: string;
  cash_sales: string | null;
  pay_in: string;
  pay_out: string;
  safe_drop: string;
  expected_cash: string | null;
}

export interface ActiveShiftResponse {
  shift: CashDrawerShift;
  transactions: CashDrawerTransaction[];
  summary: ShiftSummary;
  /** Sales and the expected total are withheld until the drawer is counted. */
  blind: boolean;
}

export const cashDrawerApi = {
  getActiveShift: async (branchId?: string, terminalId?: string): Promise<ActiveShiftResponse | null> => {
    try {
      const shift = await shiftApi.getCurrentShift(terminalId, branchId);
      // No drawer open is the ordinary state, and the screen renders its own empty view for
      // it. It used to arrive as a 404 caught below, which meant a normal visit printed a
      // failed request in the console.
      if (!shift) return null;
      const stmt = await shiftApi.getShiftStatement(shift.id);

      const legacyShift: CashDrawerShift = {
        id: shift.id,
        branch_id: shift.branch_id,
        terminal_id: shift.terminal_id,
        shift_number: shift.shift_number,
        opened_at: shift.opened_at,
        closed_at: shift.closed_at,
        opening_float: stmt.openingFloat,
        expected_cash: stmt.expectedCash,
        actual_cash: stmt.actualCash || undefined,
        over_short_amount: stmt.shortOver || '0.0000',
        status: shift.state,
      };

      const legacyTxs: CashDrawerTransaction[] = (stmt.movements || []).map((m) => ({
        id: m.id,
        shift_id: m.shift_id,
        transaction_type: m.type,
        amount: m.amount,
        reason_code_id: m.reason_code_id,
        note: m.reason_text || m.reference,
        recorded_at: m.posted_at,
      }));

      const summary: ShiftSummary = {
        opening_float: stmt.openingFloat,
        cash_sales: stmt.cashSales,
        pay_in: stmt.paidIn,
        pay_out: stmt.paidOut,
        safe_drop: '0.0000',
        expected_cash: stmt.expectedCash,
      };

      return { shift: legacyShift, transactions: legacyTxs, summary, blind: !!stmt.blind };
    } catch (err: any) {
      if (err.status === 404 || err.response?.status === 404) return null;
      throw err;
    }
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
    const moveType = data.transaction_type === 'PAY_OUT' || data.transaction_type === 'SAFE_DROP' ? 'PAID_OUT' : 'PAID_IN';
    const move = await shiftApi.recordMovement(shiftId, {
      type: moveType,
      amount: data.amount,
      reasonCodeId: data.reason_code_id,
      reason: data.note,
    });
    return {
      id: move.id,
      shift_id: move.shift_id,
      transaction_type: move.type,
      amount: move.amount,
      reason_code_id: move.reason_code_id,
      note: move.reason_text || move.reference,
      recorded_at: move.posted_at,
    };
  },
};
