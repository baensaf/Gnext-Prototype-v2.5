import type { Branch } from 'src/api/tenantApi';
import type { PriceList, PriceGrid, ListPriceChange } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { memo, useMemo, useState, useEffect, useCallback } from 'react';

import { alpha } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  Box,
  Card,
  Menu,
  Paper,
  Stack,
  Alert,
  Table,
  Button,
  Dialog,
  Select,
  Switch,
  MenuItem,
  TableRow,
  InputBase,
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
  ToggleButton,
  DialogActions,
  DialogContent,
  TableContainer,
  InputAdornment,
  FormControlLabel,
  ToggleButtonGroup,
} from '@mui/material';

import { RouterLink } from 'src/routes/components';

import { MoneyUtil } from 'src/utils/money.util';
import { toToman, fromToman } from 'src/utils/currency';

import { tenantApi } from 'src/api/tenantApi';
import { catalogApi } from 'src/api/catalogApi';

import { ConfirmDialog } from 'src/components/confirm-dialog';

type Channel = 'IN_STORE' | 'SNAPPFOOD';
type Row = PriceGrid['items'][number];

const BASE = '';
const ALL = '';

/** Persian and Arabic digits as the Latin ones a price is stored with; anything else dropped. */
const digitsOnly = (value: string) =>
  value.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[^0-9]/g, '');

/** A saved price as the toman figure its box shows; drafts are typed in tomans too. */
const shown = (price: string | null | undefined) => (price ? toToman(price) : '');

/** A draft's key: the channel, the list and the item. */
const cellKey = (channel: Channel, listId: string, row: Pick<Row, 'product_id' | 'variant_id'>) =>
  `${channel}|${listId}|${row.product_id}|${row.variant_id || ''}`;

/** What a list's box holds before any draft: its own price on the channel, or nothing. */
const savedOf = (row: Row, listId: string, channel: Channel) => {
  const cell = row.lists[listId];
  return channel === 'SNAPPFOOD' ? cell?.snappfood : cell?.price;
};

/** What the item sells for when the box is empty: base in store, the in-store price plus markup on Snappfood. */
const fallbackOf = (row: Row, listId: string, channel: Channel) =>
  channel === 'SNAPPFOOD' ? row.lists[listId]?.snappfood_fallback || row.base_snappfood : row.base_price;

/**
 * Price lists, as one grid: every item down the side, the base price and each list across.
 * An empty box sells at the base price (in store) or at the in-store price plus the markup (on
 * Snappfood). Edits stay as drafts until "Save changes" sends them all together. Which list each
 * branch uses is set above the grid, the only place it is set.
 */
