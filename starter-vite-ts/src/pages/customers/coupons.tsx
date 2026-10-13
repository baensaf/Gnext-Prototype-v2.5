import type { Product } from 'src/api/catalogApi';
import type { CouponCode, CouponBatch, CouponReward } from 'src/api/couponsApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  Box,
  Card,
  Chip,
  Grid,
  Table,
  Paper,
  Alert,
  Stack,
  Button,
  Dialog,
  Switch,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  DialogTitle,
  Autocomplete,
  ToggleButton,
  DialogContent,
  DialogActions,
  TableContainer,
  InputAdornment,
  ToggleButtonGroup,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { fDate, fDateTime } from 'src/utils/format-time';
import { fromToman, useCurrencyLabel } from 'src/utils/currency';

import { catalogApi } from 'src/api/catalogApi';
import { couponsApi } from 'src/api/couponsApi';

import { toast } from 'src/components/snackbar';
import { CalendarDateField } from 'src/components/calendar-date-field';

const EMPTY = {
  name: '',
  reward_type: 'PERCENT' as CouponReward,
  percent: '20',
  max_discount: '',
  reward_product_id: '',
  min_subtotal: '',
  valid_from: '',
  valid_to: '',
  count: '100',
};

/**
 * One-time coupons (V2): head office makes a batch of codes for a campaign (an SMS to the
 * club, say). Each code works once at the till, for a percent off the order or one free
 * item, and is the order's one order discount. A cancelled order gives its code back.
 */
