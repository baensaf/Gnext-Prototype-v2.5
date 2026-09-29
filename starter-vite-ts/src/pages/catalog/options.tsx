import type { Product, Category, OptionGroup } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import {
  Box,
  Card,
  Chip,
  Stack,
  Table,
  Alert,
  Button,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  TableContainer,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { useCurrencyLabel } from 'src/utils/currency';
import { addonMin, addonRuleLabel } from 'src/utils/addon-rule';

import { catalogApi } from 'src/api/catalogApi';
import { useAuthStore } from 'src/store/useAuthStore';

import { AddonGroupSheet } from './addon-group-sheet';

/** The price span of a group's add-ons: "free", one price, or cheapest–dearest. */
function priceRange(group: OptionGroup, currency: string, free: string) {
  const prices = (group.items || []).map((i) => Number(i.price_delta || 0));
  if (prices.length === 0) return '—';
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  if (high === 0) return free;
  const fmt = (n: number) => MoneyUtil.formatCurrency(String(n));
  return low === high ? `${fmt(low)} ${currency}` : `${fmt(low)}–${fmt(high)} ${currency}`;
}

/**
 * Add-on groups as one table: what each asks for, what it costs and where it is used. A row
 * opens the group's sheet, which also creates a new one.
 */
export function OptionsPage() {
  const currency = useCurrencyLabel();
  const { t } = useTranslation();
  const canAuthor = useAuthStore((state) => state.user?.isHeadOffice) !== false;

  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<OptionGroup | null>(null);

  const loadData = async () => {
    try {
      const [data, productList, categoryList] = await Promise.all([
        catalogApi.getOptionGroups(),
        catalogApi.getProducts().catch(() => [] as Product[]),
        catalogApi.getCategories().catch(() => [] as Category[]),
      ]);
      setGroups(data);
      setProducts(productList);
      setCategories(categoryList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('catalog.optionsPage.errors.loadFailed'));
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (group: OptionGroup | null) => {
    if (!canAuthor) return;
    setEditing(group);
    setSheetOpen(true);
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('catalog.optionsPage.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('catalog.optionsPage.subtitle')}
          </Typography>
        </Box>
        {canAuthor && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => open(null)} sx={{ fontWeight: 'bold', flexShrink: 0 }}>
            {t('catalog.optionsPage.newGroup')}
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('catalog.optionsPage.colName')}</TableCell>
                <TableCell>{t('catalog.optionsPage.colRule')}</TableCell>
                <TableCell>{t('catalog.optionsPage.colItems')}</TableCell>
                <TableCell>{t('catalog.optionsPage.colPrice')}</TableCell>
                <TableCell>{t('catalog.optionsPage.colUsedOn')}</TableCell>
                <TableCell>{t('catalog.optionsPage.colAskAtPos')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 5, color: 'text.secondary' }}>
                    {t('catalog.optionsPage.empty')}
                  </TableCell>
                </TableRow>
              )}
              {groups.map((g) => {
                const used = (g.product_links || []).length;
                const asks = addonMin(g) > 0 || g.prompt_at_pos !== false;
                const names = (g.items || []).map((i) => i.name);
                return (
                  <TableRow key={g.id} hover={canAuthor} onClick={() => open(g)} sx={{ cursor: canAuthor ? 'pointer' : 'default' }}>
                    <TableCell sx={{ fontWeight: 'bold' }}>{g.name}</TableCell>
                    <TableCell>
                      <Chip size="small" color={addonMin(g) > 0 ? 'warning' : 'default'} label={addonRuleLabel(t, g)} />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Typography variant="body2" noWrap title={names.join('، ')}>
                        {names.length ? names.join('، ') : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <span dir="ltr">{priceRange(g, currency, t('catalog.optionsPage.free'))}</span>
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                        <Typography variant="body2">{t('catalog.optionsPage.usedOnCount', { n: used })}</Typography>
                        {(g.category_ids || []).map((id) => (
                          <Chip key={id} size="small" variant="outlined" label={categories.find((c) => c.id === id)?.name || '—'} />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell>{asks ? t('catalog.optionsPage.yes') : t('catalog.optionsPage.no')}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <AddonGroupSheet
        open={sheetOpen}
        group={editing}
        products={products}
        categories={categories}
        onClose={() => setSheetOpen(false)}
        onSaved={() => {
          setSheetOpen(false);
          loadData();
        }}
      />
    </Box>
  );
}
