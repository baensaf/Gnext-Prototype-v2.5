import { useEffect } from 'react';

import { useCalendarStore } from 'src/utils/calendar';

import { settingsApi } from 'src/api/settingsApi';
import { useAuthStore } from 'src/store/useAuthStore';

// ----------------------------------------------------------------------

/**
 * Loads head office's CALENDAR setting, and the business day's cutoff, once someone is signed
 * in. Until they arrive (and when nobody has set them) the app shows Jalali dates with a
 * Saturday week start, and starts its day at 04:00.
 */
export function CalendarSync() {
  const tenantId = useAuthStore((state) => state.user?.tenantId);
  const setCalendar = useCalendarStore((state) => state.setCalendar);
  const setBusinessDay = useCalendarStore((state) => state.setBusinessDay);

  useEffect(() => {
    if (!tenantId) return;
    settingsApi
      .getSettings()
      .then((settings) => {
        setCalendar(settings?.CALENDAR);
        setBusinessDay(settings?.BUSINESS_DAY);
      })
      .catch(() => {
        setCalendar(null);
        setBusinessDay(null);
      });
  }, [tenantId, setCalendar, setBusinessDay]);

  return null;
}
