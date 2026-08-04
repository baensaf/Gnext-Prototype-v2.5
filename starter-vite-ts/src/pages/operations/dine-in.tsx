import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Stack,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Alert,
  Tabs,
  Tab,
  Grid,
  Paper,
  Drawer,
} from '@mui/material';
import TableBarIcon from '@mui/icons-material/TableBar';
import PeopleIcon from '@mui/icons-material/People';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

import { dineInApi, DiningArea, DiningTable } from 'src/api/dineInApi';

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

  // Transfer / Merge Modals
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [targetTableId, setTargetTableId] = useState('');

  // New Table / Area Drawers
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
      setError(err.detail || 'Failed to load dining floor plan');
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
      setError(err.detail || 'Failed to seat guests');
    }
  };

  const handleTransferTable = async () => {
    if (!selectedTable || !targetTableId) return;
    try {
      await dineInApi.transferTable(selectedTable.id, targetTableId);
      setTransferDialogOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to transfer table');
    }
  };

  const handleReleaseTable = async (tableId: string) => {
    try {
      await dineInApi.releaseTable(tableId, 'AVAILABLE');
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to release table');
    }
  };

  const handleCreateArea = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await dineInApi.createArea({ code: areaCode, name: areaName });
      setAreaDrawerOpen(false);
      setAreaCode('');
      setAreaName('');
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create dining area');
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
      setError(err.detail || 'Failed to create dining table');
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
            Dine-In Visual Floor Plan & Tables
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Slice 14 — Interactive floor plan, live seating sessions, table transfers & merging
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            Refresh
          </Button>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setAreaDrawerOpen(true)}>
            Add Area
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

      {/* Area Selector Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={selectedAreaId} onChange={(_, val) => setSelectedAreaId(val)}>
          <Tab label="All Dining Areas" value="ALL" />
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
                No dining tables configured in this area. Click "Add Table" to create your restaurant layout.
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
                      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                        <PeopleIcon fontSize="small" color="action" />
                        <Typography variant="body2">{tbl.guest_count} Seated Guests</Typography>
                      </Stack>
                      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
                        <AccessTimeIcon fontSize="small" color="action" />
                        <Typography variant="body2">Seated {tbl.elapsed_minutes} mins ago</Typography>
                      </Stack>
                    </Stack>
                  ) : (
                    <Box sx={{ py: 2, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">
                        Ready for Guests
                      </Typography>
                    </Box>
                  )}

                  <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
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
                        <Button
                          variant="outlined"
                          size="small"
                          color="primary"
                          startIcon={<SwapHorizIcon />}
                          onClick={() => {
                            setSelectedTable(tbl);
                            setTransferDialogOpen(true);
                          }}
                        >
                          Transfer
                        </Button>
                        <Button variant="outlined" size="small" color="success" startIcon={<CheckCircleIcon />} onClick={() => handleReleaseTable(tbl.id)}>
                          Release
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

      {/* Transfer Table Dialog */}
      <Dialog open={transferDialogOpen} onClose={() => setTransferDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>Transfer Table {selectedTable?.table_number}</DialogTitle>
        <DialogContent>
          <TextField select label="Select Target Table" value={targetTableId} onChange={(e) => setTargetTableId(e.target.value)} fullWidth sx={{ mt: 1 }}>
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
          <Button onClick={() => setTransferDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" color="primary" onClick={handleTransferTable} disabled={!targetTableId}>
            Transfer Session
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Area Drawer */}
      <Drawer anchor="right" open={areaDrawerOpen} onClose={() => setAreaDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Add Dining Area
          </Typography>
          <Box component="form" onSubmit={handleCreateArea}>
            <Stack spacing={2.5}>
              <TextField label="Area Code" value={areaCode} onChange={(e) => setAreaCode(e.target.value)} required fullWidth placeholder="e.g. MAIN_HALL" />
              <TextField label="Area Name" value={areaName} onChange={(e) => setAreaName(e.target.value)} required fullWidth placeholder="e.g. Main Dining Hall" />
              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                Save Area
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
              <TextField select label="Dining Area" value={tblAreaId} onChange={(e) => setTblAreaId(e.target.value)} required fullWidth>
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
