import type { Product, Category, ProductAvailability } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import StorefrontIcon from '@mui/icons-material/Storefront';
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
import { fDateTime } from 'src/utils/format-time';

import { catalogApi } from 'src/api/catalogApi';
import { useBranchContext } from 'src/contexts/branch-context';

import { AvailabilitySchedulesSection } from './availability-schedules';

/**
 * The one catalogue screen a branch owns.
 *
 * Head office decides what the item is; this decides whether this shop can serve it.
 * There are two ways for an item to be off, and they are different things: a duration
 * is today's 86 and expires on its own, while "until I put it back" means this branch
 * does not carry the item at all. The scope is the header switcher's, not a field in
 * the dialog — the server takes the branch from the session anyway, so offering a
 * picker a branch user cannot use would only invite a 403.
 */
export function AvailabilityPage() {
  const { t } = useTranslation();
  const { selectedBranchId, selectedBranch, isHeadOffice } = useBranchContext();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [availabilities, setAvailabilities] = useState<ProductAvailability[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Suspend Dialog
  const [suspendModalOpen, setSuspendModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [suspendHours, setSuspendHours] = useState('2');
  const [suspendReason, setSuspendReason] = useState('');

  const branchParam = selectedBranchId || undefined;

  /** The name of the shelf being edited, for every sentence that has to say it. */
  const scopeName = isHeadOffice
    ? t('catalog.availabilityPage.globalScope')
    : selectedBranch?.name || t('catalog.availabilityPage.branchScope');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [pList, aList, cList] = await Promise.all([
        catalogApi.getProducts(),
        catalogApi.getAvailabilities(branchParam),
        catalogApi.getCategories().catch(() => [] as Category[]),
      ]);
      setProducts(pList);
      setCategories(cList);
      setAvailabilities(aList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('catalog.availabilityPage.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [branchParam, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenSuspendModal = (prod: Product) => {
    setSelectedProduct(prod);
    setSuspendHours('2');
    setSuspendReason(t('catalog.availabilityPage.reasons.outOfStock'));
    setSuspendModalOpen(true);
  };

  const handleSuspendSubmit = async () => {
    if (!selectedProduct) return;
    try {
      // 0 hours is not "no suspension" — it is a suspension with no end date.
      await catalogApi.suspendProduct(
        selectedProduct.id,
        branchParam,
        parseFloat(suspendHours),
        suspendReason
      );
      setSuspendModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('catalog.availabilityPage.errors.suspendFailed'));
    }
  };

  const handleResumeProduct = async (productId: string) => {
    try {
      await catalogApi.resumeProduct(productId, branchParam);
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

      <Alert severity="info" icon={<StorefrontIcon />} sx={{ mb: 3 }}>
        {t('catalog.availabilityPage.ownershipNotice', {
          defaultValue:
            'Head office owns the menu — names, recipes and prices are set once for the whole chain. What you decide here is what {{scope}} can actually serve.',
          scope: scopeName,
        })}
      </Alert>

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
              const isSuspended =
                avail?.is_suspended &&
                (!avail.suspended_until || new Date(avail.suspended_until) > new Date());
              // A stop with no end date is an assortment decision, not a stock-out.
              const isDelisted = isSuspended && !avail?.suspended_until;

              let statusLabel = t('catalog.availabilityPage.statusAvailable');
              if (isDelisted) statusLabel = t('catalog.availabilityPage.statusNotCarried', 'Not carried here');
              else if (isSuspended) statusLabel = t('catalog.availabilityPage.statusSuspended');

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
                      label={statusLabel}
                      color={(isDelisted && 'default') || (isSuspended && 'error') || 'success'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    {isSuspended ? avail?.reason || t('catalog.availabilityPage.statusSuspended') : '-'}
                  </TableCell>
                  <TableCell>
                    {(isSuspended &&
                      (avail?.suspended_until
                        ? fDateTime(avail.suspended_until)
                        : t('catalog.availabilityPage.indefinite'))) ||
                      '-'}
                  </TableCell>
                  <TableCell align="right">
                    {isSuspended ? (
                      <Button
                        size="small"
                        color="success"
                        variant="contained"
                        startIcon={<PlayCircleIcon />}
                        onClick={() => handleResumeProduct(p.id)}
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

      <AvailabilitySchedulesSection products={products} categories={categories} scopeName={scopeName} />

      {/* Suspend Product Dialog */}
      <Dialog
        open={suspendModalOpen}
        onClose={() => setSuspendModalOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {t('catalog.availabilityPage.suspendModalTitle', { name: selectedProduct?.name })}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              {t('catalog.availabilityPage.scopeNotice', {
                defaultValue: 'This applies to {{scope}}. Change the scope in the header to work elsewhere.',
                scope: scopeName,
              })}
            </Alert>

            <TextField
              select
              label={t('catalog.availabilityPage.durationHours')}
              value={suspendHours}
              onChange={(e) => setSuspendHours(e.target.value)}
              helperText={
                suspendHours === '0'
                  ? t(
                      'catalog.availabilityPage.delistHelp',
                      'The item stays off the menu here until somebody puts it back.'
                    )
                  : t(
                      'catalog.availabilityPage.suspendHelp',
                      'The item comes back on sale by itself when the time is up.'
                    )
              }
              fullWidth
            >
              <MenuItem value="1">{t('catalog.availabilityPage.hours1')}</MenuItem>
              <MenuItem value="2">{t('catalog.availabilityPage.hours2')}</MenuItem>
              <MenuItem value="4">{t('catalog.availabilityPage.hours4')}</MenuItem>
              <MenuItem value="8">{t('catalog.availabilityPage.hours8')}</MenuItem>
              <MenuItem value="24">{t('catalog.availabilityPage.hours24')}</MenuItem>
              <MenuItem value="72">{t('catalog.availabilityPage.hours72')}</MenuItem>
              <MenuItem value="168">{t('catalog.availabilityPage.hours168')}</MenuItem>
              <MenuItem value="0">
                {t('catalog.availabilityPage.notCarried', 'Not carried here (until resumed)')}
              </MenuItem>
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
          <Button onClick={() => setSuspendModalOpen(false)}>
            {t('catalog.availabilityPage.cancel')}
          </Button>
          <Button color="warning" variant="contained" onClick={handleSuspendSubmit}>
            {t('catalog.availabilityPage.confirmSuspend')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
