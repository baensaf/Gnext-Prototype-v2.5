import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Drawer,
  TextField,
  MenuItem,
  FormControlLabel,
  Checkbox,
  Alert,
  FormControl,
  InputLabel,
  Select,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

import { discountsApi, Discount } from 'src/api/discountsApi';

export function DiscountRulesPage() {
  const { t } = useTranslation();

  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'MANUAL' | 'AUTOMATIC_RULE' | 'COUPON'>('MANUAL');
  const [calcType, setCalcType] = useState<'PERCENTAGE' | 'FIXED_AMOUNT'>('PERCENTAGE');
  const [value, setValue] = useState('0.1000');
  const [minOrderTotal, setMinOrderTotal] = useState('0');
  const [requiresReason, setRequiresReason] = useState(true);
  const [requiresManagerApproval, setRequiresManagerApproval] = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await discountsApi.getDiscounts();
      setDiscounts(data);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load discount rules');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await discountsApi.createDiscount({
        code,
        name,
        kind,
        calculation_type: calcType,
        value,
        min_order_total: minOrderTotal,
        requires_reason: requiresReason,
        requires_manager_approval: requiresManagerApproval,
      });
      setDrawerOpen(false);
      resetForm();
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create discount rule');
    }
  };

  const resetForm = () => {
    setCode('');
    setName('');
    setKind('MANUAL');
    setCalcType('PERCENTAGE');
    setValue('0.1000');
    setMinOrderTotal('0');
    setRequiresReason(true);
    setRequiresManagerApproval(true);
  };

  const handleArchive = async (id: string, discName: string) => {
    if (window.confirm(`Are you sure you want to archive discount rule "${discName}"?`)) {
      try {
        await discountsApi.archiveDiscount(id);
        loadData();
      } catch (err: any) {
        setError(err.detail || 'Failed to archive discount');
      }
    }
  };

  const formatValue = (d: Discount) => {
    if (d.calculation_type === 'PERCENTAGE') {
      return `${(Number(d.value) * 100).toFixed(0)}%`;
    }
    return `${Number(d.value).toLocaleString()} IRR`;
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Discount Rules & Promotions
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure percentage, fixed amount, manual cashier overrides, and promotion constraints
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          Create Discount Rule
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 0 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Code</TableCell>
                  <TableCell>Discount Rule Name</TableCell>
                  <TableCell>Kind</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell align="right">Value</TableCell>
                  <TableCell align="center">Reason Req.</TableCell>
                  <TableCell align="center">Approval Req.</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {discounts.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell><code>{d.code}</code></TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{d.name}</TableCell>
                    <TableCell>
                      <Chip label={d.kind} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Chip label={d.calculation_type} size="small" color="info" />
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                      {formatValue(d)}
                    </TableCell>
                    <TableCell align="center">
                      <Chip label={d.requires_reason ? 'Yes' : 'No'} size="small" />
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={d.requires_manager_approval ? 'Manager' : 'Cashier'}
                        color={d.requires_manager_approval ? 'warning' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={d.is_active ? 'Active' : 'Archived'}
                        color={d.is_active ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="center">
                      <IconButton
                        title="Archive Discount"
                        color="error"
                        onClick={() => handleArchive(d.id, d.name)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create Discount Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 420, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Create Discount Rule
          </Typography>
          <form onSubmit={handleCreate}>
            <Stack spacing={2.5}>
              <TextField
                label="Discount Code"
                placeholder="e.g. DISC-15PCT"
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <TextField
                label="Discount Display Name"
                placeholder="e.g. 15% Manager Special Discount"
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <FormControl fullWidth required>
                <InputLabel>Discount Kind</InputLabel>
                <Select
                  value={kind}
                  label="Discount Kind"
                  onChange={(e) => setKind(e.target.value as any)}
                >
                  <MenuItem value="MANUAL">MANUAL (Cashier/Manager Applied)</MenuItem>
                  <MenuItem value="AUTOMATIC_RULE">AUTOMATIC_RULE (Triggered by cart)</MenuItem>
                  <MenuItem value="COUPON">COUPON (Code Linked)</MenuItem>
                </Select>
              </FormControl>

              <FormControl fullWidth required>
                <InputLabel>Calculation Type</InputLabel>
                <Select
                  value={calcType}
                  label="Calculation Type"
                  onChange={(e) => setCalcType(e.target.value as any)}
                >
                  <MenuItem value="PERCENTAGE">PERCENTAGE (e.g. 0.1000 = 10%)</MenuItem>
                  <MenuItem value="FIXED_AMOUNT">FIXED_AMOUNT (e.g. 500000 IRR)</MenuItem>
                </Select>
              </FormControl>

              <TextField
                label={calcType === 'PERCENTAGE' ? 'Percentage Value (e.g. 0.1500 for 15%)' : 'Fixed Amount (IRR)'}
                required
                fullWidth
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />

              <TextField
                label="Min Order Subtotal Threshold (IRR)"
                type="number"
                fullWidth
                value={minOrderTotal}
                onChange={(e) => setMinOrderTotal(e.target.value)}
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={requiresReason}
                    onChange={(e) => setRequiresReason(e.target.checked)}
                  />
                }
                label="Requires Reason Code Selection"
              />

              <FormControlLabel
                control={
                  <Checkbox
                    checked={requiresManagerApproval}
                    onChange={(e) => setRequiresManagerApproval(e.target.checked)}
                  />
                }
                label="Requires Manager Approval PIN"
              />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                Save Discount Rule
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>
    </Box>
  );
}
