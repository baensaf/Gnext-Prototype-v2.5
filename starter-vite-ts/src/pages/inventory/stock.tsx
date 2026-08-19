import type { Branch } from 'src/api/tenantApi';
import type { ReasonCode } from 'src/api/settingsApi';
import type { InventoryItem, InventoryTransaction } from 'src/api/inventoryApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddBoxIcon from '@mui/icons-material/AddBox';
import WarningIcon from '@mui/icons-material/Warning';
import HistoryIcon from '@mui/icons-material/History';
import {
  Box,
  Card,
  Chip,
  Stack,
  Alert,
  Paper,
  Table,
  Button,
  Dialog,
  Select,
  MenuItem,
  TableRow,
  TextField,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  InputLabel,
  CardContent,
  DialogTitle,
  FormControl,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { tenantApi } from 'src/api/tenantApi';
import { settingsApi } from 'src/api/settingsApi';
import { inventoryApi } from 'src/api/inventoryApi';

export function InventoryStockPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [alerts, setAlerts] = useState<InventoryItem[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Post Transaction Modal
  const [txDialogOpen, setTxDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [txType, setTxType] = useState('PURCHASE_RECEIPT');
  const [qtyDelta, setQtyDelta] = useState('10');
  const [reasonId, setReasonId] = useState('');
  const [txNote, setTxNote] = useState('');

  // Audit History Modal
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [itemHistory, setItemHistory] = useState<InventoryTransaction[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const bList = await tenantApi.getBranches();
      setBranches(bList);

      const iList = await inventoryApi.getInventoryItems(selectedBranchId || undefined);
      setItems(iList);

      const aList = await inventoryApi.getLowStockAlerts(selectedBranchId || undefined);
      setAlerts(aList);

      const rList = await settingsApi.getReasonCodes();
      setReasonCodes(rList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load inventory stock');
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleOpenTxDialog = (item: InventoryItem) => {
    setSelectedItem(item);
    setTxType('PURCHASE_RECEIPT');
    setQtyDelta('10');
    setReasonId('');
    setTxNote('');
    setTxDialogOpen(true);
  };

  const handlePostTx = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    try {
      await inventoryApi.postTransaction({
        inventory_item_id: selectedItem.id,
        transaction_type: txType,
        quantity_delta: qtyDelta,
        reason_code_id: reasonId || undefined,
        note: txNote || undefined,
      });
      setTxDialogOpen(false);
      setSelectedItem(null);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to post inventory transaction');
    }
  };

  const handleOpenHistory = async (item: InventoryItem) => {
    setSelectedItem(item);
    try {
      const txs = await inventoryApi.getItemTransactions(item.id);
      setItemHistory(txs);
      setHistoryDialogOpen(true);
    } catch (err: any) {
      setError(err.detail || 'Failed to load transaction history');
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Stack direction="row" spacing={1.5} sx={{ mb: 0.5, alignItems: 'center' }}>
            <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
              Multi-Branch Stock & Low-Stock Alerts
            </Typography>
            <Chip
              label={t('nav.v5Preview', 'V5 Preview')}
              color="info"
              variant="filled"
              size="small"
              sx={{ fontWeight: 'bold' }}
            />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Inventory stock levels, reorder threshold alerts, and waste/adjustment tracking
          </Typography>
        </Box>

        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Filter Branch</InputLabel>
          <Select
            value={selectedBranchId}
            label="Filter Branch"
            onChange={(e) => setSelectedBranchId(e.target.value)}
          >
            <MenuItem value="">All Branches</MenuItem>
            {branches.map((b) => (
              <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {/* V5 Preview Isolation Notice Banner */}
      <Alert severity="info" variant="outlined" sx={{ mb: 3, borderRadius: 2, fontWeight: 500 }}>
        {t('inventory.v5Banner', 'V5 Preview Module: Inventory stock management is retained for V5 preview. It does not affect v2 catalog availability, order submission, KDS, reports, or financial calculations.')}
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Low Stock Warning Banner */}
      {alerts.length > 0 && (
        <Alert
          severity="warning"
          icon={<WarningIcon fontSize="inherit" />}
          sx={{ mb: 3, borderRadius: 2 }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
            LOW-STOCK ALERT: {alerts.length} Item(s) Below Reorder Threshold!
          </Typography>
          <Box sx={{ mt: 0.5 }}>
            {alerts.map((a) => (
              <Chip
                key={a.id}
                label={`${a.product_name} (${a.quantity_on_hand} / min ${a.reorder_level} ${a.unit_of_measure})`}
                color="warning"
                size="small"
                sx={{ mr: 1, mt: 0.5, fontWeight: 'bold' }}
                onClick={() => handleOpenTxDialog(a)}
              />
            ))}
          </Box>
        </Alert>
      )}

      {/* Stock Items Table */}
      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Product Code</TableCell>
                  <TableCell>Product Name</TableCell>
                  <TableCell align="right">On Hand Qty</TableCell>
                  <TableCell align="right">Reorder Level</TableCell>
                  <TableCell>UOM</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <code>{item.product_code}</code>
                    </TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{item.product_name}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '1.05rem', color: item.is_low_stock ? 'error.main' : 'text.primary' }}>
                      {Number(item.quantity_on_hand).toLocaleString()}
                    </TableCell>
                    <TableCell align="right" color="text.secondary">
                      {Number(item.reorder_level).toLocaleString()}
                    </TableCell>
                    <TableCell>{item.unit_of_measure}</TableCell>
                    <TableCell>
                      {item.is_low_stock ? (
                        <Chip label="LOW STOCK ALERT" color="error" size="small" sx={{ fontWeight: 'bold' }} />
                      ) : (
                        <Chip label="NORMAL" color="success" variant="outlined" size="small" />
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        <Button
                          size="small"
                          variant="contained"
                          color="primary"
                          startIcon={<AddBoxIcon />}
                          onClick={() => handleOpenTxDialog(item)}
                        >
                          Adjust / Restock
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<HistoryIcon />}
                          onClick={() => handleOpenHistory(item)}
                        >
                          History
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Post Transaction Dialog */}
      <Dialog open={txDialogOpen} onClose={() => setTxDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          Stock Transaction — {selectedItem?.product_name}
        </DialogTitle>
        <Box component="form" onSubmit={handlePostTx}>
          <DialogContent sx={{ minWidth: 380, pt: 2 }}>
            <Stack spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Transaction Type</InputLabel>
                <Select
                  value={txType}
                  label="Transaction Type"
                  onChange={(e) => setTxType(e.target.value)}
                >
                  <MenuItem value="PURCHASE_RECEIPT">Purchase Receipt (+)</MenuItem>
                  <MenuItem value="ADJUSTMENT">Stock Adjustment (+ / -)</MenuItem>
                  <MenuItem value="WASTE">Inventory Waste (-)</MenuItem>
                  <MenuItem value="TRANSFER">Branch Transfer (+ / -)</MenuItem>
                </Select>
              </FormControl>

              <TextField
                size="small"
                label={`Quantity Delta (${selectedItem?.unit_of_measure})`}
                type="number"
                required
                fullWidth
                helperText="Use positive for additions (+10), negative for reductions (-5)"
                value={qtyDelta}
                onChange={(e) => setQtyDelta(e.target.value)}
              />

              {(txType === 'WASTE' || txType === 'ADJUSTMENT') && (
                <FormControl fullWidth size="small" required>
                  <InputLabel>Reason Code</InputLabel>
                  <Select
                    value={reasonId}
                    label="Reason Code"
                    onChange={(e) => setReasonId(e.target.value)}
                  >
                    {reasonCodes.map((r) => (
                      <MenuItem key={r.id} value={r.id}>
                        {r.name} ({r.code})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <TextField
                size="small"
                label="Note / Explanation"
                fullWidth
                multiline
                rows={2}
                value={txNote}
                onChange={(e) => setTxNote(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setTxDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" sx={{ fontWeight: 'bold' }}>
              Post Stock Transaction
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Transaction History Dialog */}
      <Dialog open={historyDialogOpen} onClose={() => setHistoryDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          Stock Transaction Audit Log — {selectedItem?.product_name}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Recorded Time</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell align="right">Qty Delta</TableCell>
                  <TableCell>Note / Reason</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {itemHistory.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>{new Date(tx.recorded_at).toLocaleString()}</TableCell>
                    <TableCell>
                      <Chip label={tx.transaction_type} size="small" />
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', color: Number(tx.quantity_delta) >= 0 ? 'success.main' : 'error.main' }}>
                      {Number(tx.quantity_delta) > 0 ? `+${tx.quantity_delta}` : tx.quantity_delta}
                    </TableCell>
                    <TableCell>{tx.note || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
