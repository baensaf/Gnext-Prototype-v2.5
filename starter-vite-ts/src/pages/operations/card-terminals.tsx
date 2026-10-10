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
export function CardTerminalsPage() {
  const { t } = useTranslation();

  const [devices, setDevices] = useState<PaymentDevice[]>([]);
  const [accounts, setAccounts] = useState<SettlementAccount[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [devCode, setDevCode] = useState('');
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
        paymentApi.getDevices(),
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
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await paymentApi.createDevice({
        code: devCode,
        name: devName,
        serial_number: devSerial || undefined,
        device_type: devType as any,
        branch_id: devBranchId,
        settlement_account_id: devAccountId || undefined,
      });
      setDrawerOpen(false);
      setDevCode('');
      setDevName('');
      setDevSerial('');
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create payment device');
    }
  };

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('payments.cardTerminals.title', 'Card terminals')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('payments.cardTerminals.title', 'Card terminals') },
        ]}
        action={
          <Stack direction="row" spacing={2}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
              {t('monitoring.refresh', 'Refresh')}
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDrawerOpen(true)}>
              {t('payments.addDevice', 'Register Device')}
            </Button>
          </Stack>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Device Code</TableCell>
              <TableCell>Device Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Serial Number</TableCell>
              <TableCell>Assigned Branch</TableCell>
              <TableCell>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                  <span>Settlement Destination</span>
                  <VersionTag feature="payments.settlementAccounts" />
                </Stack>
              </TableCell>
              <TableCell>Status</TableCell>
              <TableCell>{t('payments.terminalAgent.column', 'Branch agent')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {devices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                    No payment devices registered yet. Click &quot;Register Device&quot; to add your physical or mobile POS.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              devices.map((d) => {
                const bName = branches.find((b) => b.id === d.branch_id)?.name || 'All Branches';
                const accNameStr = accounts.find((a) => a.id === d.settlement_account_id)?.name || 'Unassigned';

                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                        {d.code}
                      </Typography>
                    </TableCell>
                    <TableCell>{d.name}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Chip
                          label={d.device_type}
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
                      <Chip label={d.is_active ? 'Active' : 'Inactive'} color={d.is_active ? 'success' : 'default'} size="small" />
                    </TableCell>
                    <TableCell>
                      {d.kind !== 'MOBILE' && (
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
            Register Payment Device
          </Typography>
          <Box component="form" onSubmit={handleCreateDevice}>
            <Stack spacing={2.5}>
              <TextField label="Device Code" value={devCode} onChange={(e) => setDevCode(e.target.value)} required fullWidth placeholder="e.g. POS-MAIN-01" />
              <TextField label="Device Name" value={devName} onChange={(e) => setDevName(e.target.value)} required fullWidth placeholder="e.g. Counter Card POS Terminal" />
              <TextField select label="Device Type" value={devType} onChange={(e) => setDevType(e.target.value)} fullWidth>
                <MenuItem value="POS_TERMINAL">Physical POS Terminal</MenuItem>
                <MenuItem value="MOBILE_POS">Courier Mobile POS</MenuItem>
                <MenuItem value="BANK_TRANSFER">
                  Bank Transfer Account <VersionTag feature="payments.bankTransfer" sx={{ ml: 1 }} />
                </MenuItem>
              </TextField>
              <TextField label="Serial Number" value={devSerial} onChange={(e) => setDevSerial(e.target.value)} fullWidth placeholder="e.g. SN-8839210" />
              <TextField select label="Branch Scope" value={devBranchId} onChange={(e) => setDevBranchId(e.target.value)} fullWidth>
                <MenuItem value="">All Branches</MenuItem>
                {(scopedBranch ? [scopedBranch] : branches).map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Settlement Destination Account"
                value={devAccountId}
                onChange={(e) => setDevAccountId(e.target.value)}
                fullWidth
                slotProps={{ input: { endAdornment: <VersionTag feature="payments.settlementAccounts" sx={{ mr: 3 }} /> } }}
              >
                <MenuItem value="">Unassigned</MenuItem>
                {accounts.map((a) => (
                  <MenuItem key={a.id} value={a.id}>
                    {a.name} ({a.bank_name || 'Bank'})
                  </MenuItem>
                ))}
              </TextField>

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                Save Device
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
