import type { Product, Category, OptionGroup } from 'src/api/catalogApi';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useMemo, useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import TuneIcon from '@mui/icons-material/Tune';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import FastfoodIcon from '@mui/icons-material/Fastfood';
import StorefrontIcon from '@mui/icons-material/Storefront';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  Box,
  Card,
  Chip,
  Stack,
  Table,
  Paper,
  Alert,
  Avatar,
  Button,
  Drawer,
  Select,
  Dialog,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  InputLabel,
  CardContent,
  FormControl,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
  InputAdornment,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyCode } from 'src/utils/currency';
import { percentToTaxRate, taxRateToPercent } from 'src/utils/tax-rate';

import { catalogApi } from 'src/api/catalogApi';
import { useAuthStore } from 'src/store/useAuthStore';

import { ImageUploader } from 'src/components/ImageUploader';

// The whole catalog is rated at the standard 9% VAT, so a product added through
// this form starts there too. The old 10% default meant every hand-added product
// was silently off-rate against everything the seed produces.
const DEFAULT_TAX_PERCENT = '9';

/** A product's price, or the range of its sizes' prices when it is sold in sizes. */
const priceLabel = (p: Product, currency: string) => {
  const sizes = p.variants || [];
  if (!sizes.length) return `${MoneyUtil.formatCurrency(p.base_price)} ${currency}`;
  const prices = sizes.map((v) => Number(v.base_price || 0));
  const [low, high] = [Math.min(...prices), Math.max(...prices)];
  return low === high
    ? `${MoneyUtil.formatCurrency(low)} ${currency}`
    : `${MoneyUtil.formatCurrency(low)} – ${MoneyUtil.formatCurrency(high)} ${currency}`;
};

