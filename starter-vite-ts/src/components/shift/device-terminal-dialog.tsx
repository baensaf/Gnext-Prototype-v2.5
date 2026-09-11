import type { Terminal } from 'src/api/tenantApi';
import type { DeviceTerminal } from './device-terminal';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Alert,
  Stack,
  Radio,
  Button,
  Dialog,
  Typography,
  RadioGroup,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';

import { tenantApi } from 'src/api/tenantApi';
import { useAuthStore } from 'src/store/useAuthStore';
import { isApproverRole } from 'src/config/role-access';

import { ApprovalModal } from 'src/components/approval/ApprovalModal';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  /** The branch this device stands in. Only that branch's registers are offered. */
  branchId: string;
  branchName?: string;
  current: DeviceTerminal | null;
  onAssigned: (terminal: DeviceTerminal) => void;
};

/**
 * Tells this device which register it is. Done once, by a manager: a cashier sees the
 * same list but hands the choice to a manager's pin, because a till set up against the
 * wrong drawer puts every sale into somebody else's count.
 */
export function DeviceTerminalDialog({ open, onClose, branchId, branchName, current, onAssigned }: Props) {
  const { t } = useTranslation();
  const role = useAuthStore((state) => state.user?.role);
  const canAssign = isApproverRole(role);

  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [pinOpen, setPinOpen] = useState(false);

  useEffect(() => {
    if (!open || !branchId) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    tenantApi
      .getTerminals(branchId)
      .then((list) => {
        if (cancelled) return;
        // A kiosk and a kitchen screen have no drawer, and the list endpoint answers head
        // office about every shop unless it is told which one.
        const registers = list.filter(
          (term) => term.branch_id === branchId && term.is_active && term.terminal_type === 'CASHIER'
        );
        setTerminals(registers);
        const keep = registers.find((term) => term.id === current?.id);
        setSelectedId(keep?.id || (registers.length === 1 ? registers[0].id : ''));
      })
      .catch((err: any) => {
        if (!cancelled) setError(err.detail || err.message || t('shift.device.loadError', 'Could not load registers'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, branchId, current?.id, t]);

  const assign = () => {
    const chosen = terminals.find((term) => term.id === selectedId);
    if (!chosen) return;
    onAssigned({ id: chosen.id, code: chosen.code, name: chosen.name, branch_id: chosen.branch_id });
    onClose();
  };

  return (
    <>
      <Dialog open={open && !pinOpen} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>{t('shift.device.title', 'Set up this register')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {t(
                'shift.device.help',
                'Choose which register this device is. It is remembered on this device, so shifts open against the right drawer without asking again.'
              )}
            </Typography>
            {branchName && (
              <Typography variant="subtitle2">
                {t('shift.device.branch', 'Branch')}: {branchName}
              </Typography>
            )}
            {error && <Alert severity="error">{error}</Alert>}
            {loading ? (
              <Stack sx={{ alignItems: 'center', py: 2 }}>
                <CircularProgress size={28} />
              </Stack>
            ) : terminals.length === 0 ? (
              <Alert severity="warning">
                {t('shift.device.none', 'This branch has no active cash registers. A manager can add one under Terminals.')}
              </Alert>
            ) : (
              <RadioGroup value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
                {terminals.map((term) => (
                  <FormControlLabel
                    key={term.id}
                    value={term.id}
                    control={<Radio />}
                    label={`${term.name} (${term.code})`}
                  />
                ))}
              </RadioGroup>
            )}
            {!canAssign && terminals.length > 0 && (
              <Alert severity="info">{t('shift.device.pinNotice', 'A manager PIN is needed to set up a register.')}</Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button
            variant="contained"
            disabled={!selectedId}
            onClick={() => (canAssign ? assign() : setPinOpen(true))}
          >
            {t('shift.device.assign', 'Use this register')}
          </Button>
        </DialogActions>
      </Dialog>

      <ApprovalModal
        open={pinOpen}
        onClose={() => setPinOpen(false)}
        actionName="ASSIGN_DEVICE_TERMINAL"
        detailsText={t('shift.device.approvalDetails', 'Set up this device as a cash register')}
        onSuccess={() => {
          setPinOpen(false);
          assign();
        }}
      />
    </>
  );
}
