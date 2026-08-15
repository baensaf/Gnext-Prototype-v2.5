import type { Product, Category, OptionGroup, ProductVariant } from 'src/api/catalogApi';

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

import { catalogApi } from 'src/api/catalogApi';

import { ImageUploader } from 'src/components/ImageUploader';

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

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
  const [imageAssetId, setImageAssetId] = useState<string | undefined>(undefined);
  const [savingGeneral, setSavingGeneral] = useState(false);

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
      setImageAssetId(prod.image_asset_id);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to load product details');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
        image_asset_id: imageAssetId,
      });
      setProduct(updated);
      setSuccessMsg('Product details saved successfully');
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to save product');
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
      setSuccessMsg(editingVariant ? 'Variant updated' : 'Variant added');
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to save variant');
    } finally {
      setSavingVariant(false);
    }
  };

  const handleDeleteVariant = async (variantId: string) => {
    if (!id) return;
    if (!window.confirm('Are you sure you want to archive this variant?')) return;
    try {
      await catalogApi.deleteProductVariant(id, variantId);
      const updatedList = await catalogApi.getProductVariants(id);
      setVariants(updatedList);
      setSuccessMsg('Variant removed');
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to delete variant');
    }
  };

  const handleSetDefaultVariant = async (variantId: string) => {
    if (!id) return;
    try {
      await catalogApi.updateProductVariant(id, variantId, { is_default: true });
      const updatedList = await catalogApi.getProductVariants(id);
      setVariants(updatedList);
      setSuccessMsg('Default variant updated');
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to set default variant');
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
      setSuccessMsg('Modifier group attached');
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to attach modifier group');
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
            {t('common.back', 'Back to Products')}
          </Button>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {product?.name || 'Product Details'}
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

      {/* Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={currentTab} onChange={(_, val) => setCurrentTab(val)}>
          <Tab label="General Info & Pricing" />
          <Tab
            label={
              <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 0.75 }}>
                <span>Variants ({variants.length})</span>
                <Chip label="V5" size="small" color="info" sx={{ height: 18, fontSize: '0.65rem', fontWeight: 'bold' }} />
              </Stack>
            }
          />
          <Tab
            label={
              <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 0.75 }}>
                <span>Modifiers & Options ({product?.optionGroups?.length || 0})</span>
                <Chip label="V5" size="small" color="info" sx={{ height: 18, fontSize: '0.65rem', fontWeight: 'bold' }} />
              </Stack>
            }
          />
        </Tabs>
      </Box>

      {/* TAB 0: General Info & Pricing */}
      {currentTab === 0 && (
        <form onSubmit={handleSaveGeneral}>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 8 }}>
              <Card sx={{ p: 3, mb: 3 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                  Basic Product Information
                </Typography>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Product Code"
                      value={code}
                      onChange={(e) => setCode(e.target.value.toUpperCase())}
                      fullWidth
                      required
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Product Name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      fullWidth
                      required
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <FormControl fullWidth required>
                      <InputLabel>Category</InputLabel>
                      <Select
                        value={categoryId}
                        label="Category"
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
                      label="Default Base Price (IRR)"
                      type="number"
                      value={basePrice}
                      onChange={(e) => setBasePrice(e.target.value)}
                      fullWidth
                      required
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Tax Rate (e.g. 0.09 for 9%)"
                      type="number"
                      value={taxRate}
                      onChange={(e) => setTaxRate(e.target.value)}
                      fullWidth
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="SKU"
                      value={sku}
                      onChange={(e) => setSku(e.target.value)}
                      fullWidth
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Barcode"
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      fullWidth
                    />
                  </Grid>
                  <Grid size={{ xs: 12 }}>
                    <TextField
                      label="Description"
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
                    disabled={savingGeneral}
                    sx={{ fontWeight: 'bold', px: 4 }}
                  >
                    {savingGeneral ? 'Saving...' : 'Save Product'}
                  </Button>
                </Box>
              </Card>
            </Grid>

            <Grid size={{ xs: 12, md: 4 }}>
              <Card sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                  Product Image
                </Typography>
                <ImageUploader
                  value={imageAssetId}
                  onUploadSuccess={(asset) => setImageAssetId(asset.id)}
                />
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
                  Product Variants
                </Typography>
                <Chip label="V5 Preview" color="info" size="small" sx={{ fontWeight: 'bold' }} />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Configure distinct purchasable versions (e.g. Single Patty, Double Patty, Sizes) with independent SKUs and prices (V5 Feature).
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={handleOpenAddVariant}
              sx={{ fontWeight: 'bold' }}
            >
              Add Variant
            </Button>
          </Stack>

          {variants.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', bgcolor: 'background.neutral' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                No variants configured yet
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                This product currently uses only its single default base price ({MoneyUtil.formatCurrency(basePrice)} IRR).
              </Typography>
              <Button variant="outlined" startIcon={<AddIcon />} onClick={handleOpenAddVariant}>
                Create First Variant
              </Button>
            </Paper>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Default</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Variant Name</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Code</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>SKU</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Barcode</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Base Price</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }} align="right">Actions</TableCell>
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
                          title={v.is_default ? 'Default Variant' : 'Click to set as default'}
                        >
                          {v.is_default ? <StarIcon /> : <StarBorderIcon />}
                        </IconButton>
                        {v.is_default && (
                          <Chip label="Default" size="small" color="primary" sx={{ ml: 1, fontSize: '0.7rem' }} />
                        )}
                      </TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>{v.name}</TableCell>
                      <TableCell>{v.code}</TableCell>
                      <TableCell>{v.sku || '—'}</TableCell>
                      <TableCell>{v.barcode || '—'}</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>
                        {MoneyUtil.formatCurrency(v.base_price)} IRR
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

      {/* TAB 2: Modifiers & Option Groups */}
      {currentTab === 2 && (
        <Card sx={{ p: 3 }}>
          <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  Attached Modifiers & Option Groups
                </Typography>
                <Chip label="V5 Preview" color="info" size="small" sx={{ fontWeight: 'bold' }} />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Optional or required add-ons and preparation customizations (e.g. Extra Cheese, Sauces, Notes) (V5 Feature).
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<TuneIcon />}
              onClick={() => setAttachDialogOpen(true)}
              sx={{ fontWeight: 'bold' }}
            >
              Attach Modifier Group
            </Button>
          </Stack>

          {(!product?.optionGroups || product.optionGroups.length === 0) ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', bgcolor: 'background.neutral' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                No modifier groups attached
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Attach modifier groups to allow cashiers and customers to add toppings or customize preparation.
              </Typography>
              <Button variant="outlined" startIcon={<TuneIcon />} onClick={() => setAttachDialogOpen(true)}>
                Attach Modifier Group
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
                      {group.is_required && <Chip label="REQUIRED" color="error" size="small" />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                      Code: {group.code} • Min: {group.min_selection} • Max: {group.max_selection}
                    </Typography>

                    <Stack spacing={0.5}>
                      {group.items?.map((item) => (
                        <Stack
                          key={item.id}
                          sx={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            py: 0.5,
                            borderBottom: '1px dashed #eee',
                          }}
                        >
                          <Typography variant="body2">{item.name}</Typography>
                          <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                            {Number(item.price_delta) > 0 ? `+${MoneyUtil.formatCurrency(item.price_delta)} IRR` : 'Free'}
                          </Typography>
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
            {editingVariant ? 'Edit Product Variant' : 'Add New Product Variant'}
          </DialogTitle>
          <DialogContent sx={{ pt: 2 }}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Variant Code"
                  placeholder="e.g. VAR-CHB-DBL"
                  value={varCode}
                  onChange={(e) => setVarCode(e.target.value.toUpperCase())}
                  fullWidth
                  required
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Variant Name"
                  placeholder="e.g. Double Patty"
                  value={varName}
                  onChange={(e) => setVarName(e.target.value)}
                  fullWidth
                  required
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="SKU"
                  placeholder="e.g. CHB-DBL"
                  value={varSku}
                  onChange={(e) => setVarSku(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Barcode"
                  value={varBarcode}
                  onChange={(e) => setVarBarcode(e.target.value)}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Variant Base Price (IRR)"
                  type="number"
                  value={varPrice}
                  onChange={(e) => setVarPrice(e.target.value)}
                  fullWidth
                  required
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Sort Order"
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
                  label="Set as Default Variant for this product"
                />
              </Grid>
            </Grid>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setVariantDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={savingVariant} sx={{ fontWeight: 'bold' }}>
              {savingVariant ? 'Saving...' : 'Save Variant'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Attach Option Group Dialog */}
      <Dialog open={attachDialogOpen} onClose={() => setAttachDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>Attach Modifier Group</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Select Option Group</InputLabel>
            <Select
              value={selectedOptionGroupId}
              label="Select Option Group"
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
          <Button onClick={() => setAttachDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleAttachOptionGroup}
            disabled={!selectedOptionGroupId || attachingGroup}
            sx={{ fontWeight: 'bold' }}
          >
            {attachingGroup ? 'Attaching...' : 'Attach Group'}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default ProductDetailPage;
