import type { CreditMode, CreditAccount } from 'src/api/creditApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import EditIcon from '@mui/icons-material/Edit';
import PaymentsIcon from '@mui/icons-material/Payments';
import {
  Box,
  Card,
  Chip,
  Grid,
  Paper,
  Stack,
  Alert,
  Table,
  Button,
  Select,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  InputLabel,
  Typography,
  CardContent,
  FormControl,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';
import { toToman, fromToman, useCurrencyLabel } from 'src/utils/currency';

import { creditApi } from 'src/api/creditApi';

const MODES: CreditMode[] = ['FINITE', 'UNLIMITED', 'POLICY'];

/** A negative balance is what the customer owes. */
const owedBy = (acc?: CreditAccount | null) =>
  acc && MoneyUtil.lessThan(acc.current_balance, '0') ? MoneyUtil.abs(acc.current_balance) : '0';

type Panel = 'none' | 'repay' | 'limit';

interface CustomerCreditPanelProps {
  customerId: string;
  /** The customer's credit account, if they have one; giving credit opens it. */
  accountId?: string | null;
  /** After a repayment or a new limit, so the list and the drawer show the new figures. */
  onChanged: () => void;
}

/**
 * Everything about one customer's credit, on the Credit tab of their drawer: what they owe,
 * the limit and what is left, the transactions, and the two things head office does to it —
 * record a repayment, and give or change the limit. Credit had its own page until 2026-10-12
 * and a dialog of its own until 2026-10-14.
 */
export function CustomerCreditPanel({
  customerId,
  accountId,
  onChanged,
}: CustomerCreditPanelProps) {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();

  const [account, setAccount] = useState<CreditAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('none');
  const [saving, setSaving] = useState(false);

  const [repayAmount, setRepayAmount] = useState('0');
  const [repayReference, setRepayReference] = useState('');
  const [repayNote, setRepayNote] = useState('');

  const [limitMode, setLimitMode] = useState<CreditMode>('FINITE');
  const [limitValue, setLimitValue] = useState('0');
  const [limitNote, setLimitNote] = useState('');

  const load = useCallback(async () => {
    if (!accountId) {
      setAccount(null);
      return;
    }
    setLoading(true);
    try {
      setAccount(await creditApi.getAccountById(accountId));
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('customers.directory.errors.creditFailed'));
    } finally {
      setLoading(false);
    }
  }, [accountId, t]);

  useEffect(() => {
    setPanel('none');
    setError(null);
    load();
  }, [load]);

  const owed = owedBy(account);
  // A customer signed up at a branch has an account at zero: that is giving credit, not changing it.
  const hasCredit =
    !!account &&
    (account.mode === 'UNLIMITED' || MoneyUtil.greaterThan(account.credit_limit || '0', '0'));

  const openRepay = () => {
    setRepayAmount(owed);
    setRepayReference('');
    setRepayNote('');
    setPanel('repay');
  };

  const openLimit = () => {
    setLimitMode(account?.mode || 'FINITE');
    setLimitValue(hasCredit ? account?.credit_limit || '0' : '10000000');
    setLimitNote(account?.policy_note || '');
    setPanel('limit');
  };

  const run = async (action: () => Promise<unknown>, failed: string) => {
    setSaving(true);
    try {
      await action();
      setPanel('none');
      await load();
      onChanged();
    } catch (err: any) {
      setError(err.detail || err.message || failed);
    } finally {
      setSaving(false);
    }
  };

  const saveRepayment = () =>
    run(
      () =>
        creditApi.postRepayment(account!.id, {
          amount: repayAmount,
          reference: repayReference || undefined,
          reason: repayNote || undefined,
        }),
      t('credit.repayDialog.error')
    );

  const saveLimit = () =>
    run(
      () =>
        account
          ? creditApi.updateAccount(account.id, {
              mode: limitMode,
              creditLimit: limitMode === 'UNLIMITED' ? undefined : limitValue,
              policyNote: limitNote,
            })
          : creditApi.createAccount(customerId, {
              mode: limitMode,
              creditLimit: limitMode === 'UNLIMITED' ? undefined : limitValue,
              policyNote: limitNote || undefined,
            }),
      t('credit.limitDialog.error')
    );

  const money = (rials: string) => `${MoneyUtil.formatCurrency(rials)} ${currency}`;

  const figure = (label: string, value: string, color: string) => (
    <Grid size={{ xs: 12, sm: 4 }}>
      <Card variant="outlined" sx={{ borderRadius: 2 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {label}
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 'bold', color, mt: 0.5 }}>
            {value}
          </Typography>
        </CardContent>
      </Card>
    </Grid>
  );

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {hasCredit ? (
            <Grid container spacing={2} sx={{ mb: 2 }}>
              {figure(
                t('customers.directory.credit.owed'),
                money(owed),
                MoneyUtil.greaterThan(owed, '0') ? 'error.main' : 'text.primary'
              )}
              {figure(
                t('customers.creditLimit'),
                account!.mode === 'UNLIMITED'
                  ? t('credit.mode.unlimited')
                  : money(account!.credit_limit || '0'),
                'text.primary'
              )}
              {figure(
                t('customers.directory.credit.spendable'),
                account!.mode === 'UNLIMITED' ? '∞' : money(account!.availableCredit || '0'),
                'primary.main'
              )}
            </Grid>
          ) : (
            <Alert severity="info" sx={{ mb: 2 }}>
              {MoneyUtil.greaterThan(owed, '0')
                ? t('customers.creditDialog.noLimitButOwes', { amount: money(owed) })
                : t('customers.creditDialog.noCredit')}
            </Alert>
          )}

          {/* The two things head office does to an account, in place. */}
          {panel === 'none' && (
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
              {MoneyUtil.greaterThan(owed, '0') && (
                <Button
                  variant="contained"
                  color="success"
                  startIcon={<PaymentsIcon />}
                  onClick={openRepay}
                >
                  {t('credit.repayment')}
                </Button>
              )}
              <Button variant="outlined" startIcon={<EditIcon />} onClick={openLimit}>
                {hasCredit ? t('credit.editLimit') : t('customers.creditDialog.giveCredit')}
              </Button>
            </Stack>
          )}

          {panel === 'repay' && (
            <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
              <Stack spacing={2}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                  {t('credit.repayDialog.title')}
                </Typography>
                <TextField
                  size="small"
                  autoFocus
                  label={t('credit.repayDialog.amount', { currency })}
                  type="number"
                  value={toToman(repayAmount)}
                  onChange={(e) => setRepayAmount(fromToman(e.target.value))}
                  helperText={`${t('credit.repayDialog.owed')}: ${money(owed)}`}
                />
                <TextField
                  size="small"
                  label={t('credit.repayDialog.reference')}
                  value={repayReference}
                  onChange={(e) => setRepayReference(e.target.value)}
                />
                <TextField
                  size="small"
                  label={t('credit.repayDialog.note')}
                  value={repayNote}
                  onChange={(e) => setRepayNote(e.target.value)}
                />
                <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                  <Button onClick={() => setPanel('none')}>{t('credit.cancel')}</Button>
                  <Button
                    variant="contained"
                    color="success"
                    disabled={saving || !MoneyUtil.greaterThan(repayAmount || '0', '0')}
                    onClick={saveRepayment}
                  >
                    {t('credit.repayDialog.confirm')}
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          )}

          {panel === 'limit' && (
            <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
              <Stack spacing={2}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                  {hasCredit
                    ? t('credit.limitDialog.title')
                    : t('customers.creditDialog.giveCredit')}
                </Typography>
                <FormControl size="small">
                  <InputLabel>{t('credit.table.mode')}</InputLabel>
                  <Select
                    value={limitMode}
                    label={t('credit.table.mode')}
                    onChange={(e) => setLimitMode(e.target.value as CreditMode)}
                  >
                    {MODES.map((mode) => (
                      <MenuItem key={mode} value={mode}>
                        {t(`credit.mode.${mode.toLowerCase()}`)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {limitMode !== 'UNLIMITED' && (
                  <TextField
                    size="small"
                    autoFocus
                    label={t('credit.limitDialog.limit', { currency })}
                    type="number"
                    value={toToman(limitValue)}
                    onChange={(e) => setLimitValue(fromToman(e.target.value))}
                  />
                )}
                <TextField
                  size="small"
                  label={t('credit.policyNote')}
                  value={limitNote}
                  onChange={(e) => setLimitNote(e.target.value)}
                />
                <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                  <Button onClick={() => setPanel('none')}>{t('credit.cancel')}</Button>
                  <Button variant="contained" disabled={saving} onClick={saveLimit}>
                    {t('credit.limitDialog.confirm')}
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          )}

          {account && (
            <>
              <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                {t('customers.directory.credit.history')}
              </Typography>
              <TableContainer
                component={Paper}
                variant="outlined"
                sx={{ borderRadius: 2, maxHeight: 280 }}
              >
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('customers.directory.credit.date')}</TableCell>
                      <TableCell>{t('customers.directory.credit.type')}</TableCell>
                      <TableCell align="right">
                        {t('customers.directory.credit.amount')} ({currency})
                      </TableCell>
                      <TableCell>{t('customers.directory.credit.note')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(account.entries ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={4}
                          align="center"
                          sx={{ py: 3, color: 'text.secondary' }}
                        >
                          {t('credit.transactionsModal.empty')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      (account.entries ?? []).map((tx) => (
                        <TableRow key={tx.id}>
                          <TableCell>{fDateTime(tx.posted_at)}</TableCell>
                          <TableCell>
                            <Chip
                              label={t(`credit.types.${tx.entry_type}`, tx.entry_type)}
                              size="small"
                              color={MoneyUtil.greaterThan(tx.amount, '0') ? 'success' : 'warning'}
                            />
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                            {MoneyUtil.formatCurrency(tx.amount)}
                          </TableCell>
                          <TableCell>{tx.reason_text || tx.reference || '—'}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </>
      )}
    </Box>
  );
}
