import type { Category, ChannelPriceSheet } from 'src/api/catalogApi';

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
  MenuItem,
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
import { toToman, fromToman } from 'src/utils/currency';

import { catalogApi } from 'src/api/catalogApi';
import { settingsApi } from 'src/api/settingsApi';
import { useBranchContextOptional } from 'src/contexts/branch-context';

const CHANNEL = 'SNAPPFOOD';
/** Same cap as the server: a struck-through price over ten times the real one isn't believable. */
const MAX_SHOWN_DISCOUNT = 90;

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

  // The shown ("fake") discount, V3: a default for the channel, per-item overrides, and a
  // whole category at once. The menu prints a struck-through price; the bill is the real one.
  const [shownDiscount, setShownDiscount] = useState('0');
  const [discountDrafts, setDiscountDrafts] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [bulkCategory, setBulkCategory] = useState('');
  const [bulkPercent, setBulkPercent] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await catalogApi.getChannelPriceSheet(CHANNEL, branchId || null);
      setSheet(data);
      setMarkup(String(data.rule.markup_percent));
      setRoundTo(toToman(data.rule.round_to));
      setShownDiscount(String(data.rule.display_discount_percent || 0));
      setDrafts({});
      setDiscountDrafts({});
    } catch (err: any) {
      setError(err.detail || err.message || t('pricing.channelPrices.loadFailed'));
    }
  }, [t, branchId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    catalogApi
      .getCategories()
      .then((list) => setCategories(list.filter((c) => c.is_active !== false)))
      .catch(() => setCategories([]));
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
        display_discount_percent: Math.min(MAX_SHOWN_DISCOUNT, Math.max(0, Number(shownDiscount) || 0)),
      }));
      setNotice(t('pricing.channelPrices.ruleSaved'));
      await load();
    } catch (err: any) {
      setError(err.detail || err.message || t('pricing.channelPrices.saveFailed'));
    }
  };

  /** Sets (a number) or clears (null, back to the default) the shown discount on some items. */
  const saveItemDiscounts = async (keys: string[], percent: number | null) => {
    try {
      await saveChannelSetting((current) => {
        const items = { ...(current.item_display_discounts || {}) };
        keys.forEach((k) => {
          if (percent === null) delete items[k];
          else items[k] = Math.min(MAX_SHOWN_DISCOUNT, Math.max(0, percent));
        });
        return { ...current, item_display_discounts: items };
      });
      await load();
    } catch (err: any) {
      setError(err.detail || err.message || t('pricing.channelPrices.saveFailed'));
    }
  };

  const saveItemDiscount = (productId: string, variantId: string | null) => {
    const typed = (discountDrafts[key(productId, variantId)] ?? '').trim();
    saveItemDiscounts([key(productId, variantId)], typed === '' ? null : Number(typed) || 0);
  };

  const applyToCategory = async () => {
    if (!bulkCategory || !sheet) return;
    const keys = sheet.items.filter((r) => r.category_id === bulkCategory).map((r) => key(r.product_id, r.variant_id));
    if (!keys.length) return;
    const typed = bulkPercent.trim();
    await saveItemDiscounts(keys, typed === '' ? null : Number(typed) || 0);
    setNotice(t('pricing.channelPrices.shownDiscount.applied', { count: keys.length }));
  };

  const key = (productId: string, variantId: string | null) => `${productId}:${variantId || ''}`;

  const saveFixed = async (productId: string, variantId: string | null) => {
    const value = (drafts[key(productId, variantId)] ?? '').trim();
    try {
      setSheet(await catalogApi.setChannelFixedPrice(CHANNEL, productId, variantId, value === '' ? null : fromToman(value), branchId || null));
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
            <TextField
              label={t('pricing.channelPrices.shownDiscount.default')}
              type="number"
              size="small"
              value={shownDiscount}
              onChange={(e) => setShownDiscount(e.target.value)}
              helperText={t('pricing.channelPrices.shownDiscount.help')}
              slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> }, htmlInput: { min: 0, max: MAX_SHOWN_DISCOUNT } }}
            />
            <Button variant="contained" startIcon={<SaveIcon />} onClick={saveRule}>
              {t('common.save')}
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6">{t('pricing.channelPrices.shownDiscount.categoryTitle')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('pricing.channelPrices.shownDiscount.categoryHelp')}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
            <TextField
              select
              size="small"
              label={t('pricing.channelPrices.shownDiscount.category')}
              value={bulkCategory}
              onChange={(e) => setBulkCategory(e.target.value)}
              sx={{ minWidth: 220 }}
            >
              {categories.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              type="number"
              label={t('pricing.channelPrices.shownDiscount.percent')}
              placeholder={t('pricing.channelPrices.shownDiscount.useDefault')}
              value={bulkPercent}
              onChange={(e) => setBulkPercent(e.target.value)}
              slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> }, inputLabel: { shrink: true } }}
            />
            <Button variant="outlined" disabled={!bulkCategory} onClick={applyToCategory}>
              {t('pricing.channelPrices.shownDiscount.apply')}
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
              <TableCell align="right">{t('pricing.channelPrices.shownDiscount.column')}</TableCell>
              <TableCell align="right">{t('pricing.channelPrices.onChannel')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const k = key(r.product_id, r.variant_id);
              const draft = drafts[k];
              // Drafts are what was typed, in tomans; the sheet holds rials.
              const changed = draft !== undefined && draft !== (r.fixed_price ? toToman(r.fixed_price) : '');
              const ownDiscount = r.display_discount_own ? String(r.display_discount_percent) : '';
              const discountDraft = discountDrafts[k];
              const discountChanged = discountDraft !== undefined && discountDraft !== ownDiscount;
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
                        value={draft ?? (r.fixed_price ? toToman(r.fixed_price) : '')}
                        onChange={(e) => setDrafts((prev) => ({ ...prev, [k]: e.target.value }))}
                        sx={{ width: 150 }}
                      />
                      <Button size="small" disabled={!changed} onClick={() => saveFixed(r.product_id, r.variant_id)}>
                        {t('common.save')}
                      </Button>
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
                      <TextField
                        size="small"
                        type="number"
                        // Empty follows the channel's default, shown as the placeholder.
                        placeholder={String(sheet?.rule.display_discount_percent || 0)}
                        value={discountDraft ?? ownDiscount}
                        onChange={(e) => setDiscountDrafts((prev) => ({ ...prev, [k]: e.target.value }))}
                        slotProps={{ input: { endAdornment: <InputAdornment position="end">%</InputAdornment> } }}
                        sx={{ width: 110 }}
                      />
                      <Button size="small" disabled={!discountChanged} onClick={() => saveItemDiscount(r.product_id, r.variant_id)}>
                        {t('common.save')}
                      </Button>
                    </Stack>
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                    {r.before_price && (
                      <Typography
                        component="span"
                        variant="body2"
                        color="text.disabled"
                        title={t('pricing.channelPrices.shownDiscount.strikeHint', { percent: r.display_discount_percent })}
                        sx={{ textDecoration: 'line-through', mr: 1, fontWeight: 400 }}
                      >
                        {MoneyUtil.formatCurrency(r.before_price)}
                      </Typography>
                    )}
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
