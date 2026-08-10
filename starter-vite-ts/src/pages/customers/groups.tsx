import type { PriceGroup } from 'src/api/catalogApi';
import type { Discount } from 'src/api/discountsApi';
import type { CustomerGroup } from 'src/api/customerApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
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
  TableContainer,
} from '@mui/material';

import { catalogApi } from 'src/api/catalogApi';
import { customerApi } from 'src/api/customerApi';
import { discountsApi } from 'src/api/discountsApi';

export function CustomerGroupsPage() {
  const { t: _t } = useTranslation();

  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const [priceGroups, setPriceGroups] = useState<PriceGroup[]>([]);
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [priceGroupId, setPriceGroupId] = useState('');
  const [discountId, setDiscountId] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const gList = await customerApi.getCustomerGroups();
      setGroups(gList);
      const pgList = await catalogApi.getPriceGroups();
      setPriceGroups(pgList);
      const dList = await discountsApi.getDiscounts();
      setDiscounts(dList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load customer groups');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await customerApi.createCustomerGroup({
        code,
        name,
        price_group_id: priceGroupId || undefined,
        discount_id: discountId || undefined,
      });
      setDrawerOpen(false);
      setCode('');
      setName('');
      setPriceGroupId('');
      setDiscountId('');
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create customer group');
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Customer Tier Groups
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure customer categories for group-level pricing overrides and automatic tier discounts
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          Create Customer Group
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 0 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Group Code</TableCell>
                  <TableCell>Group Name</TableCell>
                  <TableCell>Linked Price Group Override</TableCell>
                  <TableCell>Linked Tier Discount</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {groups.map((g) => {
                  const pgObj = priceGroups.find((pg) => pg.id === g.price_group_id);
                  const discObj = discounts.find((d) => d.id === g.discount_id);
                  return (
                    <TableRow key={g.id}>
                      <TableCell><code>{g.code}</code></TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>{g.name}</TableCell>
                      <TableCell>
                        {pgObj ? <Chip label={pgObj.name} color="primary" size="small" /> : 'Default Catalog'}
                      </TableCell>
                      <TableCell>
                        {discObj ? <Chip label={discObj.name} color="info" size="small" /> : 'None'}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={g.is_active ? 'Active' : 'Archived'}
                          color={g.is_active ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create Customer Group Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Create Customer Group
          </Typography>
          <form onSubmit={handleCreate}>
            <Stack spacing={2.5}>
              <TextField
                label="Group Code"
                placeholder="e.g. GRP-VIP"
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <TextField
                label="Group Name"
                placeholder="e.g. Corporate VIP Tier"
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <FormControl fullWidth>
                <InputLabel>Linked Price Group Override</InputLabel>
                <Select
                  value={priceGroupId}
                  label="Linked Price Group Override"
                  onChange={(e) => setPriceGroupId(e.target.value)}
                >
                  <MenuItem value="">Default Standard Pricing</MenuItem>
                  {priceGroups.map((pg) => (
                    <MenuItem key={pg.id} value={pg.id}>
                      {pg.name} ({pg.code})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth>
                <InputLabel>Linked Discount Rule</InputLabel>
                <Select
                  value={discountId}
                  label="Linked Discount Rule"
                  onChange={(e) => setDiscountId(e.target.value)}
                >
                  <MenuItem value="">None</MenuItem>
                  {discounts.map((d) => (
                    <MenuItem key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                Save Customer Group
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>
    </Box>
  );
}
