import type { Terminal } from 'src/api/tenantApi';
import type { CashierShift } from 'src/api/shiftApi';

import { useNavigate } from 'react-router';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import CloseIcon from '@mui/icons-material/Close';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import {
  Box,
  Chip,
  List,
  Alert,
  Stack,
  Drawer,
  Divider,
  IconButton,
  Typography,
  ListItemButton,
  CircularProgress,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { fDate , fTime } from 'src/utils/format-time';

import { shiftApi } from 'src/api/shiftApi';
import { tenantApi } from 'src/api/tenantApi';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  branchId: string | null;
  branchName?: string;
  businessDate: string;
};

const stateColor = (state?: string) => (state === 'OPEN' ? 'success' : state === 'CLOSING_REVIEW' ? 'warning' : 'default');

/**
 * One branch's drawers, as head office sees them from the roll-up: every shift on the day,
 * and any left open from an earlier one. Read-only — each row opens the shift's statement,
 * and nothing here opens, pays into or closes a till. That stays with the branch.
 */
export function BranchShiftsDrawer({ open, onClose, branchId, branchName, businessDate }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [dayShifts, setDayShifts] = useState<CashierShift[]>([]);
  const [staleShifts, setStaleShifts] = useState<CashierShift[]>([]);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !branchId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      shiftApi.getShifts({ branch: branchId, businessDate, limit: 100 }),
      shiftApi.getShifts({ branch: branchId, state: 'OPEN', limit: 100 }),
      tenantApi.getTerminals(branchId),
    ])
      .then(([day, stillOpen, terms]) => {
        setDayShifts(day.data);
        setStaleShifts(stillOpen.data.filter((s) => s.business_date < businessDate));
        setTerminals(terms);
      })
      .catch((err: any) => setError(err.detail || err.message))
      .finally(() => setLoading(false));
  }, [open, branchId, businessDate]);

  const registerName = (id: string) => {
    const term = terminals.find((x) => x.id === id);
    return term ? `${term.name} (${term.code})` : id.slice(0, 8);
  };

  const renderShift = (s: CashierShift) => {
    const counted = s.state === 'CLOSED' && s.actual_cash !== null && s.actual_cash !== undefined;
    const variance = s.short_over ?? s.over_short_amount ?? '0';
    return (
      <ListItemButton
        key={s.id}
        divider
        onClick={() => navigate(`/app/cashier/shifts/${s.id}?from=rollup`)}
        sx={{ alignItems: 'flex-start', gap: 1 }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
            <Typography variant="subtitle2" dir="ltr">
              #{s.shift_number}
            </Typography>
            <Chip size="small" label={s.state} color={stateColor(s.state) as any} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {registerName(s.terminal_id)} · {fDate(s.business_date)}
          </Typography>
          <Typography variant="caption" color="text.secondary" dir="ltr">
            {fTime(s.opened_at)}
            {s.closed_at && ` – ${fTime(s.closed_at)}`}
          </Typography>
        </Box>
        {counted && (
          <Box sx={{ textAlign: 'end' }}>
            <Typography variant="caption" color="text.secondary">
              {t('rollup.shifts.variance', 'Net over / short')}
            </Typography>
            <Typography
              variant="subtitle2"
              sx={{ color: MoneyUtil.isZero(variance) ? 'text.primary' : 'error.main' }}
              dir="ltr"
            >
              {MoneyUtil.formatCurrency(variance)}
            </Typography>
          </Box>
        )}
        <ChevronRightIcon color="action" sx={{ alignSelf: 'center' }} />
      </ListItemButton>
    );
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 440 } } } }}>
      <Stack direction="row" sx={{ alignItems: 'center', p: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h6">{branchName}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('rollup.shifts.drawerSubtitle', 'Drawers on {{date}} · read-only', { date: fDate(businessDate) })}
          </Typography>
        </Box>
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Stack>
      <Divider />

      {loading ? (
        <Stack sx={{ alignItems: 'center', py: 6 }}>
          <CircularProgress />
        </Stack>
      ) : (
        <Box sx={{ overflowY: 'auto' }}>
          {error && (
            <Alert severity="error" sx={{ m: 2 }}>
              {error}
            </Alert>
          )}

          {staleShifts.length > 0 && (
            <>
              <Alert severity="warning" sx={{ m: 2, mb: 0 }}>
                {t('rollup.shifts.staleOpen', 'Left open from an earlier day')}
              </Alert>
              <List disablePadding>{staleShifts.map(renderShift)}</List>
            </>
          )}

          <List disablePadding>{dayShifts.map(renderShift)}</List>

          {!error && dayShifts.length === 0 && staleShifts.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
              {t('rollup.shifts.noShiftsThatDay', 'No drawer was opened at this branch on this day.')}
            </Typography>
          )}
        </Box>
      )}
    </Drawer>
  );
}
