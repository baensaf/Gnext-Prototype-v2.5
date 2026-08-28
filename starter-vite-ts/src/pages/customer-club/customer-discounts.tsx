import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import {
  Box,
  Card,
  Chip,
  Table,
  Stack,
  Alert,
  Button,
  Dialog,
  TableRow,
  Checkbox,
  MenuItem,
  TextField,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  IconButton,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
} from '@mui/material';

import { httpClient as axios } from 'src/api/httpClient';
import { DashboardContent } from 'src/layouts/dashboard';

import { Iconify } from 'src/components/iconify';

interface CustomerOption {
  id: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  code?: string;
}

interface CustomerDiscountItem {
  id: string;
  customer_id: string;
  discount_percentage: string;
  effective_from: string | null;
  effective_to: string | null;
  is_active: boolean;
  note: string | null;
  created_at: string;
  customer?: CustomerOption;
}

interface CustomerDiscountsPageProps {
  isEmbedded?: boolean;
}

export default function CustomerDiscountsPage({ isEmbedded = false }: CustomerDiscountsPageProps) {
  const { t } = useTranslation();

  const [discounts, setDiscounts] = useState<CustomerDiscountItem[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Assignment / Edit Modal State
  const [openModal, setOpenModal] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [discountPct, setDiscountPct] = useState<string>('10');
  const [effectiveFrom, setEffectiveFrom] = useState<string>('');
  const [effectiveTo, setEffectiveTo] = useState<string>('');
  const [note, setNote] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);

  // Bulk Assignment Dialog State
  const [bulkOpen, setBulkOpen] = useState<boolean>(false);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const [bulkPct, setBulkPct] = useState<string>('15');
  const [bulkFrom, setBulkFrom] = useState<string>('');
  const [bulkTo, setBulkTo] = useState<string>('');
  const [bulkNote, setBulkNote] = useState<string>('');
  const [bulkSearch, setBulkSearch] = useState<string>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [discRes, custRes] = await Promise.all([
        axios.get('/api/v1/customer-discounts').then((res) => res.data),
        axios.get('/api/v1/customers').then((res) => res.data),
      ]);

      setDiscounts(Array.isArray(discRes) ? discRes : discRes.data || []);
      setCustomers(Array.isArray(custRes) ? custRes : custRes.data || []);
    } catch (err: any) {
      setError(err.detail || err.message || t('customerClub.failedToLoad', 'Failed to load customer discounts'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSaveAssignment = async () => {
    if (!discountPct) return;
    setSaving(true);
    try {
      if (editingId) {
        // Edit existing assignment
        await axios.patch(`/api/v1/customer-discounts/${editingId}`, {
          discount_percentage: discountPct,
          effective_from: effectiveFrom || undefined,
          effective_to: effectiveTo || undefined,
          note: note || undefined,
        });
      } else {
        // Create single assignment
        if (!selectedCustomerId) return;
        await axios.post('/api/v1/customer-discounts', {
          customer_id: selectedCustomerId,
          discount_percentage: discountPct,
          effective_from: effectiveFrom || undefined,
          effective_to: effectiveTo || undefined,
          note: note || undefined,
        });
      }

      setOpenModal(false);
      resetForm();
      await fetchData();
    } catch (err: any) {
      setError(err.detail || err.message || t('customerClub.failedToSave', 'Failed to save customer discount'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBulk = async () => {
    if (bulkSelectedIds.length === 0 || !bulkPct) return;
    setSaving(true);
    try {
      await Promise.all(
        bulkSelectedIds.map((cId) =>
          axios.post('/api/v1/customer-discounts', {
            customer_id: cId,
            discount_percentage: bulkPct,
            effective_from: bulkFrom || undefined,
            effective_to: bulkTo || undefined,
            note: bulkNote || t('customerClub.bulkAssignmentDefaultNote', 'Bulk Assignment'),
          }),
        ),
      );

      setBulkOpen(false);
      setBulkSelectedIds([]);
      setBulkSearch('');
      await fetchData();
    } catch (err: any) {
      setError(err.detail || err.message || t('customerClub.failedToSaveBulk', 'Failed to save bulk discounts'));
    } finally {
      setSaving(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm(t('customerClub.confirmRevoke', 'Are you sure you want to revoke this customer discount entitlement?'))) {
      return;
    }
    try {
      await axios.delete(`/api/v1/customer-discounts/${id}`);
      await fetchData();
    } catch (err: any) {
      setError(err.detail || err.message || t('customerClub.failedToRevoke', 'Failed to revoke discount'));
    }
  };

  const startEdit = (item: CustomerDiscountItem) => {
    setEditingId(item.id);
    setSelectedCustomerId(item.customer_id);
    setDiscountPct(item.discount_percentage);
    setEffectiveFrom(item.effective_from ? item.effective_from.substring(0, 10) : '');
    setEffectiveTo(item.effective_to ? item.effective_to.substring(0, 10) : '');
    setNote(item.note || '');
    setOpenModal(true);
  };

  const resetForm = () => {
    setEditingId(null);
    setSelectedCustomerId('');
    setDiscountPct('10');
    setEffectiveFrom('');
    setEffectiveTo('');
    setNote('');
  };

  const toggleBulkCustomer = (id: string) => {
    setBulkSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );
  };

  const filteredBulkCustomers = customers.filter((c) => {
    const fullName = `${c.first_name || ''} ${c.last_name || ''} ${c.phone_number || ''}`.toLowerCase();
    return fullName.includes(bulkSearch.toLowerCase());
  });

    const content = (
    <Box sx={{ width: '100%' }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant={isEmbedded ? 'h5' : 'h4'} sx={{ fontWeight: 'bold' }}>
            {t('customerClub.title', 'Customer Specific Discounts')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('customerClub.subtitle', 'Assign dedicated percentage discount entitlements to individual customers or in bulk without complex campaigns.')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button
            variant="outlined"
            startIcon={<Iconify icon={'solar:user-id-bold' as any} />}
            onClick={() => setBulkOpen(true)}
          >
            {t('customerClub.bulkAssign', 'Bulk Assign')}
          </Button>
          <Button
            variant="contained"
            startIcon={<Iconify icon={'solar:pen-bold' as any} />}
            onClick={() => {
              resetForm();
              setOpenModal(true);
            }}
          >
            {t('customerClub.assignDiscount', 'Assign Customer Discount')}
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
          <CircularProgress />
        </Box>
      ) : discounts.length === 0 ? (
        <Card sx={{ p: 5, textAlign: 'center' }}>
          <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
            {t('customerClub.noDiscounts', 'No Customer-Specific Discounts Assigned')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('customerClub.noDiscountsDesc', 'Select a customer and assign a fixed percentage (e.g. 10%, 20%, 30%) for automatic POS application.')}
          </Typography>
          <Button
            variant="contained"
            startIcon={<Iconify icon={'solar:pen-bold' as any} />}
            onClick={() => {
              resetForm();
              setOpenModal(true);
            }}
          >
            {t('customerClub.assignFirst', 'Assign First Discount')}
          </Button>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('customerClub.customer', 'Customer')}</TableCell>
                <TableCell>{t('customerClub.rate', 'Discount Rate')}</TableCell>
                <TableCell>{t('customerClub.validity', 'Effective Window')}</TableCell>
                <TableCell>{t('customerClub.status', 'Status')}</TableCell>
                <TableCell>{t('customerClub.note', 'Note / Reason')}</TableCell>
                <TableCell align="right">{t('common.actions', 'Actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {discounts.map((row) => {
                const custName = row.customer
                  ? `${row.customer.first_name || ''} ${row.customer.last_name || ''}`.trim() || row.customer.phone_number || row.customer_id
                  : row.customer_id;

                return (
                  <TableRow key={row.id} hover>
                    <TableCell>
                      <Typography variant="subtitle2">{custName}</Typography>
                      {row.customer?.phone_number && (
                        <Typography variant="caption" color="text.secondary">
                          {row.customer.phone_number}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={`${row.discount_percentage}%`}
                        color="primary"
                        variant="filled"
                        sx={{ fontWeight: 'bold' }}
                      />
                    </TableCell>
                    <TableCell>
                      {row.effective_from || row.effective_to ? (
                        <Typography variant="caption">
                          {row.effective_from ? new Date(row.effective_from).toLocaleDateString() : t('customerClub.start', 'Start')}
                          {' — '}
                          {row.effective_to ? new Date(row.effective_to).toLocaleDateString() : t('customerClub.always', 'Always')}
                        </Typography>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {t('customerClub.alwaysValid', 'Always Valid')}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={row.is_active ? t('common.active', 'Active') : t('common.inactive', 'Inactive')}
                        color={row.is_active ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{row.note || '—'}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <IconButton color="primary" title={t('common.edit', 'Edit')} onClick={() => startEdit(row)}>
                        <Iconify icon={'solar:pen-bold' as any} />
                      </IconButton>
                      {row.is_active && (
                        <IconButton color="error" title={t('customerClub.revoke', 'Revoke Entitlement')} onClick={() => handleRevoke(row.id)}>
                          <Iconify icon={'solar:trash-bin-trash-bold' as any} />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Assignment / Edit Modal */}
      <Dialog open={openModal} onClose={() => setOpenModal(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? t('customerClub.editTitle', 'Edit Customer Discount') : t('customerClub.assignModalTitle', 'Assign Customer Discount')}</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ pt: 1 }}>
            {!editingId && (
              <TextField
                select
                fullWidth
                label={t('customerClub.selectCustomer', 'Select Customer')}
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
              >
                {customers.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {`${c.first_name || ''} ${c.last_name || ''}`.trim() || c.phone_number || c.id}
                  </MenuItem>
                ))}
              </TextField>
            )}

            <TextField
              fullWidth
              type="number"
              label={t('customerClub.discountPercentage', 'Discount Percentage (%)')}
              value={discountPct}
              onChange={(e) => setDiscountPct(e.target.value)}
              helperText={t('customerClub.percentageHelp', 'Example: 10 = 10%, 20 = 20%, 30 = 30%')}
            />

            <Stack direction="row" spacing={2}>
              <TextField
                fullWidth
                type="date"
                label={t('customerClub.effectiveFrom', 'Effective From (Optional)')}
                slotProps={{ inputLabel: { shrink: true } }}
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
              <TextField
                fullWidth
                type="date"
                label={t('customerClub.effectiveTo', 'Effective To (Optional)')}
                slotProps={{ inputLabel: { shrink: true } }}
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
              />
            </Stack>

            <TextField
              fullWidth
              multiline
              rows={2}
              label={t('customerClub.reasonNote', 'Note / Reason (Optional)')}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenModal(false)} color="inherit">
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveAssignment}
            disabled={(!editingId && !selectedCustomerId) || !discountPct || saving}
          >
            {saving ? <CircularProgress size={24} /> : t('common.save', 'Save Assignment')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Bulk Assignment Dialog */}
      <Dialog open={bulkOpen} onClose={() => setBulkOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('customerClub.bulkTitle', 'Bulk Customer Discount Assignment')}</DialogTitle>
        <DialogContent>
          <Stack spacing={3} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t('customerClub.bulkDesc', 'Search and select multiple customers to assign uniform percentage discount entitlements in a single workflow.')}
            </Typography>

            <Stack direction="row" spacing={2}>
              <TextField
                fullWidth
                type="number"
                label={t('customerClub.discountPercentage', 'Discount Percentage (%)')}
                value={bulkPct}
                onChange={(e) => setBulkPct(e.target.value)}
              />
              <TextField
                fullWidth
                type="date"
                label={t('customerClub.effectiveFrom', 'Effective From')}
                slotProps={{ inputLabel: { shrink: true } }}
                value={bulkFrom}
                onChange={(e) => setBulkFrom(e.target.value)}
              />
              <TextField
                fullWidth
                type="date"
                label={t('customerClub.effectiveTo', 'Effective To')}
                slotProps={{ inputLabel: { shrink: true } }}
                value={bulkTo}
                onChange={(e) => setBulkTo(e.target.value)}
              />
            </Stack>

            <TextField
              fullWidth
              label={t('customerClub.reasonNote', 'Note / Reason')}
              value={bulkNote}
              onChange={(e) => setBulkNote(e.target.value)}
            />

            <TextField
              fullWidth
              placeholder={t('common.searchCustomers', 'Search customers by name or phone...')}
              value={bulkSearch}
              onChange={(e) => setBulkSearch(e.target.value)}
            />

            <Box sx={{ maxHeight: 240, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={bulkSelectedIds.length > 0 && bulkSelectedIds.length === filteredBulkCustomers.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setBulkSelectedIds(filteredBulkCustomers.map((c) => c.id));
                          } else {
                            setBulkSelectedIds([]);
                          }
                        }}
                      />
                    </TableCell>
                    <TableCell>{t('customerClub.customer', 'Customer')}</TableCell>
                    <TableCell>{t('customerClub.phone', 'Phone')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredBulkCustomers.map((c) => (
                    <TableRow key={c.id} hover onClick={() => toggleBulkCustomer(c.id)} sx={{ cursor: 'pointer' }}>
                      <TableCell padding="checkbox">
                        <Checkbox checked={bulkSelectedIds.includes(c.id)} />
                      </TableCell>
                      <TableCell>
                        {`${c.first_name || ''} ${c.last_name || ''}`.trim() || c.id}
                      </TableCell>
                      <TableCell>{c.phone_number || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>

            <Alert severity="info">
              {t('customerClub.bulkReview', 'Review: {{count}} customer(s) selected for {{pct}}% discount.', {
                count: bulkSelectedIds.length,
                pct: bulkPct,
              })}
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBulkOpen(false)} color="inherit">
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveBulk}
            disabled={bulkSelectedIds.length === 0 || !bulkPct || saving}
          >
            {saving ? <CircularProgress size={24} /> : t('customerClub.confirmBulk', 'Assign to {{count}} Customer(s)', { count: bulkSelectedIds.length })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );

  return isEmbedded ? content : <DashboardContent>{content}</DashboardContent>;
}
