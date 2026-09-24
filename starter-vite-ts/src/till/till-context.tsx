import type { TillState } from './agent-client';
import type { CashierShift } from 'src/api/shiftApi';
import type { RegisterShiftState } from 'src/components/shift/use-register-shift';

import { useContext, createContext } from 'react';

// ----------------------------------------------------------------------

export type TillContextValue = {
  state: TillState;
  /** Reads the agent's state again: mode, till and shift. */
  refresh: () => Promise<void>;
};

export const TillContext = createContext<TillContextValue | null>(null);

export function useTill(): TillContextValue {
  const value = useContext(TillContext);
  if (!value) throw new Error('useTill must be used inside the offline till');
  return value;
}

/**
 * The register and its shift as the web POS's shift bar reads them, from the till the agent is
 * bound to and the shift the snapshot lists open on it. Nothing here opens or closes a shift:
 * that stays with the cloud.
 */
export function useAgentRegisterShift(): RegisterShiftState {
  const { state, refresh } = useTill();
  const branchId = state.branch?.id || '';
  const terminal = state.till ? { id: state.till.id, code: state.till.code, name: state.till.name, branch_id: branchId } : null;
  const shift: CashierShift | null = state.shift
    ? {
        id: state.shift.id,
        branch_id: branchId,
        terminal_id: state.shift.terminal_id,
        shift_number: state.shift.shift_number,
        state: 'OPEN',
        status: 'OPEN',
        currency_code: 'IRR',
        business_date: state.shift.business_date,
        opened_at: state.shift.opened_at,
        opening_cash: '0',
      }
    : null;

  return {
    terminal,
    setTerminal: () => undefined,
    mismatch: false,
    ready: !!terminal,
    isHeadOffice: false,
    terminalBranchName: state.branch?.name,
    branchId,
    branchName: state.branch?.name,
    shift,
    policy: null,
    businessDay: null,
    dayEnded: false,
    defaultFloat: '0',
    loading: false,
    checked: true,
    error: null,
    refresh,
  };
}
