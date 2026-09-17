import type { Dayjs } from 'dayjs';
import type { Theme, SxProps } from '@mui/material/styles';

import dayjs from 'dayjs';
import { useTranslation } from 'react-i18next';
import { enUS as jalaliEnUS } from 'date-fns-jalali/locale/en-US';
import { faIR as jalaliFaIR } from 'date-fns-jalali/locale/fa-IR';

import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFnsJalali } from '@mui/x-date-pickers/AdapterDateFnsJalali';

import { useCalendarStore } from 'src/utils/calendar';

// ----------------------------------------------------------------------

type Props = {
  label?: React.ReactNode;
  /** The API's business day, YYYY-MM-DD (always Gregorian), or '' for none. */
  value: string;
  /** Shaped like a text input's change event, so it drops in where `type="date"` fields were. */
  onChange: (event: { target: { value: string } }) => void;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  required?: boolean;
  disabled?: boolean;
  helperText?: React.ReactNode;
  sx?: SxProps<Theme>;
  /** Accepted for drop-in use and ignored: the picker's label always sits above its value. */
  slotProps?: unknown;
};

const pad = (n: number) => String(n).padStart(2, '0');

// The locale's narrow day names come out as "۱ش", "۲ش"… and MUI keeps only their first
// character. These are the letters an Iranian calendar prints, by JavaScript day number.
const WEEKDAY_LETTERS: Record<'fa' | 'en', string[]> = {
  fa: ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش'],
  en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
};

/**
 * A date input in the chain's calendar: a Jalali picker unless head office chose Gregorian,
 * with Saturday starting the week. Whatever the calendar, it reads and writes the API's
 * Gregorian YYYY-MM-DD, so the pages and the server never convert.
 */
export function CalendarDateField({ label, value, onChange, size, fullWidth, required, disabled, helperText, sx }: Props) {
  const { i18n } = useTranslation();
  const { calendar, weekStartsOn } = useCalendarStore();
  const emit = (next: string) => onChange({ target: { value: next } });
  const textField = { size, fullWidth, required, helperText, sx };

  if (calendar === 'JALALI') {
    const persian = i18n.language?.startsWith('fa');
    const base = persian ? jalaliFaIR : jalaliEnUS;
    const locale = { ...base, options: { ...base.options, weekStartsOn: weekStartsOn as 0 | 1 | 2 | 3 | 4 | 5 | 6 } };
    const [y, m, d] = value ? value.split('-').map(Number) : [];
    // Noon, so no time zone can move the picked day.
    const current = value ? new Date(y, m - 1, d, 12) : null;
    return (
      <LocalizationProvider dateAdapter={AdapterDateFnsJalali} adapterLocale={locale}>
        <DatePicker
          label={label}
          value={current}
          disabled={disabled}
          dayOfWeekFormatter={(day) => WEEKDAY_LETTERS[persian ? 'fa' : 'en'][(day as Date).getDay()]}
          onChange={(picked) => {
            const at = picked as Date | null;
            emit(at && !Number.isNaN(at.getTime()) ? `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` : '');
          }}
          slotProps={{ textField }}
        />
      </LocalizationProvider>
    );
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <DatePicker
        label={label}
        value={value ? dayjs(value) : null}
        disabled={disabled}
        format="YYYY/MM/DD"
        onChange={(picked) => {
          const at = picked as Dayjs | null;
          emit(at && at.isValid() ? at.format('YYYY-MM-DD') : '');
        }}
        slotProps={{ textField }}
      />
    </LocalizationProvider>
  );
}
