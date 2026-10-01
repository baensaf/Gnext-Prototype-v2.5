import type { Shift, WeekHours } from 'src/utils/opening-hours';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  Box,
  Chip,
  Stack,
  Button,
  Switch,
  Divider,
  Popover,
  Checkbox,
  FormGroup,
  TextField,
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

/**
 * The weekly hours: each day open or closed, with one or more shifts. A shift that closes at
 * or before it opens runs past midnight, and says so. "Copy to" repeats a day on others.
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

  const addShift = (day: number) => {
    const shifts = value[day] || [];
    const last = shifts[shifts.length - 1];
    // A second shift starts where the first ends, an hour later: lunch, then dinner.
    const next = last ? { open: last.close, close: last.close < '22:00' ? '23:00' : '00:00' } : { ...DEFAULT_SHIFT };
    setDay(day, [...shifts, next]);
  };

  const applyCopy = () => {
    if (!copyFrom) return;
    const source = value[copyFrom.day] || [];
    const next = { ...value };
    for (const day of copyTo) next[day] = source.map((s) => ({ ...s }));
    onChange(next);
    setCopyFrom(null);
  };

  return (
    <Stack divider={<Divider flexItem />} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
      {WEEK.map(({ key, day }) => {
        const shifts = value[day] || [];
        const open = shifts.length > 0;
        const problem = problems[day];
        return (
          <Stack
            key={key}
            direction={{ xs: 'column', md: 'row' }}
            spacing={{ xs: 1, md: 2 }}
            sx={{ px: 2, py: 1.5, alignItems: { md: 'flex-start' } }}
          >
            <Stack direction="row" sx={{ alignItems: 'center', width: { md: 220 }, flexShrink: 0 }}>
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
                    <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                      <TextField
                        type="time"
                        size="small"
                        disabled={disabled}
                        value={shift.open}
                        onChange={(e) => setShift(day, index, { open: e.target.value })}
                        slotProps={{ htmlInput: { 'aria-label': t('branchMgmt.hours.opensAt', 'Opens at') } }}
                        sx={{ width: 130 }}
                      />
                      <Typography color="text.secondary">–</Typography>
                      <TextField
                        type="time"
                        size="small"
                        disabled={disabled}
                        value={shift.close}
                        onChange={(e) => setShift(day, index, { close: e.target.value })}
                        slotProps={{ htmlInput: { 'aria-label': t('branchMgmt.hours.closesAt', 'Closes at') } }}
                        sx={{ width: 130 }}
                      />
                      {shift.open === shift.close ? (
                        <Chip size="small" label={t('branchMgmt.hours.allDay', '24 hours')} />
                      ) : (
                        runsPastMidnight(shift) && (
                          <Chip size="small" variant="outlined" label={t('branchMgmt.hours.nextDay', 'closes next day')} />
                        )
                      )}
                      {shifts.length > 1 && (
                        <IconButton
                          size="small"
                          disabled={disabled}
                          aria-label={t('branchMgmt.hours.removeShift', 'Remove shift')}
                          onClick={() => setDay(day, shifts.filter((_, i) => i !== index))}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
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
            </Box>

            <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
              {open && (
                <Button size="small" startIcon={<AddIcon />} disabled={disabled} onClick={() => addShift(day)}>
                  {t('branchMgmt.hours.addShift', 'Add shift')}
                </Button>
              )}
              <Button
                size="small"
                color="inherit"
                startIcon={<ContentCopyIcon />}
                disabled={disabled}
                onClick={(e) => {
                  setCopyFrom({ day, anchor: e.currentTarget });
                  setCopyTo([]);
                }}
              >
                {t('branchMgmt.hours.copyTo', 'Copy to…')}
              </Button>
            </Stack>
          </Stack>
        );
      })}

      <Popover
        open={!!copyFrom}
        anchorEl={copyFrom?.anchor}
        onClose={() => setCopyFrom(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
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
  );
}
