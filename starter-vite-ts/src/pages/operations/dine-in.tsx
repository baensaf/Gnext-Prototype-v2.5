import type { DiningArea, DiningTable } from 'src/api/dineInApi';
import type { OrderHeader } from 'src/api/orderApi';

import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import PeopleIcon from '@mui/icons-material/People';
import RefreshIcon from '@mui/icons-material/Refresh';
import TableBarIcon from '@mui/icons-material/TableBar';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
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
  MenuItem,
  TextField,
  Typography,
  CardContent,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Tooltip,
} from '@mui/material';

import { dineInApi } from 'src/api/dineInApi';
import { orderApi } from 'src/api/orderApi';

export function DineInPage() {
  const [areas, setAreas] = useState<DiningArea[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
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
      const data = await dineInApi.getFloorPlan();
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
  }, []);

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
    // Find all other occupied table orders
    const otherOrderIds = tables
      .filter((t) => t.id !== tbl.id && t.active_order_id)
      .map((t) => t.active_order_id!);
    setSourceMergeOrderIds(otherOrderIds.slice(0, 1));
    setMergeReason('Customer requested table merge');
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

  const filteredTables = selectedAreaId === 'ALL' ? tables : tables.filter((t) => t.dining_area_id === selectedAreaId);

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

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Dine-In Floor Plan & Operations
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Slice R17 — Table management, occupancy, move, merge, split orders, item transfers, and guest bill
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            Refresh
          </Button>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAreaDrawerOpen(true)}>
            Add Section
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setTableDrawerOpen(true)}>
            Add Table
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Section Selector Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={selectedAreaId} onChange={(_, val) => setSelectedAreaId(val)}>
          <Tab label="All Sections" value="ALL" />
          {areas.map((a) => (
            <Tab key={a.id} label={a.name} value={a.id} />
          ))}
        </Tabs>
      </Box>

      {/* Visual Floor Plan Grid */}
      <Grid container spacing={3}>
        {filteredTables.length === 0 ? (
          <Grid size={12}>
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="body1" color="text.secondary">
                No dining tables configured in this section. Click &quot;Add Table&quot; to create your layout.
              </Typography>
            </Paper>
          </Grid>
        ) : (
          filteredTables.map((tbl) => (
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={tbl.id}>
              <Card
                variant="outlined"
                sx={{
                  borderLeft: 6,
                  borderLeftColor: `${getStatusColor(tbl.status)}.main`,
                  transition: 'transform 0.2s',
                  '&:hover': { transform: 'translateY(-2px)' },
                }}
              >
                <CardContent>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                      Table {tbl.table_number}
                    </Typography>
                    <Chip label={tbl.status} color={getStatusColor(tbl.status) as any} size="small" />
                  </Stack>

                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                    Capacity: {tbl.seating_capacity} Guests • Shape: {tbl.shape}
                  </Typography>

                  {tbl.status === 'OCCUPIED' || tbl.status === 'BILL_PRINTED' ? (
                    <Stack spacing={1} sx={{ mb: 2, bgcolor: 'action.hover', p: 1.5, borderRadius: 1 }}>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                          <PeopleIcon fontSize="small" color="action" />
                          <Typography variant="body2">{tbl.guest_count} Guests</Typography>
                        </Stack>
                        {tbl.order_number && (
                          <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                            #{tbl.order_number}
                          </Typography>
                        )}
                      </Stack>
                      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                          <AccessTimeIcon fontSize="small" color="action" />
                          <Typography variant="caption">{tbl.elapsed_minutes} mins</Typography>
                        </Stack>
                        {tbl.grand_total && (
                          <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                            {tbl.grand_total}
                          </Typography>
                        )}
                      </Stack>
                    </Stack>
                  ) : (
                    <Box sx={{ py: 2, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">
                        Ready for Guests
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
                        Seat Guests
                      </Button>
                    ) : (
                      <>
                        <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'space-between' }}>
                          <Tooltip title="Move Order to Another Table">
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
                          <Tooltip title="Merge Orders">
                            <IconButton size="small" color="secondary" onClick={() => handleOpenMergeDialog(tbl)}>
                              <MergeTypeIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Split Order Items">
                            <IconButton size="small" color="info" onClick={() => handleOpenSplitDialog(tbl)}>
                              <CallSplitIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Guest Bill Preview">
                            <IconButton size="small" color="warning" onClick={() => handleOpenGuestBill(tbl)}>
                              <ReceiptLongIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                        <Button variant="outlined" size="small" color="success" fullWidth startIcon={<CheckCircleIcon />} onClick={() => handleReleaseTable(tbl.id)}>
                          Release / Vacate
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
        <DialogTitle sx={{ fontWeight: 'bold' }}>Seat Guests — Table {selectedTable?.table_number}</DialogTitle>
        <Box component="form" onSubmit={handleSeatGuests}>
          <DialogContent>
            <TextField
              label="Number of Guests"
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
            <Button onClick={() => setSeatDialogOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" color="primary">
              Confirm Seating
            </Button>
          </DialogActions>
        </Box>
      </Dialog>

      {/* Move Table Dialog */}
      <Dialog open={moveDialogOpen} onClose={() => setMoveDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>Move Order from Table {selectedTable?.table_number}</DialogTitle>
        <DialogContent>
          <TextField
            select
            label="Target Available Table"
            value={targetMoveTableId}
            onChange={(e) => setTargetMoveTableId(e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
          >
            {tables
              .filter((t) => t.id !== selectedTable?.id && t.status === 'AVAILABLE')
              .map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  Table {t.table_number} (Capacity: {t.seating_capacity})
                </MenuItem>
              ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMoveDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={handleMoveTable} disabled={!targetMoveTableId}>
            Confirm Move
          </Button>
        </DialogActions>
      </Dialog>

      {/* Merge Orders Dialog */}
      <Dialog open={mergeDialogOpen} onClose={() => setMergeDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>Merge Orders into Table {selectedTable?.table_number}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select occupied orders to merge into Target Order #{selectedTable?.order_number}. Items will be moved and target order totals recalculated.
          </Typography>
          <TextField
            select
            label="Source Order to Merge"
            value={sourceMergeOrderIds[0] || ''}
            onChange={(e) => setSourceMergeOrderIds([e.target.value])}
            fullWidth
            sx={{ mb: 2 }}
          >
            {tables
              .filter((t) => t.id !== selectedTable?.id && t.active_order_id)
              .map((t) => (
                <MenuItem key={t.id} value={t.active_order_id!}>
                  Table {t.table_number} — Order #{t.order_number} ({t.grand_total})
                </MenuItem>
              ))}
          </TextField>
          <TextField
            label="Reason for Merge"
            value={mergeReason}
            onChange={(e) => setMergeReason(e.target.value)}
            fullWidth
            placeholder="e.g. Combined party table"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMergeDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={handleMergeOrders} disabled={sourceMergeOrderIds.length === 0}>
            Merge Orders
          </Button>
        </DialogActions>
      </Dialog>

      {/* Split Order Dialog */}
      <Dialog open={splitDialogOpen} onClose={() => setSplitDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>Split Order #{currentOrder?.order_number}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select quantities of items to move to a new child order.
          </Typography>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            {(currentOrder?.items || []).map((item) => (
              <Grid size={{ xs: 12, sm: 6 }} key={item.id}>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                    {item.product_name} {item.variant_name ? `(${item.variant_name})` : ''}
                  </Typography>

                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Price: {item.unit_price} | Current Qty: {item.quantity}
                  </Typography>
                  <TextField
                    label="Split Qty"
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
            label="Target Table for Split Order (Optional)"
            value={splitTargetTableId}
            onChange={(e) => setSplitTargetTableId(e.target.value)}
            fullWidth
          >
            <MenuItem value="">Same Table</MenuItem>
            {tables
              .filter((t) => t.status === 'AVAILABLE')
              .map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  Table {t.table_number} (Capacity: {t.seating_capacity})
                </MenuItem>
              ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSplitDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={handleSplitOrder}>
            Execute Split
          </Button>
        </DialogActions>
      </Dialog>

      {/* Guest Bill Dialog */}
      <Dialog open={billDialogOpen} onClose={() => setBillDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>Guest Bill Preview</DialogTitle>
        <DialogContent>
          <Box
            sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', p: 1, minHeight: 300 }}
            dangerouslySetInnerHTML={{ __html: billHtml }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBillDialogOpen(false)}>Close</Button>
          <Button variant="contained" onClick={() => window.print()}>
            Print Preview
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Section Drawer */}
      <Drawer anchor="right" open={areaDrawerOpen} onClose={() => setAreaDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Add Dining Section
          </Typography>
          <Box component="form" onSubmit={handleCreateArea}>
            <Stack spacing={2.5}>
              <TextField label="Section Code" value={areaCode} onChange={(e) => setAreaCode(e.target.value)} required fullWidth placeholder="e.g. MAIN_HALL" />
              <TextField label="Section Name" value={areaName} onChange={(e) => setAreaName(e.target.value)} required fullWidth placeholder="e.g. Main Dining Hall" />
              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                Save Section
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>

      {/* Add Table Drawer */}
      <Drawer anchor="right" open={tableDrawerOpen} onClose={() => setTableDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Add Dining Table
          </Typography>
          <Box component="form" onSubmit={handleCreateTable}>
            <Stack spacing={2.5}>
              <TextField select label="Dining Section" value={tblAreaId} onChange={(e) => setTblAreaId(e.target.value)} required fullWidth>
                {areas.map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField label="Table Code" value={tblCode} onChange={(e) => setTblCode(e.target.value)} required fullWidth placeholder="e.g. T-01" />
              <TextField label="Table Number" value={tblNumber} onChange={(e) => setTblNumber(e.target.value)} required fullWidth placeholder="e.g. 1" />
              <TextField label="Seating Capacity" type="number" value={tblCapacity} onChange={(e) => setTblCapacity(e.target.value)} required fullWidth />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                Save Table
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>
    </Box>
  );
}
