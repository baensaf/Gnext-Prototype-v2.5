import { useTranslation } from 'react-i18next';

import { Alert } from '@mui/material';
import ScheduleIcon from '@mui/icons-material/Schedule';

import { useBranchContextOptional } from 'src/contexts/branch-context';

import { describeOpenStatus, useBranchOpenStatus } from 'src/components/branch';

/**
 * Outside its opening hours the branch still sells (as at Toast): the till only says so. The
 * order is marked after hours on the server as it is sent. No extra click for the cashier.
 */
export function ClosedBranchBanner() {
  const { t } = useTranslation();
  const branch = useBranchContextOptional()?.selectedBranch ?? null;
  const status = useBranchOpenStatus(branch?.id, branch?.time_zone);
  if (!status || status.open) return null;
  return (
    <Alert severity="warning" icon={<ScheduleIcon />} sx={{ mb: 2.5, py: 0.25 }}>
      <strong>{describeOpenStatus(status, t)}</strong>
      {' — '}
      {t('branchMgmt.pos.stillSells', 'You can still take orders; they are marked after hours.')}
    </Alert>
  );
}
