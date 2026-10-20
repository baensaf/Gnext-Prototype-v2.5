import type {
  Product,
  Category,
  ProductVariant,
  ProductAvailability,
} from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useMemo, useState, useEffect, useCallback } from 'react';

import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import StorefrontIcon from '@mui/icons-material/Storefront';
import PlaylistRemoveIcon from '@mui/icons-material/PlaylistRemove';
import {
  Box,
  Tab,
  Tabs,
  Chip,
  Radio,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Dialog,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  RadioGroup,
  Typography,
  DialogTitle,
  ToggleButton,
  DialogContent,
  DialogActions,
  InputAdornment,
  TableContainer,
  FormControlLabel,
  ToggleButtonGroup,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';
import { useCurrencyLabel } from 'src/utils/currency';

import { catalogApi } from 'src/api/catalogApi';
import { useBranchContext } from 'src/contexts/branch-context';

import { VersionTag } from 'src/components/version-tag';

import { BulkStopDialog } from './bulk-stop-dialog';

/** One thing that can be taken off sale: a product, one of its variants, or an add-on. */
type StopTarget =
  | { kind: 'product'; product: Product }
  | { kind: 'variant'; product: Product; variant: ProductVariant };

/** Snappfood's three stock states: available, off until the next shift, off until further notice. */
type StopMode = 'AVAILABLE' | 'NEXT_SHIFT' | 'MANUAL';

const isLive = (a: ProductAvailability) =>
  a.is_suspended && (!a.suspended_until || new Date(a.suspended_until) > new Date());

/**
 * The one catalogue screen a branch owns.
 *
 * Head office decides what the item is; this decides whether this shop can serve it,
 * the way Snappfood's vendor panel does: an item (or one variant of it, or an add-on)
 * is available, off until the next shift (it comes back by itself when the next business
 * day starts), or off until further notice, which only a person undoes. No reason is asked.
 * The scope is the header switcher's.
 */
export function AvailabilityPage() {
  const currency = useCurrencyLabel();
  const { t } = useTranslation();
  const { selectedBranchId, selectedBranch, isHeadOffice } = useBranchContext();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [availabilities, setAvailabilities] = useState<ProductAvailability[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryTab, setCategoryTab] = useState('ALL');

  const [target, setTarget] = useState<StopTarget | null>(null);
  const [mode, setMode] = useState<StopMode>('MANUAL');
  // Where the change applies: everywhere (''), or Snappfood only while the counter keeps selling.
  const [channel, setChannel] = useState<'' | 'SNAPPFOOD'>('');
  const [saving, setSaving] = useState(false);

  const branchParam = selectedBranchId || undefined;

  /** The name of the shelf being edited, for every sentence that has to say it. */
  const scopeName = isHeadOffice
    ? t('catalog.availabilityPage.globalScope')
    : selectedBranch?.name || t('catalog.availabilityPage.branchScope');

  const loadData = useCallback(async () => {
    try {
      const [pList, aList, cList] = await Promise.all([
        catalogApi.getProducts(),
        catalogApi.getAvailabilities(branchParam),
        catalogApi.getCategories().catch(() => [] as Category[]),
      ]);
      setProducts(pList);
      setCategories(cList);
      setAvailabilities(aList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('catalog.availabilityPage.errors.loadFailed'));
    }
  }, [branchParam, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /** The live stop on a target, everywhere ('') or on one channel. */
  const stopFor = (tg: StopTarget, ch: '' | 'SNAPPFOOD' = '') =>
    availabilities.find((a) => {
      if (!isLive(a) || (a.channel || '') !== ch) return false;
      if (a.product_id !== tg.product.id) return false;
      return tg.kind === 'variant' ? a.variant_id === tg.variant.id : !a.variant_id;
    });

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (categoryTab === 'ALL' || p.category_id === categoryTab) &&
        (!q || p.name.toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q))
    );
  }, [products, search, categoryTab]);

  const showStop = (tg: StopTarget, ch: '' | 'SNAPPFOOD') => {
    setChannel(ch);
    setMode('NEXT_SHIFT');
  };

  const openDialog = (tg: StopTarget) => {
    setTarget(tg);
    showStop(tg, '');
  };

  const targetKey = (tg: StopTarget) => {
    if (tg.kind === 'variant') return { productId: tg.product.id, variantId: tg.variant.id };
    return { productId: tg.product.id };
  };

  const handleSave = async () => {
    if (!target) return;
    setSaving(true);
    try {
      if (mode === 'AVAILABLE') {
        await catalogApi.resumeItem({ ...targetKey(target), branchId: branchParam, channel: channel || undefined });
      } else {
        await catalogApi.stopItem({
          ...targetKey(target),
          branchId: branchParam,
          channel: channel || undefined,
          until: mode === 'NEXT_SHIFT' ? 'NEXT_SHIFT' : 'FURTHER_NOTICE',
        });
      }
      setTarget(null);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('catalog.availabilityPage.errors.suspendFailed'));
    } finally {
      setSaving(false);
    }
  };

  const statusChip = (stop: ProductAvailability | undefined) => {
    if (stop) {
      return (
        <Chip
          size="small"
          color={stop.suspended_until ? 'warning' : 'default'}
          label={
            stop.suspended_until
              ? t('catalog.availabilityPage.statusOffNextShift', { time: fDateTime(stop.suspended_until) })
              : t('catalog.availabilityPage.statusOffManual', 'Unavailable until further notice')
          }
        />
      );
    }
    return <Chip size="small" color="success" label={t('catalog.availabilityPage.statusAvailable')} />;
  };

  /** A stop on Snappfood only, shown beside the item's own status: the counter still sells it. */
  const snappfoodChip = (tg: StopTarget) => {
    const stop = stopFor(tg, 'SNAPPFOOD');
    if (!stop) return null;
    return (
      <Chip
        size="small"
        variant="outlined"
        color="warning"
        label={
          stop.suspended_until
            ? t('catalog.availabilityPage.snappfoodOffUntil', { time: fDateTime(stop.suspended_until) })
            : t('catalog.availabilityPage.snappfoodOff')
        }
      />
    );
  };

  const changeButton = (tg: StopTarget) => (
    <Button size="small" variant="outlined" onClick={() => openDialog(tg)}>
      {t('catalog.availabilityPage.change', 'Change')}
    </Button>
  );

  const targetName = (tg: StopTarget) => {
    if (tg.kind === 'variant') return `${tg.product.name} — ${tg.variant.name}`;
    return tg.product.name;
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('catalog.availabilityPage.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('catalog.availabilityPage.subtitle')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Button variant="contained" color="error" startIcon={<PlaylistRemoveIcon />} onClick={() => setBulkOpen(true)}>
            {t('catalog.bulkStop.open')}
          </Button>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            {t('catalog.availabilityPage.refresh')}
          </Button>
        </Stack>
      </Stack>

      {notice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <BulkStopDialog
        open={bulkOpen}
        products={products}
        categories={categories}
        onClose={() => setBulkOpen(false)}
        onDone={(message) => {
          setBulkOpen(false);
          setNotice(message);
          loadData();
        }}
      />

      <Alert severity="info" icon={<StorefrontIcon />} sx={{ mb: 2 }}>
        {t('catalog.availabilityPage.ownershipNotice', {
          defaultValue:
            'Head office owns the menu — names, recipes and prices are set once for the whole chain. What you decide here is what {{scope}} can actually serve.',
          scope: scopeName,
        })}
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
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
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="ALL" label={t('catalog.availabilityPage.allCategories', 'All')} />
        {categories.map((c) => (
          <Tab key={c.id} value={c.id} label={c.name} />
        ))}
      </Tabs>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('catalog.availabilityPage.productName')}</TableCell>
              <TableCell>{t('catalog.productsPage.basePrice')}</TableCell>
              <TableCell>{t('catalog.availabilityPage.status')}</TableCell>
              <TableCell align="right">{t('catalog.availabilityPage.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleProducts.map((p) => {
              const productStop = stopFor({ kind: 'product', product: p });
              return (
                <React.Fragment key={p.id}>
                  <TableRow>
                    <TableCell>
                      <Typography variant="subtitle2">{p.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {p.code}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <span><bdi dir="ltr">{MoneyUtil.formatCurrency(p.base_price)}</bdi> {currency}</span>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                        {statusChip(productStop)}
                        {snappfoodChip({ kind: 'product', product: p })}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">{changeButton({ kind: 'product', product: p })}</TableCell>
                  </TableRow>
                  {(p.variants || []).map((v) => {
                    const variantStop = stopFor({ kind: 'variant', product: p, variant: v });
                    return (
                      <TableRow key={v.id}>
                        <TableCell sx={{ ps: 5 }}>
                          <Typography variant="body2" color="text.secondary">
                            └ {v.name}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <span><bdi dir="ltr">{MoneyUtil.formatCurrency(v.base_price)}</bdi> {currency}</span>
                        </TableCell>
                        {/* A stop on the whole product covers its variants; they have no state of their own then. */}
                        <TableCell>
                          <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap' }}>
                            {productStop ? '—' : statusChip(variantStop)}
                            {snappfoodChip({ kind: 'variant', product: p, variant: v })}
                          </Stack>
                        </TableCell>
                        <TableCell align="right">
                          {!productStop && changeButton({ kind: 'variant', product: p, variant: v })}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!target} onClose={() => setTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {t('catalog.availabilityPage.changeTitle', {
            defaultValue: 'Change availability — {{name}}',
            name: target ? targetName(target) : '',
          })}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              {t('catalog.availabilityPage.scopeNotice', {
                defaultValue: 'This applies to {{scope}}. Change the scope in the header to work elsewhere.',
                scope: scopeName,
              })}
            </Alert>

            {target && (
              <ToggleButtonGroup
                exclusive
                size="small"
                value={channel}
                onChange={(_, next) => next !== null && showStop(target, next)}
              >
                <ToggleButton value="">{t('catalog.availabilityPage.whereEverywhere')}</ToggleButton>
                <ToggleButton value="SNAPPFOOD">
                  {t('catalog.availabilityPage.whereSnappfood')} <VersionTag feature="catalog.snappfoodStop" sx={{ ml: 1 }} />
                </ToggleButton>
              </ToggleButtonGroup>
            )}
            {channel === 'SNAPPFOOD' && (
              <Typography variant="body2" color="text.secondary">
                {t('catalog.availabilityPage.whereSnappfoodHelp')}
              </Typography>
            )}

            <RadioGroup value={mode} onChange={(e) => setMode(e.target.value as StopMode)}>
              <FormControlLabel
                value="AVAILABLE"
                control={<Radio />}
                label={t('catalog.availabilityPage.modeAvailable', 'Available')}
              />
              <FormControlLabel
                value="NEXT_SHIFT"
                control={<Radio />}
                label={
                  <Box>
                    <Typography variant="body2">{t('catalog.availabilityPage.modeNextShift')}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('catalog.availabilityPage.modeNextShiftHelp')}
                    </Typography>
                  </Box>
                }
              />
              <FormControlLabel
                value="MANUAL"
                control={<Radio />}
                label={
                  <Box>
                    <Typography variant="body2">
                      {t('catalog.availabilityPage.modeManual', 'Unavailable until further notice')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('catalog.availabilityPage.modeManualHelp', 'Stays off until someone puts it back here.')}
                    </Typography>
                  </Box>
                }
              />
            </RadioGroup>

          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTarget(null)}>{t('catalog.availabilityPage.cancel')}</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {t('catalog.availabilityPage.save', 'Save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
