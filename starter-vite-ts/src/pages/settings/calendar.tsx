import type { CalendarSystem } from 'src/utils/calendar';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import SaveIcon from '@mui/icons-material/Save';
import EventIcon from '@mui/icons-material/Event';
import { Box, Card, Stack, Alert, Button, MenuItem, TextField, Typography, CircularProgress } from '@mui/material';

import { useCalendarStore, formatCalendarDateTime } from 'src/utils/calendar';

import { settingsApi } from 'src/api/settingsApi';
import { useAuthStore } from 'src/store/useAuthStore';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

// Values are JavaScript's day numbers, listed from the Iranian week's first day.
const WEEK_DAYS = [6, 0, 1, 2, 3, 4, 5];

/**
 * The chain's calendar: Jalali or Gregorian for every date on screen, in the date pickers and
 * on printed bills, and the day a week starts on. Head office decides it once for all
 * branches; dates are always read on Tehran's clock.
 */
export function CalendarSettingsPage() {
  const { t } = useTranslation();
  const isHeadOffice = useAuthStore((state) => state.user?.isHeadOffice) !== false;
  const applyCalendar = useCalendarStore((state) => state.setCalendar);

  const [calendar, setCalendar] = useState<CalendarSystem>('JALALI');
  const [weekStartsOn, setWeekStartsOn] = useState(6);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const value = (await settingsApi.getSettings())?.CALENDAR || {};
      setCalendar(value.calendar === 'GREGORIAN' ? 'GREGORIAN' : 'JALALI');
      setWeekStartsOn(Number.isInteger(value.weekStartsOn) ? value.weekStartsOn : 6);
    } catch (err: any) {
      setError(err.detail || err.message || t('settings.calendar.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const value = { calendar, weekStartsOn };
      await settingsApi.updateSetting('CALENDAR', value);
      applyCalendar(value);
      setSuccess(t('settings.calendar.saveSuccess'));
    } catch (err: any) {
      setError(err.detail || err.message || t('settings.calendar.saveError'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('settings.calendar.title')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.calendar.title') },
        ]}
      />

      {!isHeadOffice && (
        <Alert severity="info" sx={{ mb: 3 }}>
          {t('settings.calendar.headOfficeOnly')}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <form onSubmit={handleSave}>
        <Card sx={{ p: 3, borderRadius: 2, maxWidth: 720 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
            <EventIcon color="primary" />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              {t('settings.calendar.cardTitle')}
            </Typography>
          </Stack>

          <Stack spacing={3}>
            <TextField
              select
              fullWidth
              disabled={!isHeadOffice}
              label={t('settings.calendar.calendarLabel')}
              value={calendar}
              onChange={(e) => setCalendar(e.target.value as CalendarSystem)}
              helperText={t('settings.calendar.calendarHelp')}
            >
              <MenuItem value="JALALI">{t('settings.calendar.jalali')}</MenuItem>
              <MenuItem value="GREGORIAN">{t('settings.calendar.gregorian')}</MenuItem>
            </TextField>

            <TextField
              select
              fullWidth
              disabled={!isHeadOffice}
              label={t('settings.calendar.weekStartLabel')}
              value={weekStartsOn}
              onChange={(e) => setWeekStartsOn(Number(e.target.value))}
            >
              {WEEK_DAYS.map((day) => (
                <MenuItem key={day} value={day}>
                  {t(`settings.calendar.days.${day}`)}
                </MenuItem>
              ))}
            </TextField>

            <Alert severity="info">
              {t('settings.calendar.clockNotice', { now: formatCalendarDateTime(new Date()) })}
            </Alert>
          </Stack>
        </Card>

        {isHeadOffice && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3, maxWidth: 720 }}>
            <Button type="submit" variant="contained" size="large" startIcon={<SaveIcon />} disabled={saving}>
              {saving ? t('common.saving', 'Saving...') : t('common.save', 'Save')}
            </Button>
          </Box>
        )}
      </form>
    </Box>
  );
}