export function CouponsPage() {
  const { t } = useTranslation();
  const currency = useCurrencyLabel();

  const [batches, setBatches] = useState<CouponBatch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<{ batch: CouponBatch; codes: CouponCode[] } | null>(null);

  const load = useCallback(async () => {
    try {
      setBatches(await couponsApi.getBatches());
    } catch (err: any) {
      setError(err.detail || t('coupons.errors.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    load();
    catalogApi
      .getProducts()
      .then((list) => setProducts(list.filter((p) => p.is_active !== false)))
      .catch(() => setProducts([]));
  }, [load]);

  const productName = (id?: string | null) => products.find((p) => p.id === id)?.name || '—';
  const money = (rials?: string | null) => `${MoneyUtil.formatCurrency(rials || '0')} ${currency}`;

  const rewardText = (b: CouponBatch) =>
    b.reward_type === 'PERCENT'
      ? [
          t('coupons.percentOff', { pct: Number(b.percent) }),
          b.max_discount ? t('coupons.upTo', { amount: money(b.max_discount) }) : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : t('coupons.freeItem', { item: productName(b.reward_product_id) });

  const daysText = (b: CouponBatch) =>
    b.valid_from || b.valid_to
      ? `${b.valid_from ? fDate(b.valid_from) : '…'} – ${b.valid_to ? fDate(b.valid_to) : '…'}`
      : t('coupons.anyDay');

  const create = async () => {
    setSaving(true);
    try {
      const batch = await couponsApi.createBatch({
        name: form.name.trim(),
        reward_type: form.reward_type,
        percent: form.reward_type === 'PERCENT' ? form.percent : null,
        max_discount: form.reward_type === 'PERCENT' && form.max_discount ? fromToman(form.max_discount) : null,
        reward_product_id: form.reward_type === 'FREE_ITEM' ? form.reward_product_id : null,
        min_subtotal: form.min_subtotal ? fromToman(form.min_subtotal) : null,
        valid_from: form.valid_from || null,
        valid_to: form.valid_to || null,
        count: Number(form.count),
      });
      setCreating(false);
      setForm(EMPTY);
      await load();
      setViewing(await couponsApi.getCodes(batch.id));
    } catch (err: any) {
      setError(err.detail || t('coupons.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (b: CouponBatch) => {
    try {
      await couponsApi.setActive(b.id, !b.is_active);
      await load();
    } catch (err: any) {
      setError(err.detail || t('coupons.errors.saveFailed'));
    }
  };

  // The unused codes, one per line: what goes into the SMS tool.
  const unused = (viewing?.codes || []).filter((c) => !c.used_at).map((c) => c.code);
  const copyUnused = async () => {
    try {
      await navigator.clipboard.writeText(unused.join('\n'));
      toast.success(t('coupons.copied', { count: unused.length }));
    } catch {
      toast.error(t('coupons.errors.copyFailed'));
    }
  };
  const downloadCsv = () => {
    if (!viewing) return;
    const lines = ['code,used_at,order', ...viewing.codes.map((c) => `${c.code},${c.used_at || ''},${c.used_order_number || ''}`)];
    const url = URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${viewing.batch.name.replace(/[^\p{L}\p{N}]+/gu, '-')}-codes.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const canSave =
    !!form.name.trim() &&
    Number(form.count) >= 1 &&
    Number(form.count) <= 5000 &&
    (form.reward_type === 'PERCENT' ? Number(form.percent) > 0 && Number(form.percent) <= 100 : !!form.reward_product_id);

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('coupons.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('coupons.subtitle')}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)} sx={{ fontWeight: 'bold' }}>
          {t('coupons.newBatch')}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card>
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('coupons.batch')}</TableCell>
                <TableCell>{t('coupons.reward')}</TableCell>
                <TableCell>{t('coupons.minimum')}</TableCell>
                <TableCell>{t('coupons.days')}</TableCell>
                <TableCell align="center">{t('coupons.used')}</TableCell>
                <TableCell align="center">{t('coupons.on')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {batches.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                    {t('coupons.empty')}
                  </TableCell>
                </TableRow>
              )}
              {batches.map((b) => (
                <TableRow key={b.id} hover sx={{ cursor: 'pointer' }} onClick={async () => setViewing(await couponsApi.getCodes(b.id))}>
                  <TableCell>
                    <Typography variant="subtitle2">{b.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {fDate(b.created_at)}
                    </Typography>
                  </TableCell>
                  <TableCell>{rewardText(b)}</TableCell>
                  <TableCell>{b.min_subtotal ? money(b.min_subtotal) : '—'}</TableCell>
                  <TableCell>{daysText(b)}</TableCell>
                  <TableCell align="center">
                    <Chip size="small" label={`${b.used_count} / ${b.code_count}`} color={b.used_count > 0 ? 'secondary' : 'default'} variant="outlined" />
                  </TableCell>
                  <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                    <Switch checked={b.is_active} onChange={() => toggle(b)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* A new batch: what each code gives, when, and how many codes. */}
      <Dialog open={creating} onClose={() => setCreating(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>{t('coupons.newBatch')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <TextField
              label={t('coupons.batchName')}
              placeholder={t('coupons.batchNamePlaceholder')}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
            />
            <ToggleButtonGroup
              exclusive
              size="small"
              value={form.reward_type}
              onChange={(_e, value) => value && setForm({ ...form, reward_type: value })}
            >
              <ToggleButton value="PERCENT">{t('coupons.rewardPercent')}</ToggleButton>
              <ToggleButton value="FREE_ITEM">{t('coupons.rewardFreeItem')}</ToggleButton>
            </ToggleButtonGroup>
            {form.reward_type === 'PERCENT' ? (
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label={t('coupons.percent')}
                    value={form.percent}
                    onChange={(e) => setForm({ ...form, percent: e.target.value.replace(/[^0-9.]/g, '') })}
                    slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }}
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    label={t('coupons.maxDiscount', { currency })}
                    helperText={t('coupons.optional')}
                    value={form.max_discount}
                    onChange={(e) => setForm({ ...form, max_discount: e.target.value.replace(/\D/g, '') })}
                  />
                </Grid>
              </Grid>
            ) : (
              <Autocomplete
                options={products}
                getOptionLabel={(p) => p.name}
                value={products.find((p) => p.id === form.reward_product_id) || null}
                onChange={(_e, p) => setForm({ ...form, reward_product_id: p?.id || '' })}
                renderInput={(params) => (
                  <TextField {...params} label={t('coupons.freeProduct')} helperText={t('coupons.freeProductHelp')} />
                )}
              />
            )}
            <TextField
              label={t('coupons.minSubtotal', { currency })}
              helperText={t('coupons.optional')}
              value={form.min_subtotal}
              onChange={(e) => setForm({ ...form, min_subtotal: e.target.value.replace(/\D/g, '') })}
            />
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <CalendarDateField
                  fullWidth
                  label={t('coupons.validFrom')}
                  value={form.valid_from}
                  onChange={(e) => setForm({ ...form, valid_from: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <CalendarDateField
                  fullWidth
                  label={t('coupons.validTo')}
                  value={form.valid_to}
                  onChange={(e) => setForm({ ...form, valid_to: e.target.value })}
                />
              </Grid>
            </Grid>
            <TextField
              label={t('coupons.count')}
              helperText={t('coupons.countHelp')}
              value={form.count}
              onChange={(e) => setForm({ ...form, count: e.target.value.replace(/\D/g, '') })}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreating(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" disabled={!canSave || saving} onClick={create}>
            {t('coupons.make', { count: Number(form.count) || 0 })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* One batch's codes: copy the unused ones for the SMS, or download them all. */}
      <Dialog open={!!viewing} onClose={() => setViewing(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {viewing?.batch.name}
          <Typography variant="body2" color="text.secondary">
            {viewing && rewardText(viewing.batch)} · {viewing && daysText(viewing.batch)}
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <Button size="small" variant="outlined" startIcon={<ContentCopyIcon />} disabled={unused.length === 0} onClick={copyUnused}>
              {t('coupons.copyUnused', { count: unused.length })}
            </Button>
            <Button size="small" variant="outlined" startIcon={<DownloadIcon />} onClick={downloadCsv}>
              {t('coupons.downloadCsv')}
            </Button>
          </Stack>
          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 380 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>{t('coupons.code')}</TableCell>
                  <TableCell>{t('coupons.usedOn')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(viewing?.codes || []).map((c) => (
                  <TableRow key={c.code}>
                    <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600, letterSpacing: 1 }} dir="ltr">
                      {c.code}
                    </TableCell>
                    <TableCell>
                      {c.used_at ? (
                        <Typography variant="body2">
                          {fDateTime(c.used_at)} · #{c.used_order_number}
                          {c.used_branch_name ? ` · ${c.used_branch_name}` : ''}
                        </Typography>
                      ) : (
                        <Typography variant="body2" color="text.disabled">
                          {t('coupons.notUsed')}
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewing(null)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

