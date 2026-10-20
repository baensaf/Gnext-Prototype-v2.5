import type { Branch } from 'src/api/tenantApi';
import type { PaymentDevice, SettlementAccount } from 'src/api/paymentApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Box,
  Chip,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Drawer,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  TableContainer,
} from '@mui/material';

import { tenantApi } from 'src/api/tenantApi';
import { paymentApi } from 'src/api/paymentApi';
import { useScopedBranchId, useBranchContextOptional } from 'src/contexts/branch-context';

import { VersionTag } from 'src/components/version-tag';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import { TerminalAgentDialog } from 'src/components/payment-terminal/terminal-agent-dialog';

// ----------------------------------------------------------------------

/**
 * The branch's card terminals: the counter's EFT POS and the couriers' mobile card readers,
 * and how the branch agent reaches each one. Set up once, like the printers, so it sits
 * with them under Settings rather than on the Payments page, which only reads money.
 */
type CardTerminalsPageProps = {
  /** Shown inside the Branch agent page (2026-10-19): no page heading, the header's branch only. */
  embedded?: boolean;
  /** Look only: everyone at the branch sees the terminals, the manager changes them. */
  readOnly?: boolean;
  /** What the branch agent last said about each terminal, by terminal id (ONLINE, OFFLINE…). */
  liveStatus?: Record<string, string>;
};

