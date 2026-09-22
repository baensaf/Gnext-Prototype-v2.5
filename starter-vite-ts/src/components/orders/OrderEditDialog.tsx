import type { ReasonCode } from 'src/api/settingsApi';
import type { OptionItem, OptionGroup } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useMemo, useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import UndoIcon from '@mui/icons-material/Undo';
import DeleteOutlineIcon from '@mui/icons-material/Delete';
import {
  Box,
  Chip,
  Stack,
  Alert,
  Table,
  Dialog,
  Button,
  Select,
  Divider,
  Checkbox,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  InputLabel,
  IconButton,
  Typography,
  FormControl,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';

import { catalogApi } from 'src/api/catalogApi';
import { orderApi, type OrderItem, type OrderHeader } from 'src/api/orderApi';

import { toast, showErrorToast } from 'src/components/snackbar';
import { ApprovalModal } from 'src/components/approval/ApprovalModal';

interface OrderEditDialogProps {
  open: boolean;
  onClose: () => void;
  order: OrderHeader | null;
  reasonCodes: ReasonCode[];
  onSaved: () => void;
}

interface PendingAddition {
  productId: string;
  productName: string;
  /** Base price plus the chosen add-ons, for the preview; the server prices the line itself. */
  unitPrice: string;
  quantity: string;
  options: OptionItem[];
}

const isActive = (item: OrderItem) => (item.state || 'ACTIVE') === 'ACTIVE';

/**
 * Line editor for an order past DRAFT.
 *
 * Removals are staged locally and committed as one edit command, so the server
 * resolves authority for the whole batch rather than approving changes one at a
 * time. A 403 opens the manager PIN flow and retries with the approval id it
 * mints; a 409 surfaces the refund the edit would require.
 */
export function OrderEditDialog({ open, onClose, order, reasonCodes, onSaved }: OrderEditDialogProps) {
  const { t } = useTranslation();

  const [voidedIds, setVoidedIds] = useState<string[]>([]);
  const [additions, setAdditions] = useState<PendingAddition[]>([]);
  const [reasonCodeId, setReasonCodeId] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [pickerProductId, setPickerProductId] = useState('');
  const [pickerQuantity, setPickerQuantity] = useState('1');
  // The picked product's add-on groups. A line added here used to go without them, so a
  // combo (whose drink is required) was refused and a burger lost its extras.
  const [pickerGroups, setPickerGroups] = useState<OptionGroup[]>([]);
  const [pickerOptionIds, setPickerOptionIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setVoidedIds([]);
    setAdditions([]);
    setReasonCodeId('');
    setPickerProductId('');
    setPickerQuantity('1');
    setError(null);
    catalogApi
      .getProducts()
      // Items taken off the menu are not sold; the register refuses them.
      .then((list) => setProducts(list.filter((p: any) => p.is_active !== false)))
      .catch(() => setProducts([]));
  }, [open]);

  useEffect(() => {
    setPickerGroups([]);
    setPickerOptionIds([]);
    if (!pickerProductId) return undefined;
    let cancelled = false;
    catalogApi
      .getProductById(pickerProductId)
      .then((full) => {
        if (cancelled) return;
        const groups = ((full.optionGroups || []) as OptionGroup[]).map((g) => ({
          ...g,
          items: (g.items || []).filter((i) => !(g.excluded_item_ids || []).includes(i.id)),
        }));
        setPickerGroups(groups);
        // Defaults start ticked, as on the register.
        setPickerOptionIds(
          groups.flatMap((g) =>
            (g.items || [])
              .filter((i) => i.is_default)
              .slice(0, g.max_selection > 0 ? g.max_selection : undefined)
              .map((i) => i.id)
          )
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pickerProductId]);

  // The first group short of its minimum, so Add waits until the required choice is made.
  const unfilledGroup = pickerGroups.find(
    (g) => (g.items || []).filter((i) => pickerOptionIds.includes(i.id)).length < (g.min_selection || (g.is_required ? 1 : 0))
  );

  const toggleOption = (group: OptionGroup, itemId: string, checked: boolean) => {
    const inGroup = new Set((group.items || []).map((i) => i.id));
    setPickerOptionIds((prev) => {
      if (!checked) return prev.filter((id) => id !== itemId);
      if (group.max_selection === 1) return [...prev.filter((id) => !inGroup.has(id)), itemId];
      const chosen = prev.filter((id) => inGroup.has(id)).length;
      return group.max_selection > 0 && chosen >= group.max_selection ? prev : [...prev, itemId];
    });
  };

  const lines = order?.items || [];
  const activeLines = useMemo(() => lines.filter(isActive), [lines]);

  // Preview the total the edit would leave behind, so the cashier sees the
  // consequence before committing rather than after.
  const projectedTotal = useMemo(() => {
    const kept = activeLines
      .filter((i) => !voidedIds.includes(i.id))
      .reduce((sum, i) => MoneyUtil.add(sum, i.line_total || i.subtotal || '0'), '0');
    return additions.reduce(
      (sum, a) => MoneyUtil.add(sum, MoneyUtil.multiply(a.unitPrice, a.quantity)),
      kept,
    );
  }, [activeLines, voidedIds, additions]);

  const hasChanges = voidedIds.length > 0 || additions.length > 0;
  const needsReason = voidedIds.length > 0;

  const toggleVoid = (itemId: string) =>
    setVoidedIds((prev) => (prev.includes(itemId) ? prev.filter((i) => i !== itemId) : [...prev, itemId]));

  const handleStageAddition = () => {
    const product = products.find((p) => p.id === pickerProductId);
    if (!product || unfilledGroup) return;
    const options = pickerGroups.flatMap((g) => (g.items || []).filter((i) => pickerOptionIds.includes(i.id)));
    setAdditions((prev) => [
      ...prev,
      {
        productId: product.id,
        productName: product.name,
        unitPrice: options.reduce((sum, o) => MoneyUtil.add(sum, o.price_delta || '0'), product.base_price || '0'),
        quantity: pickerQuantity || '1',
        options,
      },
    ]);
    setPickerProductId('');
    setPickerQuantity('1');
  };

  const commit = async (approvalRequestId?: string) => {
    if (!order) return;
    setSaving(true);
    setError(null);
    try {
      await orderApi.editOrder(
        order.id,
        {
          add: additions.map((a) => ({
            product_id: a.productId,
            quantity: MoneyUtil.format(a.quantity, 4),
            options: a.options.map((o) => ({ option_item_id: o.id })),
          })),
          void: voidedIds.map((id) => ({ orderItemId: id, reasonCodeId })),
        },
        { reasonCodeId: reasonCodeId || undefined, approvalRequestId },
      );
      toast.success(t('orders.edit.saved', 'Order updated'));
      onSaved();
      onClose();
    } catch (err: any) {
      if (err?.code === 'APPROVAL_REQUIRED') {
        setApprovalOpen(true);
        setError(err.detail || t('orders.edit.approvalNeeded', 'A manager must authorize this change.'));
      } else {
        const message = err?.detail || t('orders.edit.failed', 'Could not apply the edit');
        setError(message);
        showErrorToast(err, message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!order) return null;

  return (
    <>
      <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
        <DialogTitle>
          {t('orders.edit.title', 'Edit order')} {order.order_number}
        </DialogTitle>

        <DialogContent dividers>
          <Stack spacing={2}>
            {error && <Alert severity="warning">{error}</Alert>}

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('orders.edit.line', 'Line')}</TableCell>
                  <TableCell align="center">{t('orders.edit.qty', 'Qty')}</TableCell>
                  <TableCell align="right">{t('orders.edit.lineTotal', 'Total')}</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {activeLines.map((item) => {
                  const staged = voidedIds.includes(item.id);
                  return (
                    <TableRow key={item.id} sx={{ opacity: staged ? 0.5 : 1 }}>
                      <TableCell sx={{ textDecoration: staged ? 'line-through' : 'none' }}>
                        {item.product_name}
                        {item.variant_name ? ` (${item.variant_name})` : ''}
                      </TableCell>
                      <TableCell align="center">{MoneyUtil.format(item.quantity, 0)}</TableCell>
                      <TableCell align="right">
                        {MoneyUtil.formatCurrency(item.line_total || item.subtotal || '0', 0)}
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          color={staged ? 'default' : 'error'}
                          onClick={() => toggleVoid(item.id)}
                          title={
                            staged
                              ? t('orders.edit.keepLine', 'Keep this line')
                              : t('orders.edit.voidLine', 'Void this line')
                          }
                        >
                          {staged ? <UndoIcon fontSize="small" /> : <DeleteOutlineIcon fontSize="small" />}
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}

                {additions.map((addition, index) => (
                  <TableRow key={`new-${index}`} sx={{ bgcolor: 'success.lighter' }}>
                    <TableCell>
                      {addition.productName}{' '}
                      <Chip size="small" color="success" label={t('orders.edit.new', 'New')} />
                      {addition.options.length > 0 && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          + {addition.options.map((o) => o.name).join('، ')}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">{addition.quantity}</TableCell>
                    <TableCell align="right">
                      {MoneyUtil.formatCurrency(
                        MoneyUtil.multiply(addition.unitPrice, addition.quantity),
                        0,
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        onClick={() => setAdditions((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Divider />

            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <FormControl size="small" sx={{ flex: 1 }}>
                <InputLabel>{t('orders.edit.addItem', 'Add an item')}</InputLabel>
                <Select
                  label={t('orders.edit.addItem', 'Add an item')}
                  value={pickerProductId}
                  onChange={(e) => setPickerProductId(e.target.value)}
                >
                  {products.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name} — {MoneyUtil.formatCurrency(p.base_price || '0', 0)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                size="small"
                type="number"
                label={t('orders.edit.qty', 'Qty')}
                value={pickerQuantity}
                onChange={(e) => setPickerQuantity(e.target.value)}
                sx={{ width: 90 }}
              />
              <Button
                startIcon={<AddIcon />}
                variant="outlined"
                disabled={!pickerProductId || !!unfilledGroup}
                onClick={handleStageAddition}
              >
                {t('orders.edit.add', 'Add')}
              </Button>
            </Stack>

            {pickerGroups.map((g) => (
              <Box key={g.id}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>
                  {g.name} {g.min_selection > 0 || g.is_required ? `(${t('pos.options.required')})` : ''}
                </Typography>
                <Stack direction="row" sx={{ flexWrap: 'wrap', columnGap: 2 }}>
                  {(g.items || []).map((item) => (
                    <FormControlLabel
                      key={item.id}
                      control={
                        <Checkbox
                          size="small"
                          checked={pickerOptionIds.includes(item.id)}
                          onChange={(e) => toggleOption(g, item.id, e.target.checked)}
                        />
                      }
                      label={
                        MoneyUtil.greaterThan(item.price_delta || '0', '0')
                          ? `${item.name} (+${MoneyUtil.formatCurrency(item.price_delta, 0)})`
                          : item.name
                      }
                    />
                  ))}
                </Stack>
              </Box>
            ))}
            {unfilledGroup && (
              <Typography variant="caption" color="warning.main">
                {t('pos.comboChooseSlot', { slot: unfilledGroup.name })}
              </Typography>
            )}

            {needsReason && (
              <FormControl size="small" fullWidth required>
                <InputLabel>{t('orders.edit.reason', 'Void reason')}</InputLabel>
                <Select
                  label={t('orders.edit.reason', 'Void reason')}
                  value={reasonCodeId}
                  onChange={(e) => setReasonCodeId(e.target.value)}
                >
                  {reasonCodes
                    .filter((rc) => rc.is_active !== false && (!rc.applies_to?.length || rc.applies_to.includes('ITEM_VOID')))
                    .map((rc) => (
                    <MenuItem key={rc.id} value={rc.id}>
                      {rc.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Typography variant="h6">
                {t('orders.edit.newTotal', 'New line total')}: {MoneyUtil.formatCurrency(projectedTotal, 0)}
              </Typography>
            </Box>
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={() => commit()}
            disabled={saving || !hasChanges || (needsReason && !reasonCodeId)}
            startIcon={saving ? <CircularProgress size={16} /> : undefined}
          >
            {t('orders.edit.apply', 'Apply changes')}
          </Button>
        </DialogActions>
      </Dialog>

      <ApprovalModal
        open={approvalOpen}
        onClose={() => setApprovalOpen(false)}
        onSuccess={(_pin, requestId) => {
          setApprovalOpen(false);
          commit(requestId);
        }}
        actionName="EDIT_ORDER"
        entityType="ORDER"
        entityId={order.id}
        detailsText={t('orders.edit.approvalDetails', 'Line changes outside the cashier edit window')}
        createRequest
      />
    </>
  );
}
