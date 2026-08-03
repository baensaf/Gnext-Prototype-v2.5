import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Drawer,
  TextField,
  MenuItem,
  Alert,
  FormControl,
  InputLabel,
  Select,
  Grid,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';

import { catalogApi, PriceGroup, Product } from 'src/api/catalogApi';

export function PricingPage() {
  const { t } = useTranslation();

  const [priceGroups, setPriceGroups] = useState<PriceGroup[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedPriceGroupId, setSelectedPriceGroupId] = useState<string>('');
  const [overridePrices, setOverridePrices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Drawer form
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const pgs = await catalogApi.getPriceGroups();
      setPriceGroups(pgs);
      if (pgs.length > 0 && !selectedPriceGroupId) {
        setSelectedPriceGroupId(pgs[0].id);
      }
      const prods = await catalogApi.getProducts();
      setProducts(prods);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load price groups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Price Groups & Branch Overrides
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure custom price lists for specific branches, VIP customers, or sales channels
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          Create Price Group
        </Button>
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
          <Select
            value={selectedPriceGroupId}
            label="Active Price Group"
            onChange={(e) => setSelectedPriceGroupId(e.target.value)}
          >
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
                      <TableCell><code>{p.code}</code></TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>{p.name}</TableCell>
                      <TableCell align="right">
                        {Number(p.base_price).toLocaleString()} IRR
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          type="number"
                          size="small"
                          placeholder={Number(p.base_price).toString()}
                          value={overrideVal}
                          onChange={(e) =>
                            setOverridePrices((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          sx={{ width: 180 }}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<SaveIcon />}
                          onClick={() => handleSaveOverride(p.id)}
                        >
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
    </Box>
  );
}
