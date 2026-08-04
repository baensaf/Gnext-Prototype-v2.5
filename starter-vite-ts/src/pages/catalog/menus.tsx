import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Drawer,
  TextField,
  MenuItem,
  Alert,
  IconButton,
  Grid,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';

import { catalogApi, Menu, Category, Product } from 'src/api/catalogApi';
import { tenantApi, Branch } from 'src/api/tenantApi';

export function MenusPage() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
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
      setError(err.detail || 'Failed to load menu composer data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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
      setError(err.detail || 'Failed to create menu');
    }
  };

  const handleDeleteMenu = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this menu?')) return;
    try {
      await catalogApi.deleteMenu(id);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to delete menu');
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
      setError(err.detail || 'Failed to add product to menu');
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Menus Composer
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Slice 5 — Branch & Channel Specific Menu Management
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            Refresh
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDrawerOpen(true)}>
            Create Menu
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
                <TableCell>Code</TableCell>
                <TableCell>Name</TableCell>
                <TableCell>Target Branch</TableCell>
                <TableCell>Sales Channel</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Assigned Items</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {menus.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                      No menus created yet. Click "Create Menu" to build your first channel or branch menu.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                menus.map((m) => {
                  const branchName = branches.find((b) => b.id === m.branch_id)?.name || 'All Branches';
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
                        <Chip label={m.channel} color={m.channel === 'ALL' ? 'default' : 'primary'} size="small" />
                      </TableCell>
                      <TableCell>
                        <Chip label={m.is_active ? 'Active' : 'Inactive'} color={m.is_active ? 'success' : 'default'} size="small" />
                      </TableCell>
                      <TableCell>{itemCount} products</TableCell>
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
                          Add Items
                        </Button>
                        <IconButton color="error" size="small" onClick={() => handleDeleteMenu(m.id)}>
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
            Create New Menu
          </Typography>
          <Box component="form" onSubmit={handleCreateMenu}>
            <Stack spacing={2}>
              <TextField label="Menu Code" value={code} onChange={(e) => setCode(e.target.value)} required fullWidth placeholder="e.g. DINE_IN_LUNCH" />
              <TextField label="Menu Name" value={name} onChange={(e) => setName(e.target.value)} required fullWidth placeholder="e.g. Weekend Dine-In Menu" />
              <TextField select label="Branch (Optional)" value={branchId} onChange={(e) => setBranchId(e.target.value)} fullWidth>
                <MenuItem value="">All Branches</MenuItem>
                {branches.map((b) => (
                  <MenuItem key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label="Sales Channel" value={channel} onChange={(e) => setChannel(e.target.value)} fullWidth>
                <MenuItem value="ALL">All Channels</MenuItem>
                <MenuItem value="DINE_IN">Dine-In</MenuItem>
                <MenuItem value="DELIVERY">Delivery</MenuItem>
                <MenuItem value="TAKEAWAY">Takeaway</MenuItem>
                <MenuItem value="KIOSK">Kiosk</MenuItem>
                <MenuItem value="AGGREGATOR">Aggregator (Snappfood)</MenuItem>
              </TextField>

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                Save Menu
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>

      {/* Add Product to Menu Drawer */}
      <Drawer anchor="right" open={attachDrawerOpen} onClose={() => setAttachDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 1 }}>
            Add Item to Menu
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Menu: {selectedMenu?.name} ({selectedMenu?.channel})
          </Typography>
          <Box component="form" onSubmit={handleAddProductToMenu}>
            <Stack spacing={2}>
              <TextField select label="Select Product" value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)} required fullWidth>
                {products.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name} ({p.code}) — Base: {p.base_price}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Menu Price Override (Optional)"
                value={overridePrice}
                onChange={(e) => setOverridePrice(e.target.value)}
                fullWidth
                placeholder="Leave blank to use base price"
                helperText="Specific price override for this menu channel"
              />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                Attach Item to Menu
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>
    </Box>
  );
}
