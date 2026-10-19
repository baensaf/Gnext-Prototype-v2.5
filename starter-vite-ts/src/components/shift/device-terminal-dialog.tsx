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

import { fDateTime } from 'src/utils/format-time';
import { readDeviceId, deviceDisplayName } from 'src/utils/device-id';

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
  /** A till (the default) or a self-order kiosk, which has no drawer but may have a card terminal. */
  terminalType?: 'CASHIER' | 'KIOSK';
  /** A kiosk on its own address has no menu to sign out from, so the setup dialog carries it, behind a manager PIN. */
  onSignOut?: () => void;
};

/**
 * Tells this device which register it is. Done once, by a manager: a cashier sees the
 * same list but hands the choice to a manager's pin, because a till set up against the
 * wrong drawer puts every sale into somebody else's count.
 */
export function DeviceTerminalDialog({ open, onClose, branchId, branchName, current, onAssigned, terminalType = 'CASHIER', onSignOut }: Props) {
  const isKiosk = terminalType === 'KIOSK';
  const { t } = useTranslation();
  const role = useAuthStore((state) => state.user?.role);
  const canAssign = isApproverRole(role);

  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [pinOpen, setPinOpen] = useState(false);
  const [signOutPinOpen, setSignOutPinOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // The register is paired with another device: which one, before this one takes it.
  const [takenBy, setTakenBy] = useState<{ deviceName: string | null; lastSeenAt: string | null } | null>(null);

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
          (term) => term.branch_id === branchId && term.is_active && term.terminal_type === terminalType
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
  }, [open, branchId, current?.id, terminalType, t]);

  const assign = async (replace = false) => {
    const chosen = terminals.find((term) => term.id === selectedId);
    if (!chosen) return;
    // A till register is paired on the server, one device each; a kiosk (V3) is not.
    if (!isKiosk) {
      setSaving(true);
      setError(null);
      try {
        await tenantApi.pairTerminalDevice(chosen.id, {
          device_id: readDeviceId(),
          device_name: deviceDisplayName(),
          replace,
        });
      } catch (err: any) {
        if (err.code === 'REGISTER_PAIRED_ELSEWHERE') {
          setTakenBy({ deviceName: err.context?.deviceName ?? null, lastSeenAt: err.context?.lastSeenAt ?? null });
        } else {
          setError(err.detail || err.message || t('shift.device.pairError', 'Could not set up this register'));
        }
        return;
      } finally {
        setSaving(false);
      }
    }
    setTakenBy(null);
    onAssigned({ id: chosen.id, code: chosen.code, name: chosen.name, branch_id: chosen.branch_id });
    onClose();
  };

  const chosenTerminal = terminals.find((term) => term.id === selectedId);

  return (
    <>
      <Dialog open={open && !pinOpen && !signOutPinOpen && !takenBy} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>{isKiosk ? t('kiosk.device.title', 'Set up this kiosk') : t('shift.device.title', 'Set up this register')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {isKiosk
                ? t('kiosk.device.help', 'Choose which kiosk this device is. Its card payments go to the card terminal linked to it under Terminals.')
                : t(
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
                {isKiosk
                ? t('kiosk.device.none', 'This branch has no active kiosk terminals. A manager can add one under Terminals.')
                : t('shift.device.none', 'This branch has no active cash registers. A manager can add one under Terminals.')}
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
          {onSignOut && (
            <Button color="error" onClick={() => setSignOutPinOpen(true)} sx={{ mr: 'auto' }}>
              {t('auth.logout', 'Sign Out')}
            </Button>
          )}
          <Button onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button
            variant="contained"
            disabled={!selectedId || saving}
            onClick={() => (canAssign ? assign() : setPinOpen(true))}
          >
            {isKiosk ? t('kiosk.device.assign', 'Use this kiosk') : t('shift.device.assign', 'Use this register')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={open && !!takenBy} onClose={() => setTakenBy(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>{t('shift.device.takenTitle', 'Move this register here?')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {takenBy?.lastSeenAt
              ? t('shift.device.takenSeen', '{{register}} is used by {{device}}, last seen {{seen}}.', {
                  register: chosenTerminal ? `${chosenTerminal.name} (${chosenTerminal.code})` : '',
                  device: takenBy?.deviceName || t('shift.device.otherDevice', 'another device'),
                  seen: fDateTime(takenBy.lastSeenAt),
                })
              : t('shift.device.taken', '{{register}} is used by {{device}}.', {
                  register: chosenTerminal ? `${chosenTerminal.name} (${chosenTerminal.code})` : '',
                  device: takenBy?.deviceName || t('shift.device.otherDevice', 'another device'),
                })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            {t(
              'shift.device.takenHelp',
              'Moving it here cuts the other device off. It asks a manager to set it up the next time it is used.'
            )}
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTakenBy(null)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" disabled={saving} onClick={() => assign(true)}>
            {t('shift.device.move', 'Move it here')}
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

      <ApprovalModal
        open={signOutPinOpen}
        onClose={() => setSignOutPinOpen(false)}
        actionName="SIGN_OUT_KIOSK"
        detailsText={t('kiosk.device.signOutApproval', 'Sign this kiosk device out')}
        onSuccess={() => {
          setSignOutPinOpen(false);
          onSignOut?.();
        }}
      />
    </>
  );
}
