import type {
  Product,
  Category,
  OptionGroup,
  ProductVariant,
  ProductAvailability,
} from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import StarIcon from '@mui/icons-material/Star';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import StorefrontIcon from '@mui/icons-material/Storefront';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import {
  Box,
  Tab,
  Card,
  Tabs,
  Chip,
  Grid,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Dialog,
  Select,
  Switch,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Container,
  Typography,
  IconButton,
  InputLabel,
  FormControl,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
  InputAdornment,
  FormControlLabel,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';
import { addonMin, addonRuleLabel } from 'src/utils/addon-rule';
import { toToman, fromToman, useCurrencyLabel } from 'src/utils/currency';
import { wholeRials, percentToTaxRate, taxRateToPercent } from 'src/utils/tax-rate';

import { catalogApi } from 'src/api/catalogApi';
import { useAuthStore } from 'src/store/useAuthStore';
import { useBranchContext } from 'src/contexts/branch-context';

import { VersionTag } from 'src/components/version-tag';
import { AmountInWords } from 'src/components/amount-in-words';

import { ProductPhotos } from './product-photos';
import { AddonGroupSheet } from './addon-group-sheet';
import { ProductPriceHistory } from './product-price-history';
import { ProductItemDiscounts } from './product-item-discounts';

export function ProductDetailPage() {
  const currencyLabel = useCurrencyLabel();
  const currency = useCurrencyLabel();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // A branch can open this to see what it is selling; head office is who changes it.
  // See the same flag on the products list.
  const canAuthor = useAuthStore((state) => state.user?.isHeadOffice) !== false;

  const [currentTab, setCurrentTab] = useState(0);
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [allOptionGroups, setAllOptionGroups] = useState<OptionGroup[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // General Form State
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [barcode, setBarcode] = useState('');
  const [description, setDescription] = useState('');
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [maxPerOrder, setMaxPerOrder] = useState('');
  const [savingGeneral, setSavingGeneral] = useState(false);

  // What the branch side says about this item right now, shown beside what head office set.
  const { selectedBranchId } = useBranchContext();
  const [stops, setStops] = useState<ProductAvailability[]>([]);

  // Variant Modal State
  const [variantDialogOpen, setVariantDialogOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [varCode, setVarCode] = useState('');
  const [varName, setVarName] = useState('');
  const [varBarcode, setVarBarcode] = useState('');
  const [varPrice, setVarPrice] = useState('');
  const [varIsDefault, setVarIsDefault] = useState(false);
  const [varSortOrder, setVarSortOrder] = useState('0');
  const [savingVariant, setSavingVariant] = useState(false);

  // The add-on group form: a group to edit, or null for a new one.
  const [sheet, setSheet] = useState<{ group: OptionGroup | null } | null>(null);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [prod, cList, vList, ogList] = await Promise.all([
        catalogApi.getProductById(id),
        catalogApi.getCategories(),
        catalogApi.getProductVariants(id),
        catalogApi.getOptionGroups(),
      ]);

      setProduct(prod);
      setCategories(cList);
      setVariants(vList);
      setAllOptionGroups(ogList);

      setCode(prod.code || '');
      setName(prod.name);
      setCategoryId(prod.category_id);
      setBasePrice(wholeRials(prod.base_price));
      setTaxRate(taxRateToPercent(prod.tax_rate ?? '0.0900'));
      setBarcode(prod.barcode || '');
      setDescription(prod.description || '');
      setPhotoIds([prod.image_asset_id, ...(prod.gallery_asset_ids || [])].filter(Boolean) as string[]);
      setMaxPerOrder(prod.max_per_order ? String(prod.max_per_order) : '');
      setError(null);

      const aList = await catalogApi.getAvailabilities(selectedBranchId || undefined).catch(() => [] as ProductAvailability[]);
      // The item's and its types' own stops here; a Snappfood-only stop does not take it off at the counter.
      setStops(aList.filter((a) => a.product_id === prod.id && !a.option_item_id && !a.channel));
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.productDetailPage.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, t, selectedBranchId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /** The live stop on the product (no variant) or on one of its types, at the branch in the header. */
  const liveStop = (variantId: string | null) =>
    stops.find(
      (a) =>
        (a.variant_id || null) === variantId &&
        a.is_suspended &&
        (!a.suspended_until || new Date(a.suspended_until) > new Date())
    );
  const stockState = (variantId: string | null): 'AVAILABLE' | 'NEXT_SHIFT' | 'FURTHER_NOTICE' => {
    const stop = liveStop(variantId);
    if (!stop) return 'AVAILABLE';
    return stop.suspended_until ? 'NEXT_SHIFT' : 'FURTHER_NOTICE';
  };

  /** Snappfood's "وضعیت موجودی" select, for the product or one of its types, saved at once. */
  const handleStockChange = async (variantId: string | null, next: 'AVAILABLE' | 'NEXT_SHIFT' | 'FURTHER_NOTICE') => {
    if (!id) return;
    const target = { productId: id, variantId: variantId || undefined, branchId: selectedBranchId || undefined };
    try {
      if (next === 'AVAILABLE') await catalogApi.resumeItem(target);
      else await catalogApi.stopItem({ ...target, until: next });
      const aList = await catalogApi.getAvailabilities(selectedBranchId || undefined);
      setStops(aList.filter((a) => a.product_id === id && !a.option_item_id && !a.channel));
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.availabilityPage.errors.suspendFailed'));
    }
  };

  /** The add-ons of a group this product offers: none when the group is not on it. */
  const offeredIds = (group: OptionGroup) => {
    const own = (product?.optionGroups || []).find((g) => g.id === group.id);
    if (!own) return new Set<string>();
    const off = new Set(own.excluded_item_ids || []);
    return new Set((group.items || []).map((i) => i.id).filter((itemId) => !off.has(itemId)));
  };

  /** The groups and this product's switches again, without touching the unsaved General form. */
  const refreshAddons = async () => {
    if (!id) return;
    const [prod, groups] = await Promise.all([catalogApi.getProductById(id), catalogApi.getOptionGroups()]);
    setProduct((p) => (p ? { ...p, optionGroups: prod.optionGroups } : prod));
    setAllOptionGroups(groups);
  };

  /** Snappfood's per-product add-on switch: the first one on puts the group on the product, the last one off takes it off. */
  const handleToggleOptionItem = async (group: OptionGroup, itemId: string, offered: boolean) => {
    if (!id) return;
    const next = offeredIds(group);
    if (offered) next.add(itemId);
    else next.delete(itemId);
    try {
      const result = await catalogApi.setOfferedChoices(id, group.id, [...next]);
      setProduct((p) => {
        if (!p) return p;
        const others = (p.optionGroups || []).filter((g) => g.id !== group.id);
        return { ...p, optionGroups: result.attached ? [...others, { ...group, excluded_item_ids: result.excluded_item_ids }] : others };
      });
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.productDetailPage.errors.saveFailed'));
    }
  };

  /** A group made from this product's page is switched on for it, every add-on of it. */
  const handleGroupSaved = async (saved: OptionGroup) => {
    const isNew = !sheet?.group;
    setSheet(null);
    try {
      if (isNew && id && saved.items?.length) await catalogApi.setOfferedChoices(id, saved.id, saved.items.map((i) => i.id));
      await refreshAddons();
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.productDetailPage.errors.saveFailed'));
    }
  };

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSavingGeneral(true);
    setSuccessMsg(null);
    setError(null);
    try {
      const updated = await catalogApi.updateProduct(id, {
        // Blank clears them: a product may have no code or barcode.
        code: code.trim() || null,
        name,
        category_id: categoryId,
        base_price: basePrice,
        tax_rate: percentToTaxRate(taxRate),
        barcode: barcode.trim() || null,
        description: description || undefined,
        image_asset_id: photoIds[0] || null,
        gallery_asset_ids: photoIds.slice(1),
        max_per_order: maxPerOrder ? parseInt(maxPerOrder, 10) : null,
      });
      setProduct(updated);
      setSuccessMsg(t('catalog.productDetailPage.messages.saved'));
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.productDetailPage.errors.saveFailed'));
    } finally {
      setSavingGeneral(false);
    }
  };

  const handleOpenAddVariant = () => {
    setEditingVariant(null);
    setVarCode('');
    setVarName('');
    setVarBarcode('');
    setVarPrice(basePrice || '0');
    setVarIsDefault(variants.length === 0);
    setVarSortOrder(variants.length.toString());
    setVariantDialogOpen(true);
  };

  const handleOpenEditVariant = (v: ProductVariant) => {
    setEditingVariant(v);
    setVarCode(v.code);
    setVarName(v.name);
    setVarBarcode(v.barcode || '');
    setVarPrice(wholeRials(v.base_price));
    setVarIsDefault(v.is_default);
    setVarSortOrder(v.sort_order.toString());
    setVariantDialogOpen(true);
  };

  const handleSaveVariant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSavingVariant(true);
    setError(null);
    try {
      if (editingVariant) {
        await catalogApi.updateProductVariant(id, editingVariant.id, {
          code: varCode,
          name: varName,
          barcode: varBarcode || undefined,
          base_price: varPrice,
          is_default: varIsDefault,
          sort_order: parseInt(varSortOrder, 10) || 0,
        });
      } else {
        await catalogApi.createProductVariant(id, {
          code: varCode,
          name: varName,
          barcode: varBarcode || undefined,
          base_price: varPrice,
          is_default: varIsDefault,
          sort_order: parseInt(varSortOrder, 10) || 0,
        });
      }
      setVariantDialogOpen(false);
      const updatedList = await catalogApi.getProductVariants(id);
      setVariants(updatedList);
      setSuccessMsg(editingVariant ? t('catalog.productDetailPage.messages.variantUpdated') : t('catalog.productDetailPage.messages.variantAdded'));
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.productDetailPage.errors.saveVariantFailed'));
    } finally {
      setSavingVariant(false);
    }
  };

  const handleDeleteVariant = async (variantId: string) => {
    if (!id) return;
    if (!window.confirm(t('catalog.productDetailPage.variants.deleteConfirm'))) return;
    try {
      await catalogApi.deleteProductVariant(id, variantId);
      const updatedList = await catalogApi.getProductVariants(id);
      setVariants(updatedList);
      setSuccessMsg(t('catalog.productDetailPage.messages.variantRemoved'));
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.productDetailPage.errors.deleteVariantFailed'));
    }
  };

  const handleSetDefaultVariant = async (variantId: string) => {
    if (!id) return;
    try {
      await catalogApi.updateProductVariant(id, variantId, { is_default: true });
      const updatedList = await catalogApi.getProductVariants(id);
      setVariants(updatedList);
      setSuccessMsg(t('catalog.productDetailPage.messages.defaultUpdated'));
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.productDetailPage.errors.setDefaultFailed'));
    }
  };

  const currentCategory = categories.find((c) => c.id === product?.category_id);

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Stack sx={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/catalog/products')}>
            {t('catalog.productDetailPage.backToProducts')}
          </Button>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {product?.name || t('catalog.productDetailPage.defaultTitle')}
          </Typography>
          {product?.code && <Chip label={product.code} variant="outlined" sx={{ fontWeight: 'bold' }} />}
          {currentCategory && <Chip label={currentCategory.name} color="primary" size="small" />}
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {successMsg && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccessMsg(null)}>
          {successMsg}
        </Alert>
      )}

      {!canAuthor && (
        <Alert
          severity="info"
          icon={<StorefrontIcon />}
          sx={{ mb: 3 }}
          action={
            <Button
              size="small"
              color="inherit"
              onClick={() => navigate('/app/catalog/availability')}
            >
              {t('catalog.productsPage.manageAvailability', 'Manage availability')}
            </Button>
          }
        >
          {t(
            'catalog.productDetailPage.readOnlyNotice',
            'This product is set by head office for the whole chain. Your branch decides whether it can serve it today.'
          )}
        </Alert>
      )}

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={currentTab} onChange={(_, val) => setCurrentTab(val)}>
          <Tab label={t('catalog.productDetailPage.tabs.general')} />
          <Tab label={t('catalog.productDetailPage.tabs.variants', { count: variants.length })} />
          <Tab label={t('catalog.productDetailPage.tabs.modifiers', { count: product?.optionGroups?.length || 0 })} />
          <Tab label={<Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}><span>{t('catalog.productDetailPage.tabs.priceHistory')}</span><VersionTag feature="catalog.priceHistory" /></Stack>} />
        </Tabs>
      </Box>

      {/* TAB 0: General Info & Pricing */}
      {currentTab === 0 && (
        <form onSubmit={handleSaveGeneral}>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 8 }}>
              <Card sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                  {t('catalog.productDetailPage.general.title')}
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12 }}>
                    <TextField
                      label={t('catalog.productDetailPage.general.name')}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      fullWidth
                      required
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <FormControl fullWidth required>
                      <InputLabel>{t('catalog.productDetailPage.general.category')}</InputLabel>
                      <Select
                        value={categoryId}
                        label={t('catalog.productDetailPage.general.category')}
                        onChange={(e) => setCategoryId(e.target.value)}
                      >
                        {categories.map((c) => (
                          <MenuItem key={c.id} value={c.id}>
                            {c.name} ({c.code})
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label={t('catalog.productDetailPage.general.basePrice', { currency: currencyLabel })}
                      type="number"
                      value={toToman(basePrice)}
                      onChange={(e) => setBasePrice(fromToman(e.target.value))}
                      slotProps={{
                        htmlInput: { min: 0, step: 1 },
                        input: { endAdornment: <InputAdornment position="end">{currency}</InputAdornment> },
                      }}
                      fullWidth
                      required
                    />
                    <AmountInWords amount={basePrice} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label={t('catalog.productDetailPage.general.maxPerOrder', 'Most per order')}
                      type="number"
                      value={maxPerOrder}
                      onChange={(e) => setMaxPerOrder(e.target.value)}
                      helperText={
                        <>
                          {t('catalog.productDetailPage.general.maxPerOrderHelp', 'Empty for no limit')}{' '}
                          <VersionTag feature="catalog.maxPerOrder" />
                        </>
                      }
                      slotProps={{ htmlInput: { min: 1, step: 1 } }}
                      fullWidth
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label={t('catalog.productDetailPage.general.taxRate')}
                      type="number"
                      value={taxRate}
                      onChange={(e) => setTaxRate(e.target.value)}
                      slotProps={{
                        htmlInput: { min: 0, max: 100, step: 0.01 },
                        input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                      }}
                      fullWidth
                    />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <TextField
                      label={t('catalog.productDetailPage.general.description')}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      fullWidth
                      multiline
                      rows={3}
                    />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <Typography variant="overline" color="text.secondary">
                      {t('catalog.productsPage.identifiersTitle')}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label={t('catalog.productDetailPage.general.code')}
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      helperText={t('catalog.productsPage.codeHelp')}
                      slotProps={{ htmlInput: { maxLength: 32 } }}
                      fullWidth
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label={t('catalog.productDetailPage.general.barcode')}
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      fullWidth
                    />
                  </Grid>
                </Grid>

                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    type="submit"
                    variant="contained"
                    startIcon={<SaveIcon />}
                    disabled={savingGeneral || !canAuthor}
                    sx={{ fontWeight: 'bold', px: 4 }}
                  >
                    {savingGeneral ? t('catalog.productDetailPage.general.saving') : t('catalog.productDetailPage.general.save')}
                  </Button>
                </Box>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, md: 4 }}>
              <Card sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                  {t('catalog.productDetailPage.general.imageTitle')}
                </Typography>
                <ProductPhotos ids={photoIds} onChange={setPhotoIds} disabled={!canAuthor} />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  {t('catalog.productDetailPage.photos.help', 'The starred photo is the main one. Save to keep changes.')}
                </Typography>
              </Card>

              <Card sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                  {t('catalog.productDetailPage.onSale.title', 'On sale')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {t('catalog.productDetailPage.onSale.help')}
                </Typography>
                <Stack spacing={1.5}>
                  {(variants.length ? variants.map((v) => ({ id: v.id as string | null, name: v.name })) : [{ id: null, name: product?.name || '' }]).map((row) => (
                    <TextField
                      key={row.id || 'whole'}
                      select
                      size="small"
                      fullWidth
                      label={row.name}
                      value={stockState(row.id)}
                      // A stop on the whole product covers its types; it is changed on the Availability page.
                      disabled={!!row.id && !!liveStop(null)}
                      onChange={(e) => handleStockChange(row.id, e.target.value as 'AVAILABLE' | 'NEXT_SHIFT' | 'FURTHER_NOTICE')}
                      helperText={stockState(row.id) === 'NEXT_SHIFT' ? fDateTime(liveStop(row.id)!.suspended_until!) : undefined}
                    >
                      <MenuItem value="AVAILABLE">{t('catalog.availabilityPage.statusAvailable')}</MenuItem>
                      <MenuItem value="NEXT_SHIFT">{t('catalog.availabilityPage.modeNextShift')}</MenuItem>
                      <MenuItem value="FURTHER_NOTICE">{t('catalog.availabilityPage.modeManual')}</MenuItem>
                    </TextField>
                  ))}
                  <Button size="small" variant="outlined" onClick={() => navigate('/app/catalog/availability')}>
                    {t('catalog.productsPage.manageAvailability', 'Manage availability')}
                  </Button>
                </Stack>
              </Card>

              {id && <ProductItemDiscounts productId={id} canAuthor={canAuthor} />}
            </Grid>
          </Grid>
        </form>
      )}

      {/* TAB 1: Product Variants */}
      {currentTab === 1 && (
        <Card sx={{ p: 3 }}>
          <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('catalog.productDetailPage.variants.title')}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {t('catalog.productDetailPage.variants.subtitle')}
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleOpenAddVariant}
              sx={{ fontWeight: 'bold' }}
            >
              {t('catalog.productDetailPage.variants.addVariant')}
            </Button>
          </Stack>

          {variants.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', bgcolor: 'background.neutral' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                {t('catalog.productDetailPage.variants.noVariantsTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('catalog.productDetailPage.variants.noVariantsDesc', { currency: currencyLabel, price: MoneyUtil.formatCurrency(basePrice) })}
              </Typography>
              <Button variant="outlined" startIcon={<AddIcon />} onClick={handleOpenAddVariant}>
                {t('catalog.productDetailPage.variants.createFirst')}
              </Button>
            </Paper>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>{t('catalog.productDetailPage.variants.default')}</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{t('catalog.productDetailPage.variants.variantName')}</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{t('catalog.productDetailPage.variants.code')}</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{t('catalog.productDetailPage.variants.barcode')}</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{t('catalog.productDetailPage.variants.basePrice')}</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }} align="right">{t('catalog.productDetailPage.variants.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {variants.map((v) => (
                    <TableRow key={v.id} hover>
                      <TableCell>
                        <IconButton
                          size="small"
                          color={v.is_default ? 'warning' : 'default'}
                          onClick={() => handleSetDefaultVariant(v.id)}
                          title={v.is_default ? t('catalog.productDetailPage.variants.isDefaultTitle') : t('catalog.productDetailPage.variants.setDefaultTitle')}
                        >
                          {v.is_default ? <StarIcon /> : <StarBorderIcon />}
                        </IconButton>
                        {v.is_default && (
                          <Chip label={t('catalog.productDetailPage.variants.defaultBadge')} size="small" color="primary" sx={{ ml: 1, fontSize: '0.7rem' }} />
                        )}
                      </TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>{v.name}</TableCell>
                      <TableCell>{v.code}</TableCell>
                      <TableCell>{v.barcode || '—'}</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>
                        <span dir="ltr">{MoneyUtil.formatCurrency(v.base_price)} {currency}</span>
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleOpenEditVariant(v)}
                          aria-label={t('catalog.productDetailPage.variants.editAria', { name: v.name })}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteVariant(v.id)}
                          aria-label={t('catalog.productDetailPage.variants.deleteAria', { name: v.name })}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Card>
      )}

      {currentTab === 3 && id && <ProductPriceHistory productId={id} />}

      {/* TAB 2: Add-ons, as Snappfood's product page has them: every group, a switch per add-on */}
      {currentTab === 2 && (
        <Card sx={{ p: 3 }}>
          <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                {t('catalog.productDetailPage.modifiers.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {t('catalog.productDetailPage.modifiers.subtitle')}
              </Typography>
            </Box>
            {canAuthor && (
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setSheet({ group: null })} sx={{ fontWeight: 'bold', flexShrink: 0 }}>
                {t('catalog.productDetailPage.modifiers.newGroup')}
              </Button>
            )}
          </Stack>

          {allOptionGroups.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', bgcolor: 'background.neutral' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                {t('catalog.productDetailPage.modifiers.noGroupsTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('catalog.productDetailPage.modifiers.noGroupsDesc')}
              </Typography>
            </Paper>
          ) : (
            <Stack spacing={2}>
              {allOptionGroups.map((group) => {
                const on = offeredIds(group);
                return (
                  <Card key={group.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                          {group.name}
                        </Typography>
                        <Typography variant="caption" color={addonMin(group) > 0 ? 'warning.main' : 'text.secondary'}>
                          {addonRuleLabel(t, group)}
                        </Typography>
                      </Box>
                      {canAuthor && (
                        <Button size="small" startIcon={<EditIcon fontSize="small" />} onClick={() => setSheet({ group })}>
                          {t('catalog.productDetailPage.modifiers.editGroup')}
                        </Button>
                      )}
                    </Stack>

                    <Stack>
                      {(group.items || []).map((item) => (
                        <Stack
                          key={item.id}
                          sx={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', py: 0.5, borderTop: 1, borderColor: 'divider' }}
                        >
                          <Typography variant="body2" color={on.has(item.id) ? 'text.primary' : 'text.secondary'}>
                            {item.name}
                          </Typography>
                          <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" color="text.secondary">
                              <span dir="ltr">
                                {Number(item.price_delta) > 0
                                  ? `${MoneyUtil.formatCurrency(item.price_delta)} ${currency}`
                                  : t('catalog.productDetailPage.modifiers.free')}
                              </span>
                            </Typography>
                            <Switch
                              size="small"
                              checked={on.has(item.id)}
                              disabled={!canAuthor}
                              onChange={(e) => handleToggleOptionItem(group, item.id, e.target.checked)}
                              slotProps={{ input: { 'aria-label': t('catalog.productDetailPage.modifiers.offerAria', { name: item.name }) } }}
                            />
                          </Stack>
                        </Stack>
                      ))}
                    </Stack>
                  </Card>
                );
              })}
            </Stack>
          )}
        </Card>
      )}

      {/* Add / Edit Variant Dialog */}
      <Dialog open={variantDialogOpen} onClose={() => setVariantDialogOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleSaveVariant}>
          <DialogTitle sx={{ fontWeight: 'bold' }}>
            {editingVariant ? t('catalog.productDetailPage.variants.editDialogTitle') : t('catalog.productDetailPage.variants.addDialogTitle')}
          </DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label={t('catalog.productDetailPage.variants.variantCode')}
                  placeholder="e.g. VAR-CHB-DBL"
                  value={varCode}
                  onChange={(e) => setVarCode(e.target.value.toUpperCase())}
                  fullWidth
                  required
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label={t('catalog.productDetailPage.variants.variantName')}
                  placeholder="e.g. Double Patty"
                  value={varName}
                  onChange={(e) => setVarName(e.target.value)}
                  fullWidth
                  required
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label={t('catalog.productDetailPage.variants.barcode')}
                  value={varBarcode}
                  onChange={(e) => setVarBarcode(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label={t('catalog.productDetailPage.variants.basePrice')}
                  type="number"
                  value={toToman(varPrice)}
                  onChange={(e) => setVarPrice(fromToman(e.target.value))}
                  slotProps={{
                    htmlInput: { min: 0, step: 1 },
                    input: { endAdornment: <InputAdornment position="end">{currency}</InputAdornment> },
                  }}
                  fullWidth
                  required
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label={t('catalog.productDetailPage.variants.sortOrder')}
                  type="number"
                  value={varSortOrder}
                  onChange={(e) => setVarSortOrder(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={varIsDefault}
                      onChange={(e) => setVarIsDefault(e.target.checked)}
                      // The default moves by making another size the default, never by switching it off here.
                      disabled={!!editingVariant?.is_default}
                      color="primary"
                    />
                  }
                  label={t('catalog.productDetailPage.variants.setDefaultSwitch')}
                />
                {editingVariant?.is_default && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {t('catalog.productDetailPage.variants.defaultMovesHint')}
                  </Typography>
                )}
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setVariantDialogOpen(false)}>{t('catalog.productDetailPage.variants.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={savingVariant} sx={{ fontWeight: 'bold' }}>
              {savingVariant ? t('catalog.productDetailPage.variants.savingVariant') : t('catalog.productDetailPage.variants.saveVariant')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <AddonGroupSheet open={!!sheet} group={sheet?.group ?? null} onClose={() => setSheet(null)} onSaved={handleGroupSaved} />
    </Container>
  );
}

export default ProductDetailPage;
