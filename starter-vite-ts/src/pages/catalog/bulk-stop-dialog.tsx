import type { Product, Category } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import {
  Chip,
  Stack,
  Alert,
  Button,
  Dialog,
  MenuItem,
  TextField,
  Typography,
  DialogTitle,
  ToggleButton,
  Autocomplete,
  DialogContent,
  DialogActions,
  ToggleButtonGroup,
} from '@mui/material';

import { catalogApi } from 'src/api/catalogApi';
import { useBranchContext } from 'src/contexts/branch-context';

import { STOP_REASONS } from '../pos/pos-stop-dialog';

type Props = {
  open: boolean;
  products: Product[];
  categories: Category[];
  onClose: () => void;
  /** After a stop or a resume, with what to tell the user. */
  onDone: (message: string) => void;
};

/**
 * Many items or branches at once: a whole category off ("the grill is down"), or an item off
 * at several branches. A branch acts at its own branch; head office picks branches, or none
 * for the whole chain. Each item gets a stop of its own, so each can be put back by itself.
 */
export function BulkStopDialog({ open, products, categories, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const { branches, isHeadOffice, selectedBranchId, selectedBranch } = useBranchContext();

  const [what, setWhat] = useState<'CATEGORY' | 'ITEMS'>('CATEGORY');
  const [categoryId, setCategoryId] = useState('');
  const [picked, setPicked] = useState<Product[]>([]);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [until, setUntil] = useState<'NEXT_SHIFT' | 'HOURS' | 'MANUAL'>('NEXT_SHIFT');
  const [hours, setHours] = useState('2');
  const [reason, setReason] = useState<(typeof STOP_REASONS)[number] | ''>('');
  const [otherText, setOtherText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setWhat('CATEGORY');
    setCategoryId('');
    setPicked([]);
    setBranchIds([]);
    setUntil('NEXT_SHIFT');
    setHours('2');
    setReason('');
    setOtherText('');
    setError(null);
  }, [open]);

  const reasonText = reason === 'OTHER' ? otherText.trim() : reason ? t(`pos.stop.reasons.${reason}`) : '';
  const targets = {
    ...(what === 'CATEGORY' ? { categoryId } : { productIds: picked.map((p) => p.id) }),
    // At chain level, the branches picked (none: every branch). Inside one branch, that branch:
    // the server holds a branch account to its own anyway, and head office working in a
    // branch means that branch, not the chain.
    branchIds: isHeadOffice ? branchIds : selectedBranchId ? [selectedBranchId] : undefined,
  };
  const hasTargets = what === 'CATEGORY' ? !!categoryId : picked.length > 0;

  const run = async (action: 'STOP' | 'RESUME') => {
    setBusy(true);
    setError(null);
    try {
      if (action === 'STOP') {
        const done = await catalogApi.bulkStop({
          ...targets,
          reason: reasonText,
          until: until === 'NEXT_SHIFT' ? 'NEXT_SHIFT' : undefined,
          hours: until === 'HOURS' ? Number(hours) || undefined : undefined,
        });
        onDone(t('catalog.bulkStop.stopped', { count: done.products, branches: done.branches }));
      } else {
        const done = await catalogApi.bulkResume(targets);
        onDone(
          done.chain_wide
            ? t('catalog.bulkStop.resumedSomeChainWide', { count: done.resumed, chainWide: done.chain_wide })
            : t('catalog.bulkStop.resumed', { count: done.resumed })
        );
      }
    } catch (err: any) {
      setError(err?.detail || err?.message || t('catalog.bulkStop.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('catalog.bulkStop.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <ToggleButtonGroup size="small" exclusive value={what} onChange={(_, next) => next && setWhat(next)}>
            <ToggleButton value="CATEGORY">{t('catalog.bulkStop.aCategory')}</ToggleButton>
            <ToggleButton value="ITEMS">{t('catalog.bulkStop.items')}</ToggleButton>
          </ToggleButtonGroup>

          {what === 'CATEGORY' ? (
            <TextField
              select
              size="small"
              label={t('catalog.bulkStop.category')}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              helperText={t('catalog.bulkStop.categoryHelp')}
            >
              {categories.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.parent_id ? `└ ${c.name}` : c.name}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <Autocomplete
              multiple
              size="small"
              options={products}
              value={picked}
              onChange={(_, next) => setPicked(next)}
              getOptionLabel={(p) => p.name}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(params) => <TextField {...params} label={t('catalog.bulkStop.items')} />}
            />
          )}

          {isHeadOffice ? (
            <Autocomplete
              multiple
              size="small"
              options={branches.map((b) => b.id)}
              value={branchIds}
              onChange={(_, next) => setBranchIds(next)}
              getOptionLabel={(id) => branches.find((b) => b.id === id)?.name || id}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('catalog.bulkStop.branches')}
                  helperText={branchIds.length ? undefined : t('catalog.bulkStop.allBranches')}
                />
              )}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('catalog.bulkStop.ownBranch', { name: selectedBranch?.name || '' })}
            </Typography>
          )}

          <ToggleButtonGroup size="small" exclusive value={until} onChange={(_, next) => next && setUntil(next)}>
            <ToggleButton value="NEXT_SHIFT">{t('catalog.bulkStop.untilNextShift')}</ToggleButton>
            <ToggleButton value="HOURS">{t('catalog.bulkStop.forHours')}</ToggleButton>
            <ToggleButton value="MANUAL">{t('catalog.bulkStop.untilFurtherNotice')}</ToggleButton>
          </ToggleButtonGroup>
          {until === 'HOURS' && (
            <TextField
              size="small"
              type="number"
              label={t('catalog.bulkStop.hours')}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              slotProps={{ htmlInput: { min: 1, step: 1 } }}
              sx={{ maxWidth: 160 }}
            />
          )}

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
              label={t('catalog.bulkStop.otherReason')}
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('catalog.bulkStop.cancel')}</Button>
        <Button disabled={busy || !hasTargets} onClick={() => run('RESUME')}>
          {t('catalog.bulkStop.putBack')}
        </Button>
        <Button variant="contained" color="error" disabled={busy || !hasTargets || !reasonText} onClick={() => run('STOP')}>
          {t('catalog.bulkStop.takeOff')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
