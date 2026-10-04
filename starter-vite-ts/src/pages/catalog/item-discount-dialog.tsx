import type { TFunction } from 'i18next';
import type { Product } from 'src/api/catalogApi';
import type { ItemDiscount } from 'src/api/discountsApi';

import { useTranslation } from 'react-i18next';
import React, { useMemo, useState, useEffect } from 'react';

import {
  Alert,
  Stack,
  Button,
  Dialog,
  TextField,
  DialogTitle,
  Autocomplete,
  DialogContent,
  DialogActions,
  InputAdornment,
} from '@mui/material';

import { discountsApi } from 'src/api/discountsApi';

import { CalendarDateField } from 'src/components/calendar-date-field';

export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export type ItemDiscountStatus = 'active' | 'scheduled' | 'ended';

export const itemDiscountStatus = (r: ItemDiscount, today = localToday()): ItemDiscountStatus =>
  r.starts_on > today ? 'scheduled' : r.ends_on && r.ends_on < today ? 'ended' : 'active';

export const itemDiscountStatusColor = (s: ItemDiscountStatus) =>
  s === 'active' ? 'success' : s === 'scheduled' ? 'info' : 'default';

export const itemDiscountErrorText = (err: any, t: TFunction) => {
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

type Draft = { product_id: string; percent: string; starts_on: string; ends_on: string; note: string };

type Props = {
  open: boolean;
  /** The discount being edited; none to add one. */
  editing?: ItemDiscount | null;
  /** Items to pick from. Leave out with `productId` to add for that one item. */
  products?: Product[];
  /** Fixes the item, as on the product page, and hides the picker. */
  productId?: string;
  onClose: () => void;
  onSaved: () => void;
};

/** Add or edit one automatic item discount; shared by the pricing list and the product page. */
export function ItemDiscountDialog({ open, editing, products = [], productId, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setDraft(
      editing
        ? {
            product_id: editing.product_id,
            percent: String(Number(editing.percent)),
            starts_on: editing.starts_on,
            ends_on: editing.ends_on || '',
            note: editing.note || '',
          }
        : { product_id: productId || '', percent: '', starts_on: localToday(), ends_on: '', note: '' }
    );
  }, [open, editing, productId]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    // The product page opens this inside its own form; don't let the submit reach it.
    e.stopPropagation();
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
      if (editing) await discountsApi.updateItemDiscount(editing.id, body);
      else await discountsApi.createItemDiscount(body);
      onSaved();
    } catch (err: any) {
      setFormError(itemDiscountErrorText(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => !saving && onClose()} maxWidth="xs" fullWidth>
      {draft && (
        <form onSubmit={save}>
          <DialogTitle sx={{ fontWeight: 'bold' }}>
            {editing ? t('pricing.itemDiscounts.edit') : t('pricing.itemDiscounts.add')}
          </DialogTitle>
          <DialogContent>
            {formError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {formError}
              </Alert>
            )}
            <Stack spacing={2} sx={{ mt: 1 }}>
              {!productId && (
                <Autocomplete
                  options={products}
                  value={productById.get(draft.product_id) || null}
                  getOptionLabel={(p) => p.name}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  onChange={(_e, p) => setDraft({ ...draft, product_id: p?.id || '' })}
                  renderInput={(params) => <TextField {...params} label={t('pricing.itemDiscounts.item')} required size="small" />}
                />
              )}
              <TextField
                label={t('pricing.itemDiscounts.percent')}
                type="number"
                size="small"
                required
                autoFocus={!!productId}
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
            <Button onClick={onClose} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="contained" disabled={saving || !draft.product_id || !draft.percent || !draft.starts_on}>
              {t('common.save')}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}
