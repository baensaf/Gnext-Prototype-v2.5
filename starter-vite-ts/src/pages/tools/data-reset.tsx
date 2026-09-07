import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

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
  CircularProgress,
} from '@mui/material';

import { importExportApi } from 'src/api/importExportApi';

import { Iconify } from 'src/components/iconify';

export function DataResetPage() {
  const { t } = useTranslation();

  const [openResetDialog, setOpenResetDialog] = useState(false);
  const [openSeedDialog, setOpenSeedDialog] = useState(false);
  const [openDemoResetDialog, setOpenDemoResetDialog] = useState(false);
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
      setErrorMsg(t('settings.dataResetPage.pinRequired', 'Security Manager PIN is required'));
      return;
    }
    setErrorMsg(null);
    setIsLoading(true);

    try {
      const result = await importExportApi.systemReset(pin);
      setOpenResetDialog(false);
      setPin('');
      setResetSuccess(
        t('settings.dataResetPage.resetSuccess', 'System data reset completed successfully! Tables purged: {{tables}}', {
          tables: result.resetTables.join(', '),
        })
      );
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.message || err.detail || err.message || t('settings.dataResetPage.executeError', 'Server PIN verification or data reset failed.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplySeed = async () => {
    if (!pin.trim()) {
      setErrorMsg(t('settings.dataResetPage.pinRequired', 'Security Manager PIN is required'));
      return;
    }
    setErrorMsg(null);
    setIsLoading(true);

    try {
      const result = await importExportApi.applySeedProfile(pin, selectedProfile);
      setOpenSeedDialog(false);
      setPin('');
      setResetSuccess(
        t('settings.dataResetPage.seedSuccess', 'Database seed profile "{{profile}}" applied successfully!', {
          profile: result.profile,
        })
      );
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.message || err.detail || err.message || t('settings.dataResetPage.executeError', 'Server PIN verification or seed application failed.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrepareCleanDemo = async () => {
    if (!pin.trim()) {
      setErrorMsg(t('settings.dataResetPage.pinRequired', 'Security Manager PIN is required'));
      return;
    }
    setErrorMsg(null);
    setIsLoading(true);

    try {
      const result = await importExportApi.resetAndSeedDemo(pin);
      setOpenDemoResetDialog(false);
      setPin('');
      setResetSuccess(
        t(
          'settings.dataResetPage.demoResetSuccess',
          'Clean demo is ready. Orders, KDS tickets, deliveries, and active shifts are reset to zero; {{profile}} master data is available.',
          { profile: result.seedProfile },
        ),
      );
    } catch (err: any) {
      setErrorMsg(err?.response?.data?.message || err.detail || err.message || 'Failed to prepare a clean demo.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 700 }}>
            {t('settings.dataResetPage.title', 'System Data Reset & Seed Profiles')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(
              'settings.dataResetPage.subtitle',
              'Protected Server-Side Operational Data Reset & Baseline Profile Applicator'
            )}
          </Typography>
        </Box>
        <Chip
          label={t('settings.dataResetPage.protectedBadge', 'Protected PIN Auth')}
          color="primary"
          variant="filled"
          sx={{ fontWeight: 'bold' }}
        />
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
        <Grid size={{ xs: 12 }}>
          <Card sx={{ p: 4, border: '1px solid', borderColor: 'primary.main' }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}>
              <Box>
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 1 }}>
                  <Iconify icon={"solar:restart-bold" as any} width={32} height={32} sx={{ color: 'primary.main' }} />
                  <Typography variant="h6" sx={{ fontWeight: 700 }}>Prepare a Clean Demo</Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  Clears orders, payments, KDS tickets, deliveries, shifts, and other operational queues, then re-applies the demo catalog baseline in one repeatable action.
                </Typography>
              </Box>
              <Button
                variant="contained"
                size="large"
                disabled={isLoading}
                onClick={() => { setPin(''); setOpenDemoResetDialog(true); }}
                sx={{ minWidth: 220 }}
              >
                Prepare Clean Demo
              </Button>
            </Stack>
          </Card>
        </Grid>

        {/* DATA RESET CARD */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 4, height: '100%' }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
              <Iconify icon={"solar:trash-bin-trash-bold" as any} width={32} height={32} sx={{ color: 'error.main' }} />
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {t('settings.dataResetPage.resetCardTitle', 'Transactional System Data Reset')}
              </Typography>
            </Stack>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {t(
                'settings.dataResetPage.resetCardDesc',
                'Purges operational transactional data including Order Headers, Payments, Refunds, Cash Drawer Shifts, KDS Tickets, and Audit Events while retaining core tenant and branch setup.'
              )}
            </Typography>

            <Alert severity="warning" sx={{ mb: 3 }}>
              {t(
                'settings.dataResetPage.resetCardWarning',
                'Caution: This operation is permanent and immutable. Requires server-side Security Manager PIN verification.'
              )}
            </Alert>

            <Button variant="contained" color="error" size="large" disabled={isLoading} onClick={() => { setPin(''); setOpenResetDialog(true); }}>
              {t('settings.dataResetPage.executeReset', 'Execute System Data Reset')}
            </Button>
          </Card>
        </Grid>

        {/* SEED PROFILES CARD */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 4, height: '100%' }}>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 2 }}>
              <Iconify icon={"solar:layers-bold" as any} width={32} height={32} sx={{ color: 'primary.main' }} />
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {t('settings.dataResetPage.seedCardTitle', 'Database Seed Profiles')}
              </Typography>
            </Stack>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {t(
                'settings.dataResetPage.seedCardDesc',
                'Populate fresh database instance with pre-configured operational datasets.'
              )}
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

            <Button variant="outlined" color="primary" size="large" disabled={isLoading} onClick={() => { setPin(''); setOpenSeedDialog(true); }}>
              {t('settings.dataResetPage.applySeed', 'Apply Selected Seed Profile')}
            </Button>
          </Card>
        </Grid>
      </Grid>

      <Dialog open={openDemoResetDialog} onClose={() => !isLoading && setOpenDemoResetDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Prepare a Clean Demo?</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            All current operational activity will be permanently cleared. Master configuration is retained and the demo catalog baseline is re-applied.
          </Alert>
          <TextField
            fullWidth
            type="password"
            label={t('settings.dataResetPage.pinLabel', 'Security Manager PIN')}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={isLoading}
            placeholder="2468"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDemoResetDialog(false)} disabled={isLoading}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handlePrepareCleanDemo}
            disabled={isLoading}
            startIcon={isLoading ? <CircularProgress size={18} color="inherit" /> : undefined}
          >
            {isLoading ? 'Preparing…' : 'Reset & Prepare'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* RESET CONFIRMATION DIALOG */}
      <Dialog open={openResetDialog} onClose={() => setOpenResetDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('settings.dataResetPage.dialogResetTitle', 'Authorize System Data Reset')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t(
              'settings.dataResetPage.dialogResetPrompt',
              'Enter your Manager PIN to authorize permanent operational data wipe (Demo PIN: 2468).'
            )}
          </Typography>
          <TextField
            fullWidth
            type="password"
            label={t('settings.dataResetPage.pinLabel', 'Security Manager PIN')}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={isLoading}
            placeholder="2468"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenResetDialog(false)} disabled={isLoading}>
            {t('settings.dataResetPage.cancel', 'Cancel')}
          </Button>
          <Button color="error" variant="contained" onClick={handleExecuteReset} disabled={isLoading}>
            {t('settings.dataResetPage.confirmWipe', 'Confirm & Wipe')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* SEED CONFIRMATION DIALOG */}
      <Dialog open={openSeedDialog} onClose={() => setOpenSeedDialog(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('settings.dataResetPage.dialogSeedTitle', 'Authorize Seed Profile Application')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('settings.dataResetPage.dialogSeedPrompt', 'Enter your Manager PIN to apply seed profile {{profile}}.', {
              profile: selectedProfile,
            })}
          </Typography>
          <TextField
            fullWidth
            type="password"
            label={t('settings.dataResetPage.pinLabel', 'Security Manager PIN')}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            disabled={isLoading}
            placeholder="2468"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenSeedDialog(false)} disabled={isLoading}>
            {t('settings.dataResetPage.cancel', 'Cancel')}
          </Button>
          <Button color="primary" variant="contained" onClick={handleApplySeed} disabled={isLoading}>
            {t('settings.dataResetPage.confirmSeed', 'Confirm & Apply')}
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
