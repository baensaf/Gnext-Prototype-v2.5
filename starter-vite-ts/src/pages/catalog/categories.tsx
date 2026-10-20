import type { Category } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import {
  Box,
  Card,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Dialog,
  Drawer,
  Switch,
  MenuItem,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  CardContent,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { catalogApi } from 'src/api/catalogApi';

import { useDragSort, DragHandleCell } from 'src/components/drag-sort';

/**
 * A menu has categories and nothing under them. The server returns them in menu order, which
 * is also the order the register and kiosk show them in.
 */
export function CategoriesPage() {
  const { t } = useTranslation();

  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  // The drawer creates a category, or edits `editing`.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');

  const [archiving, setArchiving] = useState<Category | null>(null);
  const [moveTo, setMoveTo] = useState('');

  const loadData = async () => {
    try {
      setCategories(await catalogApi.getCategories());
      setError(null);
    } catch (err: any) {
      setError(err.detail || t('catalog.categoriesPage.errors.loadFailed'));
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditing(null);
    setName('');
    setDrawerOpen(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    setName(c.name);
    setDrawerOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) {
        await catalogApi.updateCategory(editing.id, { name });
      } else {
        await catalogApi.createCategory({ name });
      }
      setDrawerOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('catalog.categoriesPage.errors.saveFailed'));
    }
  };

  const handleDrop = async (list: Category[]) => {
    setCategories(list);
    try {
      setCategories(await catalogApi.reorderCategories(list.map((o) => o.id)));
    } catch (err: any) {
      setError(err.detail || t('catalog.categoriesPage.errors.reorderFailed'));
      loadData();
    }
  };
  const drag = useDragSort(categories, handleDrop);

  // Off menu hides the category and every item in it from the till, kiosk and Snappfood menu.
  // The items keep their own switch, so turning the category back on brings them back as they were.
  const toggleActive = async (c: Category) => {
    try {
      const saved = await catalogApi.updateCategory(c.id, { is_active: !c.is_active });
      setCategories((list) => list.map((o) => (o.id === c.id ? { ...o, is_active: saved.is_active } : o)));
    } catch (err: any) {
      setError(err.detail || t('catalog.categoriesPage.errors.saveFailed'));
    }
  };

  const openArchive = (c: Category) => {
    setArchiving(c);
    setMoveTo('');
  };

  const handleArchive = async () => {
    if (!archiving) return;
    try {
      await catalogApi.archiveCategory(archiving.id, moveTo || undefined);
      setArchiving(null);
      loadData();
    } catch (err: any) {
      setArchiving(null);
      setError(err.detail || t('catalog.categoriesPage.errors.archiveFailed'));
    }
  };

  const archiveCount = archiving?.product_count || 0;

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {t('catalog.categoriesPage.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('catalog.categoriesPage.subtitle')}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ fontWeight: 'bold' }}>
          {t('catalog.categoriesPage.newCategory')}
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card>
        <CardContent sx={{ p: 0 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 40 }} />
                  <TableCell>{t('catalog.categoriesPage.name')}</TableCell>
                  <TableCell align="center">{t('catalog.categoriesPage.products')}</TableCell>
                  <TableCell>{t('common.status', 'Status')}</TableCell>
                  <TableCell align="center">{t('catalog.categoriesPage.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {categories.map((c) => (
                    <TableRow key={c.id} {...drag.rowProps(c.id)}>
                      <DragHandleCell show={drag.canDrag} />
                      <TableCell>
                        <Typography variant="subtitle2">{c.name}</Typography>
                      </TableCell>
                      <TableCell align="center">{c.product_count ?? 0}</TableCell>
                      <TableCell>
                        <Stack direction="row" sx={{ alignItems: 'center' }}>
                          <Switch
                            size="small"
                            checked={c.is_active !== false}
                            onChange={() => toggleActive(c)}
                            slotProps={{ input: { 'aria-label': t('catalog.productsPage.onMenu') } }}
                          />
                          <Typography variant="caption" color={c.is_active !== false ? 'success.main' : 'text.secondary'}>
                            {c.is_active !== false ? t('catalog.productsPage.onMenu') : t('catalog.productsPage.offMenu')}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell align="center">
                        <IconButton title={t('catalog.categoriesPage.edit')} onClick={() => openEdit(c)}>
                          <EditIcon />
                        </IconButton>
                        <IconButton title={t('catalog.categoriesPage.archive')} color="error" onClick={() => openArchive(c)}>
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

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: { xs: '100vw', sm: 400 }, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            {editing ? t('catalog.categoriesPage.editDrawerTitle') : t('catalog.categoriesPage.createDrawerTitle')}
          </Typography>
          <form onSubmit={handleSave}>
            <Stack spacing={2.5}>
              <TextField
                label={t('catalog.categoriesPage.name')}
                placeholder="e.g. Desserts & Cakes"
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                {editing ? t('catalog.categoriesPage.submitSave') : t('catalog.categoriesPage.submitCreate')}
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>

      <Dialog open={!!archiving} onClose={() => setArchiving(null)} fullWidth maxWidth="xs">
        <DialogTitle>{t('catalog.categoriesPage.archiveTitle', { name: archiving?.name })}</DialogTitle>
        <DialogContent>
          {archiveCount > 0 ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">
                {t('catalog.categoriesPage.archiveMove', { name: archiving?.name, count: archiveCount })}
              </Typography>
              <TextField select label={t('catalog.categoriesPage.moveTo')} fullWidth value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                {categories
                  .filter((c) => c.id !== archiving?.id)
                  .map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name}
                    </MenuItem>
                  ))}
              </TextField>
            </Stack>
          ) : (
            <Typography variant="body2">{t('catalog.categoriesPage.archiveEmpty', { name: archiving?.name })}</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setArchiving(null)}>{t('catalog.categoriesPage.cancel')}</Button>
          <Button
            color="error"
            variant="contained"
            disabled={archiveCount > 0 && !moveTo}
            onClick={handleArchive}
          >
            {t('catalog.categoriesPage.archive')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
