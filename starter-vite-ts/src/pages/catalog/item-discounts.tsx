import type { Product } from 'src/api/catalogApi';
import type { ItemDiscount } from 'src/api/discountsApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Box,
  Card,
  Chip,
  Table,
  Paper,
  Alert,
  Stack,
  Button,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  IconButton,
  TableContainer,
} from '@mui/material';

import { fDate } from 'src/utils/format-time';

import { catalogApi } from 'src/api/catalogApi';
import { discountsApi } from 'src/api/discountsApi';
import { useIsHeadOffice } from 'src/store/useAuthStore';

import { ConfirmDialog } from 'src/components/confirm-dialog';

import { ItemDiscountDialog, itemDiscountStatus, itemDiscountErrorText, itemDiscountStatusColor } from './item-discount-dialog';

/**
 * Automatic item discounts (V1): a dated percent off one item, taken off every till line of it
 * at every branch, before the order's own discount. Head office sets them; branches see them.
 * Each product page shows and edits its own discounts too.
 */
export function ItemDiscountsPage() {
  const { t } = useTranslation();
  const isHeadOffice = useIsHeadOffice();

  const [rows, setRows] = useState<ItemDiscount[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ItemDiscount | null>(null);
  const [deleting, setDeleting] = useState<ItemDiscount | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await discountsApi.getItemDiscounts());
    } catch (err: any) {
      setError(err.detail || t('pricing.itemDiscounts.errors.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    load();
    catalogApi
      .getProducts()
      .then((list) => setProducts(list.filter((p) => p.is_active !== false)))
      .catch(() => setProducts([]));
  }, [load]);

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await discountsApi.deleteItemDiscount(deleting.id);
      setDeleting(null);
      await load();
    } catch (err: any) {
      setDeleting(null);
      setError(itemDiscountErrorText(err, t));
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('pricing.itemDiscounts.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('pricing.itemDiscounts.subtitle')}
          </Typography>
        </Box>
        {isHeadOffice && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            sx={{ fontWeight: 'bold' }}
          >
            {t('pricing.itemDiscounts.add')}
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card>
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('pricing.itemDiscounts.item')}</TableCell>
                <TableCell align="center">{t('pricing.itemDiscounts.percent')}</TableCell>
                <TableCell>{t('pricing.itemDiscounts.from')}</TableCell>
                <TableCell>{t('pricing.itemDiscounts.to')}</TableCell>
                <TableCell>{t('common.status', 'Status')}</TableCell>
                <TableCell>{t('pricing.itemDiscounts.note')}</TableCell>
                {isHeadOffice && <TableCell align="center" />}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => {
                const status = itemDiscountStatus(r);
                return (
                  <TableRow key={r.id}>
                    <TableCell sx={{ fontWeight: 600 }}>{r.product_name || '—'}</TableCell>
                    <TableCell align="center">
                      <Chip size="small" color="error" variant="outlined" label={`${Number(r.percent)}%`} />
                    </TableCell>
                    <TableCell>{fDate(r.starts_on)}</TableCell>
                    <TableCell>{r.ends_on ? fDate(r.ends_on) : t('pricing.itemDiscounts.noEnd')}</TableCell>
                    <TableCell>
                      <Chip size="small" color={itemDiscountStatusColor(status)} label={t(`pricing.itemDiscounts.status.${status}`)} />
                    </TableCell>
                    <TableCell>{r.note || '—'}</TableCell>
                    {isHeadOffice && (
                      <TableCell align="center" sx={{ whiteSpace: 'nowrap' }}>
                        <IconButton
                          size="small"
                          title={t('pricing.itemDiscounts.edit')}
                          onClick={() => {
                            setEditing(r);
                            setDialogOpen(true);
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" color="error" title={t('pricing.itemDiscounts.delete')} onClick={() => setDeleting(r)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                    {t('pricing.itemDiscounts.empty')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <ItemDiscountDialog
        open={dialogOpen}
        editing={editing}
        products={products}
        onClose={() => setDialogOpen(false)}
        onSaved={() => {
          setDialogOpen(false);
          load();
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={t('pricing.itemDiscounts.delete')}
        content={t('pricing.itemDiscounts.deleteConfirm', { name: deleting?.product_name || '' })}
        action={
          <Button variant="contained" color="error" onClick={confirmDelete}>
            {t('pricing.itemDiscounts.delete')}
          </Button>
        }
      />
    </Box>
  );
}
