import type { Product, Category, DailyStockLine } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useMemo, useState, useEffect, useCallback } from 'react';

import SaveIcon from '@mui/icons-material/Save';
import SearchIcon from '@mui/icons-material/Search';
import {
  Box,
  Tab,
  Tabs,
  Chip,
  Stack,
  Alert,
  Paper,
  Button,
  Divider,
  TextField,
  Typography,
  InputAdornment,
} from '@mui/material';

import { catalogApi } from 'src/api/catalogApi';
import { useBranchContext } from 'src/contexts/branch-context';

/** A draft key: a product, or one variant of it. */
const lineKey = (productId: string, variantId?: string | null) => `${productId}:${variantId || ''}`;

/**
 * Today's stock, as Snappfood's vendor panel asks for it: when an item is limited, say
 * exactly how many you have, so orders stop at zero instead of being taken and then
 * rejected. The count is for today only; an empty box means no limit. What is left is
 * the count less today's live orders, so a cancelled order gives its units back.
 */
export function DailyStockPage() {
  const { t } = useTranslation();
  const { selectedBranchId, selectedBranch } = useBranchContext();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [lines, setLines] = useState<DailyStockLine[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [categoryTab, setCategoryTab] = useState('ALL');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const branchId = selectedBranchId || undefined;

  const load = useCallback(async () => {
    try {
      const [pList, cList, sList] = await Promise.all([
        catalogApi.getProducts(),
        catalogApi.getCategories().catch(() => [] as Category[]),
        branchId ? catalogApi.getDailyStock(branchId) : Promise.resolve([] as DailyStockLine[]),
      ]);
      setProducts(pList);
      setCategories(cList);
      setLines(sList);
      setDraft(Object.fromEntries(sList.map((l) => [lineKey(l.product_id, l.variant_id), String(l.quantity)])));
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('catalog.stockPage.loadFailed', 'Could not load today’s stock'));
    }
  }, [branchId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const saved = useMemo(
    () => Object.fromEntries(lines.map((l) => [lineKey(l.product_id, l.variant_id), l])),
    [lines]
  );

  const changed = Object.entries(draft).filter(([key, value]) => (saved[key] ? String(saved[key].quantity) : '') !== value);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (categoryTab === 'ALL' || p.category_id === categoryTab) &&
        (!q || p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q))
    );
  }, [products, search, categoryTab]);

  const handleSave = async () => {
    if (!branchId) return;
    setSaving(true);
    try {
      const entries = changed.map(([key, value]) => {
        const [productId, variantId] = key.split(':');
        return { productId, variantId: variantId || null, quantity: value.trim() === '' ? null : Number(value) };
      });
      const result = await catalogApi.setDailyStock(entries, branchId);
      setLines(result);
      setSuccess(t('catalog.stockPage.saved', 'Today’s stock saved'));
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.stockPage.saveFailed', 'Could not save the stock'));
    } finally {
      setSaving(false);
    }
  };

  const countField = (productId: string, variantId?: string) => {
    const key = lineKey(productId, variantId);
    const line = saved[key];
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        {line && (
          <Chip
            size="small"
            color={line.remaining > 0 ? 'default' : 'error'}
            label={t('catalog.stockPage.left', { defaultValue: '{{count}} left', count: line.remaining })}
          />
        )}
        <TextField
          size="small"
          type="number"
          value={draft[key] ?? ''}
          onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
          placeholder={t('catalog.stockPage.quantity', 'Quantity')}
          slotProps={{ htmlInput: { min: 0, step: 1 } }}
          sx={{ width: 110 }}
        />
      </Stack>
    );
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('catalog.stockPage.title', 'Today’s stock')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {selectedBranch?.name}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={!branchId || saving || changed.length === 0}
        >
          {t('catalog.stockPage.save', 'Save stock')}
        </Button>
      </Stack>

      <Alert severity="info" sx={{ mb: 1 }}>
        {t('catalog.stockPage.todayOnly', 'The stock set here is for today only.')}
      </Alert>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(
          'catalog.stockPage.help',
          'If an item is limited, enter exactly how many you have. Orders stop when it reaches zero, instead of being taken and rejected. Leave the box empty for no limit.'
        )}
      </Typography>

      {!branchId && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('catalog.stockPage.pickBranch', 'Stock is counted per branch. Pick a branch in the header first.')}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <TextField
        fullWidth
        size="small"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('catalog.availabilityPage.searchPlaceholder', 'Product name')}
        sx={{ mb: 1 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
      />
      <Tabs
        value={categoryTab}
        onChange={(_, v) => setCategoryTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 1, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="ALL" label={t('catalog.availabilityPage.allCategories', 'All')} />
        {categories.map((c) => (
          <Tab key={c.id} value={c.id} label={c.name} />
        ))}
      </Tabs>

      <Paper variant="outlined">
        {visible.map((p, index) => (
          <Box key={p.id}>
            {index > 0 && <Divider />}
            {(p.variants || []).length === 0 ? (
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', p: 2 }}>
                <Typography variant="subtitle2">{p.name}</Typography>
                {countField(p.id)}
              </Stack>
            ) : (
              <Box sx={{ p: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {p.name}
                </Typography>
                {(p.variants || []).map((v) => (
                  <Stack
                    key={v.id}
                    direction="row"
                    sx={{ justifyContent: 'space-between', alignItems: 'center', ps: 3, py: 0.5, borderInlineStart: 1, borderColor: 'divider' }}
                  >
                    <Typography variant="body2">{v.name}</Typography>
                    {countField(p.id, v.id)}
                  </Stack>
                ))}
              </Box>
            )}
          </Box>
        ))}
      </Paper>
    </Box>
  );
}

export default DailyStockPage;
