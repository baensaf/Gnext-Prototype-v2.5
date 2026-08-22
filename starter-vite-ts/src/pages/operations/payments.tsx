import type { Branch } from 'src/api/tenantApi';
import type { PaymentDevice, PaymentRecord, SettlementAccount } from 'src/api/paymentApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import {
  Box,
  Tab,
  Chip,
  Tabs,
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

import { MoneyUtil } from 'src/utils/money.util';

import { tenantApi } from 'src/api/tenantApi';
import { paymentApi } from 'src/api/paymentApi';
import { httpClient } from 'src/api/httpClient';

export function PaymentsPage() {
  const { t } = useTranslation();

  const [tabIndex, setTabIndex] = useState(0);
  const [transactions, setTransactions] = useState<PaymentRecord[]>([]);
  const [devices, setDevices] = useState<PaymentDevice[]>([]);
  const [accounts, setAccounts] = useState<SettlementAccount[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Device Form Drawer
  const [deviceDrawerOpen, setDeviceDrawerOpen] = useState(false);
  const [devCode, setDevCode] = useState('');
  const [devName, setDevName] = useState('');
  const [devSerial, setDevSerial] = useState('');
  const [devType, setDevType] = useState('POS_TERMINAL');
  const [devBranchId, setDevBranchId] = useState('');
  const [devAccountId, setDevAccountId] = useState('');

  // Account Form Drawer
  const [accDrawerOpen, setAccDrawerOpen] = useState(false);
  const [accCode, setAccCode] = useState('');
  const [accName, setAccName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [iban, setIban] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dList, aList, bList] = await Promise.all([
        paymentApi.getDevices(),
        paymentApi.getAccounts(),
        tenantApi.getBranches(),
      ]);
      setDevices(dList);
      setAccounts(aList);
      setBranches(bList);

      // Attempt to load recent payment transactions
      try {
        const txRes = await httpClient.get('/api/v1/audit/logs', { params: { entityType: 'Payment', limit: 25 } });
        if (Array.isArray(txRes.data)) {
          setTransactions(
            txRes.data.map((l: any) => ({
              id: l.entity_id || l.id,
              order_id: l.payload_json?.order_id || l.payload_json?.orderId || '-',
              payment_number: l.payload_json?.payment_number || `PAY-${(l.id || '').substring(0, 8)}`,
              method_id: l.payload_json?.method_id || '-',
              method_kind: l.payload_json?.method_kind || l.payload_json?.method || 'CARD_PRESENT',
              status: (l.payload_json?.status || 'SUCCEEDED') as any,
              amount: l.payload_json?.amount || '0',
              currency_code: l.payload_json?.currency_code || 'IRR',
              business_date: l.created_at || new Date().toISOString(),
              recorded_at: l.created_at || new Date().toISOString(),
              initiated_at: l.created_at || new Date().toISOString(),
              reference: l.payload_json?.reference || l.payload_json?.rrn,
            }))
          );
        }
      } catch {
        // Fallback to empty if endpoint not populated
      }

      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load payment infrastructure data');
    } finally {
      setLoading(false);
    }
  }, []);

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
      setDeviceDrawerOpen(false);
      setDevCode('');
      setDevName('');
      setDevSerial('');
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create payment device');
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await paymentApi.createAccount({
        code: accCode,
        name: accName,
        bank_name: bankName || undefined,
        account_number: accountNumber || undefined,
        iban: iban || undefined,
      });
      setAccDrawerOpen(false);
      setAccCode('');
      setAccName('');
      setBankName('');
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create settlement account');
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('payments.title', 'Payments & Settlement Infrastructure')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('nav.payments', 'مدیریت تراکنش‌های پرداخت، پایانه‌های فروشگاهی و حساب‌های تسویه‌حساب بانکی')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            {t('monitoring.refresh', 'Refresh')}
          </Button>
          {tabIndex === 1 && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDeviceDrawerOpen(true)}>
              {t('payments.addDevice', 'Register Device')}
            </Button>
          )}
          {tabIndex === 2 && (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAccDrawerOpen(true)}>
              {t('payments.addAccount', 'Create Account')}
            </Button>
          )}
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={tabIndex} onChange={(_, val) => setTabIndex(val)}>
          <Tab icon={<ReceiptLongIcon />} label={t('payments.tabTransactions', 'Payment Transactions Ledger')} iconPosition="start" />
          <Tab icon={<PointOfSaleIcon />} label={t('payments.tabDevices', 'Payment Devices & Terminals')} iconPosition="start" />
          <Tab icon={<AccountBalanceIcon />} label={t('payments.tabAccounts', 'Bank Settlement Accounts')} iconPosition="start" />
        </Tabs>
      </Box>

      {tabIndex === 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('payments.columnPaymentNumber', 'Payment Number')}</TableCell>
                <TableCell>{t('payments.columnOrder', 'Order ID')}</TableCell>
                <TableCell>{t('payments.columnMethod', 'Method')}</TableCell>
                <TableCell>{t('payments.columnAmount', 'Amount')}</TableCell>
                <TableCell>{t('payments.columnReference', 'Reference / RRN')}</TableCell>
                <TableCell>{t('payments.columnStatus', 'Status')}</TableCell>
                <TableCell>{t('payments.columnDate', 'Timestamp')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                      {t('grid.noRowsLabel', 'هیچ تراکنش پرداختی ثبت نشده است.')}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell><code>{tx.payment_number}</code></TableCell>
                    <TableCell>{tx.order_id}</TableCell>
                    <TableCell><Chip label={tx.method_kind} size="small" variant="outlined" /></TableCell>
                    <TableCell><strong>{MoneyUtil.format(tx.amount)} {tx.currency_code}</strong></TableCell>
                    <TableCell><code>{tx.reference || '-'}</code></TableCell>
                    <TableCell>
                      <Chip
                        label={tx.status}
                        color={tx.status === 'SUCCEEDED' ? 'success' : tx.status === 'FAILED' ? 'error' : 'warning'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>{new Date(tx.business_date).toLocaleString()}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {tabIndex === 1 && (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Device Code</TableCell>
                <TableCell>Device Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Serial Number</TableCell>
                <TableCell>Assigned Branch</TableCell>
                <TableCell>Settlement Destination</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {devices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center">
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
                        <Chip
                          label={d.device_type}
                          color={d.device_type === 'MOBILE_POS' ? 'info' : d.device_type === 'POS_TERMINAL' ? 'primary' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>{d.serial_number || '-'}</TableCell>
                      <TableCell>{bName}</TableCell>
                      <TableCell>{accNameStr}</TableCell>
                      <TableCell>
                        <Chip label={d.is_active ? 'Active' : 'Inactive'} color={d.is_active ? 'success' : 'default'} size="small" />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {tabIndex === 2 && (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Account Code</TableCell>
                <TableCell>Account Name</TableCell>
                <TableCell>Bank</TableCell>
                <TableCell>Account Number</TableCell>
                <TableCell>IBAN</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                      No settlement accounts created yet.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                accounts.map((acc) => (
                  <TableRow key={acc.id}>
                    <TableCell>
                      <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                        {acc.code}
                      </Typography>
                    </TableCell>
                    <TableCell>{acc.name}</TableCell>
                    <TableCell>{acc.bank_name || '-'}</TableCell>
                    <TableCell>{acc.account_number || '-'}</TableCell>
                    <TableCell>{acc.iban || '-'}</TableCell>
                    <TableCell>
                      <Chip label={acc.is_active ? 'Active' : 'Inactive'} color={acc.is_active ? 'success' : 'default'} size="small" />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Register Device Drawer */}
      <Drawer anchor="right" open={deviceDrawerOpen} onClose={() => setDeviceDrawerOpen(false)}>
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
                <MenuItem value="ONLINE_GATEWAY">Online Payment Gateway</MenuItem>
                <MenuItem value="BANK_TRANSFER">Bank Transfer Account</MenuItem>
              </TextField>
              <TextField label="Serial Number" value={devSerial} onChange={(e) => setDevSerial(e.target.value)} fullWidth placeholder="e.g. SN-8839210" />
              <TextField select label="Branch Scope" value={devBranchId} onChange={(e) => setDevBranchId(e.target.value)} fullWidth>
                <MenuItem value="">All Branches</MenuItem>
                {branches.map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label="Settlement Destination Account" value={devAccountId} onChange={(e) => setDevAccountId(e.target.value)} fullWidth>
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

      {/* Create Account Drawer */}
      <Drawer anchor="right" open={accDrawerOpen} onClose={() => setAccDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Create Settlement Account
          </Typography>
          <Box component="form" onSubmit={handleCreateAccount}>
            <Stack spacing={2.5}>
              <TextField label="Account Code" value={accCode} onChange={(e) => setAccCode(e.target.value)} required fullWidth placeholder="e.g. ACC-MELLAT-MAIN" />
              <TextField label="Account Name" value={accName} onChange={(e) => setAccName(e.target.value)} required fullWidth placeholder="e.g. Mellat Corporate Account" />
              <TextField label="Bank Name" value={bankName} onChange={(e) => setBankName(e.target.value)} fullWidth placeholder="e.g. Bank Mellat" />
              <TextField label="Account Number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} fullWidth />
              <TextField label="IBAN (Sheba)" value={iban} onChange={(e) => setIban(e.target.value)} fullWidth placeholder="IR..." />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                Save Account
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>
    </Box>
  );
}
