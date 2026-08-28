import type { Branch } from 'src/api/tenantApi';
import type { Menu, Product, Category } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Box,
  Chip,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Drawer,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  TableContainer,
} from '@mui/material';

import { useParams } from 'src/routes/hooks';

import { tenantApi } from 'src/api/tenantApi';
import { catalogApi } from 'src/api/catalogApi';

export function MenusPage() {
  const { t } = useTranslation();

  const [menus, setMenus] = useState<Menu[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [_categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Menu Creation Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [channel, setChannel] = useState('ALL');

  // Attach Item Modal / Drawer
  const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null);
  const [attachDrawerOpen, setAttachDrawerOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [overridePrice, setOverridePrice] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [mList, bList, cList, pList] = await Promise.all([
        catalogApi.getMenus(),
        tenantApi.getBranches(),
        catalogApi.getCategories(),
        catalogApi.getProducts(),
      ]);
      setMenus(mList);
      setBranches(bList);
      setCategories(cList);
      setProducts(pList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('catalog.menusPage.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const { id } = useParams();

  useEffect(() => {
    if (id && menus.length > 0) {
      const match = menus.find((m) => m.id === id || m.code === id);
      if (match) {
        setSelectedMenu(match);
        setAttachDrawerOpen(true);
      }
    }
  }, [id, menus]);

  const handleCreateMenu = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await catalogApi.createMenu({
        code,
        name,
        branch_id: branchId || undefined,
        channel,
      });
      setDrawerOpen(false);
      setCode('');
      setName('');
      setBranchId('');
      setChannel('ALL');
      loadData();
    } catch (err: any) {
      setError(err.detail || t('catalog.menusPage.errors.createFailed'));
    }
  };

  const handleDeleteMenu = async (menu: Menu) => {
    if (!window.confirm(t('catalog.menusPage.deleteMenuConfirm', { name: menu.name }))) return;
    try {
      await catalogApi.deleteMenu(menu.id);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('catalog.menusPage.errors.deleteFailed'));
    }
  };

  const handleAddProductToMenu = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMenu || !selectedProductId) return;
    try {
      await catalogApi.addProductToMenu(selectedMenu.id, selectedProductId, undefined, 0, overridePrice || undefined);
      setAttachDrawerOpen(false);
      setSelectedProductId('');
      setOverridePrice('');
      loadData();
    } catch (err: any) {
      setError(err.detail || t('catalog.menusPage.errors.attachFailed'));
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('catalog.menusPage.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('catalog.menusPage.subtitle')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            {t('catalog.menusPage.refresh')}
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDrawerOpen(true)}>
            {t('catalog.menusPage.newMenu')}
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ width: '100%' }}>
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('catalog.menusPage.code')}</TableCell>
                <TableCell>{t('catalog.menusPage.name')}</TableCell>
                <TableCell>{t('catalog.menusPage.branch')}</TableCell>
                <TableCell>{t('catalog.menusPage.channel')}</TableCell>
                <TableCell>{t('common.status', 'Status')}</TableCell>
                <TableCell>{t('catalog.menusPage.itemsAttached')}</TableCell>
                <TableCell align="right">{t('catalog.menusPage.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {menus.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                      {t('catalog.menusPage.noItems')}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                menus.map((m) => {
                  const branchName = branches.find((b) => b.id === m.branch_id)?.name || t('catalog.menusPage.allBranches');
                  const itemCount = m.products?.length || 0;

                  return (
                    <TableRow key={m.id}>
                      <TableCell>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                          {m.code}
                        </Typography>
                      </TableCell>
                      <TableCell>{m.name}</TableCell>
                      <TableCell>{branchName}</TableCell>
                      <TableCell>
                        <Chip label={t(`catalog.menusPage.channels.${m.channel}`, m.channel)} color={m.channel === 'ALL' ? 'default' : 'primary'} size="small" />
                      </TableCell>
                      <TableCell>
                        <Chip label={m.is_active ? t('common.active', 'Active') : t('common.inactive', 'Inactive')} color={m.is_active ? 'success' : 'default'} size="small" />
                      </TableCell>
                      <TableCell>{itemCount}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant="outlined"
                          sx={{ mr: 1 }}
                          onClick={() => {
                            setSelectedMenu(m);
                            setAttachDrawerOpen(true);
                          }}
                        >
                          {t('catalog.menusPage.manageItems')}
                        </Button>
                        <IconButton color="error" size="small" onClick={() => handleDeleteMenu(m)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      {/* Create Menu Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            {t('catalog.menusPage.createDrawerTitle')}
          </Typography>
          <Box component="form" onSubmit={handleCreateMenu}>
            <Stack spacing={2}>
              <TextField label={t('catalog.menusPage.code')} value={code} onChange={(e) => setCode(e.target.value)} required fullWidth placeholder="e.g. DINE_IN_LUNCH" />
              <TextField label={t('catalog.menusPage.name')} value={name} onChange={(e) => setName(e.target.value)} required fullWidth placeholder="e.g. Weekend Dine-In Menu" />
              <TextField select label={t('catalog.menusPage.branch')} value={branchId} onChange={(e) => setBranchId(e.target.value)} fullWidth>
                <MenuItem value="">{t('catalog.menusPage.allBranches')}</MenuItem>
                {branches.map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label={t('catalog.menusPage.channel')} value={channel} onChange={(e) => setChannel(e.target.value)} fullWidth>
                <MenuItem value="ALL">{t('catalog.menusPage.channels.ALL')}</MenuItem>
                <MenuItem value="POS">{t('catalog.menusPage.channels.POS')}</MenuItem>
                <MenuItem value="DELIVERY">{t('catalog.menusPage.channels.DELIVERY')}</MenuItem>
                <MenuItem value="KIOSK">{t('catalog.menusPage.channels.KIOSK')}</MenuItem>
              </TextField>

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                {t('catalog.menusPage.submitCreate')}
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>

      {/* Add Product to Menu Drawer */}
      <Drawer anchor="right" open={attachDrawerOpen} onClose={() => setAttachDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 1 }}>
            {t('catalog.menusPage.attachDrawerTitle', { name: selectedMenu?.name })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {selectedMenu?.code} ({t(`catalog.menusPage.channels.${selectedMenu?.channel}`, selectedMenu?.channel || '')})
          </Typography>
          <Box component="form" onSubmit={handleAddProductToMenu}>
            <Stack spacing={2}>
              <TextField select label={t('catalog.menusPage.selectProduct')} value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)} required fullWidth>
                {products.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name} ({p.code}) — {p.base_price} IRR
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label={t('catalog.menusPage.priceOverride')}
                value={overridePrice}
                onChange={(e) => setOverridePrice(e.target.value)}
                fullWidth
                placeholder={t('catalog.menusPage.overridePricePlaceholder')}
              />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                {t('catalog.menusPage.attachProduct')}
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>
    </Box>
  );
}
