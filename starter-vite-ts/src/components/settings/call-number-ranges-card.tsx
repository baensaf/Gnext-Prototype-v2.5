import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import { Card, Grid, Alert, Stack, Button, TextField, Typography, CircularProgress } from '@mui/material';

import { settingsApi } from 'src/api/settingsApi';

// ----------------------------------------------------------------------

type Channel = 'POS' | 'KIOSK' | 'ONLINE';
type Ranges = Record<Channel, { start: number; end: number }>;

/** The server's defaults (backend/src/modules/order/call-number.ts) for when head office has set none. */
const DEFAULT_RANGES: Ranges = {
  POS: { start: 100, end: 399 },
  KIOSK: { start: 400, end: 499 },
  ONLINE: { start: 500, end: 599 },
};

const CHANNELS: Array<{ key: Channel; labelKey: string; fallback: string }> = [
  { key: 'POS', labelKey: 'settings.callNumbers.pos', fallback: 'Tills' },
  { key: 'KIOSK', labelKey: 'settings.callNumbers.kiosk', fallback: 'Kiosks' },
  { key: 'ONLINE', labelKey: 'settings.callNumbers.online', fallback: 'Snappfood and online' },
];

type Props = {
  /** Only head office sets the ranges: every branch counts in the same ones. */
  editable: boolean;
};

/**
 * The short daily number each branch calls its orders by. Each channel counts in its own
 * range, starting over every business day, so a kiosk order and a till order never hold the
 * same number at once and staff can tell where an order came from.
 */
export function CallNumberRangesCard({ editable }: Props) {
  const { t } = useTranslation();
  const [ranges, setRanges] = useState<Ranges>(DEFAULT_RANGES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const scoped = await settingsApi.getScopedSettings(undefined);
      const stored = scoped.groups?.ORDER_CALL_NUMBERS?.value?.ranges || {};
      setRanges({
        POS: { ...DEFAULT_RANGES.POS, ...(stored.POS || {}) },
        KIOSK: { ...DEFAULT_RANGES.KIOSK, ...(stored.KIOSK || {}) },
        ONLINE: { ...DEFAULT_RANGES.ONLINE, ...(stored.ONLINE || {}) },
      });
    } catch (err: any) {
      setError(err.detail || err.message || t('settings.callNumbers.loadError', 'Could not load the order number ranges'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const set = (channel: Channel, field: 'start' | 'end', raw: string) => {
    setSaved(false);
    setRanges((prev) => ({ ...prev, [channel]: { ...prev[channel], [field]: parseInt(raw, 10) || 0 } }));
  };

  // A range must count upwards and must not share numbers with another channel's.
  const problem = (() => {
    const list = CHANNELS.map((c) => ({ ...ranges[c.key], key: c.key }));
    if (list.some((r) => r.start < 1 || r.end < r.start || r.end > 99999)) {
      return t('settings.callNumbers.invalid', 'Each range must start at 1 or more and end at or after its start.');
    }
    const overlap = list.some((a, i) => list.some((b, j) => i < j && a.start <= b.end && b.start <= a.end));
    return overlap ? t('settings.callNumbers.overlap', 'The ranges overlap, so two orders could get the same number.') : null;
  })();

  const handleSave = async () => {
    if (problem) return;
    setSaving(true);
    setError(null);
    try {
      await settingsApi.updateSetting('ORDER_CALL_NUMBERS', { ranges }, undefined);
      setSaved(true);
    } catch (err: any) {
      setError(err.detail || err.message || t('settings.callNumbers.saveError', 'Could not save the order number ranges'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card sx={{ p: 3, borderRadius: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 0.5 }}>
        {t('settings.callNumbers.title', 'Daily order numbers')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t(
          'settings.callNumbers.help',
          'The number printed large on kitchen chits and receipts, and called out at the counter. Each branch starts every channel again at the beginning of its range each business day; a range that runs out starts over.'
        )}
      </Typography>

      {loading ? (
        <CircularProgress size={24} />
      ) : (
        <Stack spacing={2}>
          <Grid container spacing={2}>
            {CHANNELS.map((c) => (
              <Grid key={c.key} size={{ xs: 12, md: 4 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t(c.labelKey, c.fallback)}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small"
                    type="number"
                    label={t('settings.callNumbers.from', 'From')}
                    value={ranges[c.key].start}
                    disabled={!editable}
                    onChange={(e) => set(c.key, 'start', e.target.value)}
                  />
                  <TextField
                    size="small"
                    type="number"
                    label={t('settings.callNumbers.to', 'To')}
                    value={ranges[c.key].end}
                    disabled={!editable}
                    onChange={(e) => set(c.key, 'end', e.target.value)}
                  />
                </Stack>
              </Grid>
            ))}
          </Grid>

          {!editable && (
            <Alert severity="info">{t('settings.callNumbers.headOfficeOnly', 'Head office sets these ranges for every branch.')}</Alert>
          )}
          {problem && editable && <Alert severity="warning">{problem}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          {saved && <Alert severity="success">{t('settings.callNumbers.saved', 'Order number ranges saved.')}</Alert>}

          {editable && (
            <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
              <Button variant="contained" disabled={saving || !!problem} onClick={handleSave}>
                {t('settings.callNumbers.save', 'Save number ranges')}
              </Button>
            </Stack>
          )}
        </Stack>
      )}
    </Card>
  );
}
