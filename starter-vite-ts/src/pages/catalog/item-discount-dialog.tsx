import type { TFunction } from 'i18next';
import type { Product, PriceList } from 'src/api/catalogApi';
import type { ItemDiscount, ItemDiscountChannel } from 'src/api/discountsApi';

import { useTranslation } from 'react-i18next';
import React, { useMemo, useState, useEffect } from 'react';

import {
  Alert,
  Stack,
  Button,
  Dialog,
  Switch,
  MenuItem,
  TextField,
  DialogTitle,
  Autocomplete,
  DialogContent,
  DialogActions,
  InputAdornment,
  FormControlLabel,
} from '@mui/material';

import { catalogApi } from 'src/api/catalogApi';
import { discountsApi } from 'src/api/discountsApi';

import { VersionTag } from 'src/components/version-tag';
import { CalendarDateField } from 'src/components/calendar-date-field';

export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export type ItemDiscountStatus = 'active' | 'scheduled' | 'ended';

export type ItemDiscountStatusOrPaused = ItemDiscountStatus | 'paused';

export const itemDiscountStatus = (r: ItemDiscount, today = localToday()): ItemDiscountStatusOrPaused =>
  r.ends_on && r.ends_on < today ? 'ended' : !r.is_active ? 'paused' : r.starts_on > today ? 'scheduled' : 'active';

export const itemDiscountStatusColor = (s: ItemDiscountStatusOrPaused) =>
  s === 'active' ? 'success' : s === 'scheduled' ? 'info' : s === 'paused' ? 'warning' : 'default';

/** The price groups, for naming a discount's scope. Empty until loaded, or when the chain has none. */
export function usePriceGroups() {
  const [groups, setGroups] = useState<PriceList[]>([]);
  useEffect(() => {
    catalogApi
      .getPriceLists()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);
  return groups;
}

/** Which price groups a discount is for, in words: "All groups", or the chosen groups' names. */
export const itemDiscountGroupsText = (r: ItemDiscount, groups: PriceList[], t: TFunction) =>
  r.all_groups
    ? t('pricing.itemDiscounts.scope.allGroups')
    : r.price_group_ids.map((id) => groups.find((g) => g.id === id)?.name || '—').join('، ');

export const itemDiscountChannelText = (r: ItemDiscount, t: TFunction) => t(`pricing.itemDiscounts.scope.channel.${r.applies_to}`);

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
    case 'ITEM_DISCOUNT_GROUPS':
      return t('pricing.itemDiscounts.errors.groups');
    case 'ITEM_DISCOUNT_CHANNEL':
      return t('pricing.itemDiscounts.errors.channel');
    default:
      return err?.detail || err?.message || t('pricing.itemDiscounts.errors.saveFailed');
  }
};

type Draft = {
  product_ids: string[];
  is_active: boolean;
  percent: string;
  starts_on: string;
  ends_on: string;
  note: string;
  all_groups: boolean;
  price_group_ids: string[];
  applies_to: ItemDiscountChannel;
};

type Props = {
  open: boolean;
  /** The discount being edited; none to add one. */
  editing?: ItemDiscount | null;
  /** Items to pick from. */
  products?: Product[];
  /** Starts a new discount with this item picked, as on the product page. */
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
  const groups = usePriceGroups();

  useEffect(() => {
    if (!open) return;
    setFormError(null);
    setDraft(
      editing
        ? {
            product_ids: editing.product_ids,
            is_active: editing.is_active,
            percent: String(Number(editing.percent)),
            starts_on: editing.starts_on,
            ends_on: editing.ends_on || '',
            note: editing.note || '',
            all_groups: editing.all_groups,
            price_group_ids: editing.price_group_ids,
            applies_to: editing.applies_to,
          }
        : {
            product_ids: productId ? [productId] : [],
            is_active: true,
            percent: '',
            starts_on: localToday(),
            ends_on: '',
            note: '',
            all_groups: true,
            price_group_ids: [],
            applies_to: 'IN_STORE',
          }
    );
  }, [open, editing, productId]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    // The product page opens this inside its own form; don't let the submit reach it.
    e.stopPropagation();
    if (!draft) return;
    const body = {
      product_ids: draft.product_ids,
      is_active: draft.is_active,
      percent: draft.percent,
      starts_on: draft.starts_on,
      ends_on: draft.ends_on || null,
      note: draft.note.trim() || null,
      all_groups: draft.all_groups,
      price_group_ids: draft.all_groups ? [] : draft.price_group_ids,
      applies_to: draft.applies_to,
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
              <Autocomplete
                multiple
                options={products}
                value={draft.product_ids.map((id) => productById.get(id)).filter((p): p is Product => !!p)}
                getOptionLabel={(p) => p.name}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                onChange={(_e, picked) => setDraft({ ...draft, product_ids: picked.map((p) => p.id) })}
                renderInput={(params) => <TextField {...params} label={t('pricing.itemDiscounts.items')} size="small" />}
              />
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
              <FormControlLabel
                control={<Switch checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />}
                label={draft.is_active ? t('pricing.itemDiscounts.running') : t('pricing.itemDiscounts.paused')}
              />
              {/* Price groups and Snappfood come in V2; V1 discounts are in store, for every branch. */}
              <TextField
                select
                label={<>{t('pricing.itemDiscounts.scope.where')} <VersionTag feature="pricing.itemDiscountScope" /></>}
                size="small"
                value={draft.applies_to}
                onChange={(e) => setDraft({ ...draft, applies_to: e.target.value as ItemDiscountChannel })}
              >
                <MenuItem value="IN_STORE">{t('pricing.itemDiscounts.scope.channel.IN_STORE')}</MenuItem>
                <MenuItem value="SNAPPFOOD">{t('pricing.itemDiscounts.scope.channel.SNAPPFOOD')}</MenuItem>
                <MenuItem value="BOTH">{t('pricing.itemDiscounts.scope.channel.BOTH')}</MenuItem>
              </TextField>
              <TextField
                select
                label={<>{t('pricing.itemDiscounts.scope.groups')} <VersionTag feature="pricing.itemDiscountScope" /></>}
                size="small"
                value={draft.all_groups ? 'ALL' : 'PICK'}
                onChange={(e) => setDraft({ ...draft, all_groups: e.target.value === 'ALL' })}
                helperText={draft.all_groups ? t('pricing.itemDiscounts.scope.allHelp') : undefined}
              >
                <MenuItem value="ALL">{t('pricing.itemDiscounts.scope.allGroups')}</MenuItem>
                <MenuItem value="PICK">{t('pricing.itemDiscounts.scope.pickGroups')}</MenuItem>
              </TextField>
              {!draft.all_groups && (
                <Autocomplete
                  multiple
                  options={groups}
                  value={groups.filter((g) => draft.price_group_ids.includes(g.id))}
                  getOptionLabel={(g) => g.name}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  onChange={(_e, picked) => setDraft({ ...draft, price_group_ids: picked.map((g) => g.id) })}
                  noOptionsText={t('pricing.itemDiscounts.scope.noGroups')}
                  renderInput={(params) => <TextField {...params} label={t('pricing.itemDiscounts.scope.pickGroups')} size="small" />}
                />
              )}
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
            <Button type="submit" variant="contained" disabled={saving || draft.product_ids.length === 0 || !draft.percent || !draft.starts_on || (!draft.all_groups && draft.price_group_ids.length === 0)}>
              {t('common.save')}
            </Button>
          </DialogActions>
        </form>
      )}
    </Dialog>
  );
}
