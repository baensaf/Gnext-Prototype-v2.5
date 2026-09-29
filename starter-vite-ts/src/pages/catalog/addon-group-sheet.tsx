import type { Product, Category, OptionGroup, OptionGroupDraft } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useMemo, useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import {
  Box,
  Stack,
  Alert,
  Radio,
  Button,
  Dialog,
  Switch,
  Divider,
  Tooltip,
  Checkbox,
  MenuItem,
  TextField,
  IconButton,
  Typography,
  DialogTitle,
  Autocomplete,
  ToggleButton,
  DialogContent,
  DialogActions,
  FormControlLabel,
  ToggleButtonGroup,
} from '@mui/material';

import { addonRuleLabel } from 'src/utils/addon-rule';
import { toToman, fromToman, useCurrencyLabel } from 'src/utils/currency';

import { catalogApi } from 'src/api/catalogApi';

import { AmountInWords } from 'src/components/amount-in-words';

interface DraftItem {
  /** Absent for an add-on added in this sheet. */
  id?: string;
  name: string;
  /** Rial, as stored; the field shows Toman. */
  price: string;
  isDefault: boolean;
  productId: string | null;
}

type Pick = 'ONE' | 'SEVERAL';

/**
 * One sheet to create or edit an add-on group, as Toast's and Snappfood's editors are: its
 * name, the rule for how many a guest picks, whether the cashier is asked when the item is rung
 * up, every add-on with its price, and where the group is used (products, or whole categories
 * that pass it to every product in them, new ones too). No codes: the server makes them.
 */
