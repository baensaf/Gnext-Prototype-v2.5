import type { KitchenTicket, KitchenStation } from 'src/api/kdsApi';

import React, { useState, useEffect } from 'react';

import UndoIcon from '@mui/icons-material/Undo';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import SoupKitchenIcon from '@mui/icons-material/SoupKitchen';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
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
  Slider,
  Divider,
  Tooltip,
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
  const [selectedStationId, setSelectedStationId] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [recallDrawerOpen, setRecallDrawerOpen] = useState(false);
  const [priorityDialogOpen, setPriorityDialogOpen] = useState(false);
  const [selectedTicketForPriority, setSelectedTicketForPriority] = useState<KitchenTicket | null>(null);
  const [priorityValue, setPriorityValue] = useState<number>(0);

  const loadData = async () => {
    setLoading(true);
    try {
      const [stList, tkList] = await Promise.all([
        kdsApi.getStations(),
        kdsApi.getKdsTickets(selectedStationId === 'ALL' ? undefined : selectedStationId, false),
      ]);
      setStations(stList);
      setTickets(tkList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to load KDS tickets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [selectedStationId]);

  const handleStartTicket = async (ticketId: string) => {
    try {
      await kdsApi.startTicket(ticketId);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to start ticket');
    }
  };

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

  const handleOpenPriorityDialog = (ticket: KitchenTicket) => {
    setSelectedTicketForPriority(ticket);
    setPriorityValue(ticket.priority || 0);
    setPriorityDialogOpen(true);
  };

  const handleSavePriority = async () => {
    if (!selectedTicketForPriority) return;
    try {
      await kdsApi.setPriority(selectedTicketForPriority.id, priorityValue);
      setPriorityDialogOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to set priority');
    }
  };

  const handleToggleItemState = async (itemId: string, currentState: string) => {
    const nextState = currentState === 'READY' ? 'NEW' : currentState === 'IN_PROGRESS' ? 'READY' : 'IN_PROGRESS';
    try {
      await kdsApi.updateItemState(itemId, nextState);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to update item state');
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const getTimerColor = (seconds: number, targetMins = 10) => {
    const targetSecs = targetMins * 60;
    if (seconds > targetSecs * 1.5) return 'error';
    if (seconds > targetSecs) return 'warning';
    return 'success';
  };

  const newTickets = tickets.filter((t) => t.state === 'NEW' || t.status === 'NEW');
  const inPrepTickets = tickets.filter((t) => t.state === 'IN_PROGRESS' || t.status === 'IN_PREPARATION');
  const readyTickets = tickets.filter((t) => t.state === 'READY' || t.state === 'BUMPED' || t.status === 'READY' || t.status === 'BUMPED');

  return (
    <Box sx={{ p: 3 }}>
      {/* SIMULATED HARDWARE BANNER */}
      <Alert severity="info" variant="filled" icon={<SoupKitchenIcon />} sx={{ mb: 3, fontWeight: 'bold' }}>
        SIMULATED KITCHEN DISPLAY SYSTEM (KDS) & PREPARATION ROUTING
      </Alert>

      {/* Header */}
      <Stack direction="row" sx={{ mb: 3, justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
            Kitchen Display Board <LocalFireDepartmentIcon color="error" />
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Live order ticket routing by product & category rules with automated readiness roll-up.
          </Typography>
        </Box>

        <Stack direction="row" spacing={2}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            Refresh
          </Button>
          <Button variant="outlined" startIcon={<UndoIcon />} onClick={() => setRecallDrawerOpen(true)}>
            Recall / History
          </Button>
        </Stack>
      </Stack>

      {/* Station Selector Tabs */}
      <Paper sx={{ mb: 3, borderRadius: 2 }}>
        <Tabs
          value={selectedStationId}
          onChange={(_, val) => setSelectedStationId(val)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 2 }}
        >
          <Tab label="All Stations" value="ALL" />
          {stations.map((st) => (
            <Tab key={st.id} label={`${st.name} (${st.target_minutes || 10}m)`} value={st.id} />
          ))}
        </Tabs>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Columns Grid */}
      <Grid container spacing={3}>
        {/* NEW COLUMN */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 2, bg: '#fafafa', borderRadius: 2, height: '100%', minHeight: 600 }}>
            <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6" color="info.main" sx={{ fontWeight: 'bold' }}>
                New ({newTickets.length})
              </Typography>
              <Chip label="Queued" color="info" size="small" />
            </Stack>
            <Divider sx={{ mb: 2 }} />

            <Stack spacing={2}>
              {newTickets.map((ticket) => (
                <KdsTicketCard
                  key={ticket.id}
                  ticket={ticket}
                  formatTimer={formatTimer}
                  getTimerColor={getTimerColor}
                  onStart={() => handleStartTicket(ticket.id)}
                  onBump={() => handleBumpTicket(ticket.id)}
                  onPriority={() => handleOpenPriorityDialog(ticket)}
                  onToggleItemState={handleToggleItemState}
                />
              ))}

              {newTickets.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                  No new tickets.
                </Typography>
              )}
            </Stack>
          </Paper>
        </Grid>

        {/* IN PROGRESS COLUMN */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 2, bg: '#fafafa', borderRadius: 2, height: '100%', minHeight: 600 }}>
            <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6" color="warning.main" sx={{ fontWeight: 'bold' }}>
                In Preparation ({inPrepTickets.length})
              </Typography>
              <Chip label="Cooking" color="warning" size="small" />
            </Stack>
            <Divider sx={{ mb: 2 }} />

            <Stack spacing={2}>
              {inPrepTickets.map((ticket) => (
                <KdsTicketCard
                  key={ticket.id}
                  ticket={ticket}
                  formatTimer={formatTimer}
                  getTimerColor={getTimerColor}
                  onBump={() => handleBumpTicket(ticket.id)}
                  onPriority={() => handleOpenPriorityDialog(ticket)}
                  onToggleItemState={handleToggleItemState}
                />
              ))}

              {inPrepTickets.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                  No tickets in preparation.
                </Typography>
              )}
            </Stack>
          </Paper>
        </Grid>

        {/* READY / BUMPED COLUMN */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 2, bg: '#fafafa', borderRadius: 2, height: '100%', minHeight: 600 }}>
            <Stack direction="row" sx={{ mb: 2, justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6" color="success.main" sx={{ fontWeight: 'bold' }}>
                Ready / Bumped ({readyTickets.length})
              </Typography>
              <Chip label="Pass Table" color="success" size="small" />
            </Stack>
            <Divider sx={{ mb: 2 }} />

            <Stack spacing={2}>
              {readyTickets.map((ticket) => (
                <KdsTicketCard
                  key={ticket.id}
                  ticket={ticket}
                  formatTimer={formatTimer}
                  getTimerColor={getTimerColor}
                  onRecall={() => handleRecallTicket(ticket.id)}
                  onToggleItemState={handleToggleItemState}
                />
              ))}

              {readyTickets.length === 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                  No bumped tickets.
                </Typography>
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      {/* Priority Dialog */}
      <Dialog open={priorityDialogOpen} onClose={() => setPriorityDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Set Ticket Priority</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 3 }}>
            Adjust priority score (0 = Normal, 9 = Rush / High Priority) for Ticket #{selectedTicketForPriority?.ticket_number}
          </Typography>
          <Slider
            value={priorityValue}
            min={0}
            max={9}
            step={1}
            marks
            valueLabelDisplay="on"
            onChange={(_, val) => setPriorityValue(val as number)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPriorityDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSavePriority}>
            Save Priority
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function KdsTicketCard({
  ticket,
  formatTimer,
  getTimerColor,
  onStart,
  onBump,
  onRecall,
  onPriority,
  onToggleItemState,
}: {
  ticket: KitchenTicket;
  formatTimer: (sec: number) => string;
  getTimerColor: (sec: number, target: number) => any;
  onStart?: () => void;
  onBump?: () => void;
  onRecall?: () => void;
  onPriority?: () => void;
  onToggleItemState: (itemId: string, currentState: string) => void;
}) {
  const timerColor = getTimerColor(ticket.prep_time_seconds, ticket.target_minutes || 10);

  return (
    <Card elevation={3} sx={{ borderRadius: 2, borderLeft: 6, borderColor: `${timerColor}.main` }}>
      <CardContent sx={{ p: 2 }}>
        <Stack direction="row" sx={{ mb: 1, justifyContent: 'space-between', alignItems: 'center' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
              #{ticket.order_number || ticket.ticket_number}
            </Typography>
            <Chip label={ticket.ticket_number} size="small" variant="outlined" />
            {ticket.is_aggregator && <Chip label="SNAPPFOOD" color="error" size="small" />}
          </Stack>

          <Chip
            icon={<AccessTimeIcon />}
            label={formatTimer(ticket.prep_time_seconds)}
            color={timerColor}
            size="small"
            sx={{ fontWeight: 'bold' }}
          />
        </Stack>

        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Chip label={ticket.order_type || 'DINE_IN'} size="small" color="primary" />
          {ticket.table_number && <Chip label={`Table ${ticket.table_number}`} size="small" color="secondary" />}
          {ticket.priority > 0 && (
            <Chip icon={<PriorityHighIcon />} label={`P${ticket.priority}`} color="error" size="small" />
          )}
        </Stack>

        <Divider sx={{ my: 1 }} />

        {/* Ticket Items */}
        <Stack spacing={1} sx={{ my: 1.5 }}>
          {ticket.items.map((item) => (
            <Box
              key={item.id}
              onClick={() => onToggleItemState(item.id, item.state || item.status)}
              sx={{
                p: 1,
                borderRadius: 1,
                bg: item.state === 'READY' || item.status === 'DONE' ? '#e8f5e9' : '#fff',
                cursor: 'pointer',
                border: '1px solid #eee',
                '&:hover': { bg: '#f5f5f5' },
              }}
            >
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                  {parseFloat(item.quantity).toFixed(0)}x {item.product_name}
                </Typography>
                <Chip
                  label={item.state || item.status}
                  size="small"
                  color={item.state === 'READY' || item.status === 'DONE' ? 'success' : 'default'}
                />
              </Stack>

              {item.options_summary && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  + {item.options_summary}
                </Typography>
              )}
              {item.special_instructions && (
                <Typography variant="caption" color="error.main" sx={{ display: 'block', fontWeight: 'bold' }}>
                  * {item.special_instructions}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>

        <Divider sx={{ my: 1 }} />

        {/* Card Actions */}
        <Stack direction="row" sx={{ pt: 1, justifyContent: 'space-between', alignItems: 'center' }}>
          {onPriority && (
            <Tooltip title="Change Priority">
              <IconButton size="small" onClick={onPriority}>
                <PriorityHighIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          <Stack direction="row" spacing={1}>
            {onStart && (
              <Button size="small" variant="contained" color="info" startIcon={<PlayArrowIcon />} onClick={onStart}>
                Start
              </Button>
            )}
            {onBump && (
              <Button size="small" variant="contained" color="success" startIcon={<CheckCircleIcon />} onClick={onBump}>
                Bump
              </Button>
            )}
            {onRecall && (
              <Button size="small" variant="outlined" color="warning" startIcon={<UndoIcon />} onClick={onRecall}>
                Recall
              </Button>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
