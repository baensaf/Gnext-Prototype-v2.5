import type { OrderHeader } from 'src/api/orderApi';
import type { DiningArea, DiningTable } from 'src/api/dineInApi';

import { useTranslation } from 'react-i18next';
import React, { useRef, useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import PeopleIcon from '@mui/icons-material/People';
import RefreshIcon from '@mui/icons-material/Refresh';
import PaymentIcon from '@mui/icons-material/Payment';
import TableBarIcon from '@mui/icons-material/TableBar';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import {
  Box,
  Tab,
  Card,
  Chip,
  Tabs,
  Grid,
  Stack,
  Alert,
  Paper,
  Button,
  Dialog,
  Drawer,
  Tooltip,
  MenuItem,
  TextField,
  Typography,
  IconButton,
  CardContent,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { orderApi } from 'src/api/orderApi';
import { dineInApi } from 'src/api/dineInApi';
import { useScopedBranchId } from 'src/contexts/branch-context';

import { Label } from 'src/components/label';
import { CheckoutModal } from 'src/components/CheckoutModal';

export function DineInPage() {
  const { t } = useTranslation();
  const [branchId] = useScopedBranchId();

  const [areas, setAreas] = useState<DiningArea[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string>('ALL');
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Seat Guests Modal
  const [seatDialogOpen, setSeatDialogOpen] = useState(false);
  const [selectedTable, setSelectedTable] = useState<DiningTable | null>(null);
  const [guestCount, setGuestCount] = useState('2');

  // Move Table Dialog
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [targetMoveTableId, setTargetMoveTableId] = useState('');

  // Merge Orders Dialog
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [sourceMergeOrderIds, setSourceMergeOrderIds] = useState<string[]>([]);
  const [mergeReason, setMergeReason] = useState('');

  // Split Order Dialog
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<OrderHeader | null>(null);
  const [splitQuantities, setSplitQuantities] = useState<Record<string, number>>({});
  const [splitTargetTableId, setSplitTargetTableId] = useState('');

  // Guest Bill Dialog
  const [billDialogOpen, setBillDialogOpen] = useState(false);
  const [billHtml, setBillHtml] = useState<string>('');
  const billFrameRef = useRef<HTMLIFrameElement>(null);

  // Pay Bill (Checkout) Dialog
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [payOrderId, setPayOrderId] = useState<string | null>(null);

  // New Table / Section Drawers
  const [tableDrawerOpen, setTableDrawerOpen] = useState(false);
  const [areaDrawerOpen, setAreaDrawerOpen] = useState(false);
  const [areaCode, setAreaCode] = useState('');
  const [areaName, setAreaName] = useState('');

  const [tblCode, setTblCode] = useState('');
  const [tblNumber, setTblNumber] = useState('');
  const [tblAreaId, setTblAreaId] = useState('');
  const [tblCapacity, setTblCapacity] = useState('4');

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await dineInApi.getFloorPlan(branchId || undefined);
      setAreas(data.areas);
      setTables(data.tables);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to load dining floor plan');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const handleSeatGuests = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTable) return;
    try {
      await dineInApi.seatGuests(selectedTable.id, parseInt(guestCount, 10));
      setSeatDialogOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to seat guests');
    }
  };

  const handleMoveTable = async () => {
    if (!selectedTable || !selectedTable.active_order_id || !targetMoveTableId) return;
    try {
      await dineInApi.moveTable(selectedTable.active_order_id, targetMoveTableId);
      setMoveDialogOpen(false);
      setTargetMoveTableId('');
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to move table');
    }
  };

  const handleOpenMergeDialog = (tbl: DiningTable) => {
    setSelectedTable(tbl);
    const otherOrderIds = tables
      .filter((tableItem) => tableItem.id !== tbl.id && tableItem.active_order_id)
      .map((tableItem) => tableItem.active_order_id!);
    setSourceMergeOrderIds(otherOrderIds.slice(0, 1));
    setMergeReason(t('dineIn.mergeReasonPlaceholder', 'Combined party table'));
    setMergeDialogOpen(true);
  };

  const handleMergeOrders = async () => {
    if (!selectedTable || !selectedTable.active_order_id || sourceMergeOrderIds.length === 0) return;
    try {
      await dineInApi.mergeOrders(sourceMergeOrderIds, selectedTable.active_order_id, mergeReason);
      setMergeDialogOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to merge orders');
    }
  };

  const handleOpenSplitDialog = async (tbl: DiningTable) => {
    setSelectedTable(tbl);
    if (!tbl.active_order_id) return;
    try {
      const ord = await orderApi.getOrderById(tbl.active_order_id);
      setCurrentOrder(ord);
      const initialQty: Record<string, number> = {};
      (ord.items || []).forEach((item) => {
        initialQty[item.id] = 0;
      });
      setSplitQuantities(initialQty);
      setSplitTargetTableId('');
      setSplitDialogOpen(true);
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to fetch order details for split');
    }
  };

  const handleSplitOrder = async () => {
    if (!currentOrder) return;
    const linesToSplit = Object.entries(splitQuantities)
      .filter(([_, qty]) => qty > 0)
      .map(([orderItemId, quantity]) => ({ orderItemId, quantity }));

    if (linesToSplit.length === 0) {
      setError('Please select at least one item quantity to split');
      return;
    }

    try {
      await orderApi.splitOrder(currentOrder.id, linesToSplit, splitTargetTableId || undefined);
      setSplitDialogOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to split order');
    }
  };

  const handleOpenGuestBill = async (tbl: DiningTable) => {
    if (!tbl.active_order_id) return;
    try {
      const res = await orderApi.getGuestBill(tbl.active_order_id);
      setBillHtml(res.html);
      setBillDialogOpen(true);
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to generate guest bill preview');
    }
  };

  const handleOpenPayment = (tbl: DiningTable) => {
    if (!tbl.active_order_id) return;
    setPayOrderId(tbl.active_order_id);
    setPayModalOpen(true);
  };

  const handleReleaseTable = async (tableId: string) => {
    try {
      await dineInApi.releaseTable(tableId, 'AVAILABLE');
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to release table');
    }
  };

  const handleCreateArea = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await dineInApi.createSection({ code: areaCode, name: areaName });
      setAreaDrawerOpen(false);
      setAreaCode('');
      setAreaName('');
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to create dining section');
    }
  };

  const handleCreateTable = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await dineInApi.createTable({
        dining_area_id: tblAreaId,
        code: tblCode,
        table_number: tblNumber,
        seating_capacity: parseInt(tblCapacity, 10),
      });
      setTableDrawerOpen(false);
      setTblCode('');
      setTblNumber('');
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to create dining table');
    }
  };

  const filteredTables = selectedAreaId === 'ALL' ? tables : tables.filter((tableItem) => tableItem.dining_area_id === selectedAreaId);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'AVAILABLE':
        return 'success';
      case 'OCCUPIED':
        return 'error';
      case 'BILL_PRINTED':
        return 'warning';
      case 'CLEANING':
        return 'info';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'AVAILABLE':
        return t('dineIn.statusAvailable', 'Available');
      case 'OCCUPIED':
        return t('dineIn.statusOccupied', 'Occupied');
      case 'BILL_PRINTED':
        return t('dineIn.statusBillPrinted', 'Bill Printed');
      case 'CLEANING':
        return t('dineIn.statusCleaning', 'Cleaning');
      case 'RESERVED':
        return t('dineIn.statusReserved', 'Reserved');
      default:
        return status;
    }
  };

  const occupiedCount = tables.filter((tableItem) => tableItem.status === 'OCCUPIED' || tableItem.status === 'BILL_PRINTED').length;
  const availableCount = tables.filter((tableItem) => tableItem.status === 'AVAILABLE').length;
  const totalGuests = tables.reduce((sum, tableItem) => sum + (tableItem.guest_count || 0), 0);

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {t('dineIn.title', 'Dine-In Floor Plan & Operations')} <Label color="info">V4</Label>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('dineIn.subtitle', 'Slice R17 — Table management, occupancy, move, merge, split orders, item transfers, and guest bill')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            {t('dineIn.refresh', 'Refresh')}
          </Button>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAreaDrawerOpen(true)}>
            {t('dineIn.addSection', 'Add Section')}
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setTableDrawerOpen(true)}>
            {t('dineIn.addTable', 'Add Table')}
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Floor Overview KPI Summary */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5, textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              {t('dineIn.totalTables', 'Total Tables')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5 }}>
              {tables.length}
            </Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5, textAlign: 'center', borderColor: 'error.light', bgcolor: 'error.lighter' }}>
            <Typography variant="caption" color="error.main" sx={{ fontWeight: 'bold' }}>
              {t('dineIn.statusOccupied', 'Occupied')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'error.darker', mt: 0.5 }}>
              {occupiedCount}
            </Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5, textAlign: 'center', borderColor: 'success.light', bgcolor: 'success.lighter' }}>
            <Typography variant="caption" color="success.main" sx={{ fontWeight: 'bold' }}>
              {t('dineIn.statusAvailable', 'Available')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'success.darker', mt: 0.5 }}>
              {availableCount}
            </Typography>
          </Paper>
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5, textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">
              {t('dineIn.activeGuests', 'Active Guests')}
            </Typography>
            <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5 }}>
              {totalGuests}
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Section Selector Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={selectedAreaId} onChange={(_, val) => setSelectedAreaId(val)} variant="scrollable" scrollButtons="auto">
          <Tab label={t('dineIn.allSections', 'All Sections')} value="ALL" />
          {areas.map((a) => (
            <Tab key={a.id} label={a.name} value={a.id} />
          ))}
        </Tabs>
      </Box>

      {/* Visual Floor Plan Grid */}
      <Grid container spacing={3}>
        {filteredTables.length === 0 ? (
          <Grid size={12}>
            <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 2 }}>
              <TableBarIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1.5 }} />
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 1 }}>
                {t('dineIn.noTablesTitle', 'No dining tables configured in this section')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                {t('dineIn.noTablesDesc', 'Click "Add Table" to create your layout.')}
              </Typography>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setTableDrawerOpen(true)}>
                {t('dineIn.addTable', 'Add Table')}
              </Button>
            </Paper>
          </Grid>
        ) : (
          filteredTables.map((tbl) => (
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={tbl.id}>
              <Card
                variant="outlined"
                sx={{
                  borderInlineStart: 6,
                  borderInlineStartColor: `${getStatusColor(tbl.status)}.main`,
                  borderRadius: 1.5,
                  transition: 'all 0.2s',
                  '&:hover': { transform: 'translateY(-2px)' },
                }}
              >
                <CardContent sx={{ p: 2.5 }}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                      {t('dineIn.table', 'Table')} {tbl.table_number}
                    </Typography>
                    <Chip label={getStatusLabel(tbl.status)} color={getStatusColor(tbl.status) as any} size="small" sx={{ fontWeight: 'bold' }} />
                  </Stack>

                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                    {t('dineIn.capacity', 'Capacity')}: {tbl.seating_capacity} {t('dineIn.guests', 'Guests')} • {t('dineIn.shape', 'Shape')}: {tbl.shape}
                  </Typography>

                  {tbl.status === 'OCCUPIED' || tbl.status === 'BILL_PRINTED' ? (
                    <Stack spacing={1.25} sx={{ mb: 2, bgcolor: 'action.hover', p: 1.5, borderRadius: 1 }}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                          <PeopleIcon fontSize="small" color="action" />
                          <Typography variant="body2" sx={{ unicodeBidi: 'isolate' }}>
                            {tbl.guest_count} {t('dineIn.guests', 'Guests')}
                          </Typography>
                        </Stack>
                        {tbl.order_number && (
                          <Typography variant="caption" sx={{ fontWeight: 'bold', direction: 'ltr', unicodeBidi: 'isolate' }}>
                            #{tbl.order_number}
                          </Typography>
                        )}
                      </Stack>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                          <AccessTimeIcon fontSize="small" color="action" />
                          <Typography variant="caption" sx={{ unicodeBidi: 'isolate', display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                            <Box component="span" sx={{ direction: 'ltr', display: 'inline-block' }}>{tbl.elapsed_minutes}</Box> {t('dineIn.mins', 'mins')}
                          </Typography>
                        </Stack>
                        {tbl.grand_total && (
                          <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'primary.main', direction: 'ltr', unicodeBidi: 'isolate' }}>
                            {tbl.grand_total}
                          </Typography>
                        )}
                      </Stack>
                    </Stack>
                  ) : (
                    <Box sx={{ py: 2, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('dineIn.readyForGuests', 'Ready for Guests')}
                      </Typography>
                    </Box>
                  )}

                  <Stack direction="column" spacing={1} sx={{ mt: 2 }}>
                    {tbl.status === 'AVAILABLE' ? (
                      <Button
                        variant="contained"
                        size="small"
                        fullWidth
                        startIcon={<TableBarIcon />}
                        onClick={() => {
                          setSelectedTable(tbl);
                          setSeatDialogOpen(true);
                        }}
                      >
                        {t('dineIn.seatGuests', 'Seat Guests')}
                      </Button>
                    ) : (
                      <>
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'space-between' }}>
                          <Tooltip title={t('dineIn.moveOrder', 'Move Order to Another Table')}>
                            <IconButton
                              size="small"
                              color="primary"
                              onClick={() => {
                                setSelectedTable(tbl);
                                setMoveDialogOpen(true);
                              }}
                            >
                              <SwapHorizIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('dineIn.mergeOrders', 'Merge Orders')}>
                            <IconButton size="small" color="secondary" onClick={() => handleOpenMergeDialog(tbl)}>
                              <MergeTypeIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('dineIn.splitOrder', 'Split Order Items')}>
                            <IconButton size="small" color="info" onClick={() => handleOpenSplitDialog(tbl)}>
                              <CallSplitIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('dineIn.guestBillPreview', 'Guest Bill Preview')}>
                            <IconButton size="small" color="warning" onClick={() => handleOpenGuestBill(tbl)}>
                              <ReceiptLongIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('dineIn.payBill', 'Pay Bill')}>
                            <IconButton size="small" color="success" onClick={() => handleOpenPayment(tbl)}>
                              <PaymentIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                        <Button variant="outlined" size="small" color="success" fullWidth startIcon={<CheckCircleIcon />} onClick={() => handleReleaseTable(tbl.id)}>
                          {t('dineIn.releaseVacate', 'Release / Vacate')}
                        </Button>
                      </>
                    )}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))
        )}
      </Grid>

      {/* Seat Guests Dialog */}
      <Dialog open={seatDialogOpen} onClose={() => setSeatDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('dineIn.seatDialogTitle', 'Seat Guests — Table')} {selectedTable?.table_number}
        </DialogTitle>
        <Box component="form" onSubmit={handleSeatGuests}>
          <DialogContent>
            <TextField
              label={t('dineIn.numberOfGuests', 'Number of Guests')}
              type="number"
              value={guestCount}
              onChange={(e) => setGuestCount(e.target.value)}
              required
              fullWidth
              autoFocus
              slotProps={{ htmlInput: { min: 1, max: 20 } }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSeatDialogOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button type="submit" variant="contained" color="primary">
              {t('dineIn.confirmSeating', 'Confirm Seating')}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Move Table Dialog */}
      <Dialog open={moveDialogOpen} onClose={() => setMoveDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('dineIn.moveDialogTitle', 'Move Order from Table')} {selectedTable?.table_number}
        </DialogTitle>
        <DialogContent>
          <TextField
            select
            label={t('dineIn.targetTable', 'Target Available Table')}
            value={targetMoveTableId}
            onChange={(e) => setTargetMoveTableId(e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
          >
            {tables
              .filter((tbl) => tbl.id !== selectedTable?.id && tbl.status === 'AVAILABLE')
              .map((tbl) => (
                <MenuItem key={tbl.id} value={tbl.id}>
                  {t('dineIn.table', 'Table')} {tbl.table_number} ({t('dineIn.capacity', 'Capacity')}: {tbl.seating_capacity})
                </MenuItem>
              ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveDialogOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="primary" onClick={handleMoveTable} disabled={!targetMoveTableId}>
            {t('dineIn.confirmMove', 'Confirm Move')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Merge Orders Dialog */}
      <Dialog open={mergeDialogOpen} onClose={() => setMergeDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('dineIn.mergeDialogTitle', 'Merge Orders into Table')} {selectedTable?.table_number}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('dineIn.mergeDialogDesc', 'Select occupied orders to merge into Target Order. Items will be moved and target order totals recalculated.')}
          </Typography>
          <TextField
            select
            label={t('dineIn.sourceOrder', 'Source Order to Merge')}
            value={sourceMergeOrderIds[0] || ''}
            onChange={(e) => setSourceMergeOrderIds([e.target.value])}
            fullWidth
            sx={{ mb: 2 }}
          >
            {tables
              .filter((tbl) => tbl.id !== selectedTable?.id && tbl.active_order_id)
              .map((tbl) => (
                <MenuItem key={tbl.id} value={tbl.active_order_id!}>
                  {t('dineIn.table', 'Table')} {tbl.table_number} — #{tbl.order_number} ({tbl.grand_total})
                </MenuItem>
              ))}
          </TextField>
          <TextField
            label={t('dineIn.mergeReason', 'Reason for Merge')}
            value={mergeReason}
            onChange={(e) => setMergeReason(e.target.value)}
            fullWidth
            placeholder={t('dineIn.mergeReasonPlaceholder', 'e.g. Combined party table')}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMergeDialogOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="primary" onClick={handleMergeOrders} disabled={sourceMergeOrderIds.length === 0}>
            {t('dineIn.confirmMerge', 'Merge Orders')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Split Order Dialog */}
      <Dialog open={splitDialogOpen} onClose={() => setSplitDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('dineIn.splitDialogTitle', 'Split Order')} #{currentOrder?.order_number}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('dineIn.splitDialogDesc', 'Select quantities of items to move to a new child order.')}
          </Typography>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            {(currentOrder?.items || []).map((item) => (
              <Grid size={{ xs: 12, sm: 6 }} key={item.id}>
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                    {item.product_name} {item.variant_name ? `(${item.variant_name})` : ''}
                  </Typography>

                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    {t('dineIn.price', 'Price')}: {item.unit_price} | {t('dineIn.currentQty', 'Current Qty')}: {item.quantity}
                  </Typography>
                  <TextField
                    label={t('dineIn.splitQty', 'Split Qty')}
                    type="number"
                    size="small"
                    value={splitQuantities[item.id] || 0}
                    onChange={(e) => {
                      const val = Math.max(0, Math.min(parseFloat(item.quantity), parseFloat(e.target.value) || 0));
                      setSplitQuantities((prev) => ({ ...prev, [item.id]: val }));
                    }}
                    slotProps={{ htmlInput: { min: 0, max: parseFloat(item.quantity), step: 1 } }}
                    fullWidth
                  />
                </Paper>
              </Grid>
            ))}
          </Grid>
          <TextField
            select
            label={t('dineIn.targetTableOptional', 'Target Table for Split Order (Optional)')}
            value={splitTargetTableId}
            onChange={(e) => setSplitTargetTableId(e.target.value)}
            fullWidth
          >
            <MenuItem value="">{t('dineIn.sameTable', 'Same Table')}</MenuItem>
            {tables
              .filter((tbl) => tbl.status === 'AVAILABLE')
              .map((tbl) => (
                <MenuItem key={tbl.id} value={tbl.id}>
                  {t('dineIn.table', 'Table')} {tbl.table_number} ({t('dineIn.capacity', 'Capacity')}: {tbl.seating_capacity})
                </MenuItem>
              ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSplitDialogOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" color="primary" onClick={handleSplitOrder}>
            {t('dineIn.executeSplit', 'Execute Split')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Guest Bill Dialog */}
      <Dialog open={billDialogOpen} onClose={() => setBillDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>{t('dineIn.guestBillTitle', 'Guest Bill Preview')}</DialogTitle>
        <DialogContent>
          {/*
            The bill is a whole document with its own body and table styles; in a frame
            they cannot restyle the app. Same-origin (with scripts still off) so Print can
            reach the frame and print the bill rather than the whole screen.
          */}
          <Box
            component="iframe"
            ref={billFrameRef}
            title={t('dineIn.guestBillTitle', 'Guest Bill Preview')}
            srcDoc={billHtml}
            sandbox="allow-same-origin allow-modals"
            sx={{
              display: 'block',
              width: '100%',
              height: 520,
              border: 1,
              borderColor: 'divider',
              borderRadius: 1,
              bgcolor: '#fff',
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBillDialogOpen(false)}>{t('common.close', 'Close')}</Button>
          <Button variant="contained" onClick={() => billFrameRef.current?.contentWindow?.print()}>
            {t('dineIn.printPreview', 'Print Preview')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Section Drawer */}
      <Drawer anchor="right" open={areaDrawerOpen} onClose={() => setAreaDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            {t('dineIn.addSectionTitle', 'Add Dining Section')}
          </Typography>
          <Box component="form" onSubmit={handleCreateArea}>
            <Stack spacing={2.5}>
              <TextField label={t('dineIn.sectionCode', 'Section Code')} value={areaCode} onChange={(e) => setAreaCode(e.target.value)} required fullWidth placeholder="e.g. MAIN_HALL" />
              <TextField label={t('dineIn.sectionName', 'Section Name')} value={areaName} onChange={(e) => setAreaName(e.target.value)} required fullWidth placeholder="e.g. Main Dining Hall" />
              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                {t('dineIn.saveSection', 'Save Section')}
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>

      {/* Add Table Drawer */}
      <Drawer anchor="right" open={tableDrawerOpen} onClose={() => setTableDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            {t('dineIn.addTableTitle', 'Add Dining Table')}
          </Typography>
          <Box component="form" onSubmit={handleCreateTable}>
            <Stack spacing={2.5}>
              <TextField select label={t('dineIn.diningSection', 'Dining Section')} value={tblAreaId} onChange={(e) => setTblAreaId(e.target.value)} required fullWidth>
                {areas.map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label={t('dineIn.tableCode', 'Table Code')} value={tblCode} onChange={(e) => setTblCode(e.target.value)} required fullWidth placeholder="e.g. T-01" />
              <TextField label={t('dineIn.tableNumber', 'Table Number')} value={tblNumber} onChange={(e) => setTblNumber(e.target.value)} required fullWidth placeholder="e.g. 1" />
              <TextField label={t('dineIn.seatingCapacity', 'Seating Capacity')} type="number" value={tblCapacity} onChange={(e) => setTblCapacity(e.target.value)} required fullWidth />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                {t('dineIn.saveTable', 'Save Table')}
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>

      <CheckoutModal
        open={payModalOpen}
        orderId={payOrderId}
        onClose={() => setPayModalOpen(false)}
        onPaymentComplete={() => {
          setPayModalOpen(false);
          loadData();
        }}
      />
    </Box>
  );
}
