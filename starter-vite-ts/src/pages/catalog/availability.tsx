import type { Branch } from 'src/api/tenantApi';
import type { Product, ProductAvailability } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import {
  Box,
  Chip,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Dialog,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';

import { tenantApi } from 'src/api/tenantApi';
import { catalogApi } from 'src/api/catalogApi';

export function AvailabilityPage() {
  const { t } = useTranslation();

  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [availabilities, setAvailabilities] = useState<ProductAvailability[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Suspend Dialog
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [suspendBranchId, setSuspendBranchId] = useState('');
  const [suspendHours, setSuspendHours] = useState('2');
  const [suspendReason, setSuspendReason] = useState('86d / Out of stock');

  const loadData = async () => {
    setLoading(true);
    try {
      const [pList, bList, aList] = await Promise.all([
        catalogApi.getProducts(),
        tenantApi.getBranches(),
        catalogApi.getAvailabilities(),
      ]);
      setProducts(pList);
      setBranches(bList);
      setAvailabilities(aList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('catalog.availabilityPage.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenSuspendModal = (prod: Product) => {
    setSelectedProduct(prod);
    setSuspendReason(t('catalog.availabilityPage.reasons.outOfStock'));
    setSuspendModalOpen(true);
  };

  const handleSuspendSubmit = async () => {
    if (!selectedProduct) return;
    try {
      await catalogApi.suspendProduct(selectedProduct.id, suspendBranchId || undefined, parseFloat(suspendHours), suspendReason);
      setSuspendModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('catalog.availabilityPage.errors.suspendFailed'));
    }
  };

  const handleResumeProduct = async (productId: string, branchId?: string) => {
    try {
      await catalogApi.resumeProduct(productId, branchId);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('catalog.availabilityPage.errors.resumeFailed'));
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('catalog.availabilityPage.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('catalog.availabilityPage.subtitle')}
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
          {t('catalog.availabilityPage.refresh')}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('catalog.availabilityPage.code')}</TableCell>
              <TableCell>{t('catalog.availabilityPage.productName')}</TableCell>
              <TableCell>{t('catalog.productsPage.basePrice')}</TableCell>
              <TableCell>{t('catalog.availabilityPage.status')}</TableCell>
              <TableCell>{t('catalog.availabilityPage.reason')}</TableCell>
              <TableCell>{t('catalog.availabilityPage.suspendedUntil')}</TableCell>
              <TableCell align="right">{t('catalog.availabilityPage.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {products.map((p) => {
              const avail = availabilities.find((a) => a.product_id === p.id);
              const isSuspended = avail?.is_suspended && (!avail.suspended_until || new Date(avail.suspended_until) > new Date());

              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                      {p.code}
                    </Typography>
                  </TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>
                    <span dir="ltr">{MoneyUtil.formatCurrency(p.base_price)} IRR</span>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={isSuspended ? t('catalog.availabilityPage.statusSuspended') : t('catalog.availabilityPage.statusAvailable')}
                      color={isSuspended ? 'error' : 'success'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{isSuspended ? avail?.reason || t('catalog.availabilityPage.statusSuspended') : '-'}</TableCell>
                  <TableCell>{isSuspended && avail?.suspended_until ? new Date(avail.suspended_until).toLocaleString() : '-'}</TableCell>
                  <TableCell align="right">
                    {isSuspended ? (
                      <Button
                        size="small"
                        color="success"
                        variant="contained"
                        startIcon={<PlayCircleIcon />}
                        onClick={() => handleResumeProduct(p.id, avail?.branch_id)}
                      >
                        {t('catalog.availabilityPage.resumeButton')}
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        color="warning"
                        variant="outlined"
                        startIcon={<PauseCircleIcon />}
                        onClick={() => handleOpenSuspendModal(p)}
                      >
                        {t('catalog.availabilityPage.suspendButton')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Suspend Product Dialog */}
      <Dialog open={suspendModalOpen} onClose={() => setSuspendModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('catalog.availabilityPage.suspendModalTitle', { name: selectedProduct?.name })}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField select label={t('catalog.availabilityPage.branchScope')} value={suspendBranchId} onChange={(e) => setSuspendBranchId(e.target.value)} fullWidth>
              <MenuItem value="">{t('catalog.availabilityPage.globalScope')}</MenuItem>
              {branches.map((b) => (
                <MenuItem key={b.id} value={b.id}>
                  {b.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField select label={t('catalog.availabilityPage.durationHours')} value={suspendHours} onChange={(e) => setSuspendHours(e.target.value)} fullWidth>
              <MenuItem value="1">{t('catalog.availabilityPage.hours1')}</MenuItem>
              <MenuItem value="2">{t('catalog.availabilityPage.hours2')}</MenuItem>
              <MenuItem value="4">{t('catalog.availabilityPage.hours4')}</MenuItem>
              <MenuItem value="8">{t('catalog.availabilityPage.hours8')}</MenuItem>
              <MenuItem value="24">{t('catalog.availabilityPage.hours24')}</MenuItem>
              <MenuItem value="72">{t('catalog.availabilityPage.hours72')}</MenuItem>
              <MenuItem value="168">{t('catalog.availabilityPage.hours168')}</MenuItem>
            </TextField>

            <TextField
              label={t('catalog.availabilityPage.reasonLabel')}
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSuspendModalOpen(false)}>{t('catalog.availabilityPage.cancel')}</Button>
          <Button color="warning" variant="contained" onClick={handleSuspendSubmit}>
            {t('catalog.availabilityPage.confirmSuspend')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
