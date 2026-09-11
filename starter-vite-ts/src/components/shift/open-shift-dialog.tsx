import type { CashierShift } from 'src/api/shiftApi';
import type { DeviceTerminal } from './device-terminal';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import LockOpenIcon from '@mui/icons-material/LockOpen';
import {
  Box,
  Alert,
  Stack,
  Button,
  Dialog,
  TextField,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';

import { shiftApi } from 'src/api/shiftApi';

// ----------------------------------------------------------------------

type Props = {
  open: boolean;
  onClose: () => void;
  /** The register being opened. Its branch is the shift's branch; nobody picks either. */
  terminal: DeviceTerminal;
  branchName?: string;
  defaultFloat: string;
  onOpened: (shift: CashierShift) => void;
};

/** Counting the float into a drawer. The only thing asked is how much went in. */
export function OpenShiftDialog({ open, onClose, terminal, branchName, defaultFloat, onOpened }: Props) {
  const { t } = useTranslation();
  const [openingFloat, setOpeningFloat] = useState(defaultFloat);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setOpeningFloat(defaultFloat);
      setError(null);
    }
  }, [open, defaultFloat]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const shift = await shiftApi.openShift({ terminalId: terminal.id, openingCash: openingFloat || '0' });
      onOpened(shift);
      onClose();
    } catch (err: any) {
      setError(err.detail || err.message || t('shift.open.error', 'Could not open the shift'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 'bold' }}>{t('shift.open.title', 'Open shift')}</DialogTitle>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent>
          <Stack spacing={2}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                {t('shift.register', 'Register')}
              </Typography>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {terminal.name} ({terminal.code})
              </Typography>
              {branchName && (
                <Typography variant="body2" color="text.secondary">
                  {branchName}
                </Typography>
              )}
            </Box>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label={t('shift.open.float', 'Opening float (IRR)')}
              helperText={t('shift.open.floatHelp', 'The cash counted into the drawer before the first sale.')}
              type="number"
              required
              fullWidth
              autoFocus
              value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)}
              slotProps={{ htmlInput: { min: 0, dir: 'ltr' } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={submitting}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            type="submit"
            variant="contained"
            color="success"
            startIcon={<LockOpenIcon />}
            disabled={submitting}
          >
            {t('shift.open.confirm', 'Open shift')}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
