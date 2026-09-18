import type { Category, PriceList, PriceChange, PriceChangeInput, PriceChangePreview } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import {
  Box,
  Card,
  Chip,
  Stack,
  Alert,
  Table,
  Button,
  Select,
  MenuItem,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  InputLabel,
  CardContent,
  FormControl,
  ToggleButton,
  TableContainer,
  InputAdornment,
  ToggleButtonGroup,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { fDate, fDateTime } from 'src/utils/format-time';

import { catalogApi } from 'src/api/catalogApi';

import { ConfirmDialog } from 'src/components/confirm-dialog';
import { CalendarDateField } from 'src/components/calendar-date-field';

const BASE = '';
const ALL = '';

const STATUS_COLOR = { SCHEDULED: 'info', APPLIED: 'success', CANCELLED: 'default' } as const;

/**
 * Dated price changes: raise or lower base prices, or one list's prices, by a percentage or an
 * amount, from today or a later day. The change is previewed item by item before it is saved,
 * and one that has not started can be called off.
 */
export function PriceChangesPage() {
  const { t } = useTranslation();
  const [lists, setLists] = useState<PriceList[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [changes, setChanges] = useState<PriceChange[]>([]);
  const [listId, setListId] = useState(BASE);
  const [categoryId, setCategoryId] = useState(ALL);
  const [adjustment, setAdjustment] = useState<'PERCENT' | 'AMOUNT'>('PERCENT');
  const [value, setValue] = useState('');
  const [roundTo, setRoundTo] = useState('0');
  const [date, setDate] = useState('');
  const [preview, setPreview] = useState<PriceChangePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<PriceChange | null>(null);

  const fail = useCallback((err: any, fallback: string) => setError(err?.detail || err?.message || fallback), []);

  const loadChanges = useCallback(
    () =>
      catalogApi
        .getPriceChanges()
        .then(setChanges)
        .catch((err) => fail(err, t('pricing.changes.loadFailed'))),
    [fail, t]
  );

  useEffect(() => {
    Promise.all([catalogApi.getPriceLists(), catalogApi.getCategories()])
      .then(([ls, cs]) => {
        setLists(ls);
        setCategories(cs);
      })
      .catch((err) => fail(err, t('pricing.changes.loadFailed')));
    loadChanges();
  }, [fail, loadChanges, t]);

  // Any edit to the form makes the preview stale.
  useEffect(() => setPreview(null), [listId, categoryId, adjustment, value, roundTo, date]);

  const input = (): PriceChangeInput => ({
    price_list_id: listId || null,
    category_id: categoryId || null,
    adjustment,
    value: value.trim(),
    round_to: Number(roundTo) || 0,
    effective_date: date || null,
  });

  const runPreview = async () => {
    setBusy(true);
    try {
      setPreview(await catalogApi.previewPriceChange(input()));
    } catch (err: any) {
      fail(err, t('pricing.changes.previewFailed'));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    try {
      const saved = await catalogApi.commitPriceChange(input());
      setNotice(
        saved.status === 'SCHEDULED'
          ? t('pricing.changes.scheduled', { count: saved.items, date: fDate(saved.effective_from) })
          : t('pricing.changes.applied', { count: saved.items })
      );
      setPreview(null);
      setValue('');
      await loadChanges();
    } catch (err: any) {
      fail(err, t('pricing.changes.saveFailed'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!cancelling) return;
    try {
      await catalogApi.cancelPriceChange(cancelling.id);
      setNotice(t('pricing.changes.cancelled'));
      setCancelling(null);
      await loadChanges();
    } catch (err: any) {
      fail(err, t('pricing.changes.saveFailed'));
    }
  };

  const describe = (c: PriceChange) => {
    const amount = c.adjustment === 'PERCENT' ? `${Number(c.value) > 0 ? '+' : ''}${Number(c.value)}%` : `${Number(c.value) > 0 ? '+' : ''}${MoneyUtil.formatCurrency(c.value)}`;
    const category = c.category_id ? categories.find((x) => x.id === c.category_id)?.name : null;
    return [amount, category || t('pricing.changes.allCategories')].join(' · ');
  };

  const valid = value.trim() !== '' && Number.isFinite(Number(value));
  const changedRows = (preview?.items || []).filter((i) => i.current !== i.new);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
        {t('pricing.changes.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('pricing.changes.subtitle')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('pricing.changes.newChange')}
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel shrink>{t('pricing.changes.prices')}</InputLabel>
              <Select value={listId} displayEmpty label={t('pricing.changes.prices')} onChange={(e) => setListId(e.target.value)}>
                <MenuItem value={BASE}>{t('pricing.changes.basePrices')}</MenuItem>
                {lists.map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    {t('pricing.changes.listPrices', { name: l.name })}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel shrink>{t('pricing.changes.category')}</InputLabel>
              <Select value={categoryId} displayEmpty label={t('pricing.changes.category')} onChange={(e) => setCategoryId(e.target.value)}>
                <MenuItem value={ALL}>{t('pricing.changes.allCategories')}</MenuItem>
                {categories.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <CalendarDateField
              size="small"
              label={t('pricing.changes.from')}
              value={date}
              onChange={(e) => setDate(e.target.value)}
              helperText={t('pricing.changes.fromHelp')}
            />
          </Stack>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: { md: 'flex-start' } }}>
            <ToggleButtonGroup size="small" exclusive value={adjustment} onChange={(_, next) => next && setAdjustment(next)}>
              <ToggleButton value="PERCENT">{t('pricing.changes.byPercent')}</ToggleButton>
              <ToggleButton value="AMOUNT">{t('pricing.changes.byAmount')}</ToggleButton>
            </ToggleButtonGroup>
            <TextField
              size="small"
              type="number"
              label={t('pricing.changes.change')}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              helperText={t('pricing.changes.changeHelp')}
              slotProps={{ input: { endAdornment: <InputAdornment position="end">{adjustment === 'PERCENT' ? '%' : t('pricing.changes.rial')}</InputAdornment> } }}
            />
            <TextField
              size="small"
              type="number"
              label={t('pricing.changes.roundTo')}
              value={roundTo}
              onChange={(e) => setRoundTo(e.target.value)}
              helperText={t('pricing.changes.roundToHelp')}
            />
            <Button variant="outlined" disabled={!valid || busy} onClick={runPreview}>
              {t('pricing.changes.preview')}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      {preview && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ mb: 2, justifyContent: 'space-between', alignItems: { sm: 'center' }, gap: 1 }}>
              <Typography variant="subtitle1">
                {t('pricing.changes.previewSummary', { count: changedRows.length, date: fDateTime(preview.effective_from) })}
              </Typography>
              <Button variant="contained" disabled={busy || changedRows.length === 0} onClick={commit}>
                {date ? t('pricing.changes.schedule') : t('pricing.changes.applyNow')}
              </Button>
            </Stack>
            {preview.items.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {preview.price_list ? t('pricing.changes.emptyList') : t('pricing.changes.empty')}
              </Typography>
            ) : (
              <TableContainer sx={{ maxHeight: 420 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('pricing.changes.item')}</TableCell>
                      <TableCell align="right">{t('pricing.changes.current')}</TableCell>
                      <TableCell align="right">{t('pricing.changes.new')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {preview.items.map((i) => (
                      <TableRow key={`${i.product_id}:${i.variant_id || ''}`} sx={{ opacity: i.current === i.new ? 0.5 : 1 }}>
                        <TableCell>{i.name}</TableCell>
                        <TableCell align="right">{MoneyUtil.formatCurrency(i.current)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                          {MoneyUtil.formatCurrency(i.new)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      )}

      <Typography variant="h6" sx={{ mb: 1 }}>
        {t('pricing.changes.history')}
      </Typography>
      {changes.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('pricing.changes.none')}
        </Typography>
      ) : (
        <TableContainer component={Card}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('pricing.changes.from')}</TableCell>
                <TableCell>{t('pricing.changes.prices')}</TableCell>
                <TableCell>{t('pricing.changes.change')}</TableCell>
                <TableCell align="right">{t('pricing.changes.items')}</TableCell>
                <TableCell>{t('pricing.changes.status')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {changes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{fDateTime(c.effective_from)}</TableCell>
                  <TableCell>{c.price_list ? t('pricing.changes.listPrices', { name: c.price_list.name || '—' }) : t('pricing.changes.basePrices')}</TableCell>
                  <TableCell>{describe(c)}</TableCell>
                  <TableCell align="right">{c.items}</TableCell>
                  <TableCell>
                    <Chip size="small" color={STATUS_COLOR[c.status]} label={t(`pricing.changes.statuses.${c.status}`)} />
                  </TableCell>
                  <TableCell align="right">
                    {c.can_cancel && (
                      <Button size="small" color="error" onClick={() => setCancelling(c)}>
                        {t('pricing.changes.cancel')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <ConfirmDialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        onConfirm={cancel}
        title={t('pricing.changes.cancelTitle')}
        content={t('pricing.changes.cancelBody')}
        confirmLabel={t('pricing.changes.cancel')}
      />
    </Box>
  );
}
