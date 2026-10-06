import type { AgentHealth } from 'src/api/agentsApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Box,
  Chip,
  Stack,
  Table,
  Alert,
  Drawer,
  Divider,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  IconButton,
  Typography,
  CircularProgress,
} from '@mui/material';

import { fDateTime } from 'src/utils/format-time';

import { kdsApi } from 'src/api/kdsApi';
import { agentsApi } from 'src/api/agentsApi';
import { paymentApi } from 'src/api/paymentApi';

// ----------------------------------------------------------------------

const REFRESH_MS = 15_000;

const DEVICE_COLOR: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  ONLINE: 'success',
  OFFLINE: 'error',
  ERROR: 'error',
  UNSUPPORTED: 'warning',
  UNKNOWN: 'default',
};

const COMMAND_COLOR: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  DONE: 'success',
  FAILED: 'error',
  EXPIRED: 'warning',
  ACKED: 'info',
  SENT: 'info',
  QUEUED: 'default',
};

type Props = {
  agentId: string | null;
  branchId: string | null;
  onClose: () => void;
};

/** One branch agent up close: its connection, what it says about its devices, and its latest commands. */
export function AgentHealthDrawer({ agentId, branchId, onClose }: Props) {
  const { t } = useTranslation();
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [deviceNames, setDeviceNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      setHealth(await agentsApi.health(agentId));
      setError(null);
    } catch (err: any) {
      setError(err?.detail || err?.message || t('operations.agents.health.loadError', 'Could not load the agent'));
    } finally {
      setLoading(false);
    }
  }, [agentId, t]);

  useEffect(() => {
    setHealth(null);
    if (!agentId) return undefined;
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [agentId, load]);

  // The agent reports devices by id; show the names head office gave them.
  useEffect(() => {
    if (!branchId) return;
    Promise.all([kdsApi.getPrinters(branchId).catch(() => []), paymentApi.getDevices(branchId).catch(() => [])]).then(
      ([printers, terminals]) => {
        const names: Record<string, string> = {};
        printers.forEach((p) => {
          names[`printer:${p.id}`] = `${p.name} (${p.code})`;
        });
        terminals.forEach((d) => {
          names[`terminal:${d.id}`] = `${d.name} (${d.code})`;
        });
        setDeviceNames(names);
      }
    );
  }, [branchId]);

  const agent = health?.agent;
  const connection = health?.connection;

  return (
    <Drawer anchor="right" open={!!agentId} onClose={onClose}>
      <Box sx={{ width: { xs: 360, sm: 560 }, p: 3 }}>
        <Stack direction="row" sx={{ alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            {t('operations.agents.health.title', 'Agent health')}
          </Typography>
          <IconButton onClick={load} disabled={loading}>
            <RefreshIcon />
          </IconButton>
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {!health && !error && <CircularProgress size={28} />}

        {agent && connection && (
          <Stack spacing={2.5}>
            <Stack spacing={0.75}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  {agent.hostname || '—'}
                </Typography>
                {agent.status === 'REVOKED' ? (
                  <Chip size="small" label={t('operations.agents.statusRevoked', 'Revoked')} />
                ) : connection.connected ? (
                  <Chip size="small" color="success" label={t('operations.agents.statusOnline', 'Online')} />
                ) : (
                  <Chip size="small" color="warning" label={t('operations.agents.statusOffline', 'Offline')} />
                )}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {agent.branch_name} · {agent.os || '—'}
              </Typography>
              <Row label={t('operations.agents.colVersion', 'Version')} value={connection.agent_version || agent.agent_version || '—'} />
              <Row label={t('operations.agents.colEnrolled', 'Enrolled')} value={fDateTime(agent.enrolled_at)} />
              <Row
                label={t('operations.agents.colLastSeen', 'Last seen')}
                value={
                  connection.last_frame_at
                    ? fDateTime(connection.last_frame_at)
                    : agent.last_seen_at
                      ? fDateTime(agent.last_seen_at)
                      : t('operations.agents.neverSeen', 'Never')
                }
              />
              {connection.connected && connection.connected_at && (
                <Row label={t('operations.agents.health.connectedSince', 'Connected since')} value={fDateTime(connection.connected_at)} />
              )}
              {connection.capabilities && connection.capabilities.length > 0 && (
                <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5, pt: 0.5 }}>
                  {connection.capabilities.map((c) => (
                    <Chip key={c} size="small" variant="outlined" label={c} />
                  ))}
                </Stack>
              )}
            </Stack>

            <Divider />

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('operations.agents.health.devices', 'Devices')}
              </Typography>
              {connection.devices.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {connection.connected
                    ? t('operations.agents.health.noDevices', 'The agent has not reported any device.')
                    : t('operations.agents.health.devicesOffline', 'Device status is known only while the agent is online.')}
                </Typography>
              ) : (
                <Table size="small">
                  <TableBody>
                    {connection.devices.map((d) => (
                      <TableRow key={`${d.kind}:${d.id}`}>
                        <TableCell>
                          <Typography variant="body2">{deviceNames[`${d.kind}:${d.id}`] || d.id}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {t(`operations.agents.health.kind.${d.kind}`, d.kind)}
                            {d.detail ? ` · ${d.detail}` : ''}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Chip size="small" color={DEVICE_COLOR[d.status] || 'default'} label={d.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('operations.agents.health.commands', 'Recent commands')}
              </Typography>
              {health.recent_commands.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('operations.agents.health.noCommands', 'No commands yet.')}
                </Typography>
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('operations.agents.health.colType', 'Command')}</TableCell>
                      <TableCell>{t('operations.agents.colCreated', 'Created')}</TableCell>
                      <TableCell align="right">{t('operations.agents.colStatus', 'Status')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {health.recent_commands.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Typography variant="body2" dir="ltr" sx={{ fontFamily: 'monospace' }}>
                            {c.type}
                          </Typography>
                          {c.error_code && (
                            <Typography variant="caption" color="error">
                              {c.error_code}
                              {c.error_message ? `: ${c.error_message}` : ''}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>{fDateTime(c.created_at)}</TableCell>
                        <TableCell align="right">
                          <Chip size="small" color={COMMAND_COLOR[c.status] || 'default'} label={c.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Box>
          </Stack>
        )}
      </Box>
    </Drawer>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" spacing={1}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>
        {label}
      </Typography>
      <Typography variant="body2">{value}</Typography>
    </Stack>
  );
}
