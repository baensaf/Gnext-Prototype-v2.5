import type { Terminal } from 'src/api/tenantApi';
import type { CashierShift, ShiftStatement } from 'src/api/shiftApi';
import type { MovementType } from 'src/components/shift/movement-dialog';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import LockIcon from '@mui/icons-material/Lock';
import RefreshIcon from '@mui/icons-material/Refresh';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import RemoveCircleIcon from '@mui/icons-material/RemoveCircle';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import {
  Box,
  Card,
  Chip,
  Grid,
  Stack,
  Alert,
  Table,
  Button,
  Divider,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  CardContent,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { businessToday } from 'src/utils/calendar';
import { fDate , fTime } from 'src/utils/format-time';

import { shiftApi } from 'src/api/shiftApi';
import { tenantApi } from 'src/api/tenantApi';
import { useAuthStore } from 'src/store/useAuthStore';
import { isApproverRole } from 'src/config/role-access';
import { useBranchContext } from 'src/contexts/branch-context';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import { MovementDialog } from 'src/components/shift/movement-dialog';
import { OpenShiftDialog } from 'src/components/shift/open-shift-dialog';
import { CloseShiftDialog } from 'src/components/shift/close-shift-dialog';
import { useRegisterShift } from 'src/components/shift/use-register-shift';
import { DeviceTerminalDialog } from 'src/components/shift/device-terminal-dialog';

// ----------------------------------------------------------------------

const today = () => businessToday();
const time = (value?: string) =>
  value ? fTime(value) : '';

function Figure({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, color }} dir="ltr">
        {value}
      </Typography>
    </Stack>
  );
}

/**
 * The branch's drawers: one card per register with the shift open on it, and the shifts
 * already counted down. A shift is one register's; the branch's day is closed separately,
 * on Business Days, once every drawer here is counted.
 *
 * A drawer is opened at its own register, so only this device's card offers Open. A
 * manager may pay into, pay out of or count down any drawer in the branch — a cashier who
 * went home without closing leaves one for them — while a cashier works their own.
 */
