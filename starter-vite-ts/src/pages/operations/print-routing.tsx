import type { Product, Category } from 'src/api/catalogApi';
import type { PrinterRoutes, PrinterDevice } from 'src/api/printingApi';

import { useTranslation } from 'react-i18next';
import { useMemo, useState, useEffect, useCallback } from 'react';

import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Box,
  Card,
  Chip,
  Table,
  Stack,
  Alert,
  Button,
  Dialog,
  Select,
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
  CircularProgress,
} from '@mui/material';

import { RouterLink } from 'src/routes/components';

import { catalogApi } from 'src/api/catalogApi';
import { printingApi } from 'src/api/printingApi';
import { useScopedBranchId } from 'src/contexts/branch-context';

import { toast } from 'src/components/snackbar';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

const EMPTY_ROUTES = { category_ids: [] as string[], product_ids: [] as string[] };

/**
 * Which kitchen printer prints what, at one branch. Each printer is given whole categories and
 * single products; a product sent somewhere of its own prints only there, and anything not sent
 * anywhere prints on the branch's default kitchen printer.
 */
export function PrintRoutingPage() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [branchId] = useScopedBranchId();

  const [printers, setPrinters] = useState<PrinterDevice[]>([]);
  const [routes, setRoutes] = useState<PrinterRoutes[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<PrinterDevice | null>(null);
  const [form, setForm] = useState(EMPTY_ROUTES);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [printerList, routeList, categoryList, productList] = await Promise.all([
        printingApi.getPrinters(branchId),
        printingApi.getPrintRoutes(branchId),
        catalogApi.getCategories().catch(() => []),
        catalogApi.getProducts().catch(() => []),
      ]);
      setPrinters((printerList || []).filter((p) => p.is_active));
      setRoutes(routeList || []);
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

  const routesOf = useCallback((printerId: string) => routes.find((r) => r.printer_id === printerId) ?? EMPTY_ROUTES, [routes]);
  const defaultPrinter = printers.find((p) => p.kitchen_default) ?? printers.find((p) => p.printer_type?.startsWith('KITCHEN'));
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;
  const productName = (id: string) => products.find((p) => p.id === id)?.name ?? id;

  /** Products nothing sends anywhere: they print on the default kitchen printer. */
  const unrouted = useMemo(() => {
    const routedProducts = new Set(routes.flatMap((r) => r.product_ids));
    const routedCategories = new Set(routes.flatMap((r) => r.category_ids));
    return products.filter((p) => !routedProducts.has(p.id) && !routedCategories.has(p.category_id));
  }, [routes, products]);

  const openEdit = (printer: PrinterDevice) => {
    const current = routesOf(printer.id);
    setForm({ category_ids: [...current.category_ids], product_ids: [...current.product_ids] });
    setEditing(printer);
  };

  const save = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await printingApi.setPrinterRoutes(editing.id, form);
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

  const categoryOptions = categories.map((c) => c.id);
  const productOptions = [...products]
    .sort((a, b) => categoryName(a.category_id).localeCompare(categoryName(b.category_id)))
    .map((p) => p.id);

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
          <Card sx={{ p: 3, borderRadius: 2 }}>
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
          </Card>

          <Card sx={{ p: 3, borderRadius: 2 }}>
            <Box sx={{ overflowX: 'auto' }}>
              <Table sx={{ minWidth: 640 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('operations.printRouting.colPrinter')}</TableCell>
                    <TableCell>{t('operations.printRouting.colCategories')}</TableCell>
                    <TableCell>{t('operations.printRouting.colProducts')}</TableCell>
                    <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'} />
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
                            <Chip label={t('operations.printRouting.defaultChip')} size="small" color="primary" variant="soft" sx={{ mt: 0.5 }} />
                          )}
                        </TableCell>
                        <TableCell>
                          {own.category_ids.length ? (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                              {own.category_ids.map((id) => (
                                <Chip key={id} label={categoryName(id)} size="small" color="info" variant="soft" />
                              ))}
                            </Box>
                          ) : (
                            <Typography variant="body2" sx={{ color: 'text.disabled' }}>—</Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          {own.product_ids.length ? (
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                              {own.product_ids.map((id) => (
                                <Chip key={id} label={productName(id)} size="small" variant="soft" />
                              ))}
                            </Box>
                          ) : (
                            <Typography variant="body2" sx={{ color: 'text.disabled' }}>—</Typography>
                          )}
                        </TableCell>
                        <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'}>
                          <IconButton onClick={() => openEdit(printer)} aria-label={t('operations.printRouting.edit', { name: printer.name })}>
                            <EditIcon />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </Card>
        </Stack>
      )}

      <Dialog open={!!editing} onClose={() => !saving && setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('operations.printRouting.dialogTitle', { name: editing?.name ?? '' })}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
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
              groupBy={(id) => categoryName(products.find((p) => p.id === id)?.category_id ?? '')}
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
    </Box>
  );
}
