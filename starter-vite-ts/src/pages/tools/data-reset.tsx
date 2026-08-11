import { useState, useEffect } from 'react';

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
  LinearProgress,
} from '@mui/material';

import { importExportApi } from 'src/api/importExportApi';

import { Iconify } from 'src/components/iconify';

export function DataResetPage() {
  const [openResetDialog, setOpenResetDialog] = useState(false);
  const [openSeedDialog, setOpenSeedDialog] = useState(false);
  const [pin, setPin] = useState('');
  const [resetSuccess, setResetSuccess] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [profiles, setProfiles] = useState<Array<{ id: string; name: string; description: string }>>([
    { id: 'MINIMAL', name: 'Minimal Base Profile', description: 'Single tenant, master branch, base currency.' },
    { id: 'DEMO_RESTAURANT', name: 'Demo Restaurant & Quick Service', description: 'Full menu, categories, pricing.' },
  ]);
  const [selectedProfile, setSelectedProfile] = useState('MINIMAL');

  useEffect(() => {
    importExportApi.getSeedProfiles().then((p) => {
      if (p && p.length > 0) setProfiles(p);
    }).catch(() => {});
  }, []);

  const handleExecuteReset = async () => {
    if (!pin.trim()) {
      setErrorMsg('Security Manager PIN is required');
      return;
    }
    setErrorMsg(null);
    setIsLoading(true);

    try {
      const result = await importExportApi.systemReset(pin);
      setOpenResetDialog(false);
      setPin('');
      setResetSuccess(`System data reset completed successfully! Tables purged: ${result.resetTables.join(', ')}`);
    } catch (err: any) {
      setErrorMsg(err.detail || err.message || 'Server PIN verification or data reset failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplySeed = async () => {
    if (!pin.trim()) {
      setErrorMsg('Security Manager PIN is required');
      return;
    }
    setErrorMsg(null);
    setIsLoading(true);

    try {
      const result = await importExportApi.applySeedProfile(pin, selectedProfile);
      setOpenSeedDialog(false);
      setPin('');
      setResetSuccess(`Database seed profile "${result.profile}" applied successfully!`);
    } catch (err: any) {
      setErrorMsg(err.detail || err.message || 'Server PIN verification or seed application failed.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            System Data Reset & Seed Profiles
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Protected Server-Side Operational Data Reset & Baseline Profile Applicator
          </Typography>
        </Box>
        <Chip label="Protected PIN Auth" color="primary" variant="filled" sx={{ fontWeight: 'bold' }} />
      </Stack>

      {resetSuccess && (
        <Alert severity="success" sx={{ mb: 4 }} onClose={() => setResetSuccess(null)}>
          {resetSuccess}
        </Alert>
      )}

      {errorMsg && (
        <Alert severity="error" sx={{ mb: 4 }} onClose={() => setErrorMsg(null)}>
          {errorMsg}
        </Alert>
      )}

      {isLoading && <LinearProgress sx={{ mb: 3 }} />}

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
              Purges operational transactional data including <strong>Order Headers, Payments, Refunds, Cash Drawer Shifts, KDS Tickets, and Audit Events</strong> while retaining core tenant and branch setup.
            </Typography>

            <Alert severity="warning" sx={{ mb: 3 }}>
              <strong>Caution:</strong> This operation is permanent and immutable. Requires server-side Security Manager PIN verification.
            </Alert>

            <Button variant="contained" color="error" size="large" onClick={() => { setPin(''); setOpenResetDialog(true); }}>
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
              {profiles.map((prof) => (
                <Paper
                  key={prof.id}
                  variant="outlined"
                  onClick={() => setSelectedProfile(prof.id)}
                  sx={{
                    p: 2,
                    cursor: 'pointer',
                    borderColor: selectedProfile === prof.id ? 'primary.main' : 'divider',
                    bgcolor: selectedProfile === prof.id ? 'primary.lighter' : 'background.paper',
                  }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {prof.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {prof.description}
                  </Typography>
                </Paper>
              ))}
            </Stack>

            <Button variant="outlined" color="primary" size="large" onClick={() => { setPin(''); setOpenSeedDialog(true); }}>
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
            Enter your Manager PIN to authorize permanent operational data wipe.
          </Typography>
          <TextField
            fullWidth
            type="password"
            label="Security Manager PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={isLoading}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenResetDialog(false)} disabled={isLoading}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleExecuteReset} disabled={isLoading}>
            Confirm & Wipe
          </Button>
        </DialogActions>
      </Dialog>

      {/* SEED CONFIRMATION DIALOG */}
      <Dialog open={openSeedDialog} onClose={() => setOpenSeedDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Authorize Seed Profile Application</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Enter your Manager PIN to apply seed profile <strong>{selectedProfile}</strong>.
          </Typography>
          <TextField
            fullWidth
            type="password"
            label="Security Manager PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={isLoading}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenSeedDialog(false)} disabled={isLoading}>Cancel</Button>
          <Button color="primary" variant="contained" onClick={handleApplySeed} disabled={isLoading}>
            Confirm & Apply
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