export function CashDrawerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const role = useAuthStore((state) => state.user?.role);
  const canManage = isApproverRole(role);
  const { selectedBranchId, selectedBranch } = useBranchContext();
  const register = useRegisterShift();

  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [shifts, setShifts] = useState<CashierShift[]>([]);
  const [statements, setStatements] = useState<Record<string, ShiftStatement>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [setupOpen, setSetupOpen] = useState(false);
  const [openFor, setOpenFor] = useState<Terminal | null>(null);
  const [closeFor, setCloseFor] = useState<CashierShift | null>(null);
  const [movement, setMovement] = useState<{ shiftId: string; type: MovementType } | null>(null);

  const load = useCallback(async () => {
    if (!selectedBranchId) return;
    setLoading(true);
    try {
      const [terms, list] = await Promise.all([
        tenantApi.getTerminals(selectedBranchId),
        shiftApi.getShifts({ branch: selectedBranchId, limit: 50 }),
      ]);
      setTerminals(terms.filter((x) => x.branch_id === selectedBranchId && x.terminal_type === 'CASHIER' && x.is_active));
      setShifts(list.data);
      const open = list.data.filter((s) => s.state !== 'CLOSED');
      const stmts = await Promise.all(open.map((s) => shiftApi.getShiftStatement(s.id)));
      setStatements(Object.fromEntries(stmts.map((st) => [st.shiftId, st])));
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('shift.page.loadError', 'Failed to load the drawers'));
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const refreshAll = () => {
    load();
    register.refresh();
  };

  const registerName = (id: string) => {
    const term = terminals.find((x) => x.id === id);
    return term ? `${term.name} (${term.code})` : id.slice(0, 8);
  };
  const openShiftOn = (terminalId: string) => shifts.find((s) => s.terminal_id === terminalId && s.state !== 'CLOSED');
  const history = shifts.filter((s) => s.state === 'CLOSED');
  const deviceTerminalId = register.ready ? register.terminal?.id : undefined;

  const stateLabel = (state?: string) =>
    state === 'OPEN'
      ? t('shift.state.open', 'Open')
      : state === 'CLOSING_REVIEW'
        ? t('shift.state.closingReview', 'In review')
        : t('shift.state.closed', 'Closed');

  const renderCard = (term: Terminal) => {
    const shift = openShiftOn(term.id);
    const stmt = shift ? statements[shift.id] : undefined;
    const isThisDevice = term.id === deviceTerminalId;
    const mayWork = canManage || isThisDevice;
    const blind = !!stmt?.blind;
    const stale = shift && shift.business_date < today();

    return (
      <Grid key={term.id} size={{ xs: 12, md: 6, xl: 4 }}>
        <Card sx={{ height: '100%', borderRadius: 3, borderColor: isThisDevice ? 'primary.main' : undefined }} variant="outlined">
          <CardContent>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }}>
              <PointOfSaleIcon color={shift ? 'success' : 'disabled'} />
              <Typography variant="subtitle1" sx={{ fontWeight: 700, flexGrow: 1 }}>
                {term.name} <Typography component="span" variant="body2" color="text.secondary">({term.code})</Typography>
              </Typography>
              {isThisDevice && <Chip size="small" color="primary" variant="outlined" label={t('shift.card.thisDevice', 'This device')} />}
              {shift && <Chip size="small" color={shift.state === 'OPEN' ? 'success' : 'warning'} label={stateLabel(shift.state)} />}
            </Stack>

            {shift ? (
              <Stack spacing={1.25}>
                <Typography variant="body2" color="text.secondary">
                  {t('shift.bar.shift', 'Shift')} <span dir="ltr">#{shift.shift_number}</span> ·{' '}
                  {t('shift.bar.since', 'Open since {{time}}', { time: time(shift.opened_at) })}
                </Typography>
                {stale && (
                  <Alert severity="warning" sx={{ py: 0 }}>
                    {t('shift.card.stale', 'Left open since {{date}}. Count it down before closing the day.', {
                      date: fDate(shift.business_date),
                    })}
                  </Alert>
                )}
                {stmt && (
                  <>
                    <Divider />
                    <Figure label={t('cashier.openingFloat', 'Opening Float')} value={MoneyUtil.formatCurrency(stmt.openingFloat)} />
                    <Figure
                      label={t('shift.close.cashSales', 'Cash sales')}
                      value={blind ? '—' : MoneyUtil.formatCurrency(stmt.cashSales)}
                    />
                    <Figure label={t('shift.movement.paidIn', 'Pay in')} value={MoneyUtil.formatCurrency(stmt.paidIn)} />
                    <Figure label={t('shift.movement.paidOut', 'Pay out')} value={MoneyUtil.formatCurrency(stmt.paidOut)} />
                    <Figure label={t('shift.movement.safeDrop', 'Safe drop')} value={MoneyUtil.formatCurrency(stmt.safeDrops)} />
                    <Figure
                      label={t('cashier.expectedCash', 'Expected Cash')}
                      value={blind ? t('shift.card.hiddenUntilCount', 'Shown after the count') : MoneyUtil.formatCurrency(stmt.expectedCash)}
                      color={blind ? 'text.secondary' : 'primary.main'}
                    />
                  </>
                )}
                <Divider />
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                  {mayWork && shift.state === 'OPEN' && (
                    <>
                      <Button size="small" startIcon={<AddCircleIcon />} onClick={() => setMovement({ shiftId: shift.id, type: 'PAID_IN' })}>
                        {t('shift.movement.paidIn', 'Pay in')}
                      </Button>
                      <Button size="small" color="warning" startIcon={<RemoveCircleIcon />} onClick={() => setMovement({ shiftId: shift.id, type: 'PAID_OUT' })}>
                        {t('shift.movement.paidOut', 'Pay out')}
                      </Button>
                      <Button size="small" color="info" startIcon={<AccountBalanceWalletIcon />} onClick={() => setMovement({ shiftId: shift.id, type: 'SAFE_DROP' })}>
                        {t('shift.movement.safeDrop', 'Safe drop')}
                      </Button>
                    </>
                  )}
                  <Button size="small" startIcon={<ReceiptLongIcon />} onClick={() => navigate(`/app/cashier/shifts/${shift.id}`)}>
                    {t('shift.card.statement', 'Statement')}
                  </Button>
                  {mayWork && (
                    <Button size="small" color="error" variant="outlined" startIcon={<LockIcon />} onClick={() => setCloseFor(shift)} sx={{ ml: 'auto' }}>
                      {t('shift.close.title', 'Close shift')}
                    </Button>
                  )}
                </Stack>
              </Stack>
            ) : (
              <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">
                  {t('shift.card.noShift', 'No shift open.')}
                </Typography>
                {isThisDevice ? (
                  <Button variant="contained" color="success" startIcon={<LockOpenIcon />} onClick={() => setOpenFor(term)} sx={{ alignSelf: 'flex-start' }}>
                    {t('shift.open.title', 'Open shift')}
                  </Button>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    {t('shift.card.openAtRegister', 'A shift is opened at the register itself, where the float goes into the drawer.')}
                  </Typography>
                )}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Grid>
    );
  };

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('shift.page.title', 'Shifts & drawers')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('shift.page.title', 'Shifts & drawers') },
        ]}
        action={
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={refreshAll}>
            {t('common.refresh', 'Refresh')}
          </Button>
        }
      />

      <Alert severity="info" sx={{ mb: 3 }}>
        {t(
          'shift.page.help',
          'Every register at {{branch}}. A shift belongs to one register and is counted down when it closes. The branch’s day is closed on Business Days once every drawer is counted.',
          { branch: selectedBranch?.name || '' }
        )}
      </Alert>

      {!register.ready && register.checked && (
        <Alert
          severity="warning"
          sx={{ mb: 3 }}
          action={
            <Button color="inherit" size="small" onClick={() => setSetupOpen(true)}>
              {t('shift.device.title', 'Set up this register')}
            </Button>
          }
        >
          {register.mismatch
            ? t('shift.device.mismatch', 'This device is {{register}} at {{branch}}', {
                register: `${register.terminal?.name} (${register.terminal?.code})`,
                branch: register.terminalBranchName || '',
              })
            : t('shift.device.notSetUp', 'This device is not set up as a register')}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading && terminals.length === 0 ? (
        <Stack sx={{ alignItems: 'center', py: 8 }}>
          <CircularProgress />
        </Stack>
      ) : (
        <>
          <Typography variant="h6" sx={{ mb: 1.5 }}>
            {t('shift.page.registers', 'Registers')}
          </Typography>
          {terminals.length === 0 ? (
            <Alert severity="warning" sx={{ mb: 3 }}>
              {t('shift.device.none', 'This branch has no active cash registers. A manager can add one under Terminals.')}
            </Alert>
          ) : (
            <Grid container spacing={2} sx={{ mb: 4 }}>
              {terminals.map(renderCard)}
            </Grid>
          )}

          <Typography variant="h6" sx={{ mb: 1.5 }}>
            {t('shift.history.title', 'Closed shifts')}
          </Typography>
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('shift.history.shift', 'Shift')}</TableCell>
                    <TableCell>{t('shift.register', 'Register')}</TableCell>
                    <TableCell>{t('cashier.businessDate', 'Business Date')}</TableCell>
                    <TableCell>{t('shift.history.hours', 'Open – closed')}</TableCell>
                    <TableCell align="right">{t('shift.close.countedLabel', 'Counted')}</TableCell>
                    <TableCell align="right">{t('shift.close.variance', 'Over / short')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {history.map((s) => {
                    const variance = s.short_over ?? s.over_short_amount ?? '0';
                    return (
                      <TableRow key={s.id} hover sx={{ cursor: 'pointer' }} onClick={() => navigate(`/app/cashier/shifts/${s.id}`)}>
                        <TableCell dir="ltr">#{s.shift_number}</TableCell>
                        <TableCell>{registerName(s.terminal_id)}</TableCell>
                        <TableCell dir="ltr">{fDate(s.business_date)}</TableCell>
                        <TableCell dir="ltr">
                          {time(s.opened_at)} – {time(s.closed_at)}
                        </TableCell>
                        <TableCell align="right" dir="ltr">
                          {MoneyUtil.formatCurrency(s.actual_cash)}
                        </TableCell>
                        <TableCell align="right" dir="ltr" sx={{ color: MoneyUtil.isZero(variance) ? 'inherit' : 'error.main' }}>
                          {MoneyUtil.formatCurrency(variance)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {history.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                        {t('shift.history.empty', 'No shift has been closed at this branch yet.')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </>
      )}

      {openFor && register.terminal && (
        <OpenShiftDialog
          open
          onClose={() => setOpenFor(null)}
          terminal={register.terminal}
          branchName={register.terminalBranchName}
          defaultFloat={register.defaultFloat}
          onOpened={refreshAll}
        />
      )}

      {closeFor && (
        <CloseShiftDialog
          open
          onClose={() => setCloseFor(null)}
          shiftId={closeFor.id}
          shiftNumber={closeFor.shift_number}
          onClosed={refreshAll}
        />
      )}

      {movement && (
        <MovementDialog open onClose={() => setMovement(null)} shiftId={movement.shiftId} type={movement.type} onPosted={load} />
      )}

      <DeviceTerminalDialog
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        branchId={register.branchId}
        branchName={register.branchName}
        current={register.terminal}
        onAssigned={register.setTerminal}
      />
    </Box>
  );
}
