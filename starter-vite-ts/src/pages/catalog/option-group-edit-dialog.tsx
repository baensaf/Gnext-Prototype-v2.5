import type { OptionGroup } from 'src/api/catalogApi';

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

import { catalogApi } from 'src/api/catalogApi';

import { AmountInWords } from 'src/components/amount-in-words';

interface DraftItem {
  /** Absent for an item added in this dialog. */
  id?: string;
  code: string;
  name: string;
  price: string;
}

/**
 * Edit an add-on group in one sheet, as Snappfood's "edit add-on" does: its title, how
 * few and how many a guest picks, and every item's name and price. Items added here get
 * a code of their own; removing one archives it, so old orders still name it.
 */
export function OptionGroupEditDialog({
  group,
  onClose,
  onSaved,
}: {
  group: OptionGroup | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [min, setMin] = useState('0');
  const [max, setMax] = useState('1');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!group) return;
    setName(group.name);
    setMin(String(group.min_selection));
    setMax(String(group.max_selection));
    setItems((group.items || []).map((i) => ({ id: i.id, code: i.code, name: i.name, price: String(Number(i.price_delta || 0)) })));
    setRemoved([]);
    setError(null);
  }, [group]);

  const patchItem = (index: number, change: Partial<DraftItem>) =>
    setItems((list) => list.map((it, i) => (i === index ? { ...it, ...change } : it)));

  const handleSave = async () => {
    if (!group) return;
    setSaving(true);
    setError(null);
    try {
      // New choices go in before a higher minimum, and removed ones come out after a lower one:
      // the server refuses a group that asks for more choices than a product offers.
      const original = new Map((group.items || []).map((i) => [i.id, i]));
      for (const [index, item] of items.entries()) {
        if (!item.name.trim()) continue;
        if (!item.id) {
          await catalogApi.createOptionItem(group.id, {
            code: `${group.code}-${Date.now().toString(36).toUpperCase()}${index}`,
            name: item.name,
            price_delta: item.price || '0',
            sort_order: index,
          });
          continue;
        }
        const was = original.get(item.id);
        if (was && (was.name !== item.name || Number(was.price_delta) !== Number(item.price || 0) || was.sort_order !== index)) {
          await catalogApi.updateOptionItem(group.id, item.id, { name: item.name, price_delta: item.price || '0', sort_order: index });
        }
      }
      await catalogApi.updateOptionGroup(group.id, {
        name,
        min_selection: parseInt(min, 10) || 0,
        max_selection: parseInt(max, 10) || 0,
      });
      for (const id of removed) {
        await catalogApi.deleteOptionItem(group.id, id);
      }
      onSaved();
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.optionsPage.errors.saveGroupFailed', 'Could not save the add-on group'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!group} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold' }}>{t('catalog.optionsPage.editGroupTitle', 'Edit add-on')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label={t('catalog.optionsPage.groupName')} value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('catalog.optionsPage.minSelection')}
              type="number"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              helperText={t('catalog.optionsPage.minHelp', 'Above 0 makes the choice required')}
              fullWidth
            />
            <TextField
              label={t('catalog.optionsPage.maxSelection')}
              type="number"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              fullWidth
            />
          </Stack>

          <Divider />
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
              {t('catalog.optionsPage.itemsTitle', 'Items')}
            </Typography>
            <Button startIcon={<AddIcon />} onClick={() => setItems((list) => [...list, { code: '', name: '', price: '0' }])}>
              {t('catalog.optionsPage.newItem', 'New add-on')}
            </Button>
          </Stack>

          {items.map((item, index) => (
            <Box key={item.id || `new-${index}`}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <TextField
                  label={t('catalog.optionsPage.itemName')}
                  value={item.name}
                  onChange={(e) => patchItem(index, { name: e.target.value })}
                  size="small"
                  sx={{ flex: 2 }}
                />
                <Box sx={{ flex: 1 }}>
                  <TextField
                    label={t('catalog.optionsPage.priceDelta')}
                    type="number"
                    value={item.price}
                    onChange={(e) => patchItem(index, { price: e.target.value })}
                    size="small"
                    fullWidth
                  />
                  <AmountInWords amount={item.price} />
                </Box>
                <IconButton
                  color="error"
                  onClick={() => {
                    if (item.id) setRemoved((r) => [...r, item.id!]);
                    setItems((list) => list.filter((_, i) => i !== index));
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Stack>
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('catalog.optionsPage.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !name.trim()}>
          {t('catalog.optionsPage.saveChanges', 'Save changes')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
