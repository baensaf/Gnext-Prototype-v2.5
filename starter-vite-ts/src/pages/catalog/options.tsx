import type { Product, OptionGroup } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Box,
  Card,
  Chip,
  Grid,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Drawer,
  Dialog,
  TableRow,
  Checkbox,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  CardContent,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
  FormControlLabel,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';

import { catalogApi } from 'src/api/catalogApi';

import { OptionGroupEditDialog } from './option-group-edit-dialog';

export function OptionsPage() {
  const { t } = useTranslation();

  const [optionGroups, setOptionGroups] = useState<OptionGroup[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Group Form
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [minSelection, setMinSelection] = useState(0);
  const [maxSelection, setMaxSelection] = useState(1);
  const [isRequired, setIsRequired] = useState(false);

  // Item Form Dialog
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [itemCode, setItemCode] = useState('');
  const [itemName, setItemName] = useState('');
  const [priceDelta, setPriceDelta] = useState('150000');
  // A combo slot's choice can be a dish of its own, so it follows that dish's availability.
  const [itemProductId, setItemProductId] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [editingGroup, setEditingGroup] = useState<OptionGroup | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [data, productList] = await Promise.all([
        catalogApi.getOptionGroups(),
        catalogApi.getProducts().catch(() => [] as Product[]),
      ]);
      setOptionGroups(data);
      setProducts(productList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('catalog.optionsPage.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await catalogApi.createOptionGroup({
        code,
        name,
        min_selection: minSelection,
        max_selection: maxSelection,
        is_required: isRequired,
      });
      setGroupDrawerOpen(false);
      setCode('');
      setName('');
      setMinSelection(0);
      setMaxSelection(1);
      setIsRequired(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('catalog.optionsPage.errors.createGroupFailed'));
    }
  };

  const handleAddItem = async () => {
    if (!selectedGroupId || !itemCode || (!itemName && !itemProductId)) return;
    try {
      await catalogApi.createOptionItem(selectedGroupId, {
        code: itemCode,
        name: itemName || undefined,
        price_delta: priceDelta,
        product_id: itemProductId || undefined,
      });
      setItemDialogOpen(false);
      setSelectedGroupId(null);
      setItemCode('');
      setItemName('');
      setItemProductId('');
      setPriceDelta('150000');
      loadData();
    } catch (err: any) {
      setError(err.detail || t('catalog.optionsPage.errors.addItemFailed'));
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
              {t('catalog.optionsPage.title')}
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('catalog.optionsPage.subtitle')}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setGroupDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          {t('catalog.optionsPage.newGroup')}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={3}>
        {optionGroups.map((group) => (
          <Grid size={{ xs: 12, md: 6 }} key={group.id}>
            <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
              <CardContent>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <Box>
                    <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                      {group.name} (<code>{group.code}</code>)
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                      <Chip
                        label={`${t('catalog.optionsPage.minSelection')}: ${group.min_selection} | ${t('catalog.optionsPage.maxSelection')}: ${group.max_selection}`}
                        size="small"
                        color="info"
                      />
                      {group.is_required && (
                        <Chip label={t('catalog.optionsPage.requiredBadge')} color="error" size="small" sx={{ fontWeight: 'bold' }} />
                      )}
                    </Stack>
                  </Box>

                  <Stack direction="row" spacing={1}>
                    <Button size="small" startIcon={<EditIcon />} onClick={() => setEditingGroup(group)}>
                      {t('catalog.optionsPage.edit', 'Edit')}
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      startIcon={<DeleteIcon />}
                      onClick={async () => {
                        if (
                          !window.confirm(
                            t(
                              'catalog.optionsPage.deleteGroupConfirm',
                              'Delete this add-on group? It comes off every product that has it.'
                            )
                          )
                        )
                          return;
                        try {
                          await catalogApi.deleteOptionGroup(group.id);
                          loadData();
                        } catch (err: any) {
                          setError(err.detail || t('catalog.optionsPage.errors.saveGroupFailed', 'Could not save the add-on group'));
                        }
                      }}
                    >
                      {t('catalog.optionsPage.delete', 'Delete')}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<AddIcon />}
                      onClick={() => {
                        setSelectedGroupId(group.id);
                        setItemDialogOpen(true);
                      }}
                    >
                      {t('catalog.optionsPage.addItem')}
                    </Button>
                  </Stack>
                </Stack>

                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('catalog.optionsPage.itemCode')}</TableCell>
                        <TableCell>{t('catalog.optionsPage.itemName')}</TableCell>
                        <TableCell align="right">{t('catalog.optionsPage.priceDeltaLabel')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(!group.items || group.items.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={3} align="center">
                            {t('catalog.optionsPage.noItems')}
                          </TableCell>
                        </TableRow>
                      )}
                      {group.items?.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell><code>{item.code}</code></TableCell>
                          <TableCell sx={{ fontWeight: 'bold' }}>{item.name}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                            <span dir="ltr">
                              {MoneyUtil.greaterThan(item.price_delta || '0', '0')
                                ? `+${MoneyUtil.formatCurrency(item.price_delta)} IRR`
                                : '0 IRR'}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <OptionGroupEditDialog
        group={editingGroup}
        onClose={() => setEditingGroup(null)}
        onSaved={() => {
          setEditingGroup(null);
          loadData();
        }}
      />

      {/* Create Option Group Drawer */}
      <Drawer anchor="right" open={groupDrawerOpen} onClose={() => setGroupDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            {t('catalog.optionsPage.createDrawerTitle')}
          </Typography>
          <form onSubmit={handleCreateGroup}>
            <Stack spacing={2.5}>
              <TextField
                label={t('catalog.optionsPage.groupCode')}
                placeholder="e.g. GRP-TOPPINGS"
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <TextField
                label={t('catalog.optionsPage.groupName')}
                placeholder="e.g. Extra Pizza Toppings"
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  label={t('catalog.optionsPage.minSelection')}
                  type="number"
                  fullWidth
                  value={minSelection}
                  onChange={(e) => setMinSelection(parseInt(e.target.value, 10) || 0)}
                />
                <TextField
                  label={t('catalog.optionsPage.maxSelection')}
                  type="number"
                  fullWidth
                  value={maxSelection}
                  onChange={(e) => setMaxSelection(parseInt(e.target.value, 10) || 1)}
                />
              </Stack>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={isRequired}
                    onChange={(e) => setIsRequired(e.target.checked)}
                  />
                }
                label={t('catalog.optionsPage.isRequired')}
              />
              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                {t('catalog.optionsPage.submitCreateGroup')}
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>

      {/* Add Option Item Dialog */}
      <Dialog open={itemDialogOpen} onClose={() => setItemDialogOpen(false)}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('catalog.optionsPage.addItemModalTitle')}
        </DialogTitle>
        <DialogContent sx={{ minWidth: 360, pt: 2 }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t('catalog.optionsPage.itemCode')}
              placeholder="e.g. OPT-EXTRACHEESE"
              required
              fullWidth
              value={itemCode}
              onChange={(e) => setItemCode(e.target.value.toUpperCase())}
            />
            <TextField
              select
              label={t('catalog.optionsPage.itemProduct')}
              helperText={t('catalog.optionsPage.itemProductHelp')}
              fullWidth
              value={itemProductId}
              onChange={(e) => setItemProductId(e.target.value)}
            >
              <MenuItem value="">{t('catalog.optionsPage.noProduct')}</MenuItem>
              {products.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={t('catalog.optionsPage.itemName')}
              placeholder="e.g. Extra Mozzarella Cheese"
              required={!itemProductId}
              fullWidth
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
            />
            <TextField
              label={t('catalog.optionsPage.priceDelta')}
              type="number"
              required
              fullWidth
              value={priceDelta}
              onChange={(e) => setPriceDelta(e.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setItemDialogOpen(false)}>{t('catalog.optionsPage.cancel')}</Button>
          <Button variant="contained" onClick={handleAddItem} sx={{ fontWeight: 'bold' }}>
            {t('catalog.optionsPage.submitAddItem')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
