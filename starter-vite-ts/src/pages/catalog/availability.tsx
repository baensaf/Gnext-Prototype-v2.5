import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Alert,
  Grid,
} from '@mui/material';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import RefreshIcon from '@mui/icons-material/Refresh';

import { catalogApi, Product, ProductAvailability } from 'src/api/catalogApi';
import { tenantApi, Branch } from 'src/api/tenantApi';

export function AvailabilityPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [availabilities, setAvailabilities] = useState<ProductAvailability[]>([]);
  const [loading, setLoading] = useState(true);
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
      setError(err.detail || 'Failed to load availability data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleOpenSuspendModal = (prod: Product) => {
    setSelectedProduct(prod);
    setSuspendModalOpen(true);
  };

  const handleSuspendSubmit = async () => {
    if (!selectedProduct) return;
    try {
      await catalogApi.suspendProduct(selectedProduct.id, suspendBranchId || undefined, parseFloat(suspendHours), suspendReason);
      setSuspendModalOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to suspend product');
    }
  };

  const handleResumeProduct = async (productId: string, branchId?: string) => {
    try {
      await catalogApi.resumeProduct(productId, branchId);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to resume product');
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Availability & Item Suspension
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Slice 5 — Temporary item suspensions & branch availability dashboard
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
          Refresh
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
              <TableCell>Code</TableCell>
              <TableCell>Product Name</TableCell>
              <TableCell>Base Price</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Suspension Reason</TableCell>
              <TableCell>Suspended Until</TableCell>
              <TableCell align="right">Actions</TableCell>
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
                  <TableCell>{p.base_price}</TableCell>
                  <TableCell>
                    <Chip
                      label={isSuspended ? '86d / Suspended' : 'Available'}
                      color={isSuspended ? 'error' : 'success'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{isSuspended ? avail?.reason || '86d' : '-'}</TableCell>
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
                        Resume Item
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        color="warning"
                        variant="outlined"
                        startIcon={<PauseCircleIcon />}
                        onClick={() => handleOpenSuspendModal(p)}
                      >
                        Suspend Item
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
        <DialogTitle>Suspend Product: {selectedProduct?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField select label="Branch Scope" value={suspendBranchId} onChange={(e) => setSuspendBranchId(e.target.value)} fullWidth>
              <MenuItem value="">All Branches</MenuItem>
              {branches.map((b) => (
                <MenuItem key={b.id} value={b.id}>
                  {b.name}
                </MenuItem>
              ))}
            </TextField>

            <TextField select label="Suspension Duration" value={suspendHours} onChange={(e) => setSuspendHours(e.target.value)} fullWidth>
              <MenuItem value="1">1 Hour</MenuItem>
              <MenuItem value="2">2 Hours (Default shift)</MenuItem>
              <MenuItem value="4">4 Hours</MenuItem>
              <MenuItem value="8">8 Hours</MenuItem>
              <MenuItem value="24">24 Hours (Full Day)</MenuItem>
            </TextField>

            <TextField
              label="Suspension Reason"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              fullWidth
              placeholder="e.g. Out of ingredients, Equipment failure"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSuspendModalOpen(false)}>Cancel</Button>
          <Button color="warning" variant="contained" onClick={handleSuspendSubmit}>
            Confirm Suspension
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
