import type { OptionGroup, OptionGroupDraft } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Box,
  Stack,
  Alert,
  Button,
  Dialog,
  Divider,
  TextField,
  IconButton,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { addonRuleLabel } from 'src/utils/addon-rule';
import { toToman, fromToman, useCurrencyLabel } from 'src/utils/currency';

import { catalogApi } from 'src/api/catalogApi';

import { AmountInWords } from 'src/components/amount-in-words';
import { useConfirm } from 'src/components/confirm-dialog/use-confirm';

interface DraftItem {
  /** Absent for an add-on added in this form. */
  id?: string;
  name: string;
  /** Rial, as stored; the field shows Toman. */
  price: string;
}

/**
 * Create or edit an add-on group, as Snappfood's "ویرایش افزودنی" does: the group's title, each
 * add-on with its price, and how many a guest may pick (at least / at most). Which products
 * offer it is set by the switches on each product's add-ons page.
 */
export function AddonGroupSheet({
  open,
  group,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Null creates a new group. */
  group: OptionGroup | null;
  onClose: () => void;
  onSaved: (saved: OptionGroup) => void;
}) {
  const { t } = useTranslation();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const currencyLabel = useCurrencyLabel();

  const [name, setName] = useState('');
  const [least, setLeast] = useState('0');
  const [most, setMost] = useState('1');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(group?.name || '');
    setLeast(String(group?.min_selection ?? 0));
    setMost(String(group?.max_selection || 1));
    setItems(group?.items?.length ? group.items.map((i) => ({ id: i.id, name: i.name, price: String(Number(i.price_delta || 0)) })) : [{ name: '', price: '0' }]);
    setRemoved([]);
    setError(null);
  }, [open, group]);

  const min = parseInt(least, 10) || 0;
  const max = parseInt(most, 10) || 0;
  const ruleError = max < 1 || max < min;

  const patchItem = (index: number, change: Partial<DraftItem>) =>
    setItems((list) => list.map((it, i) => (i === index ? { ...it, ...change } : it)));

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const draft: OptionGroupDraft = {
        name: name.trim(),
        min_selection: min,
        max_selection: max,
        items: items
          .map((item) => ({ id: item.id, name: item.name.trim(), price_delta: item.price || '0' }))
          .filter((item) => item.name),
        removed_item_ids: removed,
      };
      onSaved(await catalogApi.saveOptionGroup(group?.id || null, draft));
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.addonSheet.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!group) return;
    if (!(await confirm(t('catalog.addonSheet.deleteConfirm', { name: group.name, n: (group.product_ids || []).length })))) return;
    try {
      await catalogApi.deleteOptionGroup(group.id);
      onSaved({ ...group, items: [] });
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.addonSheet.saveFailed'));
    }
  };

  const title = name.trim() || t('catalog.addonSheet.thisGroup');

  return (
    <>
    {confirmDialog}
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold' }}>
        {group ? t('catalog.addonSheet.editTitle') : t('catalog.addonSheet.newTitle')}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label={t('catalog.addonSheet.name')}
            placeholder={t('catalog.addonSheet.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus={!group}
            fullWidth
          />

          <Divider />

          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
              {t('catalog.addonSheet.itemsTitle')}
            </Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={() => setItems((list) => [...list, { name: '', price: '0' }])}>
              {t('catalog.addonSheet.addItem')}
            </Button>
          </Stack>

          {items.map((item, index) => (
            <Stack key={item.id || `new-${index}`} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <TextField
                label={t('catalog.addonSheet.itemName')}
                value={item.name}
                onChange={(e) => patchItem(index, { name: e.target.value })}
                size="small"
                sx={{ flex: 3 }}
              />
              <Box sx={{ flex: 2 }}>
                <TextField
                  label={t('catalog.addonSheet.price', { currency: currencyLabel })}
                  type="number"
                  value={toToman(item.price)}
                  onChange={(e) => patchItem(index, { price: fromToman(e.target.value) })}
                  size="small"
                  fullWidth
                />
                <AmountInWords amount={item.price} />
              </Box>
              <IconButton
                color="error"
                aria-label={t('catalog.addonSheet.removeItem')}
                onClick={() => {
                  if (item.id) setRemoved((r) => [...r, item.id!]);
                  setItems((list) => list.filter((_, i) => i !== index));
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}

          <Divider />

          {/* Snappfood's "محدودیت انتخاب": at least and at most, nothing else. */}
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
              {t('catalog.addonSheet.limitTitle', { name: title })}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              {t('catalog.addonSheet.limitHelp', { name: title })}
            </Typography>
            <Stack direction="row" spacing={2}>
              <TextField
                size="small"
                type="number"
                label={t('catalog.addonSheet.atLeast')}
                value={least}
                onChange={(e) => setLeast(e.target.value)}
                slotProps={{ htmlInput: { min: 0, step: 1 } }}
                sx={{ width: 120 }}
              />
              <TextField
                size="small"
                type="number"
                label={t('catalog.addonSheet.atMost')}
                value={most}
                onChange={(e) => setMost(e.target.value)}
                error={ruleError}
                slotProps={{ htmlInput: { min: 1, step: 1 } }}
                sx={{ width: 120 }}
              />
            </Stack>
            <Typography variant="caption" color={ruleError ? 'error' : 'text.secondary'} sx={{ display: 'block', mt: 1 }}>
              {ruleError ? t('catalog.addonSheet.limitInvalid') : addonRuleLabel(t, { min_selection: min, max_selection: max })}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        {group && (
          <Button color="error" startIcon={<DeleteIcon />} onClick={handleDelete} sx={{ mr: 'auto' }}>
            {t('catalog.addonSheet.delete')}
          </Button>
        )}
        <Button onClick={onClose}>{t('catalog.addonSheet.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !name.trim() || ruleError}>
          {t('catalog.addonSheet.save')}
        </Button>
      </DialogActions>
    </Dialog>
    </>
  );
}
