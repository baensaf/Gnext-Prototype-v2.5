import { useEffect } from 'react';

import { useCalendarStore } from 'src/utils/calendar';

import { settingsApi } from 'src/api/settingsApi';
import { useAuthStore } from 'src/store/useAuthStore';

// ----------------------------------------------------------------------

/**
 * Loads head office's CALENDAR setting once someone is signed in. Until it arrives (and when
 * nobody has set it) the app shows Jalali dates with a Saturday week start.
 */
export function CalendarSync() {
  const tenantId = useAuthStore((state) => state.user?.tenantId);
  const setCalendar = useCalendarStore((state) => state.setCalendar);

  useEffect(() => {
    if (!tenantId) return;
    settingsApi
      .getSettings()
      .then((settings) => setCalendar(settings?.CALENDAR))
      .catch(() => setCalendar(null));
  }, [tenantId, setCalendar]);

  return null;
}
