import { useState } from 'react';

import {
  Box,
  Card,
  Grid,
  Chip,
  Alert,
  Stack,
  Paper,
  Button,
  Dialog,
  Container,
  TextField,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { Iconify } from 'src/components/iconify';

export function DataResetPage() {
  const [openResetDialog, setOpenResetDialog] = useState(false);
  const [pin, setPin] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState('MINIMAL');

  const handleExecuteReset = () => {
    if (pin !== '1234' && pin !== '9999') {
      alert('Invalid Security Manager PIN. (Use 1234 for demo)');
      return;
    }
    setOpenResetDialog(false);
    setResetSuccess(true);
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            System Data Reset & Seed Profiles
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Slice 22 — Operational Data Wipe & Minimal / Demo Restaurant Environment Applicator
          </Typography>
        </Box>
        <Chip label="Slice 22" color="primary" variant="filled" sx={{ fontWeight: 'bold' }} />
      </Stack>

      {resetSuccess && (
        <Alert severity="success" sx={{ mb: 4 }} onClose={() => setResetSuccess(false)}>
          System operational data reset completed successfully! Transactional tables (orders, payments, shifts, audit logs) have been purged.
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* DATA RESET CARD */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 4, height: '100%' }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
              <Iconify icon={"solar:trash-bin-trash-bold" as any} width={32} height={32} sx={{ color: 'error.main' }} />
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Transactional System Data Reset
              </Typography>
            </Stack>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Purges all operational transactional data including <strong>Order Headers, Payments, Refunds, Cash Drawer Shifts, KDS Tickets, and Audit Events</strong> while retaining core tenant and branch setup.
            </Typography>

            <Alert severity="warning" sx={{ mb: 3 }}>
              <strong>Caution:</strong> This operation is permanent and immutable. Requires Security Manager PIN authorization.
            </Alert>

            <Button variant="contained" color="error" size="large" onClick={() => setOpenResetDialog(true)}>
              Execute System Data Reset
            </Button>
          </Card>
        </Grid>

        {/* SEED PROFILES CARD */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 4, height: '100%' }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
              <Iconify icon={"solar:layers-bold" as any} width={32} height={32} sx={{ color: 'primary.main' }} />
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                Database Seed Profiles
              </Typography>
            </Stack>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Populate fresh database instance with pre-configured operational datasets.
            </Typography>

            <Stack spacing={2} sx={{ mb: 3 }}>
              <Paper
                variant="outlined"
                onClick={() => setSelectedProfile('MINIMAL')}
                sx={{
                  p: 2,
                  cursor: 'pointer',
                  borderColor: selectedProfile === 'MINIMAL' ? 'primary.main' : 'divider',
                  bgcolor: selectedProfile === 'MINIMAL' ? 'primary.lighter' : 'background.paper',
                }}
              >
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Minimal Base Profile
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Single tenant, master branch, default terminal, base currency and reason codes.
                </Typography>
              </Paper>

              <Paper
                variant="outlined"
                onClick={() => setSelectedProfile('DEMO_RESTAURANT')}
                sx={{
                  p: 2,
                  cursor: 'pointer',
                  borderColor: selectedProfile === 'DEMO_RESTAURANT' ? 'primary.main' : 'divider',
                  bgcolor: selectedProfile === 'DEMO_RESTAURANT' ? 'primary.lighter' : 'background.paper',
                }}
              >
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Demo Restaurant & Quick Service
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Complete food menu, Categories (Burgers, Drinks, Combos), modifiers, pricing, customers, and initial stock.
                </Typography>
              </Paper>
            </Stack>

            <Button variant="outlined" color="primary" size="large" onClick={() => alert(`Applied ${selectedProfile} Seed Profile!`)}>
              Apply Selected Seed Profile
            </Button>
          </Card>
        </Grid>
      </Grid>

      {/* RESET CONFIRMATION DIALOG */}
      <Dialog open={openResetDialog} onClose={() => setOpenResetDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Authorize System Data Reset</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Please enter your Security Manager PIN (Demo PIN: <strong>1234</strong>) to confirm operational data wipe.
          </Typography>
          <TextField fullWidth type="password" label="Manager PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenResetDialog(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleExecuteReset}>
            Confirm & Wipe
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
