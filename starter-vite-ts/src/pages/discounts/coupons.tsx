import type { Coupon, Discount, CouponValidationResult } from 'src/api/discountsApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import {
  Box,
  Card,
  Chip,
  Grid,
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
  const [discounts, setDiscounts] = useState<Discount[]>([]);
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
        discount_id: discountId,
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
      setTestError(err.detail || 'Coupon validation failed');
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Coupons & Validation Studio
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage promotional coupon codes, redemptions, and test redemption rules
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          Create Coupon Code
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Coupons List */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
            <CardContent sx={{ p: 0 }}>
              <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableCell>Coupon Code</TableCell>
                      <TableCell>Linked Discount Rule</TableCell>
                      <TableCell align="center">Redemptions</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {coupons.map((c) => {
                      const discObj = discounts.find((d) => d.id === c.discount_id);
                      return (
                        <TableRow key={c.id}>
                          <TableCell><code>{c.code}</code></TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>
                            {discObj ? `${discObj.name} (${discObj.code})` : '—'}
                          </TableCell>
                          <TableCell align="center">
                            <Chip
                              label={`${c.current_redemptions} / ${c.max_redemptions || '∞'}`}
                              size="small"
                              color="info"
                            />
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={c.is_active ? 'Active' : 'Archived'}
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
        </Grid>

        {/* Coupon Test Bench */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <ConfirmationNumberIcon color="primary" />
                Coupon Validation Test bench
              </Typography>

              <form onSubmit={handleTestValidate}>
                <Stack spacing={2}>
                  <TextField
                    label="Coupon Code"
                    placeholder="e.g. WELCOME500K"
                    required
                    fullWidth
                    value={testCouponCode}
                    onChange={(e) => setTestCouponCode(e.target.value.toUpperCase())}
                  />

                  <TextField
                    label="Simulated Order Subtotal (IRR)"
                    type="number"
                    required
                    fullWidth
                    value={testOrderTotal}
                    onChange={(e) => setTestOrderTotal(e.target.value)}
                  />

                  <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                    Validate Coupon
                  </Button>
                </Stack>
              </form>

              {testError && (
                <Alert severity="error" sx={{ mt: 3 }}>
                  {testError}
                </Alert>
              )}

              {validationResult && (
                <Box sx={{ mt: 3, p: 2, bgcolor: 'success.light', borderRadius: 2, color: 'success.dark' }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
                    <CheckCircleIcon color="success" />
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                      Coupon Code Validated!
                    </Typography>
                  </Stack>

                  <Typography variant="body2">
                    Coupon: <strong>{validationResult.coupon.code}</strong>
                  </Typography>
                  <Typography variant="body2">
                    Rule: <strong>{validationResult.discount.name}</strong> ({validationResult.discount.calculation_type})
                  </Typography>
                  <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1, color: 'primary.dark' }}>
                    Deduction Amount: -{Number(validationResult.calculatedAmount).toLocaleString()} IRR
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Create Coupon Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Create Coupon Code
          </Typography>
          <form onSubmit={handleCreate}>
            <Stack spacing={2.5}>
              <TextField
                label="Coupon Code"
                placeholder="e.g. SUMMER2026"
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />

              <FormControl fullWidth required>
                <InputLabel>Linked Discount Rule</InputLabel>
                <Select
                  value={discountId}
                  label="Linked Discount Rule"
                  onChange={(e) => setDiscountId(e.target.value)}
                >
                  {discounts.map((d) => (
                    <MenuItem key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label="Max Redemptions Cap"
                type="number"
                fullWidth
                value={maxRedemptions || ''}
                onChange={(e) => setMaxRedemptions(parseInt(e.target.value, 10) || undefined)}
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
