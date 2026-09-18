import type { PriceHistoryRow } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import { Card, Chip, Alert, Table, TableRow, TableBody, TableCell, TableHead, Typography, TableContainer } from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';

import { catalogApi } from 'src/api/catalogApi';

const STATUS_COLOR = { UPCOMING: 'info', CURRENT: 'success', ENDED: 'default' } as const;

/**
 * One product's prices over time, newest first: dated price changes (including ones still to
 * come), prices set on a branch price list, and base prices typed on this page.
 */
export function ProductPriceHistory({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<PriceHistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    catalogApi
      .getPriceHistory(productId)
      .then(setRows)
      .catch((err) => setError(err?.detail || err?.message || t('catalog.productDetailPage.priceHistory.loadFailed')));
  }, [productId, t]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (rows && rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('catalog.productDetailPage.priceHistory.empty')}
      </Typography>
    );
  }

  return (
    <TableContainer component={Card}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{t('catalog.productDetailPage.priceHistory.when')}</TableCell>
            <TableCell>{t('catalog.productDetailPage.priceHistory.what')}</TableCell>
            <TableCell>{t('catalog.productDetailPage.priceHistory.size')}</TableCell>
            <TableCell align="right">{t('catalog.productDetailPage.priceHistory.price')}</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {(rows || []).map((r, index) => (
            <TableRow key={index}>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{fDateTime(r.at)}</TableCell>
              <TableCell>
                {t(`catalog.productDetailPage.priceHistory.kinds.${r.kind}`)}
                {r.price_list && ` — ${r.price_list}`}
              </TableCell>
              <TableCell>{r.size || '—'}</TableCell>
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                {r.from && (
                  <Typography component="span" variant="body2" color="text.secondary" sx={{ textDecoration: 'line-through', mr: 1 }}>
                    {MoneyUtil.formatCurrency(r.from)}
                  </Typography>
                )}
                <b>{MoneyUtil.formatCurrency(r.to)}</b>
              </TableCell>
              <TableCell>
                {r.status && <Chip size="small" color={STATUS_COLOR[r.status]} label={t(`catalog.productDetailPage.priceHistory.statuses.${r.status}`)} />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
