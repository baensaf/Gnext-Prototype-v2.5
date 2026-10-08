import type { RegisterShiftState } from './use-register-shift';

import { useNavigate } from 'react-router';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import {
  Card,
  Chip,
  Paper,
  Stack,
  Button,
  Typography,
  CircularProgress,
} from '@mui/material';

import { fTime, fDateTime } from 'src/utils/format-time';

import { RegisterNotice } from './register-notice';
import { OpenShiftDialog } from './open-shift-dialog';
import { useAccountShift } from './account-shift-store';
import { DeviceTerminalDialog } from './device-terminal-dialog';
import { BusinessDayEndedAlert } from './business-day-ended-alert';

// ----------------------------------------------------------------------


/**
 * The shift controls a cashier needs without leaving the register: which register this
 * is, the shift open on it, and the way to close it. Opening lives in `PosShiftGate`,
 * which stands in for the till until a shift is open.
 */
export function PosShiftBar({ register }: { register: RegisterShiftState }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { terminal, shift } = register;

  if (!terminal || !shift) return null;

  const openedEarlier = !!shift.opened_at && new Date(shift.opened_at).toDateString() !== new Date().toDateString();

  return (
    <>
      <Paper
        variant="outlined"
        sx={{ px: 2, py: 1, mb: 2, borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}
      >
        <PointOfSaleIcon color="success" fontSize="small" />
        <Typography variant="subtitle2">
          {terminal.name} ({terminal.code})
        </Typography>
        <Chip
          size="small"
          color={shift.state === 'OPEN' && !register.dayEnded ? 'success' : 'warning'}
          label={
            <span>
              {t('shift.bar.shift', 'Shift')} <span dir="ltr">#{shift.shift_number}</span>
            </span>
          }
        />
        {/* A shift left open from an earlier day shows its date, and stands out: "since 19:23"
            read as this evening when the drawer had been open for six days. */}
        <Typography
          variant="caption"
          color={openedEarlier ? 'warning.main' : 'text.secondary'}
          sx={openedEarlier ? { fontWeight: 700 } : undefined}
        >
          {t('shift.bar.since', 'Open since {{time}}', {
            time: openedEarlier ? fDateTime(shift.opened_at) : fTime(shift.opened_at),
          })}
        </Typography>
        <Button
          size="small"
          color="error"
          variant="outlined"
          startIcon={<LockIcon />}
          onClick={() => navigate(`/app/cashier/shifts/${shift.id}/end`)}
          sx={{ ml: 'auto' }}
        >
          {t('shift.end.open', 'Review & end shift')}
        </Button>
      </Paper>

      <BusinessDayEndedAlert register={register} />
    </>
  );
}

/**
 * Hands the open shift to the account drawer, which opens its End shift page. Nothing shows on
 * the register itself: the shift is touched once, at its end, and its name and number took the
 * cart's header all day.
 */
export function PosShiftAccountLink({ register }: { register: RegisterShiftState }) {
  const publish = useAccountShift((state) => state.set);
  const navigate = useNavigate();
  const { terminal, shift } = register;

  const registerName = terminal ? `${terminal.name} (${terminal.code})` : '';
  const shiftId = shift?.id || '';
  const shiftNumber = shift?.shift_number || '';
  const openedAt = shift?.opened_at ? String(shift.opened_at) : '';
  useEffect(() => {
    if (!registerName || !shiftNumber) return undefined;
    publish({
      shiftId,
      registerName,
      shiftNumber,
      openedAt,
      openedEarlier: !!openedAt && new Date(openedAt).toDateString() !== new Date().toDateString(),
      close: () => navigate(`/app/cashier/shifts/${shiftId}/end`),
    });
    return () => publish(null);
  }, [publish, navigate, shiftId, registerName, shiftNumber, openedAt]);

  return null;
}

/**
 * Stands in for the till until this device is a register with a shift open on it. Selling
 * with no shift left card sales in no drawer's statement and refused cash only at the last
 * step, with the order already rung up. This is the register's rule, not the server's: a
 * kiosk and a delivery platform take orders with no drawer at all.
 */
export function PosShiftGate({ register }: { register: RegisterShiftState }) {
  const { t } = useTranslation();
  const [setupOpen, setSetupOpen] = useState(false);
  const [openOpen, setOpenOpen] = useState(false);
  const { terminal, mismatch, ready } = register;

  if (!register.checked) {
    return (
      <Stack sx={{ alignItems: 'center', py: 10 }}>
        <CircularProgress />
      </Stack>
    );
  }

  return (
    <>
      {register.isHeadOffice ? (
        <Card sx={{ borderRadius: 3, p: 4, textAlign: 'center' }}>
          <Typography variant="h6">{t('shift.gate.headOffice', 'Choose a branch to sell in')}</Typography>
        </Card>
      ) : !ready ? (
        <RegisterNotice
          terminal={terminal}
          mismatch={mismatch}
          terminalBranchName={register.terminalBranchName}
          branchName={register.branchName}
          onSetup={() => setSetupOpen(true)}
        />
      ) : (
        <Card sx={{ borderRadius: 3, p: 5, textAlign: 'center' }}>
          <Stack spacing={2} sx={{ alignItems: 'center' }}>
            <PointOfSaleIcon color="disabled" sx={{ fontSize: 56 }} />
            <Typography variant="h5">{t('shift.gate.title', 'No shift is open on this register')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('shift.gate.help', '{{register}}: count the float into the drawer and open a shift to start selling.', {
                register: terminal ? `${terminal.name} (${terminal.code})` : '',
              })}
            </Typography>
            <Button size="large" variant="contained" color="success" startIcon={<LockOpenIcon />} onClick={() => setOpenOpen(true)}>
              {t('shift.open.title', 'Open shift')}
            </Button>
          </Stack>
        </Card>
      )}

      {terminal && ready && (
        <OpenShiftDialog
          open={openOpen}
          onClose={() => setOpenOpen(false)}
          terminal={terminal}
          branchName={register.terminalBranchName}
          defaultFloat={register.defaultFloat}
          onOpened={register.refresh}
        />
      )}

      <DeviceTerminalDialog
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        branchId={register.branchId}
        branchName={register.branchName}
        current={terminal}
        onAssigned={register.setTerminal}
      />
    </>
  );
}