export function PriceListsPage() {
  const { t } = useTranslation();
  const [grid, setGrid] = useState<PriceGrid | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [channel, setChannel] = useState<Channel>('IN_STORE');
  const [categoryId, setCategoryId] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const [onlyPriced, setOnlyPriced] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newDialog, setNewDialog] = useState<{ name: string; copyFrom: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [archiving, setArchiving] = useState<PriceList | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; list: PriceList } | null>(null);

  const fail = useCallback((err: any, fallback: string) => setError(err?.detail || err?.message || fallback), []);

  const load = useCallback(async () => {
    try {
      const [g, bs] = await Promise.all([catalogApi.getPriceGrid(), tenantApi.getBranches()]);
      setGrid(g);
      // Only restaurants sell, so only they have prices.
      setBranches(bs.filter((b) => b.is_active && (!b.branch_type || b.branch_type === 'RESTAURANT')));
    } catch (err: any) {
      fail(err, t('pricing.priceLists.loadFailed'));
    }
  }, [fail, t]);

  useEffect(() => {
    load();
  }, [load]);

  const lists = useMemo(() => grid?.lists || [], [grid]);

  /** Drafts that differ from what is saved, as the changes to send. */
  const changes = useMemo(() => {
    if (!grid) return [] as ListPriceChange[];
    const out: ListPriceChange[] = [];
    for (const row of grid.items) {
      for (const list of lists) {
        for (const ch of ['IN_STORE', 'SNAPPFOOD'] as Channel[]) {
          const draft = drafts[cellKey(ch, list.id, row)];
          if (draft === undefined || draft === shown(savedOf(row, list.id, ch))) continue;
          out.push({
            listId: list.id,
            productId: row.product_id,
            variantId: row.variant_id,
            amount: draft === '' ? null : fromToman(draft),
            channel: ch === 'SNAPPFOOD' ? 'SNAPPFOOD' : null,
          });
        }
      }
    }
    return out;
  }, [grid, lists, drafts]);

  const dirty = changes.length > 0;

  // Leaving the page with unsaved prices asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = async () => {
    setSaving(true);
    try {
      const { saved } = await catalogApi.setListPrices(changes);
      setDrafts({});
      setNotice(t('pricing.priceLists.saved', { count: saved }));
      await load();
    } catch (err: any) {
      fail(err, t('pricing.priceLists.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const setDraft = useCallback((key: string, value: string) => setDrafts((prev) => ({ ...prev, [key]: digitsOnly(value) })), []);
  const dropDraft = useCallback(
    (key: string) =>
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      }),
    []
  );

  const listOfBranch = (branchId: string) => lists.find((l) => l.branch_ids.includes(branchId))?.id || BASE;

  const assign = async (branchId: string, listId: string) => {
    try {
      await catalogApi.assignBranchPriceList(branchId, listId || null);
      await load();
    } catch (err: any) {
      fail(err, t('pricing.priceLists.saveFailed'));
    }
  };

  const create = async () => {
    if (!newDialog?.name.trim()) return;
    try {
      await catalogApi.createPriceList(newDialog.name.trim(), newDialog.copyFrom || null);
      setNewDialog(null);
      await load();
    } catch (err: any) {
      fail(err, t('pricing.priceLists.saveFailed'));
    }
  };

  const rename = async () => {
    if (!renaming?.name.trim()) return;
    try {
      await catalogApi.updatePriceList(renaming.id, { name: renaming.name.trim() });
      setRenaming(null);
      await load();
    } catch (err: any) {
      fail(err, t('pricing.priceLists.saveFailed'));
    }
  };

  const archive = async () => {
    if (!archiving) return;
    try {
      await catalogApi.archivePriceList(archiving.id);
      setNotice(t('pricing.priceLists.archived', { name: archiving.name }));
      // Its drafts go with it.
      setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => k.split('|')[1] !== archiving.id)));
      setArchiving(null);
      await load();
    } catch (err: any) {
      fail(err, t('pricing.priceLists.saveFailed'));
    }
  };

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (grid?.items || []).filter(
      (r) =>
        (!categoryId || r.category_id === categoryId) &&
        (!needle || r.name.toLowerCase().includes(needle)) &&
        (!onlyPriced || lists.some((l) => savedOf(r, l.id, channel) || drafts[cellKey(channel, l.id, r)]))
    );
  }, [grid, categoryId, search, onlyPriced, lists, channel, drafts]);

  const categoryName = useMemo(() => new Map((grid?.categories || []).map((c) => [c.id, c.name])), [grid]);
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name || id.slice(0, 8);

  /** Enter moves down the column, as in a spreadsheet. */
  const moveDown = useCallback((rowIndex: number, col: number) => {
    const next = document.querySelector<HTMLInputElement>(`[data-cell="${rowIndex + 1}:${col}"]`);
    if (next) {
      next.focus();
      next.select();
    }
  }, []);

  if (!grid) {
    return (
      <Box>
        {error && <Alert severity="error">{error}</Alert>}
      </Box>
    );
  }

  return (
    <Box sx={{ pb: dirty ? 10 : 0 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3, justifyContent: 'space-between', alignItems: { sm: 'flex-start' } }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('pricing.priceLists.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 760 }}>
            {t('pricing.priceLists.subtitle')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <Button component={RouterLink} href="/app/pricing/changes" variant="outlined">
            {t('pricing.priceLists.changeByPercent')}
          </Button>
          <Button startIcon={<AddIcon />} variant="contained" onClick={() => setNewDialog({ name: '', copyFrom: '' })}>
            {t('pricing.priceLists.newList')}
          </Button>
        </Stack>
      </Stack>

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

      {lists.length === 0 ? (
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              {t('pricing.priceLists.noLists')}
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="subtitle1" sx={{ mb: 2 }}>
                {t('pricing.priceLists.branchesTitle')}
              </Typography>
              <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' } }}>
                {branches.map((b) => (
                  <FormControl key={b.id} size="small" fullWidth>
                    <InputLabel shrink>{b.name}</InputLabel>
                    <Select label={b.name} notched displayEmpty value={listOfBranch(b.id)} onChange={(e) => assign(b.id, e.target.value)}>
                      <MenuItem value={BASE}>{t('pricing.priceLists.basePrices')}</MenuItem>
                      {lists.map((l) => (
                        <MenuItem key={l.id} value={l.id}>
                          {l.name}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                ))}
              </Box>
            </CardContent>
          </Card>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2, alignItems: { md: 'center' } }}>
            <ToggleButtonGroup size="small" exclusive value={channel} onChange={(_, v) => v && setChannel(v)}>
              <ToggleButton value="IN_STORE">{t('pricing.priceLists.inStore')}</ToggleButton>
              <ToggleButton value="SNAPPFOOD">{t('pricing.priceLists.snappfood')}</ToggleButton>
            </ToggleButtonGroup>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <Select value={categoryId} displayEmpty onChange={(e) => setCategoryId(e.target.value)}>
                <MenuItem value={ALL}>{t('pricing.priceLists.allCategories')}</MenuItem>
                {grid.categories.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              placeholder={t('pricing.priceLists.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ maxWidth: { md: 280 } }}
              fullWidth
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
            />
            <FormControlLabel control={<Switch checked={onlyPriced} onChange={(e) => setOnlyPriced(e.target.checked)} />} label={t('pricing.priceLists.onlyPriced')} />
          </Stack>

          <TableContainer component={Card} sx={{ maxHeight: 'calc(100vh - 220px)' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 220, left: 0, zIndex: 3 }}>{t('pricing.priceLists.item')}</TableCell>
                  <TableCell align="right" sx={{ minWidth: 120 }}>
                    {channel === 'SNAPPFOOD' ? t('pricing.priceLists.baseSnappfood') : t('pricing.priceLists.basePrice')}
                  </TableCell>
                  {lists.map((l) => (
                    <TableCell key={l.id} align="right" sx={{ minWidth: 150, verticalAlign: 'top' }}>
                      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                        <Box sx={{ textAlign: 'right' }}>
                          <Typography variant="subtitle2">{l.name}</Typography>
                          <Typography variant="caption" color={l.branch_ids.length ? 'text.secondary' : 'warning.main'} title={l.branch_ids.map(branchName).join(', ')}>
                            {l.branch_ids.length ? t('pricing.priceLists.branchCount', { count: l.branch_ids.length }) : t('pricing.priceLists.noBranches')}
                          </Typography>
                        </Box>
                        <IconButton size="small" aria-label={t('pricing.priceLists.listMenu', { name: l.name })} onClick={(e) => setMenu({ anchor: e.currentTarget, list: l })}>
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={lists.length + 2}>
                      <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                        {t('pricing.priceLists.noItems')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r, i) => (
                  <React.Fragment key={`${r.product_id}:${r.variant_id || ''}`}>
                    {!categoryId && (i === 0 || rows[i - 1].category_id !== r.category_id) && (
                      <TableRow>
                        <TableCell colSpan={lists.length + 2} sx={{ bgcolor: 'background.neutral', fontWeight: 'bold', py: 0.75 }}>
                          {categoryName.get(r.category_id) || ''}
                        </TableCell>
                      </TableRow>
                    )}
                    <GridRow
                      row={r}
                      rowIndex={i}
                      lists={lists}
                      channel={channel}
                      values={lists.map((l) => drafts[cellKey(channel, l.id, r)])}
                      onDraft={setDraft}
                      onDrop={dropDraft}
                      onEnter={moveDown}
                    />
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {dirty && (
        <Paper
          elevation={8}
          sx={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1200, px: 2, py: 1.5, borderRadius: 2 }}
        >
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Typography variant="body2">{t('pricing.priceLists.unsaved', { count: changes.length })}</Typography>
            <Button color="inherit" disabled={saving} onClick={() => setDrafts({})}>
              {t('pricing.priceLists.discard')}
            </Button>
            <Button variant="contained" disabled={saving} onClick={save}>
              {t('pricing.priceLists.saveChanges')}
            </Button>
          </Stack>
        </Paper>
      )}

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem
          onClick={() => {
            if (menu) setRenaming({ id: menu.list.id, name: menu.list.name });
            setMenu(null);
          }}
        >
          {t('pricing.priceLists.rename')}
        </MenuItem>
        <MenuItem
          sx={{ color: 'error.main' }}
          onClick={() => {
            if (menu) setArchiving(menu.list);
            setMenu(null);
          }}
        >
          {t('pricing.priceLists.archive')}
        </MenuItem>
      </Menu>

      <Dialog open={!!newDialog} onClose={() => setNewDialog(null)} fullWidth maxWidth="xs">
        <DialogTitle>{t('pricing.priceLists.newList')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label={t('pricing.priceLists.name')}
            helperText={t('pricing.priceLists.nameHelp')}
            value={newDialog?.name || ''}
            onChange={(e) => setNewDialog((d) => (d ? { ...d, name: e.target.value } : d))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create();
            }}
          />
          {lists.length > 0 && (
            <TextField
              select
              fullWidth
              margin="dense"
              label={t('pricing.priceLists.copyFrom')}
              helperText={t('pricing.priceLists.copyHelp')}
              value={newDialog?.copyFrom || ''}
              onChange={(e) => setNewDialog((d) => (d ? { ...d, copyFrom: e.target.value } : d))}
              slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
            >
              <MenuItem value="">{t('pricing.priceLists.copyNone')}</MenuItem>
              {lists.map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.name}
                </MenuItem>
              ))}
            </TextField>
          )}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setNewDialog(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="contained" disabled={!newDialog?.name.trim()} onClick={create}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!renaming} onClose={() => setRenaming(null)} fullWidth maxWidth="xs">
        <DialogTitle>{t('pricing.priceLists.rename')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label={t('pricing.priceLists.name')}
            value={renaming?.name || ''}
            onChange={(e) => setRenaming((d) => (d ? { ...d, name: e.target.value } : d))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') rename();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setRenaming(null)}>
            {t('common.cancel')}
          </Button>
          <Button variant="contained" disabled={!renaming?.name.trim()} onClick={rename}>
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

type GridRowProps = {
  row: Row;
  rowIndex: number;
  lists: PriceList[];
  channel: Channel;
  /** This row's draft per list, in list order; undefined where the box is untouched. */
  values: (string | undefined)[];
  onDraft: (key: string, value: string) => void;
  onDrop: (key: string) => void;
  onEnter: (rowIndex: number, col: number) => void;
};

/** One item's row. Memoised, so typing in one box redraws only its own row. */
const GridRow = memo(
  ({ row, rowIndex, lists, channel, values, onDraft, onDrop, onEnter }: GridRowProps) => {
    const { t } = useTranslation();
    const base = channel === 'SNAPPFOOD' ? row.base_snappfood : row.base_price;
    return (
      <TableRow hover>
        <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1 }}>{row.name}</TableCell>
        <TableCell align="right" sx={{ color: channel === 'SNAPPFOOD' ? 'text.secondary' : undefined, whiteSpace: 'nowrap' }}>
          {MoneyUtil.formatCurrency(base)}
        </TableCell>
        {lists.map((l, col) => {
          const key = cellKey(channel, l.id, row);
          const saved = shown(savedOf(row, l.id, channel));
          const value = values[col] ?? saved;
          const changed = values[col] !== undefined && values[col] !== saved;
          // How far the list sits from what the item sells for without it.
          const against = toToman(fallbackOf(row, l.id, channel));
          const delta = value && against && Number(against) > 0 ? Math.round(((Number(value) - Number(against)) / Number(against)) * 100) : null;
          return (
            <TableCell key={l.id} align="right" sx={{ py: 0.5 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'flex-end' }}>
                {delta !== null && delta !== 0 && (
                  <Typography variant="caption" sx={{ color: delta > 0 ? 'success.main' : 'error.main', whiteSpace: 'nowrap' }}>
                    {delta > 0 ? '+' : ''}
                    {delta}%
                  </Typography>
                )}
                <InputBase
                  value={value}
                  placeholder={toToman(fallbackOf(row, l.id, channel))}
                  onChange={(e) => onDraft(key, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onEnter(rowIndex, col);
                    if (e.key === 'Escape') onDrop(key);
                  }}
                  inputProps={{
                    'data-cell': `${rowIndex}:${col}`,
                    inputMode: 'numeric',
                    'aria-label': `${row.name} — ${l.name}`,
                    title: t('pricing.priceLists.cellHelp'),
                    style: { textAlign: 'right' },
                  }}
                  sx={(theme) => ({
                    width: 120,
                    px: 1,
                    borderRadius: 1,
                    border: `1px solid ${changed ? theme.palette.warning.main : theme.palette.divider}`,
                    bgcolor: changed ? alpha(theme.palette.warning.main, 0.12) : 'transparent',
                    fontWeight: value ? 600 : 400,
                  })}
                />
              </Stack>
            </TableCell>
          );
        })}
      </TableRow>
    );
  },
  (a, b) =>
    a.row === b.row &&
    a.rowIndex === b.rowIndex &&
    a.lists === b.lists &&
    a.channel === b.channel &&
    a.values.length === b.values.length &&
    a.values.every((v, i) => v === b.values[i])
);
