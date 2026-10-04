import type { ItemDiscount } from 'src/api/discountsApi';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { Box, Card, Chip, Alert, Stack, Button, Typography, IconButton } from '@mui/material';

import { fDate } from 'src/utils/format-time';

import { discountsApi } from 'src/api/discountsApi';

import { ConfirmDialog } from 'src/components/confirm-dialog';

import { ItemDiscountDialog, itemDiscountStatus, itemDiscountErrorText, itemDiscountStatusColor } from './item-discount-dialog';

/**
 * The product page's view of its own automatic item discounts: what runs now and what is coming,
 * with add, edit and delete for head office. Ended ones stay on the pricing list.
 */
export function ProductItemDiscounts({ productId, canAuthor }: { productId: string; canAuthor: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [rows, setRows] = useState<ItemDiscount[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ItemDiscount | null>(null);
  const [deleting, setDeleting] = useState<ItemDiscount | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const all = await discountsApi.getItemDiscounts();
      setRows(
        all
          .filter((r) => r.product_id === productId && itemDiscountStatus(r) !== 'ended')
          .sort((a, b) => a.starts_on.localeCompare(b.starts_on))
      );
    } catch (err: any) {
      setError(err?.detail || t('pricing.itemDiscounts.errors.loadFailed'));
    }
  }, [productId, t]);

  useEffect(() => {
    load();
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
    <Card sx={{ p: 3 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
          {t('pricing.itemDiscounts.title')}
        </Typography>
        {canAuthor && (
          <IconButton
            size="small"
            color="primary"
            title={t('pricing.itemDiscounts.add')}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <AddIcon />
          </IconButton>
        )}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        {t('pricing.itemDiscounts.product.help')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack spacing={1.5}>
        {rows.map((r) => {
          const status = itemDiscountStatus(r);
          return (
            <Stack key={r.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Chip size="small" color="error" variant="outlined" label={`${Number(r.percent)}%`} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2">
                  {fDate(r.starts_on)} – {r.ends_on ? fDate(r.ends_on) : t('pricing.itemDiscounts.noEnd')}
                </Typography>
                {r.note && (
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {r.note}
                  </Typography>
                )}
              </Box>
              <Chip size="small" color={itemDiscountStatusColor(status)} label={t(`pricing.itemDiscounts.status.${status}`)} />
              {canAuthor && (
                <Box sx={{ whiteSpace: 'nowrap' }}>
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
                </Box>
              )}
            </Stack>
          );
        })}
        {rows.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('pricing.itemDiscounts.product.empty')}
          </Typography>
        )}
        <Button size="small" variant="outlined" onClick={() => navigate('/app/pricing/item-discounts')}>
          {t('pricing.itemDiscounts.product.all')}
        </Button>
      </Stack>

      <ItemDiscountDialog
        open={dialogOpen}
        editing={editing}
        productId={productId}
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
    </Card>
  );
}
