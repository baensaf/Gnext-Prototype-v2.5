import type { ReactNode } from 'react';
import type { ProfileOrder, ProfileAuditEvent } from 'src/api/profilesApi';

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';

import RefreshIcon from '@mui/icons-material/Refresh';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  Box,
  Card,
  Chip,
  Grid,
  Link,
  Stack,
  Table,
  Paper,
  Button,
  Dialog,
  Divider,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  CardHeader,
  DialogTitle,
  CardContent,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { paths } from 'src/routes/paths';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';

// ----------------------------------------------------------------------

export function formatDateTime(value?: string | null): string {
  return value ? fDateTime(value) : '—';
}

export function formatMoney(value?: string | null, currency: string = 'IRR'): string {
  return `${MoneyUtil.formatCurrency(value || '0')} ${currency}`;
}

const ORDER_STATE_COLOR: Record<string, 'success' | 'error' | 'warning' | 'info' | 'default'> = {
  COMPLETED: 'success',
  CANCELLED: 'error',
  REJECTED: 'error',
  PENDING_ACCEPTANCE: 'warning',
  OUT_FOR_DELIVERY: 'info',
};

// ----------------------------------------------------------------------

type ProfileHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  chips?: ReactNode;
  backTo: string;
  onRefresh: () => void;
};

export function ProfileHeader({ title, subtitle, chips, backTo, onRefresh }: ProfileHeaderProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Stack
      sx={{
        flexDirection: { xs: 'column', md: 'row' },
        alignItems: { md: 'center' },
        justifyContent: 'space-between',
        gap: 2,
        mb: 3,
      }}
    >
      <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 2, minWidth: 0 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(backTo)}>
          {t('profile.back')}
        </Button>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h4" noWrap>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
      </Stack>
      <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {chips}
        <IconButton onClick={onRefresh} title={t('profile.refresh')}>
          <RefreshIcon />
        </IconButton>
      </Stack>
    </Stack>
  );
}

// ----------------------------------------------------------------------

export type ProfileKpi = { label: string; value: ReactNode; hint?: ReactNode };

