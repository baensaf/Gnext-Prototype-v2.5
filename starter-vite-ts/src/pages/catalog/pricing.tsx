import type { Product, Category, PriceGroup } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import {
  Box,
  Card,
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
  InputLabel,
  CardContent,
  FormControl,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { catalogApi } from 'src/api/catalogApi';

export function PricingPage() {
  const { t: _t } = useTranslation();

  const [priceGroups, setPriceGroups] = useState<PriceGroup[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedPriceGroupId, setSelectedPriceGroupId] = useState<string>('');
  const [overridePrices, setOverridePrices] = useState<Record<string, string>>({});
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Drawer form for Price Group
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  // Bulk Price Update Modal
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [bulkAdjustmentType, setBulkAdjustmentType] = useState<'PERCENTAGE' | 'FIXED'>('PERCENTAGE');
  const [bulkAmount, setBulkAmount] = useState('10');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const pgs = await catalogApi.getPriceGroups();
      setPriceGroups(pgs);
      if (pgs.length > 0 && !selectedPriceGroupId) {
        setSelectedPriceGroupId(pgs[0].id);
      }
      const cats = await catalogApi.getCategories();
      setCategories(cats);
      const prods = await catalogApi.getProducts();
      setProducts(prods);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load price groups');
    } finally {
      setLoading(false);
    }
  }, [selectedPriceGroupId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await catalogApi.createPriceGroup({ code, name, currency_code: 'IRR' });
      setDrawerOpen(false);
      setCode('');
      setName('');
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create price group');
    }
  };

  const handleSaveOverride = async (productId: string) => {
    if (!selectedPriceGroupId) return;
    const price = overridePrices[productId];
    if (!price) return;

    try {
      await catalogApi.setPriceOverride(selectedPriceGroupId, productId, price);
      setSuccess('Price group override saved successfully');
      setError(null);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to save price override');
    }
  };

  const handleBulkUpdate = async () => {
    try {
      const res = await catalogApi.bulkUpdatePrices({
        price_group_id: selectedPriceGroupId || undefined,
        category_id: bulkCategoryId || undefined,
        adjustment_type: bulkAdjustmentType,
        amount: bulkAmount,
      });
      setSuccess(`Bulk price update completed! ${res.updated_count} prices updated.`);
      setBulkModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to perform bulk price update');
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Price Books & Bulk Updates
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Slice 5 — Multi-level pricing rules, price groups, and atomic bulk adjustments
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button variant="outlined" color="primary" startIcon={<TrendingUpIcon />} onClick={() => setBulkModalOpen(true)}>
            Bulk Price Update
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDrawerOpen(true)} sx={{ fontWeight: 'bold' }}>
            Create Price Group
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {/* Select Active Price Group */}
      <Box sx={{ mb: 3, maxWidth: 350 }}>
        <FormControl fullWidth size="small">
          <InputLabel>Active Price Group</InputLabel>
          <Select value={selectedPriceGroupId} label="Active Price Group" onChange={(e) => setSelectedPriceGroupId(e.target.value)}>
            {priceGroups.map((pg) => (
              <MenuItem key={pg.id} value={pg.id}>
                {pg.name} ({pg.code})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {/* Pricing Matrix */}
      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 0 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Product Code</TableCell>
                  <TableCell>Product Name</TableCell>
                  <TableCell align="right">Base Catalog Price (IRR)</TableCell>
                  <TableCell align="right">Group Override Price (IRR)</TableCell>
                  <TableCell align="center">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {products.map((p) => {
                  const overrideVal = overridePrices[p.id] ?? '';
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <code>{p.code}</code>
                      </TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>{p.name}</TableCell>
                      <TableCell align="right">{Number(p.base_price).toLocaleString()} IRR</TableCell>
                      <TableCell align="right">
                        <TextField
                          type="number"
                          size="small"
                          placeholder={Number(p.base_price).toString()}
                          value={overrideVal}
                          onChange={(e) => setOverridePrices((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          sx={{ width: 180 }}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Button size="small" variant="outlined" startIcon={<SaveIcon />} onClick={() => handleSaveOverride(p.id)}>
                          Save Override
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create Price Group Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Create Price Group
          </Typography>
          <form onSubmit={handleCreateGroup}>
            <Stack spacing={2.5}>
              <TextField
                label="Price Group Code"
                placeholder="e.g. PG-DELIVERY"
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <TextField
                label="Price Group Name"
                placeholder="e.g. Online Delivery Price List"
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                Save Price Group
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>

      {/* Bulk Price Update Modal */}
      <Dialog open={bulkModalOpen} onClose={() => setBulkModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>Bulk Price Adjustment</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Apply atomic price adjustments across catalog base prices or price group overrides.
            </Typography>

            <TextField select label="Category Filter (Optional)" value={bulkCategoryId} onChange={(e) => setBulkCategoryId(e.target.value)} fullWidth>
              <MenuItem value="">All Categories</MenuItem>
              {categories.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label="Adjustment Mode"
              value={bulkAdjustmentType}
              onChange={(e) => setBulkAdjustmentType(e.target.value as 'PERCENTAGE' | 'FIXED')}
              fullWidth
            >
              <MenuItem value="PERCENTAGE">Percentage Increase / Decrease (%)</MenuItem>
              <MenuItem value="FIXED">Fixed Amount Adjustment (IRR)</MenuItem>
            </TextField>

            <TextField
              label="Adjustment Amount"
              value={bulkAmount}
              onChange={(e) => setBulkAmount(e.target.value)}
              fullWidth
              placeholder="e.g. 10 for +10%, or -5 for -5%"
              helperText="Use positive numbers for increase, negative numbers for discount"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkModalOpen(false)}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={handleBulkUpdate}>
            Apply Bulk Adjustment
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
