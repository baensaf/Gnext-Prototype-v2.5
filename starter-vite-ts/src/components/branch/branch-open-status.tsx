import type { TFunction } from 'i18next';
import type { OpenStatus } from 'src/utils/opening-hours';
import type { BranchOperatingHour } from 'src/api/tenantApi';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { Chip } from '@mui/material';

import { openStatus } from 'src/utils/opening-hours';

import { tenantApi } from 'src/api/tenantApi';

/** "Open until 02:00", "Open 24 hours" or "Closed · opens Sat 11:00". */
export function describeOpenStatus(status: OpenStatus, t: TFunction): string {
  if (status.open) {
    return status.until
      ? t('branchMgmt.status.openUntil', { defaultValue: 'Open until {{time}}', time: status.until })
      : t('branchMgmt.status.openAllDay', 'Open 24 hours');
  }
  if (!status.opensDay) return t('branchMgmt.status.closedAlways', 'Closed every day');
  return t('branchMgmt.status.closedOpens', {
    defaultValue: 'Closed · opens {{day}} {{time}}',
    day: t(`branchMgmt.shortDays.${status.opensDay}`, status.opensDay),
    time: status.opensAt,
  });
}

/**
 * Whether a branch is open now, by its weekly hours on its own clock. Re-read every minute.
 * `rows` may be given when the page already has them; otherwise they are fetched.
 */
export function useBranchOpenStatus(branchId: string | null | undefined, timeZone?: string, rows?: BranchOperatingHour[]) {
  const [fetched, setFetched] = useState<BranchOperatingHour[] | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (rows || !branchId) return undefined;
    let live = true;
    tenantApi
      .getBranchHours(branchId)
      .then((list) => live && setFetched(list))
      .catch(() => live && setFetched(null));
    return () => {
      live = false;
    };
  }, [branchId, rows]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const hours = rows ?? fetched;
  return hours ? openStatus(hours, timeZone || 'Asia/Tehran', now) : null;
}

/** A small chip with the branch's open state. */
export function BranchOpenChip({ status }: { status: OpenStatus | null }) {
  const { t } = useTranslation();
  if (!status) return null;
  return (
    <Chip
      size="small"
      color={status.open ? 'success' : 'default'}
      variant={status.open ? 'filled' : 'outlined'}
      label={describeOpenStatus(status, t)}
    />
  );
}
