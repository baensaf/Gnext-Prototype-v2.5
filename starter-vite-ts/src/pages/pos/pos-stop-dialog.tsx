import type { Product, ProductVariant, ProductAvailability } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import { Stack, Alert, Button, Dialog, Select, MenuItem, InputLabel, DialogTitle, FormControl, DialogActions, DialogContent } from '@mui/material';

import { catalogApi } from 'src/api/catalogApi';

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
 * 86 an item from its tile: the whole product or one size, off until somebody puts it back.
 * Anyone at the register can do it, with no reason and no pin. One head office stopped at
 * every branch cannot be put back from a register.
 */
export function PosStopDialog({ product, branchId, availabilities, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const [sizes, setSizes] = useState<ProductVariant[]>([]);
  const [variantId, setVariantId] = useState(WHOLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setVariantId(WHOLE);
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

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      onDone(message);
    } catch (err: any) {
      setError(err?.detail || err?.message || t('pos.stop.failed'));
    } finally {
      setBusy(false);
    }
  };
  const stop = () =>
    run(() => catalogApi.posStop({ productId: product.id, variantId: variantId || null, branchId }), t('pos.stop.stoppedFurtherNotice', { name: product.name }));
  const resume = () =>
    run(() => catalogApi.posResume({ productId: product.id, variantId: variantId || null, branchId }), t('pos.stop.resumed', { name: product.name }));

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
            <Alert severity={chainStop ? 'warning' : 'info'}>{chainStop ? t('pos.stop.chainWide') : t('pos.stop.isOff')}</Alert>
          ) : (
            <Alert severity="info">{t('pos.stop.untilFurtherNotice')}</Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        {current ? (
          !chainStop && (
            <Button variant="contained" color="success" onClick={resume} disabled={busy}>
              {t('pos.stop.putBack')}
            </Button>
          )
        ) : (
          <Button variant="contained" color="error" onClick={stop} disabled={busy}>
            {t('pos.stop.takeOff')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
