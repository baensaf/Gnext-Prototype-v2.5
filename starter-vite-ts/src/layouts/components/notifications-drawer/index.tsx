import type { IconButtonProps } from '@mui/material/IconButton';
import type { OperationalAlertItem } from 'src/api/alertsApi';

import { m } from 'framer-motion';
import { useBoolean } from 'minimal-shared/hooks';
import { useState, useEffect, useCallback } from 'react';

import Tab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Badge from '@mui/material/Badge';
import Drawer from '@mui/material/Drawer';
import Button from '@mui/material/Button';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';

import { paths } from 'src/routes/paths';
import { useRouter } from 'src/routes/hooks';

import { alertsApi } from 'src/api/alertsApi';

import { Label } from 'src/components/label';
import { Iconify } from 'src/components/iconify';
import { Scrollbar } from 'src/components/scrollbar';
import { varTap, varHover, transitionTap } from 'src/components/animate';

import { NotificationItem } from './notification-item';

// ----------------------------------------------------------------------

export type NotificationsDrawerProps = IconButtonProps & {
  data?: OperationalAlertItem[];
};

export function NotificationsDrawer({ data = [], sx, ...other }: NotificationsDrawerProps) {
  const router = useRouter();
  const { value: open, onFalse: onClose, onTrue: onOpen } = useBoolean();

  const [alerts, setAlerts] = useState<OperationalAlertItem[]>(data);
  const [loading, setLoading] = useState(false);
  const [currentTab, setCurrentTab] = useState('all');

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const items = await alertsApi.getAlerts();
      setAlerts(items);
    } catch {
      // keep existing state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  // Refresh on open
  const handleOpenDrawer = () => {
    onOpen();
    fetchAlerts();
  };

  const handleChangeTab = useCallback((event: React.SyntheticEvent, newValue: string) => {
    setCurrentTab(newValue);
  }, []);

  const totalUnRead = alerts.filter((item) => !item.acknowledged).length;
  const totalCritical = alerts.filter(
    (item) => item.severity === 'CRITICAL' || item.severity === 'WARNING'
  ).length;

  const handleAcknowledge = async (id: string) => {
    try {
      await alertsApi.acknowledgeAlert(id);
      setAlerts((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, acknowledged: true, acknowledged_at: new Date().toISOString() }
            : item
        )
      );
    } catch (err) {
      console.error('Failed to acknowledge alert:', err);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await alertsApi.acknowledgeAll(alerts);
      setAlerts((prev) =>
        prev.map((item) => ({
          ...item,
          acknowledged: true,
          acknowledged_at: new Date().toISOString(),
        }))
      );
    } catch (err) {
      console.error('Failed to acknowledge all alerts:', err);
    }
  };

  const handleViewAll = () => {
    onClose();
    router.push(paths.app.operations.monitoring || paths.app.audit || '/app/dashboard');
  };

  const filteredAlerts = alerts.filter((item) => {
    if (currentTab === 'open') return !item.acknowledged;
    if (currentTab === 'critical') return item.severity === 'CRITICAL' || item.severity === 'WARNING';
    return true;
  });

  const TABS = [
    { value: 'all', label: 'All', count: alerts.length, color: 'default' as const },
    { value: 'open', label: 'Open', count: totalUnRead, color: 'error' as const },
    { value: 'critical', label: 'Critical', count: totalCritical, color: 'warning' as const },
  ];

  const renderHead = () => (
    <Box
      sx={{
        py: 2,
        pr: 1,
        pl: 2.5,
        minHeight: 68,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <Box sx={{ flexGrow: 1 }}>
        <Typography variant="h6">Operational Alerts</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {totalUnRead} unacknowledged issue{totalUnRead === 1 ? '' : 's'}
        </Typography>
      </Box>

      {loading && <CircularProgress size={20} sx={{ mr: 1 }} />}

      <Tooltip title="Refresh alerts">
        <IconButton size="small" onClick={fetchAlerts} sx={{ mr: 0.5 }}>
          <Iconify icon="solar:restart-bold" />
        </IconButton>
      </Tooltip>

      {!!totalUnRead && (
        <Tooltip title="Acknowledge all alerts">
          <IconButton size="small" color="primary" onClick={handleMarkAllAsRead} sx={{ mr: 0.5 }}>
            <Iconify icon="eva:done-all-fill" />
          </IconButton>
        </Tooltip>
      )}

      <IconButton onClick={onClose} sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
        <Iconify icon="mingcute:close-line" />
      </IconButton>
    </Box>
  );

  const renderTabs = () => (
    <Tabs variant="fullWidth" value={currentTab} onChange={handleChangeTab}>
      {TABS.map((tab) => (
        <Tab
          key={tab.value}
          iconPosition="end"
          value={tab.value}
          label={tab.label}
          icon={
            <Label
              variant={tab.value === currentTab ? 'filled' : 'soft'}
              color={tab.color}
              sx={{ ml: 0.5 }}
            >
              {tab.count}
            </Label>
          }
        />
      ))}
    </Tabs>
  );

  const renderList = () => {
    if (filteredAlerts.length === 0) {
      return (
        <Box
          sx={{
            py: 8,
            px: 3,
            display: 'flex',
            alignItems: 'center',
            flexDirection: 'column',
            justifyContent: 'center',
            textAlign: 'center',
          }}
        >
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              bgcolor: 'success.lighter',
              color: 'success.main',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mb: 2,
            }}
          >
            <Iconify icon="solar:check-circle-bold" width={32} />
          </Box>
          <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
            All systems normal
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 260 }}>
            {currentTab === 'open'
              ? 'There are no open operational alerts requiring acknowledgment.'
              : 'No alerts match this filter.'}
          </Typography>
        </Box>
      );
    }

    return (
      <Scrollbar>
        <Box component="ul" sx={{ p: 0, m: 0, listStyle: 'none' }}>
          {filteredAlerts.map((alert) => (
            <Box component="li" key={alert.id} sx={{ display: 'flex' }}>
              <NotificationItem notification={alert} onAcknowledge={handleAcknowledge} />
            </Box>
          ))}
        </Box>
      </Scrollbar>
    );
  };

  return (
    <>
      <IconButton
        component={m.button}
        whileTap={varTap(0.96)}
        whileHover={varHover(1.04)}
        transition={transitionTap()}
        aria-label="Operational Alerts button"
        onClick={handleOpenDrawer}
        sx={sx}
        {...other}
      >
        <Badge badgeContent={totalUnRead} color={totalUnRead > 0 ? 'error' : 'default'}>
          <Iconify width={24} icon="solar:bell-bing-bold-duotone" />
        </Badge>
      </IconButton>

      <Drawer
        open={open}
        onClose={onClose}
        anchor="right"
        slotProps={{
          backdrop: { invisible: true },
          paper: { sx: { width: 1, maxWidth: 420 } },
        }}
      >
        {renderHead()}
        {renderTabs()}
        {renderList()}

        <Box sx={{ p: 2, borderTop: (theme) => `solid 1px ${theme.vars.palette.divider}` }}>
          <Button
            fullWidth
            size="medium"
            variant="outlined"
            onClick={handleViewAll}
            startIcon={<Iconify icon="solar:shield-check-bold" />}
          >
            View Operational Monitoring
          </Button>
        </Box>
      </Drawer>
    </>
  );
}