export function ProductsPage() {
  const currency = useCurrencyCode();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Products belong to the chain. A branch reads this screen to know what it may serve,
  // and goes to Availability to say whether it can serve it today. The API refuses these
  // writes anyway, so offering buttons that 403 would be a worse way to say the same thing.
  // Undefined means the account has not loaded yet: assume the wider case and let the
  // server decide, rather than flashing a read-only screen at head office.
  const canAuthor = useAuthStore((state) => state.user?.isHeadOffice) !== false;

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allOptionGroups, setAllOptionGroups] = useState<OptionGroup[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ON' | 'OFF'>('ALL');
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [basePrice, setBasePrice] = useState('1500000');
  const [productType, setProductType] = useState<'STANDARD' | 'COMBO'>('STANDARD');
  const [taxPercent, setTaxPercent] = useState(DEFAULT_TAX_PERCENT);
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [description, setDescription] = useState('');
  const [imageAssetId, setImageAssetId] = useState<string | undefined>(undefined);

  // Attach Option Group Dialog
  const [attachDialogOpen, setAttachDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedOptionGroupId, setSelectedOptionGroupId] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const cList = await catalogApi.getCategories();
      setCategories(cList);
      const pList = await catalogApi.getProducts(selectedCategoryId || undefined);
      setProducts(pList);
      const ogList = await catalogApi.getOptionGroups();
      setAllOptionGroups(ogList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('catalog.productsPage.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [selectedCategoryId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryId) {
      setError(t('catalog.productsPage.errors.selectCategory'));
      return;
    }
    try {
      await catalogApi.createProduct({
        code,
        name,
        category_id: categoryId,
        base_price: basePrice,
        product_type: productType,
        tax_rate: percentToTaxRate(taxPercent),
        sku,
        barcode,
        description,
        image_asset_id: imageAssetId,
      });
      setDrawerOpen(false);
      resetForm();
      loadData();
    } catch (err: any) {
      setError(err.detail || t('catalog.productsPage.errors.createFailed'));
    }
  };

  const resetForm = () => {
    setCode('');
    setName('');
    setCategoryId('');
    setBasePrice('1500000');
    setProductType('STANDARD');
    setTaxPercent(DEFAULT_TAX_PERCENT);
    setSku('');
    setBarcode('');
    setDescription('');
    setImageAssetId(undefined);
  };

  // Search by name, code, SKU or barcode, within the picked category and status.
  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (statusFilter === 'ALL' || (statusFilter === 'ON') === p.is_active) &&
        (!q || [p.name, p.code, p.sku, p.barcode].some((field) => (field || '').toLowerCase().includes(q)))
    );
  }, [products, search, statusFilter]);

  const handleArchive = async (id: string, prodName: string) => {
    if (window.confirm(t('catalog.productsPage.archiveConfirm', { name: prodName }))) {
      try {
        await catalogApi.archiveProduct(id);
        loadData();
      } catch (err: any) {
        setError(err.detail || t('catalog.productsPage.errors.archiveFailed'));
      }
    }
  };

  const handleOpenAttachDialog = (prod: Product) => {
    setSelectedProduct(prod);
    setAttachDialogOpen(true);
  };

  const handleAttachOptionGroup = async () => {
    if (!selectedProduct || !selectedOptionGroupId) return;
    try {
      await catalogApi.attachOptionGroup(selectedProduct.id, selectedOptionGroupId);
      setAttachDialogOpen(false);
      setSelectedProduct(null);
      setSelectedOptionGroupId('');
      loadData();
    } catch (err: any) {
      setError(err.detail || t('catalog.productsPage.errors.attachFailed'));
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('catalog.productsPage.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('catalog.productsPage.subtitle')}
          </Typography>
        </Box>
        {canAuthor ? (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setDrawerOpen(true)}
            sx={{ fontWeight: 'bold' }}
          >
            {t('catalog.productsPage.newProduct')}
          </Button>
        ) : (
          <Button
            variant="contained"
            startIcon={<StorefrontIcon />}
            onClick={() => navigate('/app/catalog/availability')}
            sx={{ fontWeight: 'bold' }}
          >
            {t('catalog.productsPage.manageAvailability', 'Manage availability')}
          </Button>
        )}
      </Stack>

      {!canAuthor && (
        <Alert severity="info" icon={<StorefrontIcon />} sx={{ mb: 3 }}>
          {t(
            'catalog.productsPage.readOnlyNotice',
            'Head office sets the menu for the whole chain, so these products are read-only here. What your branch decides is whether it can serve them today — that lives on Availability.'
          )}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Search and filters */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('catalog.productsPage.searchPlaceholder')}
          sx={{ flex: 1, maxWidth: { sm: 360 } }}
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
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>{t('catalog.productsPage.category')}</InputLabel>
          <Select
            value={selectedCategoryId}
            label={t('catalog.productsPage.category')}
            onChange={(e) => setSelectedCategoryId(e.target.value)}
          >
            <MenuItem value="">{t('catalog.productsPage.allCategories')}</MenuItem>
            {categories.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.parent_id ? `└ ${c.name}` : c.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>{t('common.status', 'Status')}</InputLabel>
          <Select
            value={statusFilter}
            label={t('common.status', 'Status')}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'ON' | 'OFF')}
          >
            <MenuItem value="ALL">{t('catalog.productsPage.statusAll')}</MenuItem>
            <MenuItem value="ON">{t('catalog.productsPage.onMenu')}</MenuItem>
            <MenuItem value="OFF">{t('catalog.productsPage.offMenu')}</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 0 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('catalog.productsPage.name')}</TableCell>
                  <TableCell>{t('catalog.productsPage.category')}</TableCell>
                  <TableCell align="right">{t('catalog.productsPage.basePrice')}</TableCell>
                  <TableCell align="center">{t('catalog.productsPage.sizes')}</TableCell>
                  <TableCell align="center">{t('catalog.productsPage.taxRate')}</TableCell>
                  <TableCell>{t('common.status', 'Status')}</TableCell>
                  <TableCell align="center">{t('catalog.productsPage.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleProducts.map((p) => {
                  const catObj = categories.find((c) => c.id === p.category_id);
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                          <Avatar variant="rounded" src={p.image_url || undefined} alt="" sx={{ width: 44, height: 44, bgcolor: 'action.hover' }}>
                            <FastfoodIcon fontSize="small" color="disabled" />
                          </Avatar>
                          <Box>
                            <Typography variant="subtitle2">
                              {p.name}
                              {p.product_type === 'COMBO' && (
                                <Chip label={t('catalog.productsPage.comboBadge')} size="small" color="secondary" sx={{ ml: 1 }} />
                              )}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" component="code">
                              {p.code}
                            </Typography>
                          </Box>
                        </Stack>
                      </TableCell>
                      <TableCell>{catObj ? catObj.name : '—'}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                        <span dir="ltr">{priceLabel(p, currency)}</span>
                      </TableCell>
                      <TableCell align="center">{p.variants?.length || '—'}</TableCell>
                      <TableCell align="center">
                        <Chip label={`${taxRateToPercent(p.tax_rate)}%`} size="small" />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={p.is_active ? t('catalog.productsPage.onMenu') : t('catalog.productsPage.offMenu')}
                          color={p.is_active ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="center">
                        <IconButton
                          title={
                            canAuthor
                              ? t('catalog.productsPage.editDetails')
                              : t('catalog.productsPage.viewDetails', 'View details')
                          }
                          color="primary"
                          onClick={() => navigate(`/app/catalog/products/${p.id}`)}
                        >
                          {canAuthor ? <EditIcon /> : <VisibilityIcon />}
                        </IconButton>
                        {canAuthor && (
                          <>
                            <IconButton
                              title={t('catalog.productsPage.attachModifier')}
                              color="info"
                              onClick={() => handleOpenAttachDialog(p)}
                            >
                              <TuneIcon />
                            </IconButton>
                            <IconButton
                              title={t('catalog.productsPage.archive')}
                              color="error"
                              onClick={() => handleArchive(p.id, p.name)}
                            >
                              <DeleteIcon />
                            </IconButton>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {visibleProducts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      {t('catalog.productsPage.noMatches')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create Product Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: { xs: '100vw', sm: 450 }, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            {t('catalog.productsPage.createDrawerTitle')}
          </Typography>
          <form onSubmit={handleCreate}>
            <Stack spacing={2.5}>
              <FormControl fullWidth required>
                <InputLabel>{t('catalog.productsPage.category')}</InputLabel>
                <Select
                  value={categoryId}
                  label={t('catalog.productsPage.category')}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  {categories.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label={t('catalog.productsPage.code')}
                placeholder={t('catalog.productsPage.codeHint')}
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />

              <TextField
                label={t('catalog.productsPage.name')}
                placeholder={t('catalog.productsPage.nameHint')}
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <FormControl fullWidth>
                <InputLabel>{t('catalog.productsPage.productType')}</InputLabel>
                <Select
                  value={productType}
                  label={t('catalog.productsPage.productType')}
                  onChange={(e) => setProductType(e.target.value as 'STANDARD' | 'COMBO')}
                >
                  <MenuItem value="STANDARD">{t('catalog.productsPage.typeStandard')}</MenuItem>
                  <MenuItem value="COMBO">{t('catalog.productsPage.typeCombo')}</MenuItem>
                </Select>
              </FormControl>
              {productType === 'COMBO' && (
                <Alert severity="info">{t('catalog.productsPage.comboHelp')}</Alert>
              )}

              <TextField
                label={t('catalog.productsPage.basePrice')}
                type="number"
                required
                fullWidth
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                slotProps={{
                  htmlInput: { min: 0, step: 1 },
                  input: { endAdornment: <InputAdornment position="end">{currency}</InputAdornment> },
                }}
              />

              <TextField
                label={t('catalog.productsPage.taxRate')}
                type="number"
                fullWidth
                value={taxPercent}
                onChange={(e) => setTaxPercent(e.target.value)}
                slotProps={{
                  htmlInput: { min: 0, max: 100, step: 0.01 },
                  input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                }}
              />

              <ImageUploader
                label={t('catalog.productsPage.productImage')}
                onUploadSuccess={(asset) => setImageAssetId(asset.id)}
              />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                {t('catalog.productsPage.submitCreate')}
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>

      {/* Attach Option Group Dialog */}
      <Dialog open={attachDialogOpen} onClose={() => setAttachDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('catalog.productsPage.attachModalTitle', { name: selectedProduct?.name })}
        </DialogTitle>
        <DialogContent sx={{ minWidth: 360, pt: 2 }}>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>{t('catalog.productsPage.selectOptionGroup')}</InputLabel>
            <Select
              value={selectedOptionGroupId}
              label={t('catalog.productsPage.selectOptionGroup')}
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
          <Button onClick={() => setAttachDialogOpen(false)}>{t('catalog.productsPage.cancel')}</Button>
          <Button variant="contained" onClick={handleAttachOptionGroup} sx={{ fontWeight: 'bold' }}>
            {t('catalog.productsPage.submitAttach')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
