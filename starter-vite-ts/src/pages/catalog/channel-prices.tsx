import type { ChannelPriceSheet } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useMemo, useState, useEffect, useCallback } from 'react';

import SaveIcon from '@mui/icons-material/Save';
import SearchIcon from '@mui/icons-material/Search';
import {
  Box,
  Card,
  Chip,
  Stack,
  Alert,
  Table,
  Button,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  CardContent,
  TableContainer,
  InputAdornment,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';

import { catalogApi } from 'src/api/catalogApi';
import { settingsApi } from 'src/api/settingsApi';
import { useBranchContextOptional } from 'src/contexts/branch-context';

const CHANNEL = 'SNAPPFOOD';

/**
 * What each item costs on Snappfood: the in-store price with the channel's markup, rounded,
 * unless an item has a fixed Snappfood price. The prototype does not push the menu to
 * Snappfood, so this is the sheet someone copies into the vendor panel.
 */
export function ChannelPricesPage() {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<ChannelPriceSheet | null>(null);
  const [markup, setMarkup] = useState('0');
  const [roundTo, setRoundTo] = useState('0');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  // Whose in-store prices the markup starts from: the branch chosen in the header, or base
  // prices at head office.
  const branchScope = useBranchContextOptional();
  const branchId = branchScope?.selectedBranchId ?? '';
  const branchName = branchScope?.selectedBranch?.name ?? '';
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await catalogApi.getChannelPriceSheet(CHANNEL, branchId || null);
      setSheet(data);
      setMarkup(String(data.rule.markup_percent));
      setRoundTo(String(data.rule.round_to));
      setDrafts({});
    } catch (err: any) {
      setError(err.detail || err.message || t('pricing.channelPrices.loadFailed'));
    }
  }, [t, branchId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveRule = async () => {
    try {
      const all = (await settingsApi.getSettings())?.CHANNEL_PRICING || {};
      await settingsApi.updateSetting('CHANNEL_PRICING', {
        ...all,
        [CHANNEL]: { markup_percent: Number(markup) || 0, round_to: Number(roundTo) || 0 },
      });
      setNotice(t('pricing.channelPrices.ruleSaved'));
      await load();
    } catch (err: any) {
      setError(err.detail || err.message || t('pricing.channelPrices.saveFailed'));
    }
  };

  const key = (productId: string, variantId: string | null) => `${productId}:${variantId || ''}`;

  const saveFixed = async (productId: string, variantId: string | null) => {
    const value = (drafts[key(productId, variantId)] ?? '').trim();
    try {
      setSheet(await catalogApi.setChannelFixedPrice(CHANNEL, productId, variantId, value === '' ? null : value, branchId || null));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key(productId, variantId)];
        return next;
      });
    } catch (err: any) {
      setError(err.detail || err.message || t('pricing.channelPrices.saveFailed'));
    }
  };

  const rows = useMemo(
    () => (sheet?.items || []).filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase())),
    [sheet, search]
  );

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
        {t('pricing.channelPrices.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('pricing.channelPrices.subtitle')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {t('pricing.channelPrices.ruleTitle')}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
            <TextField
              label={t('pricing.channelPrices.markup')}
              type="number"
              size="small"
              value={markup}
              onChange={(e) => setMarkup(e.target.value)}
              slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }}
            />
            <TextField
              label={t('pricing.channelPrices.roundTo')}
              type="number"
              size="small"
              value={roundTo}
              onChange={(e) => setRoundTo(e.target.value)}
              helperText={t('pricing.channelPrices.roundToHelp')}
            />
            <Button variant="contained" startIcon={<SaveIcon />} onClick={saveRule}>
              {t('common.save')}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { sm: 'center' } }}>
        <Typography variant="subtitle2" sx={{ whiteSpace: 'nowrap' }}>
          {branchId ? `${t('pricing.channelPrices.branch')} ${branchName}` : t('pricing.channelPrices.basePrices')}
        </Typography>
        <TextField
          size="small"
          placeholder={t('pricing.channelPrices.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ maxWidth: 360 }}
          fullWidth
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
        />
        {branchId && (
          <Typography variant="body2" color="text.secondary">
            {sheet?.price_list
              ? t('pricing.channelPrices.fromList', { name: sheet.price_list.name })
              : t('pricing.channelPrices.noList')}
          </Typography>
        )}
      </Stack>

      <TableContainer component={Card}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('pricing.channelPrices.item')}</TableCell>
              <TableCell align="right">{t('pricing.channelPrices.inStore')}</TableCell>
              <TableCell align="right">{t('pricing.channelPrices.byRule')}</TableCell>
              <TableCell align="right">{t('pricing.channelPrices.fixed')}</TableCell>
              <TableCell align="right">{t('pricing.channelPrices.onChannel')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const k = key(r.product_id, r.variant_id);
              const draft = drafts[k];
              const changed = draft !== undefined && draft !== (r.fixed_price ? String(Number(r.fixed_price)) : '');
              return (
                <TableRow key={k}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell align="right">{MoneyUtil.formatCurrency(r.base_price)}</TableCell>
                  <TableCell align="right">{MoneyUtil.formatCurrency(r.rule_price)}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
                      <TextField
                        size="small"
                        type="number"
                        placeholder={t('pricing.channelPrices.followsRule')}
                        value={draft ?? (r.fixed_price ? String(Number(r.fixed_price)) : '')}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [k]: e.target.value }))}
                        sx={{ width: 150 }}
                      />
                      <Button size="small" disabled={!changed} onClick={() => saveFixed(r.product_id, r.variant_id)}>
                        {t('common.save')}
                      </Button>
                    </Stack>
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                    {MoneyUtil.formatCurrency(r.price)}
                    {r.fixed_price && <Chip size="small" label={t('pricing.channelPrices.fixedChip')} sx={{ ml: 1 }} />}
                    {/* Off on Snappfood right now: switch it off in the vendor panel too. */}
                    {r.off && (
                      <Chip
                        size="small"
                        color="warning"
                        sx={{ ml: 1 }}
                        title={r.off.reason || undefined}
                        label={
                          r.off.until
                            ? t('pricing.channelPrices.offUntil', { time: fDateTime(r.off.until) })
                            : t('pricing.channelPrices.off')
                        }
                      />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {(sheet?.add_ons || []).length > 0 && (
        <TableContainer component={Card} sx={{ mt: 3 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('pricing.channelPrices.addOn')}</TableCell>
                <TableCell align="right">{t('pricing.channelPrices.inStore')}</TableCell>
                <TableCell align="right">{t('pricing.channelPrices.onChannel')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sheet!.add_ons.map((a) => (
                <TableRow key={a.option_item_id}>
                  <TableCell>{a.name}</TableCell>
                  <TableCell align="right">{MoneyUtil.formatCurrency(a.base_price)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                    {MoneyUtil.formatCurrency(a.price)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
