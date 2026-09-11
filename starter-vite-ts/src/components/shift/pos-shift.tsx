import type { RegisterShiftState } from './use-register-shift';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import { Card, Chip, Paper, Stack, Button, Typography, CircularProgress } from '@mui/material';

import { RegisterNotice } from './register-notice';
import { OpenShiftDialog } from './open-shift-dialog';
import { CloseShiftDialog } from './close-shift-dialog';
import { DeviceTerminalDialog } from './device-terminal-dialog';

// ----------------------------------------------------------------------

const DEFAULT_OPENING_FLOAT = '5000000';

/**
 * The shift controls a cashier needs without leaving the register: which register this
 * is, the shift open on it, and the way to close it. Opening lives in `PosShiftGate`,
 * which stands in for the till until a shift is open.
 */
export function PosShiftBar({ register }: { register: RegisterShiftState }) {
  const { t } = useTranslation();
  const [closeOpen, setCloseOpen] = useState(false);
  const { terminal, shift } = register;

  if (!terminal || !shift) return null;

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
          color={shift.state === 'OPEN' ? 'success' : 'warning'}
          label={
            <span>
              {t('shift.bar.shift', 'Shift')} <span dir="ltr">#{shift.shift_number}</span>
            </span>
          }
        />
        <Typography variant="caption" color="text.secondary">
          {t('shift.bar.since', 'Open since {{time}}', {
            time: new Date(shift.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          })}
        </Typography>
        <Button
          size="small"
          color="error"
          variant="outlined"
          startIcon={<LockIcon />}
          onClick={() => setCloseOpen(true)}
          sx={{ ml: 'auto' }}
        >
          {t('shift.close.title', 'Close shift')}
        </Button>
      </Paper>

      <CloseShiftDialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        shiftId={shift.id}
        shiftNumber={shift.shift_number}
        onClosed={register.refresh}
      />
    </>
  );
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
          defaultFloat={DEFAULT_OPENING_FLOAT}
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
