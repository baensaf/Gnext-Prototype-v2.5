import type { Product } from 'src/api/catalogApi';
import type { ItemDiscount } from 'src/api/discountsApi';

import { useTranslation } from 'react-i18next';
import React, { useMemo, useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Box,
  Card,
  Chip,
  Table,
  Paper,
  Alert,
  Stack,
  Button,
  Dialog,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  DialogTitle,
  Autocomplete,
  DialogContent,
  DialogActions,
  InputAdornment,
  TableContainer,
} from '@mui/material';

import { fDate } from 'src/utils/format-time';

import { catalogApi } from 'src/api/catalogApi';
import { discountsApi } from 'src/api/discountsApi';
import { useIsHeadOffice } from 'src/store/useAuthStore';

import { ConfirmDialog } from 'src/components/confirm-dialog';
import { CalendarDateField } from 'src/components/calendar-date-field';

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type Draft = { id?: string; product_id: string; percent: string; starts_on: string; ends_on: string; note: string };

const emptyDraft = (): Draft => ({ product_id: '', percent: '', starts_on: localToday(), ends_on: '', note: '' });

/**
 * Automatic item discounts (V1): a dated percent off one item, taken off every till line of it
 * at every branch, before the order's own discount. Head office sets them; branches see them.
 */
export function ItemDiscountsPage() {
  const { t } = useTranslation();
  const isHeadOffice = useIsHeadOffice();

  const [rows, setRows] = useState<ItemDiscount[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<ItemDiscount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await discountsApi.getItemDiscounts());
    } catch (err: any) {
      setError(err.detail || t('pricing.itemDiscounts.errors.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    load();
    catalogApi
      .getProducts()
      .then((list) => setProducts(list.filter((p) => p.is_active !== false)))
      .catch(() => setProducts([]));
  }, [load]);

  const today = localToday();
  const statusOf = (r: ItemDiscount) =>
    r.starts_on > today ? 'scheduled' : r.ends_on && r.ends_on < today ? 'ended' : 'active';

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const errorText = (err: any) => {
    switch (err?.code) {
      case 'ITEM_DISCOUNT_OVERLAP':
        return t('pricing.itemDiscounts.errors.overlap');
      case 'ITEM_DISCOUNT_PERCENT':
        return t('pricing.itemDiscounts.errors.percent');
      case 'ITEM_DISCOUNT_DATES':
        return t('pricing.itemDiscounts.errors.dates');
      case 'ITEM_DISCOUNT_PRODUCT':
        return t('pricing.itemDiscounts.errors.product');
      default:
        return err?.detail || err?.message || t('pricing.itemDiscounts.errors.saveFailed');
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const body = {
      product_id: draft.product_id,
      percent: draft.percent,
      starts_on: draft.starts_on,
      ends_on: draft.ends_on || null,
      note: draft.note.trim() || null,
    };
    try {
      setSaving(true);
      setFormError(null);
      if (draft.id) await discountsApi.updateItemDiscount(draft.id, body);
      else await discountsApi.createItemDiscount(body);
      setDraft(null);
      await load();
    } catch (err: any) {
      setFormError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await discountsApi.deleteItemDiscount(deleting.id);
      setDeleting(null);
      await load();
    } catch (err: any) {
      setDeleting(null);
      setError(errorText(err));
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('pricing.itemDiscounts.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('pricing.itemDiscounts.subtitle')}
          </Typography>
        </Box>
        {isHeadOffice && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setFormError(null);
              setDraft(emptyDraft());
            }}
            sx={{ fontWeight: 'bold' }}
          >
            {t('pricing.itemDiscounts.add')}
          </Button>
        )}
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
                <TableCell>{t('pricing.itemDiscounts.item')}</TableCell>
                <TableCell align="center">{t('pricing.itemDiscounts.percent')}</TableCell>
                <TableCell>{t('pricing.itemDiscounts.from')}</TableCell>
                <TableCell>{t('pricing.itemDiscounts.to')}</TableCell>
                <TableCell>{t('common.status', 'Status')}</TableCell>
                <TableCell>{t('pricing.itemDiscounts.note')}</TableCell>
                {isHeadOffice && <TableCell align="center" />}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => {
                const status = statusOf(r);
                return (
                  <TableRow key={r.id}>
                    <TableCell sx={{ fontWeight: 600 }}>{r.product_name || '—'}</TableCell>
                    <TableCell align="center">
                      <Chip size="small" color="error" variant="outlined" label={`${Number(r.percent)}%`} />
                    </TableCell>
                    <TableCell>{fDate(r.starts_on)}</TableCell>
                    <TableCell>{r.ends_on ? fDate(r.ends_on) : t('pricing.itemDiscounts.noEnd')}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={status === 'active' ? 'success' : status === 'scheduled' ? 'info' : 'default'}
                        label={t(`pricing.itemDiscounts.status.${status}`)}
                      />
                    </TableCell>
                    <TableCell>{r.note || '—'}</TableCell>
                    {isHeadOffice && (
                      <TableCell align="center" sx={{ whiteSpace: 'nowrap' }}>
                        <IconButton
                          size="small"
                          title={t('pricing.itemDiscounts.edit')}
                          onClick={() => {
                            setFormError(null);
                            setDraft({
                              id: r.id,
                              product_id: r.product_id,
                              percent: String(Number(r.percent)),
                              starts_on: r.starts_on,
                              ends_on: r.ends_on || '',
                              note: r.note || '',
                            });
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" title={t('pricing.itemDiscounts.delete')} onClick={() => setDeleting(r)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    {t('pricing.itemDiscounts.empty')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={!!draft} onClose={() => !saving && setDraft(null)} maxWidth="xs" fullWidth>
        {draft && (
          <form onSubmit={save}>
            <DialogTitle sx={{ fontWeight: 'bold' }}>
              {draft.id ? t('pricing.itemDiscounts.edit') : t('pricing.itemDiscounts.add')}
            </DialogTitle>
            <DialogContent>
              {formError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {formError}
                </Alert>
              )}
              <Stack spacing={2} sx={{ mt: 1 }}>
                <Autocomplete
                  options={products}
                  value={productById.get(draft.product_id) || null}
                  getOptionLabel={(p) => p.name}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  onChange={(_e, p) => setDraft({ ...draft, product_id: p?.id || '' })}
                  renderInput={(params) => <TextField {...params} label={t('pricing.itemDiscounts.item')} required size="small" />}
                />
                <TextField
                  label={t('pricing.itemDiscounts.percent')}
                  type="number"
                  size="small"
                  required
                  value={draft.percent}
                  onChange={(e) => setDraft({ ...draft, percent: e.target.value })}
                  slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> }, htmlInput: { min: 1, max: 100, step: 'any' } }}
                />
                <CalendarDateField
                  label={t('pricing.itemDiscounts.from')}
                  size="small"
                  fullWidth
                  required
                  value={draft.starts_on}
                  onChange={(e) => setDraft({ ...draft, starts_on: e.target.value })}
                />
                <CalendarDateField
                  label={t('pricing.itemDiscounts.toOptional')}
                  size="small"
                  fullWidth
                  value={draft.ends_on}
                  onChange={(e) => setDraft({ ...draft, ends_on: e.target.value })}
                  helperText={t('pricing.itemDiscounts.toHelp')}
                />
                <TextField
                  label={t('pricing.itemDiscounts.note')}
                  size="small"
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                />
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2.5 }}>
              <Button onClick={() => setDraft(null)} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="contained" disabled={saving || !draft.product_id || !draft.percent || !draft.starts_on}>
                {t('common.save')}
              </Button>
            </DialogActions>
          </form>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('pricing.itemDiscounts.delete')}
        content={t('pricing.itemDiscounts.deleteConfirm', { name: deleting?.product_name || '' })}
        action={
          <Button variant="contained" color="error" onClick={confirmDelete}>
            {t('pricing.itemDiscounts.delete')}
          </Button>
        }
      />
    </Box>
  );
}
