import type { KitchenTicket, KitchenStation} from 'src/api/kdsApi';

import React, { useState, useEffect } from 'react';

import UndoIcon from '@mui/icons-material/Undo';
import PrintIcon from '@mui/icons-material/Print';
import CheckIcon from '@mui/icons-material/Check';
import RefreshIcon from '@mui/icons-material/Refresh';
import SoupKitchenIcon from '@mui/icons-material/SoupKitchen';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
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
  Divider,
  Typography,
  IconButton,
  CardContent,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { kdsApi } from 'src/api/kdsApi';

export function KdsPage() {
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [bumpedTickets, setBumpedTickets] = useState<KitchenTicket[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [recallDrawerOpen, setRecallDrawerOpen] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printChitData, setPrintChitData] = useState<any | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [stList, tkList, bumpList] = await Promise.all([
        kdsApi.getStations(),
        kdsApi.getKdsTickets(selectedStationId === 'ALL' ? undefined : selectedStationId, false),
        kdsApi.getKdsTickets(selectedStationId === 'ALL' ? undefined : selectedStationId, true),
      ]);
      setStations(stList);
      setTickets(tkList);
      setBumpedTickets(bumpList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load KDS tickets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000); // Live poll every 10 seconds
    return () => clearInterval(interval);
  }, [selectedStationId]);

  const handleBumpTicket = async (ticketId: string) => {
    try {
      await kdsApi.bumpTicket(ticketId);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to bump ticket');
    }
  };

  const handleRecallTicket = async (ticketId: string) => {
    try {
      await kdsApi.recallTicket(ticketId);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to recall ticket');
    }
  };

  const handleToggleItemStatus = async (itemId: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'DONE' ? 'PENDING' : currentStatus === 'COOKING' ? 'DONE' : 'COOKING';
    try {
      await kdsApi.updateItemStatus(itemId, nextStatus);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to update item status');
    }
  };

  const handleSimulatePrint = async (ticketId: string) => {
    try {
      const res = await kdsApi.simulatePrint({ ticket_id: ticketId, paper_width_mm: 80 });
      setPrintChitData(res);
      setPrintModalOpen(true);
    } catch (err: any) {
      setError(err.detail || 'Failed to simulate print');
    }
  };

  const getUrgencyColor = (seconds: number) => {
    if (seconds > 600) return 'error'; // >10 mins (Urgent)
    if (seconds > 300) return 'warning'; // >5 mins
    return 'success';
  };

  const formatPrepTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Kitchen Display System (KDS)
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Slice 15 — Real-time kitchen preparation screen, line-item cooking progress, bump & recall, and simulated thermal printing
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            Refresh
          </Button>
          <Button variant="outlined" startIcon={<UndoIcon />} onClick={() => setRecallDrawerOpen(true)}>
            Recall Drawer ({bumpedTickets.length})
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Station Selector Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={selectedStationId} onChange={(_, val) => setSelectedStationId(val)}>
          <Tab label="All Stations" value="ALL" />
          {stations.map((st) => (
            <Tab key={st.id} label={st.name} value={st.id} />
          ))}
        </Tabs>
      </Box>

      {/* Tickets Grid */}
      <Grid container spacing={2.5}>
        {tickets.length === 0 ? (
          <Grid size={12}>
            <Paper variant="outlined" sx={{ p: 5, textAlign: 'center' }}>
              <SoupKitchenIcon sx={{ fontSize: 60, color: 'text.secondary', mb: 1 }} />
              <Typography variant="h6" color="text.secondary">
                No active kitchen tickets. All orders bumped & fulfilled!
              </Typography>
            </Paper>
          </Grid>
        ) : (
          tickets.map((t) => {
            const urgency = getUrgencyColor(t.prep_time_seconds);

            return (
              <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={t.id}>
                <Card
                  variant="outlined"
                  sx={{
                    borderTop: 6,
                    borderTopColor: `${urgency}.main`,
                    bgcolor: urgency === 'error' ? 'error.lighter' : 'background.paper',
                  }}
                >
                  <CardContent sx={{ pb: 1 }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                        #{t.order_number}
                      </Typography>
                      <Chip
                        icon={<LocalFireDepartmentIcon />}
                        label={formatPrepTime(t.prep_time_seconds)}
                        color={urgency as any}
                        size="small"
                        sx={{ fontWeight: 'bold' }}
                      />
                    </Stack>

                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                      Ticket: <code>{t.ticket_number}</code> • {t.order_type} {t.table_number ? `(Table ${t.table_number})` : ''}
                    </Typography>

                    <Divider sx={{ mb: 1.5 }} />

                    {/* Ticket Line Items */}
                    <Stack spacing={1} sx={{ mb: 2, minHeight: 120 }}>
                      {t.items.map((it) => {
                        const isDone = it.status === 'DONE';
                        const isCooking = it.status === 'COOKING';

                        return (
                          <Box
                            key={it.id}
                            onClick={() => handleToggleItemStatus(it.id, it.status)}
                            sx={{
                              p: 1,
                              borderRadius: 1,
                              bgcolor: isDone ? 'action.selected' : isCooking ? 'warning.lighter' : 'action.hover',
                              cursor: 'pointer',
                              textDecoration: isDone ? 'line-through' : 'none',
                              opacity: isDone ? 0.6 : 1,
                            }}
                          >
                            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                                {Number(it.quantity).toFixed(0)}x {it.product_name}
                              </Typography>
                              <Chip
                                label={it.status}
                                size="small"
                                color={isDone ? 'success' : isCooking ? 'warning' : 'default'}
                                sx={{ height: 20, fontSize: 10 }}
                              />
                            </Stack>

                            {it.options_summary && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pl: 1 }}>
                                + {it.options_summary}
                              </Typography>
                            )}
                            {it.special_instructions && (
                              <Typography variant="caption" color="error.main" sx={{ display: 'block', pl: 1, fontWeight: 'bold' }}>
                                * {it.special_instructions}
                              </Typography>
                            )}
                          </Box>
                        );
                      })}
                    </Stack>

                    <Stack direction="row" spacing={1}>
                      <Button variant="contained" color="success" size="small" fullWidth startIcon={<CheckIcon />} onClick={() => handleBumpTicket(t.id)}>
                        Bump Ticket
                      </Button>
                      <IconButton color="primary" size="small" onClick={() => handleSimulatePrint(t.id)}>
                        <PrintIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            );
          })
        )}
      </Grid>

      {/* Recall Drawer */}
      <Drawer anchor="right" open={recallDrawerOpen} onClose={() => setRecallDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Bumped Tickets Recall History
          </Typography>
          <Stack spacing={2}>
            {bumpedTickets.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No bumped tickets to recall.
              </Typography>
            ) : (
              bumpedTickets.map((bt) => (
                <Paper key={bt.id} variant="outlined" sx={{ p: 2 }}>
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                      Order #{bt.order_number} ({bt.ticket_number})
                    </Typography>
                    <Button variant="outlined" size="small" startIcon={<UndoIcon />} onClick={() => handleRecallTicket(bt.id)}>
                      Recall
                    </Button>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Bumped at: {new Date(bt.created_at).toLocaleTimeString()}
                  </Typography>
                </Paper>
              ))
            )}
          </Stack>
        </Box>
      </Drawer>

      {/* Simulated Thermal Print Modal */}
      <Dialog open={printModalOpen} onClose={() => setPrintModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PrintIcon color="primary" />
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
            Simulated 80mm Thermal Print Chit
          </Typography>
        </DialogTitle>
        <DialogContent>
          {printChitData && (
            <Paper
              variant="outlined"
              sx={{
                bgcolor: '#fffaed',
                p: 2,
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                lineHeight: 1.4,
              }}
            >
              {printChitData.raw_ascii_chit}
            </Paper>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPrintModalOpen(false)}>Close Preview</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