export function ProfileKpis({ items }: { items: ProfileKpi[] }) {
  return (
    <Grid container spacing={2} sx={{ mb: 3 }}>
      {items.map((item) => (
        <Grid key={item.label} size={{ xs: 6, sm: 4, lg: 12 / Math.min(items.length, 6) }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                {item.label}
              </Typography>
              <Typography variant="h6" sx={{ mt: 0.5 }} dir="auto">
                {item.value}
              </Typography>
              {item.hint && (
                <Typography variant="caption" color="text.secondary">
                  {item.hint}
                </Typography>
              )}
            </CardContent>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}

// ----------------------------------------------------------------------

type InfoCardProps = {
  title: string;
  icon?: ReactNode;
  rows?: { label: string; value: ReactNode }[];
  children?: ReactNode;
  action?: ReactNode;
};

export function InfoCard({ title, icon, rows, children, action }: InfoCardProps) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardHeader avatar={icon} title={title} action={action} />
      <Divider />
      <CardContent>
        {rows && (
          <Stack spacing={1.5}>
            {rows.map((row) => (
              <Stack
                key={row.label}
                sx={{ flexDirection: 'row', justifyContent: 'space-between', gap: 2 }}
              >
                <Typography color="text.secondary">{row.label}</Typography>
                <Typography component="div" sx={{ fontWeight: 600, textAlign: 'end' }}>
                  {row.value ?? '—'}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------

/** A plain table that scrolls sideways on a phone instead of squeezing its columns. */
export function ProfileTable({
  head,
  children,
  empty,
  isEmpty,
}: {
  head: ReactNode[];
  children: ReactNode;
  empty: string;
  isEmpty: boolean;
}) {
  return (
    <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
      <Table size="small" sx={{ minWidth: 640 }}>
        <TableHead>
          <TableRow>
            {head.map((cell, index) => (
              <TableCell key={index}>{cell}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {isEmpty ? (
            <TableRow>
              <TableCell colSpan={head.length} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            children
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function LimitNotice({ shown, limit }: { shown: number; limit: number }) {
  const { t } = useTranslation();
  if (shown < limit) return null;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
      {t('profile.limitNotice', { count: limit })}
    </Typography>
  );
}

// ----------------------------------------------------------------------

export function ProfileOrdersTable({ orders }: { orders: ProfileOrder[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <>
      <ProfileTable
        head={[
          t('profile.orders.number'),
          t('profile.orders.placedAt'),
          t('profile.orders.branch'),
          t('profile.orders.type'),
          t('profile.orders.state'),
          t('profile.orders.total'),
        ]}
        empty={t('profile.orders.empty')}
        isEmpty={orders.length === 0}
      >
        {orders.map((order) => (
          <TableRow key={order.id} hover>
            <TableCell>
              <Link
                component="button"
                variant="body2"
                onClick={() => navigate(paths.app.orders.detail(order.id))}
                sx={{ fontFamily: 'monospace', fontWeight: 600 }}
              >
                {order.order_number}
              </Link>
            </TableCell>
            <TableCell dir="ltr">{formatDateTime(order.placed_at)}</TableCell>
            <TableCell>{order.branch_name || '—'}</TableCell>
            <TableCell>
              <Typography variant="body2">{order.order_type}</Typography>
              <Typography variant="caption" color="text.secondary">
                {order.channel}
              </Typography>
            </TableCell>
            <TableCell>
              <Chip size="small" label={order.state} color={ORDER_STATE_COLOR[order.state] || 'default'} />
            </TableCell>
            <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
              {formatMoney(order.grand_total, order.currency_code)}
            </TableCell>
          </TableRow>
        ))}
      </ProfileTable>
      <LimitNotice shown={orders.length} limit={100} />
    </>
  );
}

// ----------------------------------------------------------------------

/** One line saying what changed, so most events can be read without opening them. */
function summarise(event: ProfileAuditEvent): string {
  const changed: string[] | undefined = event.details?.changed;
  if (Array.isArray(changed) && changed.length) return changed.join(', ');

  const before = event.before_data || {};
  const after = event.after_data || {};
  const moved = Object.keys(before)
    .filter((key) => after[key] !== undefined && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => `${key}: ${before[key]} → ${after[key]}`);
  if (moved.length) return moved.join(', ');

  return event.entity_type || '';
}

export function ProfileAuditTable({ events }: { events: ProfileAuditEvent[] }) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [inspecting, setInspecting] = useState<ProfileAuditEvent | null>(null);

  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? events.filter((event) =>
        [event.action, event.actor_name, event.entity_type].some((field) =>
          (field || '').toLowerCase().includes(needle)
        )
      )
    : events;

  return (
    <>
      <TextField
        size="small"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t('profile.audit.filter')}
        sx={{ mb: 2, width: { xs: '100%', sm: 320 } }}
      />
      <ProfileTable
        head={[
          t('profile.audit.time'),
          t('profile.audit.action'),
          t('profile.audit.actor'),
          t('profile.audit.changes'),
          '',
        ]}
        empty={t('profile.audit.empty')}
        isEmpty={shown.length === 0}
      >
        {shown.map((event) => (
          <TableRow key={event.id} hover>
            <TableCell dir="ltr" sx={{ whiteSpace: 'nowrap' }}>
              {formatDateTime(event.occurred_at)}
            </TableCell>
            <TableCell>
              <Chip size="small" variant="outlined" color="primary" label={event.action} />
            </TableCell>
            <TableCell>{event.actor_name || event.actor_type || t('profile.audit.system')}</TableCell>
            <TableCell sx={{ maxWidth: 320 }}>
              <Typography variant="body2" noWrap title={summarise(event)}>
                {summarise(event) || '—'}
              </Typography>
            </TableCell>
            <TableCell align="right">
              <IconButton size="small" onClick={() => setInspecting(event)} title={t('profile.audit.inspect')}>
                <VisibilityIcon fontSize="small" />
              </IconButton>
            </TableCell>
          </TableRow>
        ))}
      </ProfileTable>
      <LimitNotice shown={events.length} limit={200} />

      <Dialog open={!!inspecting} onClose={() => setInspecting(null)} maxWidth="md" fullWidth>
        {inspecting && (
          <>
            <DialogTitle>{inspecting.action}</DialogTitle>
            <DialogContent dividers>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary" dir="ltr">
                  {formatDateTime(inspecting.occurred_at)} · {inspecting.actor_name || inspecting.actor_type}
                  {inspecting.correlation_id ? ` · ${inspecting.correlation_id}` : ''}
                </Typography>
                {(
                  [
                    ['before', inspecting.before_data],
                    ['after', inspecting.after_data],
                    ['details', inspecting.details],
                  ] as const
                )
                  .filter(([, payload]) => payload)
                  .map(([key, payload]) => (
                    <Box key={key}>
                      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                        {t(`profile.audit.${key}`)}
                      </Typography>
                      <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'background.neutral' }}>
                        <pre style={{ margin: 0, overflowX: 'auto', fontSize: 12 }} dir="ltr">
                          {JSON.stringify(payload, null, 2)}
                        </pre>
                      </Paper>
                    </Box>
                  ))}
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setInspecting(null)}>{t('profile.close')}</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}
