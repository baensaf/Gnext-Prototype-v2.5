import type {
  Product,
  Category,
  OptionGroup,
  ProductVariant,
  ProductAvailability,
  AvailabilitySchedule,
} from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import StarIcon from '@mui/icons-material/Star';
import TuneIcon from '@mui/icons-material/Tune';
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
  FormControlLabel,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';

import { catalogApi } from 'src/api/catalogApi';
import { useAuthStore } from 'src/store/useAuthStore';
import { useBranchContext } from 'src/contexts/branch-context';

import { AmountInWords } from 'src/components/amount-in-words';

import { ProductPhotos } from './product-photos';
import { ProductPriceHistory } from './product-price-history';

export function ProductDetailPage() {
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
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [description, setDescription] = useState('');
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [containerPrice, setContainerPrice] = useState('0');
  const [maxPerOrder, setMaxPerOrder] = useState('');
  const [savingGeneral, setSavingGeneral] = useState(false);

  // What the branch side says about this item right now, shown beside what head office set.
  const { selectedBranchId } = useBranchContext();
  const [stops, setStops] = useState<ProductAvailability[]>([]);
  const [windows, setWindows] = useState<AvailabilitySchedule[]>([]);

  // Variant Modal State
  const [variantDialogOpen, setVariantDialogOpen] = useState(false);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [varCode, setVarCode] = useState('');
  const [varName, setVarName] = useState('');
  const [varSku, setVarSku] = useState('');
  const [varBarcode, setVarBarcode] = useState('');
  const [varPrice, setVarPrice] = useState('');
  const [varIsDefault, setVarIsDefault] = useState(false);
  const [varSortOrder, setVarSortOrder] = useState('0');
  const [savingVariant, setSavingVariant] = useState(false);

  // Option Group Modal State
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [selectedOptionGroupId, setSelectedOptionGroupId] = useState('');
  const [attachingGroup, setAttachingGroup] = useState(false);

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

      setCode(prod.code);
      setName(prod.name);
      setCategoryId(prod.category_id);
      setBasePrice(prod.base_price || '0');
      setTaxRate(prod.tax_rate || '0.1000');
      setSku(prod.sku || '');
      setBarcode(prod.barcode || '');
      setDescription(prod.description || '');
      setPhotoIds([prod.image_asset_id, ...(prod.gallery_asset_ids || [])].filter(Boolean) as string[]);
      setContainerPrice(String(Number(prod.container_price || 0)));
      setMaxPerOrder(prod.max_per_order ? String(prod.max_per_order) : '');
      setError(null);

      const [aList, sList] = await Promise.all([
        catalogApi.getAvailabilities(selectedBranchId || undefined).catch(() => [] as ProductAvailability[]),
        catalogApi.getSchedules(selectedBranchId || undefined).catch(() => [] as AvailabilitySchedule[]),
      ]);
      // The item's own stops here; a Snappfood-only stop does not take it off at the counter.
      setStops(aList.filter((a) => a.product_id === prod.id && !a.variant_id && !a.channel));
      const own = sList.filter((s) => s.is_active && s.product_id === prod.id);
      setWindows(
        own.length
          ? own
          : sList.filter((s) => s.is_active && !!prod.category_id && s.category_id === prod.category_id)
      );
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.productDetailPage.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, t, selectedBranchId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const liveStop = stops.find(
    (a) => a.is_suspended && (!a.suspended_until || new Date(a.suspended_until) > new Date())
  );

  /** Items of a group this product offers, as Snappfood's per-product add-on switch. */
  const handleToggleOptionItem = async (group: OptionGroup, itemId: string, offered: boolean) => {
    if (!id) return;
    const excluded = new Set(group.excluded_item_ids || []);
    if (offered) excluded.delete(itemId);
    else excluded.add(itemId);
    try {
      await catalogApi.setExcludedOptionItems(id, group.id, [...excluded]);
      setProduct((p) =>
        p
          ? {
              ...p,
              optionGroups: (p.optionGroups || []).map((g) =>
                g.id === group.id ? { ...g, excluded_item_ids: [...excluded] } : g
              ),
            }
          : p
      );
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.productDetailPage.errors.saveFailed'));
    }
  };

  const handleDetachGroup = async (groupId: string) => {
    if (!id) return;
    if (!window.confirm(t('catalog.productDetailPage.modifiers.detachConfirm', 'Take this add-on group off this product?')))
      return;
    try {
      await catalogApi.detachOptionGroup(id, groupId);
      setProduct(await catalogApi.getProductById(id));
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
        code,
        name,
        category_id: categoryId,
        base_price: basePrice,
        tax_rate: taxRate,
        sku: sku || undefined,
        barcode: barcode || undefined,
        description: description || undefined,
        image_asset_id: photoIds[0] || undefined,
        gallery_asset_ids: photoIds.slice(1),
        container_price: containerPrice || '0',
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
    setVarSku('');
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
    setVarSku(v.sku || '');
    setVarBarcode(v.barcode || '');
    setVarPrice(v.base_price || '0');
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
          sku: varSku || undefined,
          barcode: varBarcode || undefined,
          base_price: varPrice,
          is_default: varIsDefault,
          sort_order: parseInt(varSortOrder, 10) || 0,
        });
      } else {
        await catalogApi.createProductVariant(id, {
          code: varCode,
          name: varName,
          sku: varSku || undefined,
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

  const handleAttachOptionGroup = async () => {
    if (!id || !selectedOptionGroupId) return;
    setAttachingGroup(true);
    try {
      await catalogApi.attachOptionGroup(id, selectedOptionGroupId);
      setAttachDialogOpen(false);
      setSelectedOptionGroupId('');
      const prod = await catalogApi.getProductById(id);
      setProduct(prod);
      setSuccessMsg(t('catalog.productDetailPage.messages.groupAttached'));
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.productDetailPage.errors.attachGroupFailed'));
    } finally {
      setAttachingGroup(false);
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
          <Chip label={product?.code} variant="outlined" sx={{ fontWeight: 'bold' }} />
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
          <Tab label={t('catalog.productDetailPage.tabs.priceHistory')} />
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
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label={t('catalog.productDetailPage.general.code')}
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      fullWidth
                      required
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
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
                      label={t('catalog.productDetailPage.general.basePrice')}
                      type="number"
                      value={basePrice}
                      onChange={(e) => setBasePrice(e.target.value)}
                      fullWidth
                      required
                    />
                    <AmountInWords amount={basePrice} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label={t('catalog.productDetailPage.general.containerPrice', 'Packaging price')}
                      type="number"
                      value={containerPrice}
                      onChange={(e) => setContainerPrice(e.target.value)}
                      helperText={t(
                        'catalog.productDetailPage.general.containerPriceHelp',
                        'Per unit, for delivery apps. Recorded for the Snappfood menu; not charged on orders here yet.'
                      )}
                      fullWidth
                    />
                    <AmountInWords amount={containerPrice} />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label={t('catalog.productDetailPage.general.maxPerOrder', 'Most per order')}
                      type="number"
                      value={maxPerOrder}
                      onChange={(e) => setMaxPerOrder(e.target.value)}
                      helperText={t('catalog.productDetailPage.general.maxPerOrderHelp', 'Empty for no limit')}
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
                      fullWidth
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label={t('catalog.productDetailPage.general.sku')}
                      value={sku}
                      onChange={(e) => setSku(e.target.value)}
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

              <Card sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                  {t('catalog.productDetailPage.onSale.title', 'On sale')}
                </Typography>
                <Stack spacing={1.5}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {t('catalog.productDetailPage.onSale.status', 'Availability')}
                    </Typography>
                    <Box>
                      {liveStop ? (
                        <Chip
                          size="small"
                          color={liveStop.suspended_until ? 'warning' : 'default'}
                          label={
                            liveStop.suspended_until
                              ? t('catalog.availabilityPage.statusOffUntil', {
                                  defaultValue: 'Unavailable until {{time}}',
                                  time: fDateTime(liveStop.suspended_until),
                                })
                              : t('catalog.availabilityPage.statusOffManual', 'Unavailable until further notice')
                          }
                        />
                      ) : (
                        <Chip size="small" color="success" label={t('catalog.availabilityPage.statusAvailable')} />
                      )}
                    </Box>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {t('catalog.productDetailPage.onSale.menuTime', 'Menu time')}
                    </Typography>
                    <Typography variant="body2">
                      {windows.length
                        ? windows.map((w) => `${w.label ? `${w.label} ` : ''}${w.start_time}–${w.end_time}`).join('، ')
                        : t('catalog.productDetailPage.onSale.allDay', 'All day')}
                    </Typography>
                  </Box>
                  <Button size="small" variant="outlined" onClick={() => navigate('/app/catalog/availability')}>
                    {t('catalog.productsPage.manageAvailability', 'Manage availability')}
                  </Button>
                </Stack>
              </Card>
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
                {t('catalog.productDetailPage.variants.noVariantsDesc', { price: MoneyUtil.formatCurrency(basePrice) })}
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
                    <TableCell sx={{ fontWeight: 'bold' }}>{t('catalog.productDetailPage.variants.sku')}</TableCell>
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
                      <TableCell>{v.sku || '—'}</TableCell>
                      <TableCell>{v.barcode || '—'}</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>
                        <span dir="ltr">{MoneyUtil.formatCurrency(v.base_price)} IRR</span>
                      </TableCell>
                      <TableCell align="right">
                        <IconButton size="small" color="primary" onClick={() => handleOpenEditVariant(v)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => handleDeleteVariant(v.id)}>
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

      {/* TAB 2: Modifiers & Option Groups */}
      {currentTab === 2 && (
        <Card sx={{ p: 3 }}>
          <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('catalog.productDetailPage.modifiers.title')}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {t('catalog.productDetailPage.modifiers.subtitle')}
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<TuneIcon />}
              onClick={() => setAttachDialogOpen(true)}
              sx={{ fontWeight: 'bold' }}
            >
              {t('catalog.productDetailPage.modifiers.attachGroup')}
            </Button>
          </Stack>

          {(!product?.optionGroups || product.optionGroups.length === 0) ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', bgcolor: 'background.neutral' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                {t('catalog.productDetailPage.modifiers.noGroupsTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('catalog.productDetailPage.modifiers.noGroupsDesc')}
              </Typography>
              <Button variant="outlined" startIcon={<TuneIcon />} onClick={() => setAttachDialogOpen(true)}>
                {t('catalog.productDetailPage.modifiers.attachGroup')}
              </Button>
            </Paper>
          ) : (
            <Grid container spacing={2}>
              {product.optionGroups.map((group) => (
                <Grid key={group.id} size={{ xs: 12, md: 6 }}>
                  <Card variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                        {group.name}
                      </Typography>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        {group.is_required && (
                          <Chip label={t('catalog.productDetailPage.modifiers.requiredBadge')} color="error" size="small" />
                        )}
                        {canAuthor && (
                          <IconButton
                            size="small"
                            color="error"
                            title={t('catalog.productDetailPage.modifiers.detach', 'Remove from this product')}
                            onClick={() => handleDetachGroup(group.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Stack>
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                      {t('catalog.productDetailPage.modifiers.code')}: {group.code} • {t('catalog.productDetailPage.modifiers.min')}: {group.min_selection} • {t('catalog.productDetailPage.modifiers.max')}: {group.max_selection}
                    </Typography>

                    <Stack spacing={0.5}>
                      {group.items?.map((item) => (
                        <Stack
                          key={item.id}
                          sx={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            py: 0.5,
                            borderBottom: 1,
                            borderColor: 'divider',
                          }}
                        >
                          <Typography
                            variant="body2"
                            color={(group.excluded_item_ids || []).includes(item.id) ? 'text.disabled' : 'text.primary'}
                          >
                            {item.name}
                          </Typography>
                          <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                              <span dir="ltr">
                                {Number(item.price_delta) > 0
                                  ? `+${MoneyUtil.formatCurrency(item.price_delta)} IRR`
                                  : t('catalog.productDetailPage.modifiers.free')}
                              </span>
                            </Typography>
                            {/* Offered on this product, as Snappfood's per-product add-on switch. */}
                            <Switch
                              size="small"
                              checked={!(group.excluded_item_ids || []).includes(item.id)}
                              disabled={!canAuthor}
                              onChange={(e) => handleToggleOptionItem(group, item.id, e.target.checked)}
                            />
                          </Stack>
                        </Stack>
                      ))}
                    </Stack>
                  </Card>
                </Grid>
              ))}
            </Grid>
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
                  label={t('catalog.productDetailPage.variants.sku')}
                  placeholder="e.g. CHB-DBL"
                  value={varSku}
                  onChange={(e) => setVarSku(e.target.value)}
                  fullWidth
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
                  value={varPrice}
                  onChange={(e) => setVarPrice(e.target.value)}
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
                      color="primary"
                    />
                  }
                  label={t('catalog.productDetailPage.variants.setDefaultSwitch')}
                />
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

      {/* Attach Option Group Dialog */}
      <Dialog open={attachDialogOpen} onClose={() => setAttachDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>{t('catalog.productDetailPage.modifiers.dialogTitle')}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>{t('catalog.productDetailPage.modifiers.selectGroup')}</InputLabel>
            <Select
              value={selectedOptionGroupId}
              label={t('catalog.productDetailPage.modifiers.selectGroup')}
              onChange={(e) => setSelectedOptionGroupId(e.target.value)}
            >
              {allOptionGroups.map((og) => (
                <MenuItem key={og.id} value={og.id}>
                  {og.name} ({og.code})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAttachDialogOpen(false)}>{t('catalog.productDetailPage.modifiers.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleAttachOptionGroup}
            disabled={!selectedOptionGroupId || attachingGroup}
            sx={{ fontWeight: 'bold' }}
          >
            {attachingGroup ? t('catalog.productDetailPage.modifiers.attachingButton') : t('catalog.productDetailPage.modifiers.attachButton')}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default ProductDetailPage;
