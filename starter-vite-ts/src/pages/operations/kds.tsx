import type { KitchenTicket, KitchenStation } from 'src/api/kdsApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import UndoIcon from '@mui/icons-material/Undo';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
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
  Drawer,
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

import { useLiveRefresh } from 'src/utils/use-live-refresh';

import { kdsApi } from 'src/api/kdsApi';
import { useScopedBranchId } from 'src/contexts/branch-context';

import { Label } from 'src/components/label';

export function KdsPage() {
  const { t } = useTranslation();
  const [branchId] = useScopedBranchId();
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<string>('ALL');
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [recallDrawerOpen, setRecallDrawerOpen] = useState(false);
  const [priorityDialogOpen, setPriorityDialogOpen] = useState(false);
  const [selectedTicketForPriority, setSelectedTicketForPriority] = useState<KitchenTicket | null>(null);
  const [priorityValue, setPriorityValue] = useState<number>(0);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // `isBumped` selects between two disjoint sets server-side: queued/cooking
      // or ready/bumped. The board shows all three columns and the recall drawer
      // reads the bumped ones, so both sets have to be fetched.
      const station = selectedStationId === 'ALL' ? undefined : selectedStationId;
      // A kitchen display showed every kitchen in the chain until this was passed.
      const branch = branchId || undefined;
      const [stList, activeList, bumpedList] = await Promise.all([
        kdsApi.getStations(branch),
        kdsApi.getKdsTickets(station, false, branch),
        kdsApi.getKdsTickets(station, true, branch),
      ]);
      setStations(stList);
      setTickets([...activeList, ...bumpedList]);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('kds.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [selectedStationId, branchId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useLiveRefresh(['kds'], loadData, branchId);

  const handleStartTicket = async (ticketId: string) => {
    try {
      await kdsApi.startTicket(ticketId);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('kds.errors.startFailed'));
    }
  };

  const handleBumpTicket = async (ticketId: string) => {
    try {
      await kdsApi.bumpTicket(ticketId);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('kds.errors.bumpFailed'));
    }
  };

  const handleRecallTicket = async (ticketId: string) => {
    try {
      await kdsApi.recallTicket(ticketId);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('kds.errors.recallFailed'));
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
      setError(err.detail || t('kds.errors.priorityFailed'));
    }
  };

  const handleToggleItemState = async (itemId: string, currentState: string) => {
    const nextState = currentState === 'READY' ? 'NEW' : currentState === 'IN_PROGRESS' ? 'READY' : 'IN_PROGRESS';
    try {
      await kdsApi.updateItemState(itemId, nextState);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('kds.errors.itemStateFailed'));
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

  const newTickets = tickets.filter((ticket) => ticket.state === 'NEW' || ticket.status === 'NEW');
  const inPrepTickets = tickets.filter((ticket) => ticket.state === 'IN_PROGRESS' || ticket.status === 'IN_PREPARATION');
  const readyTickets = tickets.filter((ticket) => ticket.state === 'READY' || ticket.state === 'BUMPED' || ticket.status === 'READY' || ticket.status === 'BUMPED');

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Stack direction="row" sx={{ mb: 3, justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1.5 }}>
            {t('kds.title')} <LocalFireDepartmentIcon color="error" /> <Label color="info">{t('kds.version')}</Label>
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('kds.subtitle')}
          </Typography>
        </Box>

        <Stack direction="row" spacing={2}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => loadData()}>
            {t('kds.refresh')}
          </Button>
          <Button variant="outlined" startIcon={<UndoIcon />} onClick={() => setRecallDrawerOpen(true)}>
            {t('kds.recallHistory')}
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
          <Tab label={t('kds.allStations')} value="ALL" />
          {stations.map((st) => (
            <Tab key={st.id} label={`${st.name} (${st.target_minutes || 10} ${t('kds.minutesShort')})`} value={st.id} />
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
                {t('kds.columns.new')} ({newTickets.length})
              </Typography>
              <Chip label={t('kds.columns.queued')} color="info" size="small" />
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
                  {t('kds.columns.noNewTickets')}
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
                {t('kds.columns.inPrep')} ({inPrepTickets.length})
              </Typography>
              <Chip label={t('kds.columns.cooking')} color="warning" size="small" />
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
                  {t('kds.columns.noPrepTickets')}
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
                {t('kds.columns.ready')} ({readyTickets.length})
              </Typography>
              <Chip label={t('kds.columns.passTable')} color="success" size="small" />
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
                  {t('kds.columns.noBumpedTickets')}
                </Typography>
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      {/* Priority Dialog */}
      <Dialog open={priorityDialogOpen} onClose={() => setPriorityDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('kds.priorityDialog.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 3 }}>
            {t('kds.priorityDialog.description', { ticketNumber: selectedTicketForPriority?.ticket_number })}
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
          <Button onClick={() => setPriorityDialogOpen(false)}>{t('kds.priorityDialog.cancel')}</Button>
          <Button variant="contained" onClick={handleSavePriority}>
            {t('kds.priorityDialog.save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Recall / Completed Tickets Drawer */}
      <Drawer
        anchor="right"
        open={recallDrawerOpen}
        onClose={() => setRecallDrawerOpen(false)}
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 480 }, p: 3 } } }}
      >
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
            {t('kds.recallDrawer.title', { count: readyTickets.length })}
          </Typography>
          <Button size="small" onClick={() => setRecallDrawerOpen(false)}>
            {t('kds.recallDrawer.close')}
          </Button>
        </Stack>
        <Divider sx={{ mb: 2 }} />

        <Stack spacing={2}>
          {readyTickets.map((ticket) => (
            <KdsTicketCard
              key={ticket.id}
              ticket={ticket}
              formatTimer={formatTimer}
              getTimerColor={getTimerColor}
              onRecall={() => {
                handleRecallTicket(ticket.id);
                setRecallDrawerOpen(false);
              }}
              onToggleItemState={handleToggleItemState}
            />
          ))}

          {readyTickets.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
              {t('kds.recallDrawer.noHistory')}
            </Typography>
          )}
        </Stack>
      </Drawer>
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
  const { t } = useTranslation();
  const timerColor = getTimerColor(ticket.prep_time_seconds, ticket.target_minutes || 10);

  const getOrderTypeLabel = (type?: string) => {
    switch (type) {
      case 'DINE_IN':
        return t('kds.orderTypes.dineIn');
      case 'TAKEAWAY':
        return t('kds.orderTypes.takeaway');
      case 'DELIVERY':
        return t('kds.orderTypes.delivery');
      case 'AGGREGATOR':
      case 'SNAPPFOOD':
        return t('kds.orderTypes.aggregators');
      default:
        return type || t('kds.orderTypes.dineIn');
    }
  };

  const getItemStatusLabel = (state?: string) => {
    switch (state) {
      case 'READY':
        return t('kds.itemStatus.ready');
      case 'IN_PROGRESS':
        return t('kds.itemStatus.inProgress');
      case 'NEW':
        return t('kds.itemStatus.new');
      case 'DONE':
        return t('kds.itemStatus.done');
      case 'BUMPED':
        return t('kds.itemStatus.bumped');
      default:
        return state || t('kds.itemStatus.new');
    }
  };

  return (
    <Card elevation={3} sx={{ borderRadius: 2, borderLeft: 6, borderColor: `${timerColor}.main` }}>
      <CardContent sx={{ p: 2 }}>
        <Stack direction="row" sx={{ mb: 1, justifyContent: 'space-between', alignItems: 'center' }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
              #{ticket.order_number || ticket.ticket_number}
            </Typography>
            <Chip label={ticket.ticket_number} size="small" variant="outlined" />
            {ticket.is_aggregator && <Chip label={t('kds.snappfood')} color="error" size="small" />}
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
          <Chip label={getOrderTypeLabel(ticket.order_type)} size="small" color="primary" />
          {ticket.table_number && <Chip label={`${t('kds.table')} ${ticket.table_number}`} size="small" color="secondary" />}
          {ticket.priority > 0 && (
            <Chip icon={<PriorityHighIcon />} label={`${t('kds.priorityScore')} ${ticket.priority}`} color="error" size="small" />
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
                  label={getItemStatusLabel(item.state || item.status)}
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
            <Tooltip title={t('kds.actions.changePriority')}>
              <IconButton size="small" onClick={onPriority}>
                <PriorityHighIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}

          <Stack direction="row" spacing={1}>
            {onStart && (
              <Button size="small" variant="contained" color="info" startIcon={<PlayArrowIcon />} onClick={onStart}>
                {t('kds.actions.start')}
              </Button>
            )}
            {onBump && (
              <Button size="small" variant="contained" color="success" startIcon={<CheckCircleIcon />} onClick={onBump}>
                {t('kds.actions.bump')}
              </Button>
            )}
            {onRecall && (
              <Button size="small" variant="outlined" color="warning" startIcon={<UndoIcon />} onClick={onRecall}>
                {t('kds.actions.recall')}
              </Button>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
