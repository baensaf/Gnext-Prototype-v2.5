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
  Drawer,
  TextField,
  FormControlLabel,
  Checkbox,
  Alert,
  Switch,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';

import { settingsApi, ReasonCode } from 'src/api/settingsApi';

const DOMAIN_OPTIONS = [
  'ORDER_CANCEL',
  'REFUND',
  'PAYMENT_REVERSAL',
  'SHIFT_CLOSE',
  'SETTLEMENT_CLOSE',
  'REPRINT',
  'PRICE_OVERRIDE',
  'ITEM_VOID',
  'OTHER',
];

export function ReasonCodesPage() {
  const { t } = useTranslation();

  const [reasons, setReasons] = useState<ReasonCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [appliesTo, setAppliesTo] = useState<string[]>(['ORDER_CANCEL']);
  const [requiresNote, setRequiresNote] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await settingsApi.getReasonCodes();
      setReasons(data);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load reason codes');
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
      await settingsApi.createReasonCode({ code, name, applies_to: appliesTo, requires_note: requiresNote });
      setDrawerOpen(false);
      setCode('');
      setName('');
      setAppliesTo(['ORDER_CANCEL']);
      setRequiresNote(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create reason code');
    }
  };

  const handleToggleDomain = (domain: string) => {
    setAppliesTo((prev) =>
      prev.includes(domain) ? prev.filter((d) => d !== domain) : [...prev, domain]
    );
  };

  const handleToggleActive = async (reason: ReasonCode, active: boolean) => {
    try {
      await settingsApi.updateReasonCode(reason.id, { is_active: active });
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to update reason code status');
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Reason Codes Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure standardized operational reasons for cancellations, refunds, shifts, and overrides
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          Create Reason Code
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
                  <TableCell>Reason Name</TableCell>
                  <TableCell>Applies To</TableCell>
                  <TableCell align="center">Requires Note</TableCell>
                  <TableCell align="center">Active</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reasons.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell><code>{r.code}</code></TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{r.name}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                        {r.applies_to.map((domain) => (
                          <Chip key={domain} label={domain} size="small" variant="outlined" />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={r.requires_note ? 'Yes' : 'No'}
                        color={r.requires_note ? 'warning' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Switch
                        checked={r.is_active}
                        onChange={(e) => handleToggleActive(r, e.target.checked)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create Reason Code Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 420, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Create Reason Code
          </Typography>

          <form onSubmit={handleCreate}>
            <Stack spacing={2.5}>
              <TextField
                label="Reason Code"
                placeholder="e.g. CUSTOMER_CANCEL"
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />

              <TextField
                label="Reason Display Name"
                placeholder="e.g. Customer Requested Cancellation"
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                  Applies To Operational Domains
                </Typography>
                <Stack spacing={0.5}>
                  {DOMAIN_OPTIONS.map((d) => (
                    <FormControlLabel
                      key={d}
                      control={
                        <Checkbox
                          checked={appliesTo.includes(d)}
                          onChange={() => handleToggleDomain(d)}
                        />
                      }
                      label={d}
                    />
                  ))}
                </Stack>
              </Box>

              <FormControlLabel
                control={
                  <Checkbox
                    checked={requiresNote}
                    onChange={(e) => setRequiresNote(e.target.checked)}
                  />
                }
                label="Requires Cashier Note When Selected"
              />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                Save Reason Code
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>
    </Box>
  );
}
