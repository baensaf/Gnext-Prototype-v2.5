import { useTranslation } from 'react-i18next';

import { Typography } from '@mui/material';

import { numberToWords } from 'src/utils/number-to-words';

/** The amount under a price box, written out in the interface language, in rials. */
export function AmountInWords({ amount }: { amount: string | number | null | undefined }) {
  const { t, i18n } = useTranslation();
  const value = Number(amount);
  if (amount === '' || amount === null || amount === undefined || !Number.isFinite(value) || value <= 0) return null;
  const words = numberToWords(value, i18n.language?.startsWith('fa') ? 'fa' : 'en');
  if (!words) return null;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
      {t('common.amountInWords', { defaultValue: '{{words}} rials', words })}
    </Typography>
  );
}
