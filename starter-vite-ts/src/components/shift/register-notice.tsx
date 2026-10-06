import type { DeviceTerminal } from './device-terminal';

import { useTranslation } from 'react-i18next';

import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import { Card, Stack, Button, Typography } from '@mui/material';

import { useBranchContext } from 'src/contexts/branch-context';

// ----------------------------------------------------------------------

type Props = {
  terminal: DeviceTerminal | null;
  mismatch: boolean;
  terminalBranchName?: string;
  branchName?: string;
  onSetup: () => void;
};

/**
 * What stands in for the drawer when this device cannot open one: it is not set up as a
 * register yet, or it is set up as a register in a different branch from the one on screen.
 * Returns nothing when the device is ready.
 */
export function RegisterNotice({ terminal, mismatch, terminalBranchName, branchName, onSetup }: Props) {
  const { t } = useTranslation();
  const { canChangeScope, setSelectedBranchId } = useBranchContext();

  if (terminal && !mismatch) return null;

  return (
    <Card sx={{ borderRadius: 3, p: 4, textAlign: 'center' }}>
      <Stack spacing={2} sx={{ alignItems: 'center' }}>
        <PointOfSaleIcon color="disabled" sx={{ fontSize: 48 }} />
        {!terminal ? (
          <>
            <Typography variant="h6">{t('shift.device.notSetUp', 'This device is not set up as a register')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('shift.device.notSetUpHelp', 'Choose which of the {{branch}} registers this is, once. Shifts then open on it without asking.', {
                branch: branchName || '',
              })}
            </Typography>
            <Button variant="contained" onClick={onSetup}>
              {t('shift.device.title', 'Set up this register')}
            </Button>
          </>
        ) : (
          <>
            <Typography variant="h6">
              {t('shift.device.mismatch', 'This device is {{register}} at {{branch}}', {
                register: `${terminal.name} (${terminal.code})`,
                branch: terminalBranchName || '',
              })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('shift.device.mismatchHelp', 'You are working in {{current}}. A drawer can only be opened in the branch it stands in.', {
                current: branchName || '',
              })}
            </Typography>
            <Stack direction="row" spacing={1.5}>
              {canChangeScope && terminalBranchName && (
                <Button variant="contained" onClick={() => setSelectedBranchId(terminal.branch_id)}>
                  {t('shift.device.switchTo', 'Work in {{branch}}', { branch: terminalBranchName })}
                </Button>
              )}
              <Button variant="outlined" onClick={onSetup}>
                {t('shift.device.change', 'Set up as a {{branch}} register', { branch: branchName || '' })}
              </Button>
            </Stack>
          </>
        )}
      </Stack>
    </Card>
  );
}