export function AddonGroupSheet({
  open,
  group,
  products,
  categories,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Null creates a new group. */
  group: OptionGroup | null;
  products: Product[];
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const currencyLabel = useCurrencyLabel();

  const [groupId, setGroupId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [required, setRequired] = useState(false);
  const [pick, setPick] = useState<Pick>('SEVERAL');
  const [least, setLeast] = useState('1');
  const [most, setMost] = useState('');
  const [askAtPos, setAskAtPos] = useState(false);
  const [comboSlot, setComboSlot] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [productIds, setProductIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const g = group;
    const min = g ? Math.max(g.min_selection || 0, g.is_required ? 1 : 0) : 0;
    const max = g ? g.max_selection || 0 : 0;
    setGroupId(g?.id || null);
    setName(g?.name || '');
    setRequired(min > 0);
    setPick(g && max === 1 ? 'ONE' : 'SEVERAL');
    setLeast(String(Math.max(min, 1)));
    setMost(max > 1 ? String(max) : '');
    // A new optional group rings straight through, as HAMI's register does.
    setAskAtPos(g ? g.prompt_at_pos !== false : false);
    setItems(
      (g?.items || []).map((i) => ({
        id: i.id,
        name: i.name,
        price: String(Number(i.price_delta || 0)),
        isDefault: !!i.is_default,
        productId: i.product_id || null,
      }))
    );
    setComboSlot((g?.items || []).some((i) => !!i.product_id));
    setRemoved([]);
    setProductIds((g?.product_links || []).filter((l) => !l.from_category_id).map((l) => l.product_id));
    setCategoryIds(g?.category_ids || []);
    setError(null);
  }, [open, group]);

  // The rule as min/max: pick one is exactly one (or at most one); several is at least / at most.
  const rule = useMemo(() => {
    const cap = parseInt(most, 10) || 0;
    if (pick === 'ONE') return { min: required ? 1 : 0, max: 1 };
    return { min: required ? Math.max(parseInt(least, 10) || 1, 1) : 0, max: cap };
  }, [pick, required, least, most]);

  const inherited = useMemo(() => {
    const inCategories = new Set(categoryIds);
    return products.filter((p) => inCategories.has(p.category_id) && !productIds.includes(p.id));
  }, [products, categoryIds, productIds]);

  const patchItem = (index: number, change: Partial<DraftItem>) =>
    setItems((list) => list.map((it, i) => (i === index ? { ...it, ...change } : it)));

  const moveItem = (index: number, by: number) =>
    setItems((list) => {
      const to = index + by;
      if (to < 0 || to >= list.length) return list;
      const copy = [...list];
      [copy[index], copy[to]] = [copy[to], copy[index]];
      return copy;
    });

  const toggleDefault = (index: number, on: boolean) =>
    setItems((list) =>
      list.map((it, i) => {
        if (i === index) return { ...it, isDefault: on };
        // A pick-one group has one default at most.
        return pick === 'ONE' && on ? { ...it, isDefault: false } : it;
      })
    );

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const draft: OptionGroupDraft = {
        name: name.trim(),
        min_selection: rule.min,
        max_selection: rule.max,
        prompt_at_pos: required || askAtPos,
        items: items
          .map((item, index) => ({
            id: item.id,
            name: item.name.trim(),
            price_delta: item.price || '0',
            sort_order: index,
            is_default: item.isDefault,
            product_id: comboSlot ? item.productId : null,
          }))
          .filter((item) => item.name || item.product_id),
        removed_item_ids: removed,
      };
      // The group first, then where it is used; a group saved but not placed keeps its id,
      // so trying again updates it rather than making a second one.
      const saved = await catalogApi.saveOptionGroup(groupId, draft);
      setGroupId(saved.id);
      await catalogApi.setOptionGroupLinks(saved.id, { product_ids: productIds, category_ids: categoryIds });
      onSaved();
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.addonSheet.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!group) return;
    const used = (group.product_links || []).length;
    if (!window.confirm(t('catalog.addonSheet.deleteConfirm', { name: group.name, n: used }))) return;
    try {
      await catalogApi.deleteOptionGroup(group.id);
      onSaved();
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.addonSheet.saveFailed'));
    }
  };

  const productName = (id: string) => products.find((p) => p.id === id)?.name || '';
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name || '';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold' }}>
        {group ? t('catalog.addonSheet.editTitle') : t('catalog.addonSheet.newTitle')}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label={t('catalog.addonSheet.name')}
            placeholder={t('catalog.addonSheet.namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus={!group}
            fullWidth
          />

          {/* The rule, in the words a manager uses rather than min / max / required. */}
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
              {t('catalog.addonSheet.ruleTitle')}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
              <ToggleButtonGroup exclusive size="small" color="primary" value={required ? 'REQ' : 'OPT'} onChange={(_, v) => v && setRequired(v === 'REQ')}>
                <ToggleButton value="OPT">{t('catalog.addonSheet.optional')}</ToggleButton>
                <ToggleButton value="REQ">{t('catalog.addonSheet.required')}</ToggleButton>
              </ToggleButtonGroup>
              <ToggleButtonGroup exclusive size="small" color="primary" value={pick} onChange={(_, v) => v && setPick(v)}>
                <ToggleButton value="ONE">{t('catalog.addonSheet.pickOne')}</ToggleButton>
                <ToggleButton value="SEVERAL">{t('catalog.addonSheet.pickSeveral')}</ToggleButton>
              </ToggleButtonGroup>
              {pick === 'SEVERAL' && (
                <Stack direction="row" spacing={1}>
                  {required && (
                    <TextField
                      size="small"
                      type="number"
                      label={t('catalog.addonSheet.atLeast')}
                      value={least}
                      onChange={(e) => setLeast(e.target.value)}
                      sx={{ width: 110 }}
                    />
                  )}
                  <TextField
                    size="small"
                    type="number"
                    label={t('catalog.addonSheet.atMost')}
                    placeholder={t('catalog.addonSheet.noLimit')}
                    value={most}
                    onChange={(e) => setMost(e.target.value)}
                    slotProps={{ inputLabel: { shrink: true } }}
                    sx={{ width: 130 }}
                  />
                </Stack>
              )}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {addonRuleLabel(t, { min_selection: rule.min, max_selection: rule.max })}
            </Typography>
          </Box>

          <FormControlLabel
            control={<Switch checked={required || askAtPos} disabled={required} onChange={(e) => setAskAtPos(e.target.checked)} />}
            label={
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {t('catalog.addonSheet.askAtPos')}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {required ? t('catalog.addonSheet.askAtPosRequired') : t('catalog.addonSheet.askAtPosHelp')}
                </Typography>
              </Box>
            }
          />

          <Divider />

          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
              {t('catalog.addonSheet.itemsTitle')}
            </Typography>
            <FormControlLabel
              control={<Switch size="small" checked={comboSlot} onChange={(e) => setComboSlot(e.target.checked)} />}
              label={<Typography variant="caption">{t('catalog.addonSheet.comboSlot')}</Typography>}
            />
          </Stack>

          {items.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {t('catalog.addonSheet.noItems')}
            </Typography>
          )}

          {items.map((item, index) => (
            <Stack key={item.id || `new-${index}`} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <Stack sx={{ pt: 0.5 }}>
                <IconButton size="small" disabled={index === 0} onClick={() => moveItem(index, -1)} aria-label={t('catalog.addonSheet.moveUp')}>
                  <ArrowUpwardIcon fontSize="inherit" />
                </IconButton>
                <IconButton size="small" disabled={index === items.length - 1} onClick={() => moveItem(index, 1)} aria-label={t('catalog.addonSheet.moveDown')}>
                  <ArrowDownwardIcon fontSize="inherit" />
                </IconButton>
              </Stack>
              <Stack spacing={1} sx={{ flex: 2 }}>
                <TextField
                  label={t('catalog.addonSheet.itemName')}
                  value={item.name}
                  onChange={(e) => patchItem(index, { name: e.target.value })}
                  size="small"
                  fullWidth
                />
                {comboSlot && (
                  <TextField
                    select
                    size="small"
                    label={t('catalog.addonSheet.givesProduct')}
                    helperText={t('catalog.addonSheet.givesProductHelp')}
                    value={item.productId || ''}
                    onChange={(e) => patchItem(index, { productId: e.target.value || null })}
                    fullWidth
                  >
                    <MenuItem value="">{t('catalog.addonSheet.noProduct')}</MenuItem>
                    {products.map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.name}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              </Stack>
              <Box sx={{ flex: 1 }}>
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
              <Tooltip title={t('catalog.addonSheet.defaultHelp')}>
                <FormControlLabel
                  sx={{ m: 0, pt: 0.5 }}
                  labelPlacement="bottom"
                  control={
                    pick === 'ONE' ? (
                      <Radio size="small" checked={item.isDefault} onClick={() => toggleDefault(index, !item.isDefault)} />
                    ) : (
                      <Checkbox size="small" checked={item.isDefault} onChange={(e) => toggleDefault(index, e.target.checked)} />
                    )
                  }
                  label={<Typography variant="caption">{t('catalog.addonSheet.default')}</Typography>}
                />
              </Tooltip>
              <IconButton
                color="error"
                sx={{ mt: 0.5 }}
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

          <Box>
            <Button
              startIcon={<AddIcon />}
              onClick={() => setItems((list) => [...list, { name: '', price: '0', isDefault: false, productId: null }])}
            >
              {t('catalog.addonSheet.addItem')}
            </Button>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
              {t('catalog.addonSheet.usedOnTitle')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              {t('catalog.addonSheet.usedOnHelp')}
            </Typography>
            <Stack spacing={2}>
              <Autocomplete
                multiple
                size="small"
                options={categories.map((c) => c.id)}
                getOptionLabel={categoryName}
                value={categoryIds}
                onChange={(_, v) => setCategoryIds(v)}
                renderInput={(params) => <TextField {...params} label={t('catalog.addonSheet.categories')} />}
              />
              <Autocomplete
                multiple
                size="small"
                options={products.map((p) => p.id)}
                getOptionLabel={productName}
                value={productIds}
                onChange={(_, v) => setProductIds(v)}
                renderInput={(params) => <TextField {...params} label={t('catalog.addonSheet.products')} />}
              />
              {inherited.length > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {t('catalog.addonSheet.throughCategories', { n: inherited.length, names: inherited.slice(0, 6).map((p) => p.name).join('، ') })}
                </Typography>
              )}
            </Stack>
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
        <Button variant="contained" onClick={handleSave} disabled={saving || !name.trim()}>
          {t('catalog.addonSheet.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
