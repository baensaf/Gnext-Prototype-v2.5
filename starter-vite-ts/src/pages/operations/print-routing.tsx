import type { Product, Category } from 'src/api/catalogApi';
import type { RouteSource, PrinterRoutes, PrinterDevice, ProductRouting, KitchenChitPreview } from 'src/api/printingApi';

import { useTranslation } from 'react-i18next';
import { useMemo, useState, useEffect, useCallback } from 'react';

import EditIcon from '@mui/icons-material/Edit';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import {
  Box,
  Tab,
  Card,
  Chip,
  Tabs,
  Table,
  Stack,
  Alert,
  Button,
  Dialog,
  Select,
  Switch,
  Tooltip,
  MenuItem,
  TableRow,
  useTheme,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  InputLabel,
  DialogTitle,
  FormControl,
  Autocomplete,
  DialogContent,
  DialogActions,
  InputAdornment,
  CircularProgress,
} from '@mui/material';

import { RouterLink } from 'src/routes/components';

import { catalogApi } from 'src/api/catalogApi';
import { printingApi } from 'src/api/printingApi';
import { useScopedBranchId } from 'src/contexts/branch-context';

import { toast } from 'src/components/snackbar';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

const EMPTY_ROUTES = { category_ids: [] as string[], product_ids: [] as string[] };

/** What a routing dialog edits: one printer, or (no id) the branch's "not printed" list. */
type Target = { id: string | null; name: string };

const SOURCE_COLOR: Record<RouteSource, 'primary' | 'info' | 'default' | 'warning' | 'error'> = {
  PRODUCT: 'primary',
  CATEGORY: 'info',
  DEFAULT: 'default',
  NOT_PRINTED: 'warning',
  NOWHERE: 'error',
};

const ORDER_TYPES = ['TAKEAWAY', 'DINE_IN', 'DELIVERY', 'AGGREGATOR'];

/**
 * Which kitchen printer prints what, at one branch. Each printer is given whole categories and
 * single products; a product sent somewhere of its own prints only there, anything not sent
 * anywhere prints on the branch's default kitchen printer, and anything on the "not printed"
 * list prints in no kitchen. A printer at the pass can also print every order whole. The same
 * routing reads item by item on the second tab, and a preview shows the chits an order makes.
 */
