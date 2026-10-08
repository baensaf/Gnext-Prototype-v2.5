import type { OnlinePlatformStatus } from 'src/api/onlineOrdersApi';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import Chip from '@mui/material/Chip';
import Menu from '@mui/material/Menu';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';

import { onlineOrdersApi } from 'src/api/onlineOrdersApi';

import { toast } from 'src/components/snackbar';

import { clockTime } from './online-helpers';

// ----------------------------------------------------------------------

type Props = {
  branchId: string;
  status: OnlinePlatformStatus;
  onChanged: () => void;
};

const BUSY_MINUTES = [15, 30, 60];

/**
 * Whether a platform is sending this branch orders, and the switch to stop it for a while when
 * the kitchen is swamped. A pause lifts by itself; "closed for today" lifts at the day's end.
 */
export function PlatformStatus({ branchId, status, onChanged }: Props) {
  const { t, i18n } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const platform = t(`online.platform.${status.platform}`);
  const paused = !!status.pausedUntil;

  const change = async (minutes: number | 'TODAY') => {
    setAnchor(null);
    setBusy(true);
    try {
      const [next] = (await onlineOrdersApi.pause(branchId, status.platform, minutes)).filter((s) => s.platform === status.platform);
      if (next?.pausedUntil) {
        toast.success(t('online.pause.done', { platform, time: clockTime(next.pausedUntil, i18n.language) }));
      } else {
        toast.success(t('online.pause.resumed', { platform }));
      }
      onChanged();
    } catch (err: any) {
      toast.error(err?.detail || t('online.pause.failed', { platform }));
    } finally {
      setBusy(false);
    }
  };

  const label = paused
    ? t('online.status.paused', { platform, time: clockTime(status.pausedUntil!, i18n.language) })
    : t('online.status.open', { platform });

  return (
    <>
      <Chip
        size="small"
        color={paused ? 'warning' : 'success'}
        variant={paused ? 'filled' : 'outlined'}
        label={label}
        disabled={busy || !status.capabilities.pause}
        onClick={status.capabilities.pause ? (e) => setAnchor(e.currentTarget) : undefined}
        onDelete={status.capabilities.pause ? (e) => setAnchor((e.currentTarget as HTMLElement).parentElement) : undefined}
        deleteIcon={<ArrowDropDownIcon />}
      />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {BUSY_MINUTES.map((m) => (
          <MenuItem key={m} onClick={() => change(m)}>
            {t('online.pause.busy', { count: m })}
          </MenuItem>
        ))}
        <MenuItem onClick={() => change('TODAY')}>{t('online.pause.today')}</MenuItem>
        {paused && <Divider />}
        {paused && <MenuItem onClick={() => change(0)}>{t('online.pause.resume')}</MenuItem>}
      </Menu>
    </>
  );
}
