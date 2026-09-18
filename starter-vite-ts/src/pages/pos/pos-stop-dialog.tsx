import type { Product, ProductVariant, ProductAvailability } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import {
  Chip,
  Stack,
  Alert,
  Radio,
  Button,
  Dialog,
  Select,
  MenuItem,
  TextField,
  Typography,
  InputLabel,
  RadioGroup,
  DialogTitle,
  FormControl,
  DialogActions,
  DialogContent,
  FormControlLabel,
} from '@mui/material';

import { fDateTime } from 'src/utils/format-time';

import { catalogApi } from 'src/api/catalogApi';
import { useAuthStore } from 'src/store/useAuthStore';
import { isApproverRole } from 'src/config/role-access';

/** The reasons a register picks from; OTHER asks for a few words. */
export const STOP_REASONS = ['SOLD_OUT', 'INGREDIENT_MISSING', 'EQUIPMENT_DOWN', 'QUALITY', 'OTHER'] as const;

const WHOLE = '';

type Props = {
  product: Product | null;
  branchId: string | null;
  /** Stops at this branch and chain-wide ones, as the register already holds them. */
  availabilities: ProductAvailability[];
  onClose: () => void;
  /** After a stop or a resume, so the grid can refresh. */
  onDone: (message: string) => void;
};

const isLive = (a: ProductAvailability) => a.is_suspended && (!a.suspended_until || new Date(a.suspended_until) > new Date());

/**
 * 86 an item from its tile: the whole product or one size, until the next shift (anyone,
 * with a reason) or until further notice (an approver, or anyone with an approver's pin).
 * An item already off here can be put back the same way; one head office stopped at every
 * branch cannot be put back from a register.
 */
export function PosStopDialog({ product, branchId, availabilities, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const approver = isApproverRole(useAuthStore((state) => state.user?.role));
  const [sizes, setSizes] = useState<ProductVariant[]>([]);
  const [variantId, setVariantId] = useState(WHOLE);
  const [reason, setReason] = useState<(typeof STOP_REASONS)[number] | ''>('');
  const [otherText, setOtherText] = useState('');
  const [until, setUntil] = useState<'NEXT_SHIFT' | 'FURTHER_NOTICE'>('NEXT_SHIFT');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setVariantId(WHOLE);
    setReason('');
    setOtherText('');
    setUntil('NEXT_SHIFT');
    setPin('');
    setError(null);
    setSizes([]);
    if (!product) return;
    catalogApi
      .getProductVariants(product.id)
      .then((list) => setSizes((list || []).filter((v) => v.is_active !== false)))
      .catch(() => setSizes([]));
  }, [product]);

  if (!product) return null;

  const target = (a: ProductAvailability) => a.product_id === product.id && (a.variant_id || WHOLE) === variantId && !a.option_item_id;
  const branchStop = availabilities.find((a) => target(a) && a.branch_id === branchId && isLive(a));
  const chainStop = availabilities.find((a) => target(a) && !a.branch_id && isLive(a));
  const current = chainStop || branchStop;

  const needsPin = !approver && (!!branchStop || until === 'FURTHER_NOTICE');
  const reasonText = reason === 'OTHER' ? otherText.trim() : reason ? t(`pos.stop.reasons.${reason}`) : '';
  const canStop = !!reasonText && (!needsPin || pin.trim().length > 0);

  const fail = (err: any) => setError(err?.detail || err?.message || t('pos.stop.failed'));

  const stop = async () => {
    setBusy(true);
    try {
      await catalogApi.posStop({
        productId: product.id,
        variantId: variantId || null,
        until,
        reason: reasonText,
        branchId,
        approverPin: needsPin ? pin.trim() : undefined,
      });
      onDone(t(until === 'NEXT_SHIFT' ? 'pos.stop.stoppedNextShift' : 'pos.stop.stoppedFurtherNotice', { name: product.name }));
    } catch (err: any) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    setBusy(true);
    try {
      await catalogApi.posResume({ productId: product.id, variantId: variantId || null, branchId, approverPin: needsPin ? pin.trim() : undefined });
      onDone(t('pos.stop.resumed', { name: product.name }));
    } catch (err: any) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const pinField = needsPin && (
    <TextField
      size="small"
      type="password"
      label={t('pos.stop.approverPin')}
      helperText={t('pos.stop.approverPinHelp')}
      value={pin}
      onChange={(e) => setPin(e.target.value)}
      slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'off' } }}
    />
  );

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('pos.stop.title', { name: product.name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {sizes.length > 0 && (
            <FormControl size="small" fullWidth>
              <InputLabel>{t('pos.stop.what')}</InputLabel>
              <Select value={variantId} label={t('pos.stop.what')} onChange={(e) => setVariantId(e.target.value)}>
                <MenuItem value={WHOLE}>{t('pos.stop.allSizes')}</MenuItem>
                {sizes.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          {current ? (
            <>
              <Alert severity={chainStop ? 'warning' : 'info'}>
                {chainStop ? t('pos.stop.chainWide') : t('pos.stop.isOff')}
                {current.reason && ` — ${current.reason}`}
                {current.suspended_until
                  ? ` (${t('pos.stop.backAt', { at: fDateTime(current.suspended_until) })})`
                  : ` (${t('pos.stop.untilFurtherNotice')})`}
              </Alert>
              {!chainStop && pinField}
            </>
          ) : (
            <>
              <div>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {t('pos.stop.why')}
                </Typography>
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
                  {STOP_REASONS.map((r) => (
                    <Chip
                      key={r}
                      label={t(`pos.stop.reasons.${r}`)}
                      color={reason === r ? 'primary' : 'default'}
                      variant={reason === r ? 'filled' : 'outlined'}
                      onClick={() => setReason(r)}
                    />
                  ))}
                </Stack>
                {reason === 'OTHER' && (
                  <TextField
                    size="small"
                    fullWidth
                    sx={{ mt: 1.5 }}
                    label={t('pos.stop.otherReason')}
                    value={otherText}
                    onChange={(e) => setOtherText(e.target.value)}
                    slotProps={{ htmlInput: { maxLength: 200 } }}
                  />
                )}
              </div>
              <RadioGroup value={until} onChange={(e) => setUntil(e.target.value as 'NEXT_SHIFT' | 'FURTHER_NOTICE')}>
                <FormControlLabel value="NEXT_SHIFT" control={<Radio />} label={t('pos.stop.untilNextShift')} />
                <FormControlLabel
                  value="FURTHER_NOTICE"
                  control={<Radio />}
                  label={approver ? t('pos.stop.untilFurtherNotice') : `${t('pos.stop.untilFurtherNotice')} — ${t('pos.stop.needsManager')}`}
                />
              </RadioGroup>
              {pinField}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        {current ? (
          !chainStop && (
            <Button variant="contained" color="success" onClick={resume} disabled={busy || (needsPin && !pin.trim())}>
              {t('pos.stop.putBack')}
            </Button>
          )
        ) : (
          <Button variant="contained" color="error" onClick={stop} disabled={busy || !canStop}>
            {t('pos.stop.takeOff')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