export function PrintRoutingPage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [branchId] = useScopedBranchId();

  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [routes, setRoutes] = useState<PrinterRoutes[]>([]);
  const [menuRouting, setMenuRouting] = useState<ProductRouting[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<'printers' | 'items'>('printers');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Target | null>(null);
  const [form, setForm] = useState(EMPTY_ROUTES);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [printerList, routeList, menuList, categoryList, productList] = await Promise.all([
        printingApi.getPrinters(branchId),
        printingApi.getPrintRoutes(branchId),
        printingApi.getMenuRouting(branchId).catch(() => []),
        catalogApi.getCategories().catch(() => []),
        catalogApi.getProducts().catch(() => []),
      ]);
      setPrinters((printerList || []).filter((p) => p.is_active));
      setRoutes(routeList || []);
      setMenuRouting(menuList || []);
      setCategories((categoryList || []).filter((c) => c.is_active !== false));
      setProducts((productList || []).filter((p) => p.is_active !== false));
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.printRouting.loadError'));
    } finally {
      setLoading(false);
    }
  }, [branchId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const printerById = useMemo(() => new Map(printers.map((p) => [p.id, p])), [printers]);
  const categoryName = (id: string) => categoryById.get(id)?.name ?? '';
  const productName = (id: string) => productById.get(id)?.name ?? '';

  /**
   * What a printer (or the "not printed" list) is given, leaving out archived categories and
   * products: their routes stay in the database but name nothing anyone can sell.
   */
  const routesOf = useCallback(
    (printerId: string | null) => {
      const own = routes.find((r) => r.printer_id === printerId) ?? EMPTY_ROUTES;
      return {
        category_ids: own.category_ids.filter((id) => categoryById.has(id)),
        product_ids: own.product_ids.filter((id) => productById.has(id)),
      };
    },
    [routes, categoryById, productById]
  );
  const defaultPrinter = printers.find((p) => p.kitchen_default) ?? printers.find((p) => p.printer_type?.startsWith('KITCHEN'));
  const passPrinters = printers.filter((p) => p.prints_whole_order);

  /** Products nothing sends anywhere: they print on the default kitchen printer. */
  const unrouted = useMemo(() => {
    const routedProducts = new Set(routes.flatMap((r) => r.product_ids));
    const routedCategories = new Set(routes.flatMap((r) => r.category_ids));
    return products.filter((p) => !routedProducts.has(p.id) && !routedCategories.has(p.category_id));
  }, [routes, products]);

  const openEdit = (target: Target) => {
    const current = routesOf(target.id);
    setForm({ category_ids: [...current.category_ids], product_ids: [...current.product_ids] });
    setEditing(target);
  };

  const save = async () => {
    if (!editing || !branchId) return;
    setSaving(true);
    try {
      if (editing.id) await printingApi.setPrinterRoutes(editing.id, form);
      else await printingApi.setNotPrinted(branchId, form);
      toast.success(t('operations.printRouting.saved', { name: editing.name }));
      setEditing(null);
      await load();
    } catch (err: any) {
      toast.error(err.detail || err.message || t('operations.printRouting.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const changeDefault = async (printerId: string) => {
    try {
      await printingApi.setKitchenDefault(printerId);
      await load();
    } catch (err: any) {
      toast.error(err.detail || err.message || t('operations.printRouting.saveError'));
    }
  };

  const toggleWholeOrder = async (printer: PrinterDevice) => {
    const on = !printer.prints_whole_order;
    try {
      await printingApi.updatePrinter(printer.id, { prints_whole_order: on });
      toast.success(t(on ? 'operations.printRouting.wholeOrderOn' : 'operations.printRouting.wholeOrderOff', { name: printer.name }));
      await load();
    } catch (err: any) {
      toast.error(err.detail || err.message || t('operations.printRouting.saveError'));
    }
  };

  const categoryOptions = categories.map((c) => c.id);
  const productOptions = useMemo(
    () =>
      [...products]
        .sort(
          (a, b) =>
            (categoryById.get(a.category_id)?.name ?? '').localeCompare(categoryById.get(b.category_id)?.name ?? '') ||
            a.name.localeCompare(b.name)
        )
        .map((p) => p.id),
    [products, categoryById]
  );

  const routingByProduct = useMemo(() => new Map(menuRouting.map((r) => [r.product_id, r])), [menuRouting]);
  const itemRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return productOptions
      .map((id) => productById.get(id)!)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || (categoryById.get(p.category_id)?.name ?? '').toLowerCase().includes(q));
  }, [productOptions, productById, categoryById, search]);

  const chips = (ids: string[], name: (id: string) => string, color: 'info' | 'default') =>
    ids.length ? (
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {ids.map((id) => (
          <Chip key={id} label={name(id)} size="small" color={color} variant="soft" />
        ))}
      </Box>
    ) : (
      <Typography variant="body2" sx={{ color: 'text.disabled' }}>
        —
      </Typography>
    );

  const endAlign = theme.direction === 'rtl' ? 'left' : 'right';
  const notPrinted = routesOf(null);

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('operations.printRouting.title')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('operations.printRouting.title') },
        ]}
        action={
          <Stack direction="row" spacing={1.5}>
            <Button
              variant="contained"
              startIcon={<ReceiptLongIcon />}
              onClick={() => setPreviewOpen(true)}
              disabled={!branchId || loading || printers.length === 0}
            >
              {t('operations.printRouting.preview')}
            </Button>
            <Button component={RouterLink} href="/app/operations/printers" variant="outlined">
              {t('operations.printRouting.printersLink')}
            </Button>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load}>
              {t('common.refresh', 'Refresh')}
            </Button>
          </Stack>
        }
      />

      <Alert severity="info" sx={{ mb: 3, borderRadius: 2 }}>
        {t('operations.printRouting.hint')}
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!branchId ? (
        <Alert severity="warning">{t('operations.printRouting.chooseBranch')}</Alert>
      ) : loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
          <CircularProgress />
        </Box>
      ) : printers.length === 0 ? (
        <Alert
          severity="warning"
          action={
            <Button component={RouterLink} href="/app/operations/printers" size="small">
              {t('operations.printRouting.printersLink')}
            </Button>
          }
        >
          {t('operations.printRouting.noPrinters')}
        </Alert>
      ) : (
        <Stack spacing={3}>
          <Card sx={{ p: 3 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
              <FormControl sx={{ minWidth: 260 }} size="small">
                <InputLabel>{t('operations.printRouting.defaultPrinter')}</InputLabel>
                <Select
                  label={t('operations.printRouting.defaultPrinter')}
                  value={defaultPrinter?.id ?? ''}
                  onChange={(e) => changeDefault(e.target.value)}
                >
                  {printers.map((p) => (
                    <MenuItem key={p.id} value={p.id}>
                      {p.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('operations.printRouting.defaultHint')}
              </Typography>
            </Stack>
            {unrouted.length > 0 && (
              <Alert severity={defaultPrinter ? 'info' : 'warning'} variant="outlined" sx={{ mt: 2 }}>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {defaultPrinter
                    ? t('operations.printRouting.unrouted', { count: unrouted.length, name: defaultPrinter.name })
                    : t('operations.printRouting.unroutedNoDefault', { count: unrouted.length })}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {unrouted.map((p) => (
                    <Chip key={p.id} label={p.name} size="small" variant="outlined" />
                  ))}
                </Box>
              </Alert>
            )}
            {passPrinters.length > 0 && (
              <Alert severity="success" variant="outlined" sx={{ mt: 2 }}>
                {t('operations.printRouting.wholeOrderNote', { names: passPrinters.map((p) => p.name).join('، ') })}
              </Alert>
            )}
          </Card>

          <Card>
            <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}>
              <Tab value="printers" label={t('operations.printRouting.tabPrinters')} />
              <Tab value="items" label={t('operations.printRouting.tabItems')} />
            </Tabs>

            {tab === 'printers' ? (
              <Box sx={{ p: 3, overflowX: 'auto' }}>
                <Table sx={{ minWidth: 720 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('operations.printRouting.colPrinter')}</TableCell>
                      <TableCell>{t('operations.printRouting.colCategories')}</TableCell>
                      <TableCell>{t('operations.printRouting.colProducts')}</TableCell>
                      <TableCell>
                        <Tooltip title={t('operations.printRouting.wholeOrderHint')}>
                          <span>{t('operations.printRouting.colWholeOrder')}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell align={endAlign} />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {printers.map((printer) => {
                      const own = routesOf(printer.id);
                      return (
                        <TableRow key={printer.id} hover>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>
                            <Typography variant="subtitle2">{printer.name}</Typography>
                            {printer.id === defaultPrinter?.id && (
                              <Chip
                                label={t('operations.printRouting.defaultChip')}
                                size="small"
                                color="primary"
                                variant="soft"
                                sx={{ mt: 0.5 }}
                              />
                            )}
                          </TableCell>
                          <TableCell>{chips(own.category_ids, categoryName, 'info')}</TableCell>
                          <TableCell>{chips(own.product_ids, productName, 'default')}</TableCell>
                          <TableCell>
                            <Switch
                              checked={!!printer.prints_whole_order}
                              onChange={() => toggleWholeOrder(printer)}
                              slotProps={{ input: { 'aria-label': `${t('operations.printRouting.colWholeOrder')}: ${printer.name}` } }}
                            />
                          </TableCell>
                          <TableCell align={endAlign}>
                            <IconButton
                              onClick={() => openEdit({ id: printer.id, name: printer.name })}
                              aria-label={t('operations.printRouting.edit', { name: printer.name })}
                            >
                              <EditIcon />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow hover sx={{ bgcolor: 'background.neutral' }}>
                      <TableCell>
                        <Typography variant="subtitle2">{t('operations.printRouting.notPrintedRow')}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', maxWidth: 220 }}>
                          {t('operations.printRouting.notPrintedHint')}
                        </Typography>
                      </TableCell>
                      <TableCell>{chips(notPrinted.category_ids, categoryName, 'info')}</TableCell>
                      <TableCell>{chips(notPrinted.product_ids, productName, 'default')}</TableCell>
                      <TableCell />
                      <TableCell align={endAlign}>
                        <IconButton
                          onClick={() => openEdit({ id: null, name: t('operations.printRouting.notPrintedRow') })}
                          aria-label={t('operations.printRouting.edit', { name: t('operations.printRouting.notPrintedRow') })}
                        >
                          <EditIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </Box>
            ) : (
              <Box sx={{ p: 3 }}>
                <TextField
                  size="small"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('operations.printRouting.search')}
                  sx={{ mb: 2, width: { xs: 1, sm: 320 } }}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      ),
                    },
                  }}
                />
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" sx={{ minWidth: 640 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('operations.printRouting.colItem')}</TableCell>
                        <TableCell>{t('operations.printRouting.colCategory')}</TableCell>
                        <TableCell>{t('operations.printRouting.colPrintsOn')}</TableCell>
                        <TableCell>{t('operations.printRouting.colWhy')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {itemRows.map((p) => {
                        const routed = routingByProduct.get(p.id);
                        return (
                          <TableRow key={p.id} hover>
                            <TableCell>{p.name}</TableCell>
                            <TableCell sx={{ color: 'text.secondary' }}>{categoryName(p.category_id)}</TableCell>
                            <TableCell>
                              {chips(routed?.printer_ids ?? [], (id) => printerById.get(id)?.name ?? '', 'default')}
                            </TableCell>
                            <TableCell>
                              {routed && (
                                <Chip
                                  size="small"
                                  variant="soft"
                                  color={SOURCE_COLOR[routed.source]}
                                  label={t(`operations.printRouting.source.${routed.source}`)}
                                />
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {itemRows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={4} sx={{ color: 'text.secondary', textAlign: 'center', py: 4 }}>
                            {t('operations.printRouting.noItems')}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Box>
              </Box>
            )}
          </Card>
        </Stack>
      )}

      <Dialog open={!!editing} onClose={() => !saving && setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editing?.id
            ? t('operations.printRouting.dialogTitle', { name: editing?.name ?? '' })
            : t('operations.printRouting.dialogNotPrintedTitle')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {!editing?.id && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('operations.printRouting.notPrintedHint')}
              </Typography>
            )}
            <Autocomplete
              multiple
              options={categoryOptions}
              value={form.category_ids}
              getOptionLabel={categoryName}
              onChange={(_, value) => setForm((f) => ({ ...f, category_ids: value }))}
              renderInput={(params) => <TextField {...params} label={t('operations.printRouting.colCategories')} />}
            />
            <Autocomplete
              multiple
              options={productOptions}
              value={form.product_ids}
              getOptionLabel={productName}
              groupBy={(id) => categoryName(productById.get(id)?.category_id ?? '')}
              onChange={(_, value) => setForm((f) => ({ ...f, product_ids: value }))}
              renderInput={(params) => (
                <TextField {...params} label={t('operations.printRouting.colProducts')} helperText={t('operations.printRouting.productHint')} />
              )}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="contained" onClick={save} loading={saving}>
            {t('common.save', 'Save')}
          </Button>
        </DialogActions>
      </Dialog>

      {branchId && (
        <PreviewDialog
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          branchId={branchId}
          productOptions={productOptions}
          productName={productName}
          groupOf={(id) => categoryName(productById.get(id)?.category_id ?? '')}
        />
      )}
    </Box>
  );
}

// ----------------------------------------------------------------------

type PreviewDialogProps = {
  open: boolean;
  onClose: () => void;
  branchId: string;
  productOptions: string[];
  productName: (id: string) => string;
  groupOf: (id: string) => string;
};

/** Ring up a made-up order and see the chits it prints, as they would come out. Nothing prints. */
function PreviewDialog({ open, onClose, branchId, productOptions, productName, groupOf }: PreviewDialogProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<string[]>([]);
  const [orderType, setOrderType] = useState('TAKEAWAY');
  const [notes, setNotes] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ chits: KitchenChitPreview[]; not_printed: string[] } | null>(null);

  const run = async () => {
    setRunning(true);
    try {
      setResult(await printingApi.previewKitchenChits({ branch_id: branchId, product_ids: items, order_type: orderType, notes: notes || undefined }));
    } catch (err: any) {
      toast.error(err.detail || err.message || t('operations.printRouting.previewError'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{t('operations.printRouting.previewTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('operations.printRouting.previewHint')}
          </Typography>
          <Autocomplete
            multiple
            options={productOptions}
            value={items}
            getOptionLabel={productName}
            groupBy={groupOf}
            onChange={(_, value) => setItems(value)}
            renderInput={(params) => <TextField {...params} label={t('operations.printRouting.previewItems')} />}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>{t('operations.printRouting.previewType')}</InputLabel>
              <Select label={t('operations.printRouting.previewType')} value={orderType} onChange={(e) => setOrderType(e.target.value)}>
                {ORDER_TYPES.map((type) => (
                  <MenuItem key={type} value={type}>
                    {t(`operations.printRouting.orderTypes.${type}`)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              fullWidth
              label={t('operations.printRouting.previewNotes')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <Button variant="contained" onClick={run} loading={running} disabled={items.length === 0} sx={{ flexShrink: 0 }}>
              {t('operations.printRouting.previewRun')}
            </Button>
          </Stack>

          {result && (
            <>
              {result.not_printed.length > 0 && (
                <Alert severity="warning" variant="outlined">
                  {t('operations.printRouting.previewNotPrinted', { names: result.not_printed.join('، ') })}
                </Alert>
              )}
              {result.chits.length === 0 ? (
                <Alert severity="info">{t('operations.printRouting.previewNone')}</Alert>
              ) : (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'flex-start' }}>
                  {result.chits.map((chit, index) => (
                    <Box key={`${chit.printer_id}-${index}`}>
                      <Typography variant="subtitle2" sx={{ mb: 0.5 }} color={chit.in_service ? undefined : 'error'}>
                        {chit.label}
                        {!chit.in_service &&
                          ` — ${chit.printer_id ? t('operations.printRouting.previewOutOfService') : t('operations.printRouting.previewNoPrinter')}`}
                      </Typography>
                      <Box
                        component="iframe"
                        title={chit.label}
                        srcDoc={chit.html}
                        sandbox="allow-same-origin"
                        onLoad={(e: React.SyntheticEvent<HTMLIFrameElement>) => {
                          const frame = e.currentTarget;
                          const height = frame.contentDocument?.body?.scrollHeight;
                          if (height) frame.style.height = `${height + 40}px`;
                        }}
                        sx={{ width: 340, height: 360, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: '#fff' }}
                      />
                    </Box>
                  ))}
                </Box>
              )}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close', 'Close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
