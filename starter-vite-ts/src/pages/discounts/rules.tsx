import type { DiscountCampaign } from 'src/api/discountsApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
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
  TableRow,
  MenuItem,
  Checkbox,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  InputLabel,
  CardContent,
  FormControl,
  TableContainer,
  FormControlLabel,
} from '@mui/material';

import { discountsApi } from 'src/api/discountsApi';

export function DiscountRulesPage() {
  const { t } = useTranslation();

  const [discounts, setDiscounts] = useState<DiscountCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [discountType, setDiscountType] = useState<'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_ITEM' | 'FREE_DELIVERY'>('PERCENTAGE');
  const [percentage, setPercentage] = useState('10.00');
  const [amount, setAmount] = useState('50000.0000');
  const [priority, setPriority] = useState(30);
  const [stackingGroup, setStackingGroup] = useState('DEFAULT');
  const [isStackable, setIsStackable] = useState(true);
  const [couponRequired, setCouponRequired] = useState(false);
  const [minSubtotal, setMinSubtotal] = useState('0');

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await discountsApi.getDiscounts();
      setDiscounts(data);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load discount rules');
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
      await discountsApi.createDiscount({
        code,
        name,
        discount_type: discountType,
        percentage: discountType === 'PERCENTAGE' ? percentage : undefined,
        amount: discountType === 'FIXED_AMOUNT' ? amount : undefined,
        priority,
        stacking_group: stackingGroup,
        is_stackable: isStackable,
        coupon_required: couponRequired,
        minimum_subtotal: minSubtotal,
      });
      setDrawerOpen(false);
      resetForm();
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create discount rule');
    }
  };

  const resetForm = () => {
    setCode('');
    setName('');
    setDiscountType('PERCENTAGE');
    setPercentage('10.00');
    setAmount('50000.0000');
    setPriority(30);
    setStackingGroup('DEFAULT');
    setIsStackable(true);
    setCouponRequired(false);
    setMinSubtotal('0');
  };

  const handleArchive = async (id: string, discName: string) => {
    if (window.confirm(`Are you sure you want to archive discount rule "${discName}"?`)) {
      try {
        await discountsApi.archiveDiscount(id);
        loadData();
      } catch (err: any) {
        setError(err.detail || 'Failed to archive discount');
      }
    }
  };

  const formatValue = (d: DiscountCampaign) => {
    const dType = d.discount_type || (d as any).calculation_type;
    const val = d.percentage || d.amount || (d as any).value || '0';
    if (dType === 'PERCENTAGE') {
      return `${Number(val).toFixed(0)}%`;
    }
    if (dType === 'FREE_DELIVERY') {
      return 'Free Delivery';
    }
    if (dType === 'FREE_ITEM') {
      return 'Free Item Reward';
    }
    return `${Number(val).toLocaleString()} IRR`;
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Discount Rules & Campaigns
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure percentage, fixed amount, priority stacking groups, coupons, and promotion constraints
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          Create Campaign Rule
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
                  <TableCell>Code</TableCell>
                  <TableCell>Campaign Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell align="right">Value</TableCell>
                  <TableCell align="center">Priority</TableCell>
                  <TableCell align="center">Stackable</TableCell>
                  <TableCell align="center">Coupon Req.</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {discounts.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell><code>{d.code}</code></TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{d.name}</TableCell>
                    <TableCell>
                      <Chip label={d.discount_type || (d as any).calculation_type} size="small" color="info" />
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                      {formatValue(d)}
                    </TableCell>
                    <TableCell align="center">
                      <Chip label={`P${d.priority ?? 30}`} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell align="center">
                      <Chip label={d.is_stackable ?? true ? 'Yes' : 'No'} size="small" />
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={d.coupon_required ? 'Coupon' : 'Automatic'}
                        color={d.coupon_required ? 'warning' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={d.is_active ? 'Active' : 'Archived'}
                        color={d.is_active ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="center">
                      <IconButton
                        title="Archive Discount"
                        color="error"
                        onClick={() => handleArchive(d.id, d.name)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create Discount Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 440, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Create Campaign Rule
          </Typography>
          <form onSubmit={handleCreate}>
            <Stack spacing={2.5}>
              <TextField
                label="Campaign Code"
                placeholder="e.g. DISC-15PCT"
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <TextField
                label="Campaign Display Name"
                placeholder="e.g. 15% Summer Special Promotion"
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <FormControl fullWidth required>
                <InputLabel>Discount Type</InputLabel>
                <Select
                  value={discountType}
                  label="Discount Type"
                  onChange={(e) => setDiscountType(e.target.value as any)}
                >
                  <MenuItem value="PERCENTAGE">PERCENTAGE</MenuItem>
                  <MenuItem value="FIXED_AMOUNT">FIXED_AMOUNT</MenuItem>
                  <MenuItem value="FREE_DELIVERY">FREE_DELIVERY</MenuItem>
                  <MenuItem value="FREE_ITEM">FREE_ITEM</MenuItem>
                </Select>
              </FormControl>

              {discountType === 'PERCENTAGE' && (
                <TextField
                  label="Percentage Value (%)"
                  required
                  fullWidth
                  value={percentage}
                  onChange={(e) => setPercentage(e.target.value)}
                />
              )}

              {discountType === 'FIXED_AMOUNT' && (
                <TextField
                  label="Fixed Amount (IRR)"
                  required
                  fullWidth
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              )}

              <TextField
                label="Priority (Lower number evaluates first, e.g. 10, 20, 30)"
                type="number"
                fullWidth
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />

              <TextField
                label="Stacking Group"
                fullWidth
                value={stackingGroup}
                onChange={(e) => setStackingGroup(e.target.value)}
              />

              <TextField
                label="Min Order Subtotal (IRR)"
                type="number"
                fullWidth
                value={minSubtotal}
                onChange={(e) => setMinSubtotal(e.target.value)}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={isStackable}
                    onChange={(e) => setIsStackable(e.target.checked)}
                  />
                }
                label="Allow Stacking with other campaigns"
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={couponRequired}
                    onChange={(e) => setCouponRequired(e.target.checked)}
                  />
                }
                label="Requires Coupon Code Input"
              />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                Save Campaign Rule
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>
    </Box>
  );
}
