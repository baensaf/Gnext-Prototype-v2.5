import type {
  Customer,
  CustomerAddress,
  CustomerCreditAccount,
  CustomerCreditTransaction} from 'src/api/customerApi';

import { useNavigate } from 'react-router';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import HomeIcon from '@mui/icons-material/Home';
import SearchIcon from '@mui/icons-material/Search';
import VisibilityIcon from '@mui/icons-material/Visibility';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import {
  Box,
  Card,
  Chip,
  Grid,
  Link,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Drawer,
  Select,
  Dialog,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  InputLabel,
  CardContent,
  FormControl,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { paths } from 'src/routes/paths';

import { MoneyUtil } from 'src/utils/money.util';

import {
  customerApi
} from 'src/api/customerApi';

import { ServerDataGrid } from 'src/components/server-data-grid';

export function CustomersPage() {
  const navigate = useNavigate();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [creditLimit, setCreditLimit] = useState('10000000');

  // Credit Account Modal state
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [creditAccount, setCreditAccount] = useState<CustomerCreditAccount | null>(null);
  const [transactions, setTransactions] = useState<CustomerCreditTransaction[]>([]);
  const [txType, setTxType] = useState<string>('CHARGE');
  const [txAmount, setTxAmount] = useState<string>('1000000');
  const [txNote, setTxNote] = useState<string>('');

  // Address Modal state
  const [addressDialogOpen, setAddressDialogOpen] = useState(false);
  const [addresses, setAddresses] = useState<CustomerAddress[]>([]);
  const [addrTitle, setAddrTitle] = useState('Home');
  const [addrText, setAddrText] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const cList = await customerApi.getCustomers(search || undefined);
      setCustomers(cList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const finalCode = code.trim() || mobile.trim();
      await customerApi.createCustomer({
        code: finalCode,
        first_name: firstName,
        last_name: lastName,
        mobile,
        email,
        credit_limit: creditLimit,
      });
      setDrawerOpen(false);
      resetForm();
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create customer');
    }
  };

  const resetForm = () => {
    setCode('');
    setFirstName('');
    setLastName('');
    setMobile('');
    setEmail('');
    setCreditLimit('10000000');
  };

  // Credit Account Handlers
  const handleOpenCredit = useCallback(async (c: Customer) => {
    setSelectedCustomer(c);
    setCreditDialogOpen(true);
    try {
      const res = await customerApi.getCreditAccount(c.id);
      setCreditAccount(res.account);
      setTransactions(res.transactions);
    } catch (err: any) {
      setError(err.detail || 'Failed to fetch credit account');
    }
  }, []);

  const handlePostTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    try {
      const res = await customerApi.postCreditTransaction(selectedCustomer.id, {
        transaction_type: txType,
        amount: txAmount,
        note: txNote,
      });
      setCreditAccount(res.account);
      const updated = await customerApi.getCreditAccount(selectedCustomer.id);
      setTransactions(updated.transactions);
      setTxNote('');
    } catch (err: any) {
      setError(err.detail || 'Failed to post credit transaction');
    }
  };

  // Address Handlers
  const handleOpenAddresses = async (c: Customer) => {
    setSelectedCustomer(c);
    setAddressDialogOpen(true);
    try {
      const res = await customerApi.getAddresses(c.id);
      setAddresses(res);
    } catch (err: any) {
      setError(err.detail || 'Failed to fetch customer addresses');
    }
  };

  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer || !addrText) return;
    try {
      await customerApi.createAddress(selectedCustomer.id, {
        title: addrTitle,
        address_text: addrText,
        is_default: addresses.length === 0,
      });
      const updated = await customerApi.getAddresses(selectedCustomer.id);
      setAddresses(updated);
      setAddrText('');
    } catch (err: any) {
      setError(err.detail || 'Failed to add address');
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Customer Relationship & Accounts
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage customer profiles, delivery addresses and credit account ledgers
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          Register Customer
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Search Input */}
      <Box sx={{ mb: 3, maxWidth: 400 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search by code, name, or mobile number..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} />,
            },
          }}
        />
      </Box>

      <ServerDataGrid
        rows={customers}
        columns={[
          {
            field: 'code',
            headerName: 'Code',
            width: 120,
            renderCell: (params) => <code>{params.value}</code>,
          },
          {
            field: 'name',
            headerName: 'Customer Name',
            flex: 1,
            minWidth: 180,
            valueGetter: (_value, row) => `${row.first_name || ''} ${row.last_name || ''}`.trim(),
            renderCell: (params) => (
              <Link
                component="button"
                onClick={() => navigate(paths.app.customers.detail(params.row.id))}
                sx={{ fontWeight: 600 }}
              >
                {params.value}
              </Link>
            ),
          },
          {
            field: 'mobile',
            headerName: 'Mobile Number',
            width: 150,
            renderCell: (params) => <span dir="ltr">{params.value}</span>,
          },
          {
            field: 'wallet_balance',
            headerName: 'Wallet / Credit Balance',
            width: 220,
            renderCell: (params) => {
              const c = params.row as Customer;
              const walletBal = c.wallet_balance || c.credit_account?.current_balance || '0.0000';
              const credLim = c.credit_limit || c.credit_account?.credit_limit || '0.0000';
              const isPositive = MoneyUtil.greaterThan(walletBal, '0');
              return (
                <Stack spacing={0.5} sx={{ alignItems: 'flex-start', py: 1 }}>
                  <Chip
                    icon={<AccountBalanceWalletIcon sx={{ '&&': { fontSize: 16 } }} />}
                    label={`${MoneyUtil.formatCurrency(walletBal)} IRR`}
                    color={isPositive ? 'success' : 'default'}
                    size="small"
                    onClick={() => handleOpenCredit(c)}
                    title="Click to view full wallet ledger & post transactions"
                    sx={{ fontWeight: 600, cursor: 'pointer' }}
                  />
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                    Limit: {MoneyUtil.formatCurrency(credLim)} IRR
                  </Typography>
                </Stack>
              );
            },
          },
          {
            field: 'is_active',
            headerName: 'Status',
            width: 110,
            renderCell: (params) => (
              <Chip
                label={params.value ? 'Active' : 'Disabled'}
                color={params.value ? 'success' : 'default'}
                size="small"
              />
            ),
          },
          {
            field: 'actions',
            headerName: 'Actions',
            width: 150,
            sortable: false,
            renderCell: (params) => {
              const c = params.row as Customer;
              return (
                <Stack direction="row" spacing={0.5}>
                  <IconButton
                    size="small"
                    title="View profile"
                    onClick={() => navigate(paths.app.customers.detail(c.id))}
                  >
                    <VisibilityIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    title="Customer Wallet & Credit Ledger"
                    color="primary"
                    onClick={() => handleOpenCredit(c)}
                  >
                    <AccountBalanceWalletIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    title="Delivery Addresses"
                    color="info"
                    onClick={() => handleOpenAddresses(c)}
                  >
                    <HomeIcon fontSize="small" />
                  </IconButton>
                </Stack>
              );
            },
          },
        ]}
        loading={_loading}
        height={600}
        emptyTitle="No customers registered"
        emptyDescription="Click 'New Customer' to register a customer account."
      />

      {/* Create Customer Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 440, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Register New Customer
          </Typography>
          <form onSubmit={handleCreate}>
            <Stack spacing={2.5}>
              <TextField
                label="Mobile Phone Number"
                placeholder="e.g. 09120000000 / +989120000000"
                required
                fullWidth
                value={mobile}
                onChange={(e) => {
                  const newMobile = e.target.value;
                  // If code was empty or was keeping in sync with previous mobile value, update it
                  if (!code || code === mobile.toUpperCase()) {
                    setCode(newMobile.toUpperCase());
                  }
                  setMobile(newMobile);
                }}
              />
              <TextField
                label="Customer Code"
                placeholder="Defaults to phone number"
                helperText="Customer code defaults to the customer's phone number."
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  label="First Name"
                  required
                  fullWidth
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
                <TextField
                  label="Last Name"
                  required
                  fullWidth
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </Stack>
              <TextField
                label="Email Address"
                type="email"
                fullWidth
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <TextField
                label="Assigned Credit Line / Overdraft Limit (IRR)"
                type="number"
                fullWidth
                value={creditLimit}
                helperText="A wallet account will be automatically provisioned with this initial credit limit."
                onChange={(e) => setCreditLimit(e.target.value)}
              />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                Save Customer Profile
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>

      {/* Credit Ledger Dialog */}
      <Dialog open={creditDialogOpen} onClose={() => setCreditDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          Customer Wallet & Credit Ledger — {selectedCustomer?.first_name} {selectedCustomer?.last_name} ({selectedCustomer?.code})
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {creditAccount && (
            <Grid container spacing={2} sx={{ mb: 3, mt: 1 }}>
              <Grid size={{ xs: 12, md: 4 }}>
                <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: 'success.50', borderColor: 'success.200' }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="caption" color="success.dark" sx={{ fontWeight: 600 }}>
                      Available Wallet Balance
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'success.main', mt: 0.5 }}>
                      {MoneyUtil.formatCurrency(creditAccount.current_balance)} IRR
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: 'background.neutral' }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                      Assigned Credit Limit
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5 }}>
                      {MoneyUtil.formatCurrency(creditAccount.credit_limit)} IRR
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Card variant="outlined" sx={{ borderRadius: 2, bgcolor: 'primary.50', borderColor: 'primary.200' }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="caption" color="primary.dark" sx={{ fontWeight: 600 }}>
                      Total Purchasing Power
                    </Typography>
                    <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main', mt: 0.5 }}>
                      {MoneyUtil.formatCurrency(
                        MoneyUtil.add(creditAccount.current_balance || '0', creditAccount.credit_limit || '0'),
                      )} IRR
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>
          )}

          {/* Post Transaction Form */}
          <Box component="form" onSubmit={handlePostTransaction} sx={{ mb: 3, p: 2, bgcolor: 'background.neutral', borderRadius: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1.5 }}>
              Top-Up, Deduct or Adjust Wallet Balance
            </Typography>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              sx={{ alignItems: { xs: 'stretch', md: 'center' }, flexWrap: { md: 'wrap' } }}
            >
              <FormControl size="small" sx={{ width: { xs: '100%', md: 200 } }}>
                <InputLabel>Transaction Type</InputLabel>
                <Select value={txType} label="Transaction Type" onChange={(e) => setTxType(e.target.value)}>
                  <MenuItem value="CHARGE">CHARGE (Top-Up / Deposit +)</MenuItem>
                  <MenuItem value="DEBIT">DEBIT (Deduct / Spend -)</MenuItem>
                  <MenuItem value="SETTLEMENT">SETTLEMENT (Debt Repay +)</MenuItem>
                  <MenuItem value="ADJUSTMENT">ADJUSTMENT (Balance Adjust =)</MenuItem>
                </Select>
              </FormControl>

              <TextField
                size="small"
                label="Amount (IRR)"
                type="number"
                value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
                sx={{ width: { xs: '100%', md: 180 } }}
              />

              <TextField
                size="small"
                label="Note / Reference"
                value={txNote}
                onChange={(e) => setTxNote(e.target.value)}
                sx={{ flex: '1 1 220px' }}
              />

              <Button
                type="submit"
                variant="contained"
                size="small"
                sx={{ fontWeight: 'bold', whiteSpace: 'nowrap', minHeight: 40 }}
              >
                Post Transaction
              </Button>
            </Stack>
          </Box>

          {/* Transactions Table */}
          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
            Transaction History
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2, maxHeight: 260 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell align="right">Amount (IRR)</TableCell>
                  <TableCell>Note</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {transactions.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{new Date(t.recorded_at || (t as any).posted_at || Date.now()).toLocaleString()}</TableCell>
                    <TableCell>
                      <Chip
                        label={t.transaction_type || (t as any).entry_type || 'ADJUSTMENT'}
                        size="small"
                        color={t.transaction_type === 'CHARGE' || t.transaction_type === 'SETTLEMENT' || (t as any).entry_type === 'REPAYMENT' ? 'success' : 'warning'}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                      {MoneyUtil.formatCurrency(t.amount)} IRR
                    </TableCell>
                    <TableCell>{t.note || (t as any).reason_text || (t as any).reference || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreditDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Address Dialog */}
      <Dialog open={addressDialogOpen} onClose={() => setAddressDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          Delivery Addresses — {selectedCustomer?.first_name} {selectedCustomer?.last_name}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={2} component="form" onSubmit={handleAddAddress} sx={{ mb: 3, mt: 1 }}>
            <TextField
              size="small"
              label="Address Title"
              placeholder="e.g. Office / Home"
              required
              value={addrTitle}
              onChange={(e) => setAddrTitle(e.target.value)}
            />
            <TextField
              size="small"
              label="Address Text"
              placeholder="Full street address..."
              multiline
              rows={2}
              required
              value={addrText}
              onChange={(e) => setAddrText(e.target.value)}
            />
            <Button type="submit" variant="contained" size="small" sx={{ alignSelf: 'flex-start', fontWeight: 'bold' }}>
              Add Address
            </Button>
          </Stack>

          <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
            Saved Addresses
          </Typography>
          <Stack spacing={1}>
            {addresses.map((a) => (
              <Card key={a.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                      {a.title} {a.is_default && <Chip label="Default" size="small" color="primary" sx={{ ml: 1 }} />}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {a.address_text}
                    </Typography>
                  </Box>
                </Stack>
              </Card>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddressDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
