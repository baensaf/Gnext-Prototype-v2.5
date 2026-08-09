import type { Product, Category, OptionGroup } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
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

import { catalogApi } from 'src/api/catalogApi';

import { ImageUploader } from 'src/components/ImageUploader';

export function ProductsPage() {
  const { t } = useTranslation();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allOptionGroups, setAllOptionGroups] = useState<OptionGroup[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [loading, setLoading] = useState(true);
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

  const loadData = async () => {
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
      setError(err.detail || 'Failed to load products');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedCategoryId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryId) {
      setError('Please select a category');
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
      setError(err.detail || 'Failed to create product');
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
    if (window.confirm(`Are you sure you want to archive product "${prodName}"?`)) {
      try {
        await catalogApi.archiveProduct(id);
        loadData();
      } catch (err: any) {
        setError(err.detail || 'Failed to archive product');
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
      setError(err.detail || 'Failed to attach option group');
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Product Catalog
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage master items, base pricing, tax rates, and modifier option groups
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          Create Product
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
          <InputLabel>Filter by Category</InputLabel>
          <Select
            value={selectedCategoryId}
            label="Filter by Category"
            onChange={(e) => setSelectedCategoryId(e.target.value)}
          >
            <MenuItem value="">All Categories</MenuItem>
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
                  <TableCell>Code</TableCell>
                  <TableCell>Product Name</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell align="right">Base Price (IRR)</TableCell>
                  <TableCell align="center">VAT Tax Rate</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="center">Actions</TableCell>
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
                        {Number(p.base_price).toLocaleString()} IRR
                      </TableCell>
                      <TableCell align="center">
                        <Chip label={`${(Number(p.tax_rate) * 100).toFixed(0)}%`} size="small" />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={p.is_active ? 'Active' : 'Archived'}
                          color={p.is_active ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="center">
                        <IconButton
                          title="Attach Modifier Option Group"
                          color="primary"
                          onClick={() => handleOpenAttachDialog(p)}
                        >
                          <TuneIcon />
                        </IconButton>
                        <IconButton
                          title="Archive Product"
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
            Create New Master Product
          </Typography>
          <form onSubmit={handleCreate}>
            <Stack spacing={2.5}>
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

              <TextField
                label="Product Code"
                placeholder="e.g. PROD-DOUBLEBURGER"
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />

              <TextField
                label="Product Name"
                placeholder="e.g. Double Beef Burger"
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <TextField
                label="Base Price (IRR)"
                type="number"
                required
                fullWidth
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
              />

              <TextField
                label="Tax Rate (VAT)"
                placeholder="e.g. 0.1000 for 10%"
                fullWidth
                value={taxRate}
                onChange={(e) => setTaxRate(e.target.value)}
              />

              <ImageUploader
                label="Product Media Image Asset"
                onUploadSuccess={(asset) => setImageAssetId(asset.id)}
              />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                Save Product
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>

      {/* Attach Option Group Dialog */}
      <Dialog open={attachDialogOpen} onClose={() => setAttachDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          Attach Modifier Option Group to {selectedProduct?.name}
        </DialogTitle>
        <DialogContent sx={{ minWidth: 360, pt: 2 }}>
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
          <Button variant="contained" onClick={handleAttachOptionGroup} sx={{ fontWeight: 'bold' }}>
            Attach Group
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
