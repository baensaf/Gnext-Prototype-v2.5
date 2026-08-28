import type { Product, Category, OptionGroup } from 'src/api/catalogApi';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import TuneIcon from '@mui/icons-material/Tune';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Box,
  Card,
  Chip,
  Stack,
  Table,
  Paper,
  Alert,
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
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';

import { catalogApi } from 'src/api/catalogApi';

import { ImageUploader } from 'src/components/ImageUploader';

export function ProductsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allOptionGroups, setAllOptionGroups] = useState<OptionGroup[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [basePrice, setBasePrice] = useState('1500000');
  const [taxRate, setTaxRate] = useState('0.1000');
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
        tax_rate: taxRate,
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
    setTaxRate('0.1000');
    setSku('');
    setBarcode('');
    setDescription('');
    setImageAssetId(undefined);
  };

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
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          {t('catalog.productsPage.newProduct')}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Category Filter */}
      <Box sx={{ mb: 3, maxWidth: 300 }}>
        <FormControl fullWidth size="small">
          <InputLabel>{t('catalog.productsPage.category')}</InputLabel>
          <Select
            value={selectedCategoryId}
            label={t('catalog.productsPage.category')}
            onChange={(e) => setSelectedCategoryId(e.target.value)}
          >
            <MenuItem value="">{t('catalog.productsPage.allCategories')}</MenuItem>
            {categories.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name} ({c.code})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 0 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('catalog.productsPage.code')}</TableCell>
                  <TableCell>{t('catalog.productsPage.name')}</TableCell>
                  <TableCell>{t('catalog.productsPage.category')}</TableCell>
                  <TableCell align="right">{t('catalog.productsPage.basePrice')}</TableCell>
                  <TableCell align="center">{t('catalog.productsPage.taxRate')}</TableCell>
                  <TableCell>{t('common.status', 'Status')}</TableCell>
                  <TableCell align="center">{t('catalog.productsPage.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {products.map((p) => {
                  const catObj = categories.find((c) => c.id === p.category_id);
                  return (
                    <TableRow key={p.id}>
                      <TableCell><code>{p.code}</code></TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>{p.name}</TableCell>
                      <TableCell>{catObj ? catObj.name : '—'}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                        <span dir="ltr">{MoneyUtil.formatCurrency(p.base_price)} IRR</span>
                      </TableCell>
                      <TableCell align="center">
                        <Chip label={`${MoneyUtil.multiply(p.tax_rate || '0', '100', 0)}%`} size="small" />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={p.is_active ? t('common.active', 'Active') : t('common.archived', 'Archived')}
                          color={p.is_active ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="center">
                        <IconButton
                          title={t('catalog.productsPage.editDetails')}
                          color="primary"
                          onClick={() => navigate(`/app/catalog/products/${p.id}`)}
                        >
                          <EditIcon />
                        </IconButton>
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
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create Product Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 450, p: 3 }}>
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
                placeholder="e.g. PROD-DOUBLEBURGER"
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />

              <TextField
                label={t('catalog.productsPage.name')}
                placeholder="e.g. Double Beef Burger"
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <TextField
                label={t('catalog.productsPage.basePrice')}
                type="number"
                required
                fullWidth
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
              />

              <TextField
                label={t('catalog.productsPage.taxRate')}
                placeholder="e.g. 0.1000 for 10%"
                fullWidth
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
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
