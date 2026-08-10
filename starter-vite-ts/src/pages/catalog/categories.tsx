import type { Category } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Box,
  Card,
  Chip,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Drawer,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  CardContent,
  TableContainer,
} from '@mui/material';

import { catalogApi } from 'src/api/catalogApi';

export function CategoriesPage() {
  const { t: _t } = useTranslation();

  const [categories, setCategories] = useState<Category[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState(1);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await catalogApi.getCategories();
      setCategories(data);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await catalogApi.createCategory({ code, name, sort_order: sortOrder });
      setDrawerOpen(false);
      setCode('');
      setName('');
      setSortOrder(1);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create category');
    }
  };

  const handleArchive = async (id: string, catName: string) => {
    if (window.confirm(`Are you sure you want to archive category "${catName}"?`)) {
      try {
        await catalogApi.archiveCategory(id);
        loadData();
      } catch (err: any) {
        setError(err.detail || 'Failed to archive category');
      }
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Catalog Categories
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage product categories and menu hierarchy
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          Create Category
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 0 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Code</TableCell>
                  <TableCell>Category Name</TableCell>
                  <TableCell align="center">Sort Order</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {categories.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell><code>{c.code}</code></TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{c.name}</TableCell>
                    <TableCell align="center">{c.sort_order}</TableCell>
                    <TableCell>
                      <Chip
                        label={c.is_active ? 'Active' : 'Archived'}
                        color={c.is_active ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="center">
                      <IconButton
                        title="Archive Category"
                        color="error"
                        onClick={() => handleArchive(c.id, c.name)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create Category Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Create New Category
          </Typography>
          <form onSubmit={handleCreate}>
            <Stack spacing={2.5}>
              <TextField
                label="Category Code"
                placeholder="e.g. CAT-DESSERTS"
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <TextField
                label="Category Name"
                placeholder="e.g. Desserts & Cakes"
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <TextField
                label="Sort Order"
                type="number"
                fullWidth
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
              />
              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                Save Category
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>
    </Box>
  );
}