export function CardTerminalsPage({ embedded = false, readOnly = false, liveStatus }: CardTerminalsPageProps = {}) {
  const { t } = useTranslation();

  const [devices, setDevices] = useState<PaymentDevice[]>([]);
  const [accounts, setAccounts] = useState<SettlementAccount[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [devName, setDevName] = useState('');
  const [devSerial, setDevSerial] = useState('');
  const [devType, setDevType] = useState('POS_TERMINAL');
  const [devBranchId, setDevBranchId] = useScopedBranchId();
  // The header's branch is the only branch offered; the other choice is the whole chain.
  const scopedBranch = useBranchContextOptional()?.selectedBranch ?? null;
  const [devAccountId, setDevAccountId] = useState('');
  const [agentDevice, setAgentDevice] = useState<PaymentDevice | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [dList, aList, bList] = await Promise.all([
        // On the Branch agent page: the branch's own terminals and the chain's shared ones.
        embedded && devBranchId ? paymentApi.getDevices(devBranchId) : paymentApi.getDevices(),
        paymentApi.getAccounts(),
        tenantApi.getBranches(),
      ]);
      setDevices(dList);
      setAccounts(aList);
      setBranches(bList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('payments.cardTerminals.loadError', 'Failed to load the card terminals'));
    }
    // devBranchId is the header's branch, read once per load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, embedded]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await paymentApi.createDevice({
        name: devName,
        serial_number: devSerial || undefined,
        device_type: devType as any,
        branch_id: devBranchId,
        settlement_account_id: devAccountId || undefined,
      });
      setDrawerOpen(false);
      setDevName('');
      setDevSerial('');
      loadData();
    } catch (err: any) {
      setError(err.detail || t('payments.cardTerminals.createFailed', 'Failed to create payment device'));
    }
  };

  const actions = (
    <Stack direction="row" spacing={2}>
      <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
        {t('monitoring.refresh', 'Refresh')}
      </Button>
      {!readOnly && (
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDrawerOpen(true)}>
          {t('payments.addDevice', 'Register Device')}
        </Button>
      )}
    </Stack>
  );

  return (
    <Box sx={{ pb: embedded ? 0 : 6 }}>
      {embedded ? (
        <Stack direction="row" sx={{ justifyContent: 'flex-end', mb: 2 }}>
          {actions}
        </Stack>
      ) : (
        <CustomBreadcrumbs
          heading={t('payments.cardTerminals.title', 'Card terminals')}
          links={[
            { name: t('nav.home', 'Home'), href: '/app/dashboard' },
            { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
            { name: t('payments.cardTerminals.title', 'Card terminals') },
          ]}
          action={actions}
        />
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('payments.cardTerminals.colName', 'Device name')}</TableCell>
              <TableCell>{t('payments.cardTerminals.colType', 'Type')}</TableCell>
              <TableCell>{t('payments.cardTerminals.colSerial', 'Serial number')}</TableCell>
              <TableCell>{t('payments.cardTerminals.colBranch', 'Branch')}</TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  <span>{t('payments.cardTerminals.colSettlement', 'Settles to')}</span>
                  <VersionTag feature="payments.settlementAccounts" />
                </Stack>
              </TableCell>
              <TableCell>{t('payments.cardTerminals.colStatus', 'Status')}</TableCell>
              <TableCell>{t('payments.terminalAgent.column', 'Branch agent')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {devices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                    {t('payments.cardTerminals.empty', 'No card terminals yet. Add one with Register device.')}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              devices.map((d) => {
                const bName = branches.find((b) => b.id === d.branch_id)?.name || t('payments.cardTerminals.allBranches', 'All branches');
                const accNameStr = accounts.find((a) => a.id === d.settlement_account_id)?.name || t('payments.cardTerminals.unassigned', 'Not set');

                return (
                  <TableRow key={d.id}>
                    <TableCell sx={{ fontWeight: 'bold' }}>{d.name}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Chip
                          label={t(`payments.cardTerminals.types.${d.device_type}`, d.device_type ?? '')}
                          color={d.device_type === 'MOBILE_POS' ? 'info' : d.device_type === 'POS_TERMINAL' ? 'primary' : 'default'}
                          size="small"
                        />
                        {d.device_type === 'BANK_TRANSFER' && <VersionTag feature="payments.bankTransfer" />}
                      </Stack>
                    </TableCell>
                    <TableCell>{d.serial_number || '-'}</TableCell>
                    <TableCell>{bName}</TableCell>
                    <TableCell>{accNameStr}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5}>
                        <Chip label={d.is_active ? t('payments.cardTerminals.active', 'Active') : t('payments.cardTerminals.inactive', 'Inactive')} color={d.is_active ? 'success' : 'default'} size="small" />
                        {liveStatus?.[d.id] && (
                          <Chip
                            label={t(`operations.agents.live.${liveStatus[d.id]}`, liveStatus[d.id])}
                            color={liveStatus[d.id] === 'ONLINE' ? 'success' : liveStatus[d.id] === 'UNKNOWN' ? 'default' : 'error'}
                            variant="outlined"
                            size="small"
                          />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      {d.kind !== 'MOBILE' && readOnly && d.agent_connection && (
                        <Typography variant="body2" dir="ltr">
                          {`${d.agent_driver?.toUpperCase() || ''} · ${d.agent_connection.kind === 'tcp' ? `${d.agent_connection.host}:${d.agent_connection.port}` : d.agent_connection.port}`}
                        </Typography>
                      )}
                      {d.kind !== 'MOBILE' && !readOnly && (
                        <Button size="small" variant={d.agent_connection ? 'soft' : 'text'} onClick={() => setAgentDevice(d)}>
                          {d.agent_connection
                            ? `${d.agent_driver?.toUpperCase() || ''} · ${d.agent_connection.kind === 'tcp' ? `${d.agent_connection.host}:${d.agent_connection.port}` : d.agent_connection.port}`
                            : t('payments.terminalAgent.connect', 'Connect to agent')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            {t('payments.cardTerminals.drawerTitle', 'Register card terminal')}
          </Typography>
          <Box component="form" onSubmit={handleCreateDevice}>
            <Stack spacing={2.5}>
              <TextField label={t('payments.cardTerminals.colName', 'Device name')} value={devName} onChange={(e) => setDevName(e.target.value)} required fullWidth placeholder={t('payments.cardTerminals.namePlaceholder', 'e.g. Counter card terminal')} />
              <TextField select label={t('payments.cardTerminals.colType', 'Type')} value={devType} onChange={(e) => setDevType(e.target.value)} fullWidth>
                <MenuItem value="POS_TERMINAL">{t('payments.cardTerminals.types.POS_TERMINAL', 'Counter terminal')}</MenuItem>
                <MenuItem value="MOBILE_POS">{t('payments.cardTerminals.types.MOBILE_POS', 'Courier mobile terminal')}</MenuItem>
                <MenuItem value="BANK_TRANSFER">
                  {t('payments.cardTerminals.types.BANK_TRANSFER', 'Bank transfer account')} <VersionTag feature="payments.bankTransfer" sx={{ ml: 1 }} />
                </MenuItem>
              </TextField>
              <TextField label={t('payments.cardTerminals.colSerial', 'Serial number')} value={devSerial} onChange={(e) => setDevSerial(e.target.value)} fullWidth placeholder="SN-8839210" />
              <TextField select label={t('payments.cardTerminals.colBranch', 'Branch')} value={devBranchId} onChange={(e) => setDevBranchId(e.target.value)} fullWidth>
                <MenuItem value="">{t('payments.cardTerminals.allBranches', 'All branches')}</MenuItem>
                {(scopedBranch ? [scopedBranch] : branches).map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label={t('payments.cardTerminals.settlementAccount', 'Settles to account')}
                value={devAccountId}
                onChange={(e) => setDevAccountId(e.target.value)}
                fullWidth
                slotProps={{ input: { endAdornment: <VersionTag feature="payments.settlementAccounts" sx={{ mr: 3 }} /> } }}
              >
                <MenuItem value="">{t('payments.cardTerminals.unassigned', 'Not set')}</MenuItem>
                {accounts.map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.name}{a.bank_name ? ` (${a.bank_name})` : ''}
                  </MenuItem>
                ))}
              </TextField>

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                {t('payments.cardTerminals.save', 'Save')}
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>

      <TerminalAgentDialog
        device={agentDevice}
        onClose={() => setAgentDevice(null)}
        onSaved={() => {
          setAgentDevice(null);
          loadData();
        }}
      />
    </Box>
  );
}
