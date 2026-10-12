import type { Branch } from 'src/api/tenantApi';
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
  Select,
  MenuItem,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  InputLabel,
  CardContent,
  FormControl,
  TableContainer,
  InputAdornment,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';
import { toToman, fromToman } from 'src/utils/currency';

import { tenantApi } from 'src/api/tenantApi';
import { catalogApi } from 'src/api/catalogApi';
import { settingsApi } from 'src/api/settingsApi';
import { useBranchContextOptional } from 'src/contexts/branch-context';

const CHANNEL = 'SNAPPFOOD';
/**
 * What each item costs on Snappfood at one branch, read only: the price group's own Snappfood
 * price, or the in-store price with the channel's markup, rounded. The group's prices are set
 * on the price lists page. The markup rule is edited here. The menu sync sends this sheet.
 */
export function ChannelPricesPage() {
  const { t } = useTranslation();
  const [sheet, setSheet] = useState<ChannelPriceSheet | null>(null);
  const [markup, setMarkup] = useState('0');
  const [roundTo, setRoundTo] = useState('0');
  const [search, setSearch] = useState('');
  // Whose sheet to show: starts at the branch chosen in the header, or base prices.
  const branchScope = useBranchContextOptional();
  const [branchId, setBranchId] = useState(branchScope?.selectedBranchId ?? '');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await catalogApi.getChannelPriceSheet(CHANNEL, branchId || null);
      setSheet(data);
      setMarkup(String(data.rule.markup_percent));
      setRoundTo(toToman(data.rule.round_to));
    } catch (err: any) {
      setError(err.detail || err.message || t('pricing.channelPrices.loadFailed'));
    }
  }, [t, branchId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // Only restaurants sell, so only they have a sheet.
    tenantApi
      .getBranches()
      .then((all) => setBranches(all.filter((b) => b.is_active && (!b.branch_type || b.branch_type === 'RESTAURANT'))))
      .catch(() => setBranches([]));
  }, []);

  /** Rewrites this channel's part of the CHANNEL_PRICING setting, keeping what isn't changed. */
  const saveChannelSetting = async (change: (current: Record<string, any>) => Record<string, any>) => {
    const all = (await settingsApi.getSettings())?.CHANNEL_PRICING || {};
    await settingsApi.updateSetting('CHANNEL_PRICING', { ...all, [CHANNEL]: change({ ...(all[CHANNEL] || {}) }) });
  };

  const saveRule = async () => {
    try {
      await saveChannelSetting((current) => ({
        ...current,
        markup_percent: Number(markup) || 0,
        round_to: Number(fromToman(roundTo)) || 0,
      }));
      setNotice(t('pricing.channelPrices.ruleSaved'));
      await load();
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

      {/* Food Partner says this on every price field: Snappfood's contract fines a price that
          differs from the in-store one, so a markup here is the chain's own risk. */}
      <Alert severity="warning" sx={{ mb: 2 }}>
        {t('pricing.channelPrices.parityWarning')}
      </Alert>

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
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel shrink>{t('pricing.channelPrices.branch')}</InputLabel>
          <Select displayEmpty notched value={branchId} label={t('pricing.channelPrices.branch')} onChange={(e) => setBranchId(e.target.value)}>
            <MenuItem value="">{t('pricing.channelPrices.basePrices')}</MenuItem>
            {branches.map((b) => (
              <MenuItem key={b.id} value={b.id}>
                {b.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
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
              <TableCell align="right">{t('pricing.channelPrices.onChannel')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.product_id}:${r.variant_id || ''}`}>
                <TableCell>{r.name}</TableCell>
                <TableCell align="right">{MoneyUtil.formatCurrency(r.base_price)}</TableCell>
                <TableCell align="right">{MoneyUtil.formatCurrency(r.rule_price)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                  {MoneyUtil.formatCurrency(r.price)}
                  {r.group_price && <Chip size="small" label={t('pricing.channelPrices.groupChip')} sx={{ ml: 1 }} />}
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
              ))}
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
