import type { Dayjs } from 'dayjs';
import type { Shift, WeekHours } from 'src/utils/opening-hours';

import dayjs from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import {
  Box,
  Chip,
  Stack,
  Button,
  Switch,
  Divider,
  Popover,
  Tooltip,
  Checkbox,
  FormGroup,
  Typography,
  IconButton,
  FormControlLabel,
} from '@mui/material';

import { WEEK, weekProblems, DEFAULT_SHIFT, runsPastMidnight } from 'src/utils/opening-hours';

type BranchHoursEditorProps = {
  value: WeekHours;
  onChange: (week: WeekHours) => void;
  disabled?: boolean;
};

const toTime = (hhmm: string) => dayjs(`2000-01-01T${hhmm}`);
const fromTime = (value: Dayjs | null) => (value && value.isValid() ? value.format('HH:mm') : null);
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const hhmmOf = (total: number) => {
  const m = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * The next shift for a day. One long shift that covers the afternoon is split into lunch and
 * dinner (11:00–23:00 becomes 11:00–15:00 and 18:00–23:00), the usual reason to add one;
 * otherwise the new shift starts an hour after the last one ends and runs three hours.
 */
function withAnotherShift(shifts: Shift[]): Shift[] {
  if (!shifts.length) return [{ ...DEFAULT_SHIFT }];
  const last = shifts[shifts.length - 1];
  if (shifts.length === 1 && !runsPastMidnight(last) && minutes(last.open) < 15 * 60 && minutes(last.close) > 18 * 60) {
    return [
      { open: last.open, close: '15:00' },
      { open: '18:00', close: last.close },
    ];
  }
  const start = (runsPastMidnight(last) ? minutes(last.close) + 1440 : minutes(last.close)) + 60;
  return [...shifts, { open: hhmmOf(start), close: hhmmOf(start + 180) }];
}

/**
 * The weekly hours: each day open or closed, with one or more shifts, on a 24-hour clock. A
 * shift that closes at or before it opens runs past midnight, and says so. "Copy to" repeats
 * a day on others.
 */
export function BranchHoursEditor({ value, onChange, disabled }: BranchHoursEditorProps) {
  const { t } = useTranslation();
  const problems = weekProblems(value);
  const [copyFrom, setCopyFrom] = useState<{ day: number; anchor: HTMLElement } | null>(null);
  const [copyTo, setCopyTo] = useState<number[]>([]);

  const setDay = (day: number, shifts: Shift[]) => onChange({ ...value, [day]: shifts });
  const setShift = (day: number, index: number, change: Partial<Shift>) =>
    setDay(
      day,
      (value[day] || []).map((s, i) => (i === index ? { ...s, ...change } : s))
    );

  const applyCopy = () => {
    if (!copyFrom) return;
    const source = value[copyFrom.day] || [];
    const next = { ...value };
    for (const day of copyTo) next[day] = source.map((s) => ({ ...s }));
    onChange(next);
    setCopyFrom(null);
  };

  const timeField = (label: string, time: string, onTime: (hhmm: string) => void) => (
    <TimePicker
      ampm={false}
      disabled={disabled}
      value={toTime(time)}
      onChange={(next) => {
        const hhmm = fromTime(next as Dayjs | null);
        if (hhmm) onTime(hhmm);
      }}
      slotProps={{
        textField: { size: 'small', title: label, sx: { width: 128 } },
      }}
    />
  );

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Stack divider={<Divider flexItem />} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
        {WEEK.map(({ key, day }) => {
          const shifts = value[day] || [];
          const open = shifts.length > 0;
          const problem = problems[day];
          return (
            <Stack
              key={key}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={{ xs: 1, sm: 2 }}
              sx={{ px: 2, py: 1.5, alignItems: { sm: 'flex-start' } }}
            >
              <Stack direction="row" sx={{ alignItems: 'center', width: { sm: 190 }, flexShrink: 0, minHeight: 40 }}>
                <Typography sx={{ fontWeight: 600, flex: 1 }}>{t(`operations.branchDetail.days.${key}`, key)}</Typography>
                <FormControlLabel
                  disabled={disabled}
                  control={
                    <Switch
                      size="small"
                      checked={open}
                      onChange={(e) => setDay(day, e.target.checked ? [{ ...DEFAULT_SHIFT }] : [])}
                    />
                  }
                  label={
                    <Typography variant="body2" color={open ? 'text.primary' : 'text.secondary'}>
                      {open ? t('branchMgmt.hours.open', 'Open') : t('branchMgmt.hours.closed', 'Closed')}
                    </Typography>
                  }
                  sx={{ mr: 0 }}
                />
              </Stack>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                {open ? (
                  <Stack spacing={1}>
                    {shifts.map((shift, index) => (
                      <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        {timeField(t('branchMgmt.hours.opensAt', 'Opens at'), shift.open, (hhmm) => setShift(day, index, { open: hhmm }))}
                        <Typography color="text.secondary">–</Typography>
                        {timeField(t('branchMgmt.hours.closesAt', 'Closes at'), shift.close, (hhmm) => setShift(day, index, { close: hhmm }))}
                        {shift.open === shift.close ? (
                          <Chip size="small" label={t('branchMgmt.hours.allDay', '24 hours')} />
                        ) : (
                          runsPastMidnight(shift) && (
                            <Chip size="small" variant="outlined" label={t('branchMgmt.hours.nextDayShort', 'next day')} />
                          )
                        )}
                        {shifts.length > 1 && (
                          <Tooltip title={t('branchMgmt.hours.removeShift', 'Remove shift')}>
                            <span>
                              <IconButton
                                size="small"
                                disabled={disabled}
                                aria-label={t('branchMgmt.hours.removeShift', 'Remove shift')}
                                onClick={() => setDay(day, shifts.filter((_, i) => i !== index))}
                              >
                                <CloseIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        )}
                      </Stack>
                    ))}
                    {problem && (
                      <Typography variant="caption" color="error">
                        {problem === 'overlap'
                          ? t('branchMgmt.hours.overlap', 'Two shifts on this day overlap.')
                          : t('branchMgmt.hours.runsIntoNextDay', "The late shift runs into the next day's first shift.")}
                      </Typography>
                    )}
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                    {t('branchMgmt.hours.closedAllDay', 'Closed all day')}
                  </Typography>
                )}

                <Stack direction="row" spacing={1} sx={{ mt: 0.5, ml: -1 }}>
                  {open && (
                    <Button
                      size="small"
                      startIcon={<AddIcon />}
                      disabled={disabled}
                      onClick={() => setDay(day, withAnotherShift(shifts))}
                    >
                      {t('branchMgmt.hours.addShift', 'Add shift')}
                    </Button>
                  )}
                  <Button
                    size="small"
                    color="inherit"
                    startIcon={<ContentCopyIcon fontSize="small" />}
                    disabled={disabled}
                    onClick={(e) => {
                      setCopyFrom({ day, anchor: e.currentTarget });
                      setCopyTo([]);
                    }}
                  >
                    {t('branchMgmt.hours.copyTo', 'Copy to…')}
                  </Button>
                </Stack>
              </Box>
            </Stack>
          );
        })}

        <Popover
          open={!!copyFrom}
          anchorEl={copyFrom?.anchor}
          onClose={() => setCopyFrom(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          <Box sx={{ p: 2, width: 240 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('branchMgmt.hours.copyTitle', 'Repeat these hours on')}
            </Typography>
            <FormGroup>
              {WEEK.filter(({ day }) => day !== copyFrom?.day).map(({ key, day }) => (
                <FormControlLabel
                  key={key}
                  control={
                    <Checkbox
                      size="small"
                      checked={copyTo.includes(day)}
                      onChange={(e) => setCopyTo((prev) => (e.target.checked ? [...prev, day] : prev.filter((d) => d !== day)))}
                    />
                  }
                  label={t(`operations.branchDetail.days.${key}`, key)}
                />
              ))}
            </FormGroup>
            <Stack direction="row" spacing={1} sx={{ mt: 1, justifyContent: 'space-between' }}>
              <Button
                size="small"
                color="inherit"
                onClick={() => setCopyTo(WEEK.map((w) => w.day).filter((d) => d !== copyFrom?.day))}
              >
                {t('branchMgmt.hours.allDays', 'All days')}
              </Button>
              <Button size="small" variant="contained" disabled={!copyTo.length} onClick={applyCopy}>
                {t('branchMgmt.hours.apply', 'Apply')}
              </Button>
            </Stack>
          </Box>
        </Popover>
      </Stack>
    </LocalizationProvider>
  );
}
