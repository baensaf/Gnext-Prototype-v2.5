import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

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
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  CardContent,
  DialogTitle,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';

import { httpClient as axios } from 'src/api/httpClient';

import { Iconify } from 'src/components/iconify';

interface Coupon {
  id: string;
  code: string;
  max_uses?: number | null;
  uses_count?: number;
  effective_from?: string | null;
  effective_to?: string | null;
  is_active: boolean;
  campaign_id?: string;
}

export function CouponsPage() {
  const { t } = useTranslation();

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state for 1-time coupon
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [percentage, setPercentage] = useState('15');
  const [minSubtotal, setMinSubtotal] = useState('');
  const [maxCap, setMaxCap] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [saving, setSaving] = useState(false);

  // Test bench state
  const [testCouponCode, setTestCouponCode] = useState('');
  const [testOrderTotal, setTestOrderTotal] = useState('100000');
  const [validationResult, setValidationResult] = useState<any>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/v1/coupons');
      const cList = res.data;
      setCoupons(Array.isArray(cList) ? cList : cList.data || []);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to load coupons');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateOneTimeCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !percentage) return;
    setSaving(true);
    setError(null);
    try {
      await axios.post('/api/v1/coupons/one-time', {
        code: code.trim().toUpperCase(),
        percentage,
        minimum_subtotal: minSubtotal || undefined,
        maximum_discount_amount: maxCap || undefined,
        effective_from: effectiveFrom || undefined,
        effective_to: effectiveTo || undefined,
      });

      setDrawerOpen(false);
      resetForm();
      await loadData();
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to create one-time coupon');
    } finally {
      setSaving(false);
    }
  };

  const handleTestValidate = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestError(null);
    setValidationResult(null);
    try {
      const res = await axios.post('/api/v1/coupons/validate', {
        couponCode: testCouponCode,
        orderTotal: testOrderTotal,
      });
      setValidationResult(res.data);
    } catch (err: any) {
      setTestError(err.detail || err.message || 'Coupon validation failed');
    }
  };

  const resetForm = () => {
    setCode('');
    setPercentage('15');
    setMinSubtotal('');
    setMaxCap('');
    setEffectiveFrom('');
    setEffectiveTo('');
  };

  return (
    <Box sx={{ p: 3 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('coupons.title', 'One-Time Promotional Coupons')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('coupons.subtitle', 'Create unique one-time percentage coupon codes with minimum purchase subtotal and redemption tracking.')}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Iconify icon={'solar:ticket-bold' as any} />}
          onClick={() => {
            resetForm();
            setDrawerOpen(true);
          }}
          sx={{ fontWeight: 'bold' }}
        >
          {t('coupons.createOneTime', 'Create One-Time Coupon')}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Interactive Coupon Validation Test Bench */}
      <Card sx={{ mb: 4, borderRadius: 3, bgcolor: 'background.neutral' }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Iconify icon={'solar:ticket-bold' as any} color="primary" />
            {t('coupons.testBenchTitle', 'POS Coupon Validation Test Bench')}
          </Typography>
          <form onSubmit={handleTestValidate}>
            <Stack spacing={2} sx={{ flexDirection: { xs: 'column', sm: 'row' }, alignItems: 'center' }}>
              <Box sx={{ flex: 1, width: '100%' }}>
                <TextField
                  label={t('coupons.testCodeLabel', 'Coupon Code')}
                  fullWidth
                  size="small"
                  value={testCouponCode}
                  onChange={(e) => setTestCouponCode(e.target.value.toUpperCase())}
                />
              </Box>
              <Box sx={{ flex: 1, width: '100%' }}>
                <TextField
                  label={t('coupons.simulatedSubtotal', 'Simulated Subtotal (IRR)')}
                  type="number"
                  fullWidth
                  size="small"
                  value={testOrderTotal}
                  onChange={(e) => setTestOrderTotal(e.target.value)}
                />
              </Box>
              <Box sx={{ width: { xs: '100%', sm: 'auto' } }}>
                <Button type="submit" variant="contained" color="secondary" fullWidth sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                  {t('coupons.validateButton', 'Validate Code')}
                </Button>
              </Box>
            </Stack>
          </form>

          {validationResult && (
            <Alert severity="success" sx={{ mt: 2, borderRadius: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                Coupon VALID! Applied Discount: -{MoneyUtil.formatCurrency(validationResult.calculatedAmount)} IRR
              </Typography>
              <Typography variant="caption">
                Rule: <strong>{validationResult.discount?.name || 'Discount'}</strong>
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
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
              <CircularProgress />
            </Box>
          ) : coupons.length === 0 ? (
            <Box sx={{ p: 5, textAlign: 'center' }}>
              <Typography variant="body1" color="text.secondary">
                {t('coupons.noCoupons', 'No one-time coupons created yet.')}
              </Typography>
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('coupons.code', 'Coupon Code')}</TableCell>
                    <TableCell>{t('coupons.redemptionStatus', 'Redemption Status')}</TableCell>
                    <TableCell>{t('coupons.validity', 'Effective Window')}</TableCell>
                    <TableCell>{t('coupons.status', 'Status')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {coupons.map((coupon) => {
                    const uses = coupon.uses_count || 0;
                    const max = coupon.max_uses || 1;
                    const isRedeemed = uses >= max;

                    return (
                      <TableRow key={coupon.id} hover>
                        <TableCell>
                          <Typography variant="subtitle2" sx={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
                            {coupon.code}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={isRedeemed ? 'Redeemed (1/1)' : `Available (${uses}/${max})`}
                            color={isRedeemed ? 'error' : 'success'}
                            variant={isRedeemed ? 'outlined' : 'filled'}
                            size="small"
                          />
                        </TableCell>
                        <TableCell>
                          {coupon.effective_from || coupon.effective_to ? (
                            <Typography variant="caption">
                              {coupon.effective_from ? new Date(coupon.effective_from).toLocaleDateString() : 'Start'}
                              {' — '}
                              {coupon.effective_to ? new Date(coupon.effective_to).toLocaleDateString() : 'Expires'}
                            </Typography>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              No Date Limit
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={coupon.is_active ? 'Active' : 'Inactive'}
                            color={coupon.is_active ? 'success' : 'default'}
                            size="small"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Drawer Form for 1-Time Coupon */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: { xs: 320, sm: 440 }, p: 3 }}>
          <DialogTitle sx={{ px: 0, pt: 0 }}>{t('coupons.createModalTitle', 'Create One-Time Coupon Code')}</DialogTitle>
          <form onSubmit={handleCreateOneTimeCoupon}>
            <Stack spacing={3}>
              <TextField
                required
                fullWidth
                label={t('coupons.codeLabel', 'Unique Coupon Code')}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. WELCOME15"
              />

              <TextField
                required
                fullWidth
                type="number"
                label={t('coupons.percentageLabel', 'Discount Percentage (%)')}
                value={percentage}
                onChange={(e) => setPercentage(e.target.value)}
                placeholder="15"
              />

              <TextField
                fullWidth
                type="number"
                label={t('coupons.minSubtotalLabel', 'Minimum Purchase Subtotal (IRR)')}
                value={minSubtotal}
                onChange={(e) => setMinSubtotal(e.target.value)}
                placeholder="100000"
              />

              <TextField
                fullWidth
                type="number"
                label={t('coupons.maxCapLabel', 'Maximum Discount Cap (IRR)')}
                value={maxCap}
                onChange={(e) => setMaxCap(e.target.value)}
                placeholder="50000"
              />

              <Stack direction="row" spacing={2}>
                <TextField
                  fullWidth
                  type="date"
                  label={t('coupons.startDate', 'Start Date')}
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
                <TextField
                  fullWidth
                  type="date"
                  label={t('coupons.endDate', 'End Date')}
                  slotProps={{ inputLabel: { shrink: true } }}
                  value={effectiveTo}
                  onChange={(e) => setEffectiveTo(e.target.value)}
                />
              </Stack>

              <Alert severity="info">
                {t('coupons.oneTimeNotice', 'One-Time Coupons are locked to exactly 1 total redemption and 1 redemption per customer.')}
              </Alert>

              <Stack direction="row" spacing={2} sx={{ justifyContent: 'flex-end' }}>
                <Button onClick={() => setDrawerOpen(false)} color="inherit">
                  {t('common.cancel', 'Cancel')}
                </Button>
                <Button type="submit" variant="contained" disabled={saving}>
                  {saving ? <CircularProgress size={24} /> : t('common.create', 'Create Coupon')}
                </Button>
              </Stack>
            </Stack>
          </form>
        </Box>
      </Drawer>
    </Box>
  );
}
