import type { CashierShift } from 'src/api/shiftApi';

import { useState, useEffect, useCallback } from 'react';

import { shiftApi } from 'src/api/shiftApi';
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
 */
export function useRegisterShift() {
  const { selectedBranchId, selectedBranch, branches, isHeadOffice } = useBranchContext();
  const [terminal, setTerminal] = useDeviceTerminal();
  const [shift, setShift] = useState<CashierShift | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = !!terminal && !isHeadOffice && !!selectedBranchId && terminal.branch_id !== selectedBranchId;
  const terminalBranchName = terminal ? branches.find((b) => b.id === terminal.branch_id)?.name : undefined;

  const refresh = useCallback(async () => {
    if (!terminal || mismatch || isHeadOffice) {
      setShift(null);
      return;
    }
    setLoading(true);
    try {
      setShift(await shiftApi.getCurrentShift(terminal.id, terminal.branch_id));
      setError(null);
    } catch (err: any) {
      // A register deleted or moved since this device was set up is the same as none.
      if (err.status === 403 || err.status === 404) setTerminal(null);
      setError(err.detail || err.message || 'Failed to load the shift');
    } finally {
      setLoading(false);
    }
  }, [terminal, mismatch, isHeadOffice, setTerminal]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    terminal,
    setTerminal,
    mismatch,
    terminalBranchName,
    branchId: selectedBranchId,
    branchName: selectedBranch?.name,
    shift,
    loading,
    error,
    refresh,
  };
}
