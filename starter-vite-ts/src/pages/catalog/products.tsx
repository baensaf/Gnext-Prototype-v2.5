import type { Product, Category } from 'src/api/catalogApi';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMemo, useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import FastfoodIcon from '@mui/icons-material/Fastfood';
import StorefrontIcon from '@mui/icons-material/Storefront';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ImportExportIcon from '@mui/icons-material/ImportExport';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import {
  Box,
  Card,
  Chip,
  Stack,
  Table,
  Paper,
  Alert,
  Avatar,
  Button,
  Select,
  Switch,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  InputLabel,
  CardContent,
  FormControl,
  TableContainer,
  InputAdornment,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';
import { taxRateToPercent } from 'src/utils/tax-rate';
import { useCurrencyLabel } from 'src/utils/currency';

import { catalogApi } from 'src/api/catalogApi';
import { useAuthStore } from 'src/store/useAuthStore';

/** A product's price, or the range of its sizes' prices when it is sold in sizes. */
const priceLabel = (p: Product, currency: string) => {
  const sizes = p.variants || [];
  if (!sizes.length) return `${MoneyUtil.formatCurrency(p.base_price)} ${currency}`;
  const prices = sizes.map((v) => Number(v.base_price || 0));
  const [low, high] = [Math.min(...prices), Math.max(...prices)];
  return low === high
    ? `${MoneyUtil.formatCurrency(low)} ${currency}`
    : `${MoneyUtil.formatCurrency(low)} – ${MoneyUtil.formatCurrency(high)} ${currency}`;
};

export function ProductsPage() {
  const currency = useCurrencyLabel();
  const navigate = useNavigate();
  const { t } = useTranslation();

  // Products belong to the chain. A branch reads this screen to know what it may serve,
  // and goes to Availability to say whether it can serve it today. The API refuses these
  // writes anyway, so offering buttons that 403 would be a worse way to say the same thing.
  // Undefined means the account has not loaded yet: assume the wider case and let the
  // server decide, rather than flashing a read-only screen at head office.
  const canAuthor = useAuthStore((state) => state.user?.isHeadOffice) !== false;

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ON' | 'OFF'>('ALL');
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const cList = await catalogApi.getCategories();
      setCategories(cList);
      const pList = await catalogApi.getProducts(selectedCategoryId || undefined);
      setProducts(pList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('catalog.productsPage.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [selectedCategoryId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Search by name, code or barcode, within the picked category and status.
  const visibleProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (statusFilter === 'ALL' || (statusFilter === 'ON') === p.is_active) &&
        (!q || [p.name, p.code, p.barcode].some((field) => (field || '').toLowerCase().includes(q)))
    );
  }, [products, search, statusFilter]);

  // Off menu is separate from a stop: a stop is "sold out for now", off menu hides the item
  // everywhere until someone turns it back on (seasonal items, items not launched yet).
  const handleToggleActive = async (p: Product) => {
    try {
      const saved = await catalogApi.updateProduct(p.id, { is_active: !p.is_active });
      setProducts((list) => list.map((o) => (o.id === p.id ? { ...o, is_active: saved.is_active } : o)));
    } catch (err: any) {
      setError(err.detail || t('catalog.productsPage.errors.toggleFailed'));
    }
  };

  // A category's products are put in order the way Snappfood's "ترتیب محصولات" does: one
  // category at a time, with the whole list showing (no search or status filter).
  const canReorder = canAuthor && !!selectedCategoryId && !search.trim() && statusFilter === 'ALL';

  const handleMove = async (index: number, by: number) => {
    const to = index + by;
    if (to < 0 || to >= products.length) return;
    const list = [...products];
    [list[index], list[to]] = [list[to], list[index]];
    setProducts(list);
    try {
      await catalogApi.reorderProducts(selectedCategoryId, list.map((p) => p.id));
    } catch (err: any) {
      setError(err.detail || t('catalog.productsPage.errors.reorderFailed'));
      loadData();
    }
  };

  const handleArchive = async (id: string, prodName: string) => {
    if (window.confirm(t('catalog.productsPage.archiveConfirm', { name: prodName }))) {
      try {
        await catalogApi.archiveProduct(id);
        loadData();
      } catch (err: any) {
        setError(err.detail || t('catalog.productsPage.errors.archiveFailed'));
      }
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('catalog.productsPage.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('catalog.productsPage.subtitle')}
          </Typography>
        </Box>
        {canAuthor ? (
          // Bulk loading lives with the products it loads, not in the sidebar.
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<ImportExportIcon />}
              onClick={() => navigate('/app/catalog/import-export')}
            >
              {t('nav.importExport', 'Import & Export')}
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => navigate('/app/catalog/products/new')}
              sx={{ fontWeight: 'bold' }}
            >
              {t('catalog.productsPage.newProduct')}
            </Button>
          </Stack>
        ) : (
          <Button
            variant="contained"
            startIcon={<StorefrontIcon />}
            onClick={() => navigate('/app/catalog/availability')}
            sx={{ fontWeight: 'bold' }}
          >
            {t('catalog.productsPage.manageAvailability', 'Manage availability')}
          </Button>
        )}
      </Stack>

      {!canAuthor && (
        <Alert severity="info" icon={<StorefrontIcon />} sx={{ mb: 3 }}>
          {t(
            'catalog.productsPage.readOnlyNotice',
            'Head office sets the menu for the whole chain, so these products are read-only here. What your branch decides is whether it can serve them today — that lives on Availability.'
          )}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Search and filters */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <TextField
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('catalog.productsPage.searchPlaceholder')}
          sx={{ flex: 1, maxWidth: { sm: 360 } }}
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
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>{t('catalog.productsPage.category')}</InputLabel>
          <Select
            value={selectedCategoryId}
            label={t('catalog.productsPage.category')}
            onChange={(e) => setSelectedCategoryId(e.target.value)}
          >
            <MenuItem value="">{t('catalog.productsPage.allCategories')}</MenuItem>
            {categories.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>{t('common.status', 'Status')}</InputLabel>
          <Select
            value={statusFilter}
            label={t('common.status', 'Status')}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'ON' | 'OFF')}
          >
            <MenuItem value="ALL">{t('catalog.productsPage.statusAll')}</MenuItem>
            <MenuItem value="ON">{t('catalog.productsPage.onMenu')}</MenuItem>
            <MenuItem value="OFF">{t('catalog.productsPage.offMenu')}</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 0 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  {canReorder && <TableCell sx={{ width: 64 }}>{t('catalog.productsPage.order')}</TableCell>}
                  <TableCell>{t('catalog.productsPage.name')}</TableCell>
                  <TableCell>{t('catalog.productsPage.category')}</TableCell>
                  <TableCell align="right">{t('catalog.productsPage.basePrice')}</TableCell>
                  <TableCell align="center">
                    {t('catalog.productsPage.sizes')}
                  </TableCell>
                  <TableCell align="center">{t('catalog.productsPage.taxRate')}</TableCell>
                  <TableCell>{t('common.status', 'Status')}</TableCell>
                  <TableCell align="center">{t('catalog.productsPage.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleProducts.map((p, index) => {
                  const catObj = categories.find((c) => c.id === p.category_id);
                  return (
                    <TableRow key={p.id}>
                      {canReorder && (
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          <IconButton size="small" disabled={index === 0} onClick={() => handleMove(index, -1)} aria-label={t('catalog.productsPage.moveUp')}>
                            <ArrowUpwardIcon fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            disabled={index === visibleProducts.length - 1}
                            onClick={() => handleMove(index, 1)}
                            aria-label={t('catalog.productsPage.moveDown')}
                          >
                            <ArrowDownwardIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      )}
                      <TableCell>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                          <Avatar variant="rounded" src={p.image_url || undefined} alt="" sx={{ width: 44, height: 44, bgcolor: 'action.hover' }}>
                            <FastfoodIcon fontSize="small" color="disabled" />
                          </Avatar>
                          <Box>
                            <Typography variant="subtitle2">
                              {p.name}
                            </Typography>
                            {p.code && (
                              <Typography variant="caption" color="text.secondary" component="code">
                                {p.code}
                              </Typography>
                            )}
                          </Box>
                        </Stack>
                      </TableCell>
                      <TableCell>{catObj ? catObj.name : '—'}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                        <span dir="ltr">{priceLabel(p, currency)}</span>
                      </TableCell>
                      <TableCell align="center">{p.variants?.length || '—'}</TableCell>
                      <TableCell align="center">
                        <Chip label={`${taxRateToPercent(p.tax_rate)}%`} size="small" />
                      </TableCell>
                      <TableCell>
                        {canAuthor ? (
                          <Stack direction="row" sx={{ alignItems: 'center' }}>
                            <Switch
                              size="small"
                              checked={p.is_active}
                              onChange={() => handleToggleActive(p)}
                              slotProps={{ input: { 'aria-label': t('catalog.productsPage.onMenu') } }}
                            />
                            <Typography variant="caption" color={p.is_active ? 'success.main' : 'text.secondary'}>
                              {p.is_active ? t('catalog.productsPage.onMenu') : t('catalog.productsPage.offMenu')}
                            </Typography>
                          </Stack>
                        ) : (
                          <Chip
                            label={p.is_active ? t('catalog.productsPage.onMenu') : t('catalog.productsPage.offMenu')}
                            color={p.is_active ? 'success' : 'default'}
                            size="small"
                          />
                        )}
                        {p.is_active && catObj?.is_active === false && (
                          <Typography variant="caption" color="warning.main" sx={{ display: 'block' }}>
                            {t('catalog.productsPage.categoryOff')}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell align="center">
                        <IconButton
                          title={
                            canAuthor
                              ? t('catalog.productsPage.editDetails')
                              : t('catalog.productsPage.viewDetails', 'View details')
                          }
                          color="primary"
                          onClick={() => navigate(`/app/catalog/products/${p.id}`)}
                        >
                          {canAuthor ? <EditIcon /> : <VisibilityIcon />}
                        </IconButton>
                        {canAuthor && (
                          <IconButton
                              title={t('catalog.productsPage.archive')}
                              color="error"
                              onClick={() => handleArchive(p.id, p.name)}
                            >
                              <DeleteIcon />
                            </IconButton>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {visibleProducts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canReorder ? 8 : 7} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      {t('catalog.productsPage.noMatches')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
}
