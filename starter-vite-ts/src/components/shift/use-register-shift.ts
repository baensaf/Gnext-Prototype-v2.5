import type { CurrentBusinessDay } from 'src/api/businessDayApi';
import type { ShiftPolicy, CashierShift } from 'src/api/shiftApi';

import { useState, useEffect, useCallback } from 'react';

import { shiftApi } from 'src/api/shiftApi';
import { businessDayApi } from 'src/api/businessDayApi';
import { useBranchContext } from 'src/contexts/branch-context';

import { useDeviceTerminal } from './device-terminal';

// ----------------------------------------------------------------------

/**
 * The register this device is, and the shift open on it.
 *
 * `mismatch` is the device's register belonging to a branch other than the one the header
 * is set to — head office switching scope, or a device carried to another shop. Nothing is
 * opened or counted in that state: the server would put it in the register's own branch,
 * which is not the one on screen.
 *
 * `checked` turns true once the first answer is in, so a screen that gates on the shift
 * does not flash its "no shift" state while the question is still in flight.
 */
export function useRegisterShift() {
  const { selectedBranchId, selectedBranch, branches, isHeadOffice } = useBranchContext();
  const [terminal, setTerminal] = useDeviceTerminal();
  const [shift, setShift] = useState<CashierShift | null>(null);
  // The drawer rules in the register's branch — the float the open dialog offers.
  const [policy, setPolicy] = useState<ShiftPolicy | null>(null);
  // The register's branch's business day, so a shift left open past the cutoff shows as ended.
  const [businessDay, setBusinessDay] = useState<CurrentBusinessDay | null>(null);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = !!terminal && !isHeadOffice && !!selectedBranchId && terminal.branch_id !== selectedBranchId;
  const ready = !!terminal && !mismatch && !isHeadOffice;
  const terminalBranchName = terminal ? branches.find((b) => b.id === terminal.branch_id)?.name : undefined;

  const refresh = useCallback(async () => {
    if (!terminal || mismatch || isHeadOffice) {
      setShift(null);
      setChecked(true);
      return;
    }
    setLoading(true);
    try {
      const [current, rules, day] = await Promise.all([
        shiftApi.getCurrentShift(terminal.id, terminal.branch_id),
        shiftApi.getPolicy(terminal.branch_id).catch(() => null),
        businessDayApi.getCurrent(terminal.branch_id).catch(() => null),
      ]);
      setShift(current);
      setPolicy(rules);
      setBusinessDay(day);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to load the shift');
    } finally {
      setLoading(false);
      setChecked(true);
    }
  }, [terminal, mismatch, isHeadOffice]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Look again when the day turns over, so an open till learns its shift has ended.
  useEffect(() => {
    if (!businessDay?.endsAt) return undefined;
    const wait = new Date(businessDay.endsAt).getTime() - Date.now() + 1000;
    if (wait <= 0 || wait > 24 * 3600_000) return undefined;
    const timer = setTimeout(refresh, wait);
    return () => clearTimeout(timer);
  }, [businessDay?.endsAt, refresh]);

  /**
   * The open shift belongs to a business day that has ended: it can only be counted and
   * closed, and a new shift opened on the new day, before anything more is sold.
   */
  const dayEnded = !!shift && !!businessDay && String(shift.business_date).slice(0, 10) < businessDay.businessDate;

  return {
    terminal,
    setTerminal,
    mismatch,
    ready,
    isHeadOffice,
    terminalBranchName,
    branchId: selectedBranchId,
    branchName: selectedBranch?.name,
    shift,
    policy,
    businessDay,
    dayEnded,
    /** What the open dialog offers; the server's default until the policy has loaded. */
    defaultFloat: policy?.defaultOpeningFloat ?? '5000000',
    loading,
    checked,
    error,
    refresh,
  };
}

export type RegisterShiftState = ReturnType<typeof useRegisterShift>;
