import type { Coupon, DiscountCampaign, CouponValidationResult } from 'src/api/discountsApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
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

import { discountsApi } from 'src/api/discountsApi';

export function CouponsPage() {
  const { t } = useTranslation();

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [discounts, setDiscounts] = useState<DiscountCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [discountId, setDiscountId] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState<number | undefined>(100);

  // Test bench state
  const [testCouponCode, setTestCouponCode] = useState('WELCOME500K');
  const [testOrderTotal, setTestOrderTotal] = useState('1500000');
  const [validationResult, setValidationResult] = useState<CouponValidationResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const cList = await discountsApi.getCoupons();
      setCoupons(cList);
      const dList = await discountsApi.getDiscounts();
      setDiscounts(dList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load coupons');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!discountId) {
      setError('Please select a discount rule');
      return;
    }
    try {
      await discountsApi.createCoupon({
        code,
        campaign_id: discountId,
        discount_id: discountId,
        max_uses: maxRedemptions,
        max_redemptions: maxRedemptions,
      });
      setDrawerOpen(false);
      setCode('');
      setDiscountId('');
      setMaxRedemptions(100);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create coupon');
    }
  };

  const handleTestValidate = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestError(null);
    setValidationResult(null);
    try {
      const res = await discountsApi.validateCoupon(testCouponCode, testOrderTotal);
      setValidationResult(res);
    } catch (err: any) {
      setTestError(err.detail || err.message || 'Coupon validation failed');
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Coupons & Voucher Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage single-use and multi-use coupon codes bound to campaign rules
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          Create Coupon
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Interactive Coupon Validation Test Bench */}
      <Card sx={{ mb: 4, borderRadius: 3, bgcolor: 'background.neutral', boxShadow: 1 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <ConfirmationNumberIcon color="primary" /> Interactive Coupon Validation Test Bench
          </Typography>
          <form onSubmit={handleTestValidate}>
            <Stack spacing={2} sx={{ flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'center' }}>
              <Box sx={{ flex: 1, width: '100%' }}>
                <TextField
                  label="Test Coupon Code"
                  fullWidth
                  size="small"
                  value={testCouponCode}
                  onChange={(e) => setTestCouponCode(e.target.value.toUpperCase())}
                />
              </Box>
              <Box sx={{ flex: 1, width: '100%' }}>
                <TextField
                  label="Simulated Subtotal (IRR)"
                  type="number"
                  fullWidth
                  size="small"
                  value={testOrderTotal}
                  onChange={(e) => setTestOrderTotal(e.target.value)}
                />
              </Box>
              <Box sx={{ width: { xs: '100%', sm: 'auto' } }}>
                <Button type="submit" variant="contained" color="secondary" fullWidth sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                  Validate Coupon Code
                </Button>
              </Box>
            </Stack>
          </form>

          {validationResult && (
            <Alert icon={<CheckCircleIcon fontSize="inherit" />} severity="success" sx={{ mt: 2, borderRadius: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                Coupon VALID! Applied Deduction: -{Number(validationResult.calculatedAmount).toLocaleString()} IRR
              </Typography>
              <Typography variant="caption">
                Rule: <strong>{validationResult.discount.name}</strong> ({validationResult.discount.calculation_type})
              </Typography>
            </Alert>
          )}

          {testError && (
            <Alert severity="error" sx={{ mt: 2, borderRadius: 2 }}>
              {testError}
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 0 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Coupon Code</TableCell>
                  <TableCell>Linked Campaign Rule</TableCell>
                  <TableCell align="center">Uses / Max Limit</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {coupons.map((c) => {
                  const cId = c.campaign_id || c.discount_id;
                  const discObj = discounts.find((d) => d.id === cId);
                  const currentUses = c.uses_count ?? c.current_redemptions ?? 0;
                  const maxUses = c.max_uses ?? c.max_redemptions;
                  return (
                    <TableRow key={c.id}>
                      <TableCell sx={{ fontWeight: 'bold', fontSize: '1.05rem' }}>
                        <code>{c.code}</code>
                      </TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>
                        {discObj ? `${discObj.name} (${discObj.code})` : cId}
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          label={`${currentUses} / ${maxUses ? maxUses : 'Unlimited'}`}
                          size="small"
                          color={maxUses && currentUses >= maxUses ? 'error' : 'default'}
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={c.is_active ? 'Active' : 'Disabled'}
                          color={c.is_active ? 'success' : 'default'}
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

      {/* Create Coupon Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Create Coupon Code
          </Typography>
          <form onSubmit={handleCreate}>
            <Stack spacing={2.5}>
              <TextField
                label="Coupon Code (Auto Uppercase)"
                placeholder="e.g. WELCOME500K"
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />

              <FormControl fullWidth required>
                <InputLabel>Target Discount Campaign Rule</InputLabel>
                <Select
                  value={discountId}
                  label="Target Discount Campaign Rule"
                  onChange={(e) => setDiscountId(e.target.value)}
                >
                  {discounts.map((d) => (
                    <MenuItem key={d.id} value={d.id}>
                      {d.code} - {d.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label="Max Allowed Redemptions"
                type="number"
                fullWidth
                value={maxRedemptions || ''}
                onChange={(e) => setMaxRedemptions(e.target.value ? Number(e.target.value) : undefined)}
              />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                Save Coupon Code
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>
    </Box>
  );
}
