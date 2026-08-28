import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import SaveIcon from '@mui/icons-material/Save';
import RefreshIcon from '@mui/icons-material/Refresh';
import ScheduleIcon from '@mui/icons-material/Schedule';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RoomServiceIcon from '@mui/icons-material/RoomService';
import LocalDiningIcon from '@mui/icons-material/LocalDining';
import {
  Box,
  Card,
  Grid,
  Stack,
  Alert,
  Paper,
  Switch,
  Button,
  Divider,
  TextField,
  Typography,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';

import { settingsApi } from 'src/api/settingsApi';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

export function OrderWorkflowSettingsPage() {
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Workflow settings state
  const [autoAcceptOrders, setAutoAcceptOrders] = useState(true);
  const [cashierEditWindowMinutes, setCashierEditWindowMinutes] = useState(5);
  const [cashierCancelWindowMinutes, setCashierCancelWindowMinutes] = useState(5);
  const [autoRouteToKds, setAutoRouteToKds] = useState(true);
  const [allowReopenClosedOrders, setAllowReopenClosedOrders] = useState(false);
  const [enableDineIn, setEnableDineIn] = useState(true);
  const [enableTakeaway, setEnableTakeaway] = useState(true);
  const [enableDelivery, setEnableDelivery] = useState(true);
  const [enableAggregators, setEnableAggregators] = useState(true);
  const [requireTableSelection, setRequireTableSelection] = useState(true);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await settingsApi.getSettings();
      const workflow = data?.ORDER_WORKFLOW || data?.POS || {};

      if (workflow.autoAcceptOrders !== undefined) setAutoAcceptOrders(Boolean(workflow.autoAcceptOrders));
      if (workflow.cashierEditWindowMinutes !== undefined) setCashierEditWindowMinutes(Number(workflow.cashierEditWindowMinutes));
      if (workflow.cashierCancelWindowMinutes !== undefined) setCashierCancelWindowMinutes(Number(workflow.cashierCancelWindowMinutes));
      if (workflow.autoRouteToKds !== undefined) setAutoRouteToKds(Boolean(workflow.autoRouteToKds));
      if (workflow.allowReopenClosedOrders !== undefined) setAllowReopenClosedOrders(Boolean(workflow.allowReopenClosedOrders));
      if (workflow.enableDineIn !== undefined) setEnableDineIn(Boolean(workflow.enableDineIn));
      if (workflow.enableTakeaway !== undefined) setEnableTakeaway(Boolean(workflow.enableTakeaway));
      if (workflow.enableDelivery !== undefined) setEnableDelivery(Boolean(workflow.enableDelivery));
      if (workflow.enableAggregators !== undefined) setEnableAggregators(Boolean(workflow.enableAggregators));
      if (workflow.requireTableSelection !== undefined) setRequireTableSelection(Boolean(workflow.requireTableSelection));
    } catch (err: any) {
      setError(err?.response?.data?.message || err.detail || err.message || 'Failed to load order workflow settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const payload = {
      autoAcceptOrders,
      cashierEditWindowMinutes: Number(cashierEditWindowMinutes),
      cashierCancelWindowMinutes: Number(cashierCancelWindowMinutes),
      autoRouteToKds,
      allowReopenClosedOrders,
      enableDineIn,
      enableTakeaway,
      enableDelivery,
      enableAggregators,
      requireTableSelection,
    };

    try {
      await settingsApi.updateSetting('ORDER_WORKFLOW', payload);
      setSuccess(t('settings.orderWorkflow.saveSuccess', 'Order workflow settings saved successfully.'));
    } catch (err: any) {
      setError(err?.response?.data?.message || err.detail || err.message || 'Failed to save order workflow settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('settings.orderWorkflow.title', 'Order & Workflow Policies')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.orderWorkflow.title', 'Order Workflow') },
        ]}
        action={
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadSettings} disabled={saving}>
            {t('common.refresh', 'Refresh')}
          </Button>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <form onSubmit={handleSave}>
        <Grid container spacing={3}>
          {/* Time Windows & Governance */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ p: 3, height: '100%', borderRadius: 2 }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
                <ScheduleIcon color="primary" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {t('settings.orderWorkflow.timeWindowsTitle', 'Cashier Time Windows & Escalation')}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {t(
                  'settings.orderWorkflow.timeWindowsDesc',
                  'Orders can be freely edited or cancelled by cashiers within this grace window. After expiration, supervisor PIN escalation is mandatory.'
                )}
              </Typography>

              <Stack spacing={3}>
                <TextField
                  fullWidth
                  type="number"
                  label={t('settings.orderWorkflow.editWindowLabel', 'Order Edit Grace Window (Minutes)')}
                  value={cashierEditWindowMinutes}
                  onChange={(e) => setCashierEditWindowMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  helperText={t(
                    'settings.orderWorkflow.editWindowHelp',
                    'Number of minutes a cashier can modify items on an open order without manager PIN approval.'
                  )}
                  slotProps={{ htmlInput: { min: 0, max: 120 } }}
                />

                <TextField
                  fullWidth
                  type="number"
                  label={t('settings.orderWorkflow.cancelWindowLabel', 'Order Cancellation Grace Window (Minutes)')}
                  value={cashierCancelWindowMinutes}
                  onChange={(e) => setCashierCancelWindowMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  helperText={t(
                    'settings.orderWorkflow.cancelWindowHelp',
                    'Number of minutes a cashier can void an order without supervisor PIN escalation.'
                  )}
                  slotProps={{ htmlInput: { min: 0, max: 120 } }}
                />

                <Divider />

                <FormControlLabel
                  control={
                    <Switch
                      checked={allowReopenClosedOrders}
                      onChange={(e) => setAllowReopenClosedOrders(e.target.checked)}
                      color="warning"
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="subtitle2">
                        {t('settings.orderWorkflow.allowReopenLabel', 'Allow Reopening Closed Orders')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t(
                          'settings.orderWorkflow.allowReopenHelp',
                          'When enabled, authorized supervisors can reopen previously settled orders for adjustments.'
                        )}
                      </Typography>
                    </Box>
                  }
                />
              </Stack>
            </Card>
          </Grid>

          {/* Lifecycle Automation */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ p: 3, height: '100%', borderRadius: 2 }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
                <AutoAwesomeIcon color="warning" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {t('settings.orderWorkflow.automationTitle', 'Lifecycle & Kitchen Routing')}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {t(
                  'settings.orderWorkflow.automationDesc',
                  'Configure how incoming orders flow into kitchen stations and external channels.'
                )}
              </Typography>

              <Stack spacing={2.5}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={autoAcceptOrders}
                        onChange={(e) => setAutoAcceptOrders(e.target.checked)}
                        color="primary"
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="subtitle2">
                          {t('settings.orderWorkflow.autoAcceptLabel', 'Auto-Accept In-Store & Kiosk Orders')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t(
                            'settings.orderWorkflow.autoAcceptHelp',
                            'Automatically advance paid counter and kiosk orders directly to Kitchen Prep queue.'
                          )}
                        </Typography>
                      </Box>
                    }
                  />
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={autoRouteToKds}
                        onChange={(e) => setAutoRouteToKds(e.target.checked)}
                        color="info"
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="subtitle2">
                          {t('settings.orderWorkflow.autoRouteKdsLabel', 'Immediate Kitchen KDS Dispatch')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t(
                            'settings.orderWorkflow.autoRouteKdsHelp',
                            'Broadcast tickets to kitchen bump screens immediately upon order submission.'
                          )}
                        </Typography>
                      </Box>
                    }
                  />
                </Paper>

                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={requireTableSelection}
                        onChange={(e) => setRequireTableSelection(e.target.checked)}
                        color="secondary"
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="subtitle2">
                          {t('settings.orderWorkflow.requireTableLabel', 'Enforce Table Selection for Dine-In')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {t(
                            'settings.orderWorkflow.requireTableHelp',
                            'Cashiers must designate a floor table before confirming any Dine-In transaction.'
                          )}
                        </Typography>
                      </Box>
                    }
                  />
                </Paper>
              </Stack>
            </Card>
          </Grid>

          {/* Enabled Dining Channels */}
          <Grid size={{ xs: 12 }}>
            <Card sx={{ p: 3, borderRadius: 2 }}>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
                <LocalDiningIcon color="success" />
                <Typography variant="h6" sx={{ fontWeight: 700 }}>
                  {t('settings.orderWorkflow.channelsTitle', 'Active Dining Channels')}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t(
                  'settings.orderWorkflow.channelsDesc',
                  'Enable or disable operating dining channels across POS terminals and Kiosk registers.'
                )}
              </Typography>

              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, textAlign: 'center' }}>
                    <RoomServiceIcon sx={{ fontSize: 36, color: 'primary.main', mb: 1 }} />
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      {t('settings.orderWorkflow.channels.dineIn', 'Dine-In Service')}
                    </Typography>
                    <Switch
                      checked={enableDineIn}
                      onChange={(e) => setEnableDineIn(e.target.checked)}
                      color="primary"
                    />
                  </Paper>
                </Grid>

                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, textAlign: 'center' }}>
                    <LocalDiningIcon sx={{ fontSize: 36, color: 'warning.main', mb: 1 }} />
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      {t('settings.orderWorkflow.channels.takeaway', 'Takeaway & Counter')}
                    </Typography>
                    <Switch
                      checked={enableTakeaway}
                      onChange={(e) => setEnableTakeaway(e.target.checked)}
                      color="warning"
                    />
                  </Paper>
                </Grid>

                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, textAlign: 'center' }}>
                    <LocalDiningIcon sx={{ fontSize: 36, color: 'info.main', mb: 1 }} />
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      {t('settings.orderWorkflow.channels.delivery', 'Direct Delivery')}
                    </Typography>
                    <Switch
                      checked={enableDelivery}
                      onChange={(e) => setEnableDelivery(e.target.checked)}
                      color="info"
                    />
                  </Paper>
                </Grid>

                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, textAlign: 'center' }}>
                    <AutoAwesomeIcon sx={{ fontSize: 36, color: 'secondary.main', mb: 1 }} />
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>
                      {t('settings.orderWorkflow.channels.aggregators', 'Snappfood & Aggregators')}
                    </Typography>
                    <Switch
                      checked={enableAggregators}
                      onChange={(e) => setEnableAggregators(e.target.checked)}
                      color="secondary"
                    />
                  </Paper>
                </Grid>
              </Grid>
            </Card>
          </Grid>
        </Grid>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
          <Button
            type="submit"
            variant="contained"
            size="large"
            startIcon={<SaveIcon />}
            disabled={saving}
            sx={{ px: 4, py: 1.2, fontWeight: 700 }}
          >
            {saving ? t('common.saving', 'Saving...') : t('common.saveChanges', 'Save Workflow Policies')}
          </Button>
        </Box>
      </form>
    </Box>
  );
}
