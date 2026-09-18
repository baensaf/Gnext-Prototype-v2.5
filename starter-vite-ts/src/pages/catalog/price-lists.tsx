import type { Branch } from 'src/api/tenantApi';
import type { PriceList, PriceListSheet } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useMemo, useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import ArchiveIcon from '@mui/icons-material/Archive';
import {
  Box,
  Card,
  Chip,
  Stack,
  Alert,
  Table,
  Button,
  Dialog,
  Select,
  MenuItem,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  IconButton,
  Typography,
  InputLabel,
  CardContent,
  DialogTitle,
  FormControl,
  DialogActions,
  DialogContent,
  TableContainer,
  InputAdornment,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';

import { tenantApi } from 'src/api/tenantApi';
import { catalogApi } from 'src/api/catalogApi';

import { ConfirmDialog } from 'src/components/confirm-dialog';

const BASE = '';

/**
 * Branch price lists. A few shared lists hold prices for some items; each branch sells from
 * one list, or at the base price when it has none. An item a list does not price sells at
 * base on that list too. The register, the kiosk and the Snappfood sheet all use these.
 */
export function PriceListsPage() {
  const { t } = useTranslation();
  const [lists, setLists] = useState<PriceList[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedListId, setSelectedListId] = useState<string>('');
  const [sheet, setSheet] = useState<PriceListSheet | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<{ id: string | null; name: string } | null>(null);
  const [archiving, setArchiving] = useState<PriceList | null>(null);

  const fail = useCallback((err: any, fallback: string) => setError(err?.detail || err?.message || fallback), []);

  const loadLists = useCallback(async () => {
    try {
      const [ls, bs] = await Promise.all([catalogApi.getPriceLists(), tenantApi.getBranches()]);
      setLists(ls);
      // Only restaurants sell, so only they have prices.
      setBranches(bs.filter((b) => b.is_active && (!b.branch_type || b.branch_type === 'RESTAURANT')));
      setSelectedListId((current) => (current && ls.some((l) => l.id === current) ? current : ls[0]?.id || ''));
    } catch (err: any) {
      fail(err, t('pricing.priceLists.loadFailed'));
    }
  }, [fail, t]);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  useEffect(() => {
    setDrafts({});
    if (!selectedListId) {
      setSheet(null);
      return;
    }
    catalogApi
      .getPriceListSheet(selectedListId)
      .then(setSheet)
      .catch((err) => fail(err, t('pricing.priceLists.loadFailed')));
  }, [selectedListId, fail, t]);

  const listOfBranch = (branchId: string) => lists.find((l) => l.branch_ids.includes(branchId))?.id || BASE;

  const assign = async (branchId: string, listId: string) => {
    try {
      await catalogApi.assignBranchPriceList(branchId, listId || null);
      await loadLists();
    } catch (err: any) {
      fail(err, t('pricing.priceLists.saveFailed'));
    }
  };

  const saveName = async () => {
    if (!nameDialog?.name.trim()) return;
    try {
      if (nameDialog.id) {
        await catalogApi.updatePriceList(nameDialog.id, { name: nameDialog.name.trim() });
      } else {
        const created = await catalogApi.createPriceList(nameDialog.name.trim());
        setSelectedListId(created.id);
      }
      setNameDialog(null);
      await loadLists();
    } catch (err: any) {
      fail(err, t('pricing.priceLists.saveFailed'));
    }
  };

  const archive = async () => {
    if (!archiving) return;
    try {
      await catalogApi.archivePriceList(archiving.id);
      setNotice(t('pricing.priceLists.archived', { name: archiving.name }));
      setArchiving(null);
      await loadLists();
    } catch (err: any) {
      fail(err, t('pricing.priceLists.saveFailed'));
    }
  };

  const key = (productId: string, variantId: string | null) => `${productId}:${variantId || ''}`;
  const shown = (price: string | null) => (price ? String(Number(price)) : '');

  const savePrice = async (productId: string, variantId: string | null) => {
    const value = (drafts[key(productId, variantId)] ?? '').trim();
    try {
      setSheet(await catalogApi.setListPrice(selectedListId, productId, variantId, value === '' ? null : value));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key(productId, variantId)];
        return next;
      });
      await loadLists();
    } catch (err: any) {
      fail(err, t('pricing.priceLists.saveFailed'));
    }
  };

  const rows = useMemo(
    () => (sheet?.items || []).filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase())),
    [sheet, search]
  );

  const branchName = (id: string) => branches.find((b) => b.id === id)?.name;

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
        {t('pricing.priceLists.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('pricing.priceLists.subtitle')}
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

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} sx={{ mb: 3, alignItems: 'stretch' }}>
        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Stack direction="row" sx={{ mb: 2, alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="h6">{t('pricing.priceLists.listsTitle')}</Typography>
              <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => setNameDialog({ id: null, name: '' })}>
                {t('pricing.priceLists.newList')}
              </Button>
            </Stack>
            {lists.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('pricing.priceLists.noLists')}
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('pricing.priceLists.name')}</TableCell>
                    <TableCell>{t('pricing.priceLists.branches')}</TableCell>
                    <TableCell align="right">{t('pricing.priceLists.pricedItems')}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {lists.map((l) => (
                    <TableRow key={l.id} hover selected={l.id === selectedListId} onClick={() => setSelectedListId(l.id)} sx={{ cursor: 'pointer' }}>
                      <TableCell sx={{ fontWeight: 'bold' }}>{l.name}</TableCell>
                      <TableCell>
                        {l.branch_ids.length === 0 ? (
                          <Typography variant="caption" color="text.secondary">
                            {t('pricing.priceLists.noBranches')}
                          </Typography>
                        ) : (
                          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                            {l.branch_ids.map((id) => (
                              <Chip key={id} size="small" label={branchName(id) || id.slice(0, 8)} />
                            ))}
                          </Stack>
                        )}
                      </TableCell>
                      <TableCell align="right">{l.price_count}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <IconButton
                          size="small"
                          aria-label={t('pricing.priceLists.rename')}
                          onClick={(e) => {
                            e.stopPropagation();
                            setNameDialog({ id: l.id, name: l.name });
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label={t('pricing.priceLists.archive')}
                          onClick={(e) => {
                            e.stopPropagation();
                            setArchiving(l);
                          }}
                        >
                          <ArchiveIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {t('pricing.priceLists.branchesTitle')}
            </Typography>
            <Table size="small">
              <TableBody>
                {branches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>{b.name}</TableCell>
                    <TableCell align="right">
                      <Select size="small" value={listOfBranch(b.id)} displayEmpty onChange={(e) => assign(b.id, e.target.value)} sx={{ minWidth: 200 }}>
                        <MenuItem value={BASE}>{t('pricing.priceLists.basePrices')}</MenuItem>
                        {lists.map((l) => (
                          <MenuItem key={l.id} value={l.id}>
                            {l.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </Stack>

      {lists.length > 0 && (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
            <FormControl size="small" sx={{ minWidth: 240 }}>
              <InputLabel>{t('pricing.priceLists.pricesOf')}</InputLabel>
              <Select value={selectedListId} label={t('pricing.priceLists.pricesOf')} onChange={(e) => setSelectedListId(e.target.value)}>
                {lists.map((l) => (
                  <MenuItem key={l.id} value={l.id}>
                    {l.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              placeholder={t('pricing.priceLists.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ maxWidth: 360 }}
              fullWidth
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
            />
          </Stack>

          <TableContainer component={Card}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('pricing.priceLists.item')}</TableCell>
                  <TableCell align="right">{t('pricing.priceLists.basePrice')}</TableCell>
                  <TableCell align="right">{t('pricing.priceLists.listPrice')}</TableCell>
                  <TableCell align="right">{t('pricing.priceLists.charged')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => {
                  const k = key(r.product_id, r.variant_id);
                  const draft = drafts[k];
                  const changed = draft !== undefined && draft !== shown(r.list_price);
                  return (
                    <TableRow key={k}>
                      <TableCell>{r.name}</TableCell>
                      <TableCell align="right">{MoneyUtil.formatCurrency(r.base_price)}</TableCell>
                      <TableCell align="right">
                        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', alignItems: 'center' }}>
                          <TextField
                            size="small"
                            type="number"
                            placeholder={t('pricing.priceLists.usesBase')}
                            value={draft ?? shown(r.list_price)}
                            onChange={(e) => setDrafts((prev) => ({ ...prev, [k]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && changed) savePrice(r.product_id, r.variant_id);
                            }}
                            sx={{ width: 150 }}
                          />
                          <Button size="small" disabled={!changed} onClick={() => savePrice(r.product_id, r.variant_id)}>
                            {t('common.save')}
                          </Button>
                        </Stack>
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                        {MoneyUtil.formatCurrency(r.price)}
                        {r.list_price && <Chip size="small" color="primary" label={t('pricing.priceLists.onList')} sx={{ ml: 1 }} />}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      <Dialog open={!!nameDialog} onClose={() => setNameDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle>{nameDialog?.id ? t('pricing.priceLists.rename') : t('pricing.priceLists.newList')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label={t('pricing.priceLists.name')}
            helperText={nameDialog?.id ? undefined : t('pricing.priceLists.nameHelp')}
            value={nameDialog?.name || ''}
            onChange={(e) => setNameDialog((d) => (d ? { ...d, name: e.target.value } : d))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setNameDialog(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="contained" disabled={!nameDialog?.name.trim()} onClick={saveName}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!archiving}
        onClose={() => setArchiving(null)}
        onConfirm={archive}
        title={t('pricing.priceLists.archiveTitle', { name: archiving?.name || '' })}
        content={t('pricing.priceLists.archiveBody')}
        confirmLabel={t('pricing.priceLists.archive')}
      />
    </Box>
  );
}
