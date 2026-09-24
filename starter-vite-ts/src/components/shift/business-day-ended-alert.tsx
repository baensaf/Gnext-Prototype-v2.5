import type { RegisterShiftState } from './use-register-shift';

import { useTranslation } from 'react-i18next';

import { Alert, AlertTitle } from '@mui/material';

import { fDate } from 'src/utils/format-time';

// ----------------------------------------------------------------------

type Props = {
  register: Pick<RegisterShiftState, 'shift' | 'businessDay' | 'dayEnded'>;
  /** Shown beside the message: usually the button that opens the close dialog. */
  action?: React.ReactNode;
};

/**
 * Says so when the shift open at this register belongs to a business day that has ended. After
 * the cutoff the server refuses new sales on it: the drawer is counted and closed, and a new
 * shift opened on the new day. Nobody has to close the business day itself first.
 */
export function BusinessDayEndedAlert({ register, action }: Props) {
  const { t } = useTranslation();
  if (!register.dayEnded || !register.shift || !register.businessDay) return null;

  return (
    <Alert severity="warning" sx={{ mb: 2.5 }} action={action}>
      <AlertTitle>{t('shift.dayEnded.title', 'This shift’s business day has ended')}</AlertTitle>
      {t(
        'shift.dayEnded.body',
        'Shift {{shift}} belongs to {{shiftDate}}, which ended at {{cutoff}}. Count and close it, then open a new shift on {{today}} to keep selling.',
        {
          shift: register.shift.shift_number || '',
          shiftDate: fDate(register.shift.business_date),
          cutoff: register.businessDay.cutoff,
          today: fDate(register.businessDay.businessDate),
        }
      )}
    </Alert>
  );
}
