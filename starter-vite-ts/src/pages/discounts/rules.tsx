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

import { MoneyUtil } from 'src/utils/money.util';

import { discountsApi } from 'src/api/discountsApi';

export function DiscountRulesPage() {
  const { t } = useTranslation();

  const [discounts, setDiscounts] = useState<DiscountCampaign[]>([]);
  const [_loading, setLoading] = useState(true);
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
      setError(err.detail || t('discounts.rules.loadError', 'Failed to load discount rules'));
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
      setError(err.detail || t('discounts.rules.createError', 'Failed to create discount rule'));
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
    if (window.confirm(t('discounts.rules.confirmArchive', 'Are you sure you want to archive discount rule "{{name}}"?', { name: discName }))) {
      try {
        await discountsApi.archiveDiscount(id);
        loadData();
      } catch (err: any) {
        setError(err.detail || t('discounts.rules.archiveError', 'Failed to archive discount'));
      }
    }
  };

  const formatValue = (d: DiscountCampaign) => {
    const dType = d.discount_type || (d as any).calculation_type;
    const val = d.percentage || d.amount || (d as any).value || '0';
    if (dType === 'PERCENTAGE') {
      return `${MoneyUtil.format(val, 0)}%`;
    }
    if (dType === 'FREE_DELIVERY') {
      return t('discounts.rules.freeDelivery', 'Free Delivery');
    }
    if (dType === 'FREE_ITEM') {
      return t('discounts.rules.freeItemReward', 'Free Item Reward');
    }
    return `${MoneyUtil.formatCurrency(val)} ${t('common.irr', 'IRR')}`;
  };

  return (
    <Box sx={{ p: 3 }}>
      <Alert severity="info" sx={{ mb: 3, borderRadius: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
          {t('discounts.rules.v5AlertTitle', 'V5 Preview Experience — Advanced Campaign Engine')}
        </Typography>
        <Typography variant="body2">
          {t(
            'discounts.rules.v5AlertDesc',
            'Advanced campaign types (free item rewards, free delivery waivers, complex multi-scopes, stacking groups, and funding sources) are part of the V5 Preview platform. For standard Phase 1 setups, use Customer Club Discounts, One-Time Coupons, or Cashier Manual Discount Authorizations.'
          )}
        </Typography>
      </Alert>

      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Stack direction="row" sx={{ alignItems: 'center' }} spacing={1}>
            <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
              {t('discounts.rules.title', 'Advanced Discount Campaigns')}
            </Typography>
            <Chip label={t('discounts.rules.v5Preview', 'V5 Preview')} color="info" size="small" sx={{ fontWeight: 'bold' }} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t('discounts.rules.subtitle', 'Multi-scope, multi-level campaign rules and stacking groups (V5 Preview)')}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          {t('discounts.rules.createV5Campaign', 'Create V5 Campaign')}
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
                  <TableCell>{t('discounts.rules.thCode', 'Code')}</TableCell>
                  <TableCell>{t('discounts.rules.thName', 'Campaign Name')}</TableCell>
                  <TableCell>{t('discounts.rules.thType', 'Type')}</TableCell>
                  <TableCell align="right">{t('discounts.rules.thValue', 'Value')}</TableCell>
                  <TableCell align="center">{t('discounts.rules.thPriority', 'Priority')}</TableCell>
                  <TableCell align="center">{t('discounts.rules.thStackable', 'Stackable')}</TableCell>
                  <TableCell align="center">{t('discounts.rules.thCouponReq', 'Coupon Req.')}</TableCell>
                  <TableCell>{t('discounts.rules.thStatus', 'Status')}</TableCell>
                  <TableCell align="center">{t('common.actions', 'Actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {discounts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      {t('discounts.rules.noDiscounts', 'No discount campaign rules found.')}
                    </TableCell>
                  </TableRow>
                ) : (
                  discounts.map((d) => (
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
                        <Chip label={(d.is_stackable ?? true) ? t('common.yes', 'Yes') : t('common.no', 'No')} size="small" />
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          label={d.coupon_required ? t('discounts.rules.couponRequiredBadge', 'Coupon') : t('discounts.rules.automaticBadge', 'Automatic')}
                          color={d.coupon_required ? 'warning' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={d.is_active ? t('common.active', 'Active') : t('common.archived', 'Archived')}
                          color={d.is_active ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="center">
                        <IconButton
                          title={t('discounts.rules.archiveTooltip', 'Archive Discount')}
                          color="error"
                          onClick={() => handleArchive(d.id, d.name)}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create Discount Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 440, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            {t('discounts.rules.drawerTitle', 'Create Campaign Rule')}
          </Typography>
          <form onSubmit={handleCreate}>
            <Stack spacing={2.5}>
              <TextField
                label={t('discounts.rules.formCode', 'Campaign Code')}
                placeholder={t('discounts.rules.formCodePlaceholder', 'e.g. DISC-15PCT')}
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <TextField
                label={t('discounts.rules.formName', 'Campaign Display Name')}
                placeholder={t('discounts.rules.formNamePlaceholder', 'e.g. 15% Summer Special Promotion')}
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <FormControl fullWidth required>
                <InputLabel>{t('discounts.rules.formType', 'Discount Type')}</InputLabel>
                <Select
                  value={discountType}
                  label={t('discounts.rules.formType', 'Discount Type')}
                  onChange={(e) => setDiscountType(e.target.value as any)}
                >
                  <MenuItem value="PERCENTAGE">{t('discounts.types.percentage', 'PERCENTAGE')}</MenuItem>
                  <MenuItem value="FIXED_AMOUNT">{t('discounts.types.fixedAmount', 'FIXED_AMOUNT')}</MenuItem>
                  <MenuItem value="FREE_DELIVERY">{t('discounts.types.freeDelivery', 'FREE_DELIVERY')}</MenuItem>
                  <MenuItem value="FREE_ITEM">{t('discounts.types.freeItem', 'FREE_ITEM')}</MenuItem>
                </Select>
              </FormControl>

              {discountType === 'PERCENTAGE' && (
                <TextField
                  label={t('discounts.rules.formPercentage', 'Percentage Value (%)')}
                  required
                  fullWidth
                  value={percentage}
                  onChange={(e) => setPercentage(e.target.value)}
                />
              )}

              {discountType === 'FIXED_AMOUNT' && (
                <TextField
                  label={t('discounts.rules.formAmount', 'Fixed Amount (IRR)')}
                  required
                  fullWidth
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              )}

              <TextField
                label={t('discounts.rules.formPriority', 'Priority (Lower number evaluates first, e.g. 10, 20, 30)')}
                type="number"
                fullWidth
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />

              <TextField
                label={t('discounts.rules.formStackingGroup', 'Stacking Group')}
                fullWidth
                value={stackingGroup}
                onChange={(e) => setStackingGroup(e.target.value)}
              />

              <TextField
                label={t('discounts.rules.formMinSubtotal', 'Min Order Subtotal (IRR)')}
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
                label={t('discounts.rules.formAllowStacking', 'Allow Stacking with other campaigns')}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={couponRequired}
                    onChange={(e) => setCouponRequired(e.target.checked)}
                  />
                }
                label={t('discounts.rules.formCouponRequired', 'Requires Coupon Code Input')}
              />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                {t('discounts.rules.formSave', 'Save Campaign Rule')}
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>
    </Box>
  );
}
