import type { Category } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
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
  const [code, setCode] = useState('');
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
    setCode('');
    setName('');
    setDrawerOpen(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    setCode(c.code);
    setName(c.name);
    setDrawerOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) {
        await catalogApi.updateCategory(editing.id, { name });
      } else {
        await catalogApi.createCategory({ code, name });
      }
      setDrawerOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('catalog.categoriesPage.errors.saveFailed'));
    }
  };

  const move = async (c: Category, step: -1 | 1) => {
    const ids = categories.map((o) => o.id);
    const from = ids.indexOf(c.id);
    const to = from + step;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    try {
      setCategories(await catalogApi.reorderCategories(ids));
    } catch (err: any) {
      setError(err.detail || t('catalog.categoriesPage.errors.reorderFailed'));
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

      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 0 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('catalog.categoriesPage.name')}</TableCell>
                  <TableCell align="center">{t('catalog.categoriesPage.products')}</TableCell>
                  <TableCell align="center">{t('catalog.categoriesPage.order')}</TableCell>
                  <TableCell align="center">{t('catalog.categoriesPage.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {categories.map((c, index) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Typography variant="subtitle2">{c.name}</Typography>
                        <Typography variant="caption" color="text.secondary" component="code">
                          {c.code}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">{c.product_count ?? 0}</TableCell>
                      <TableCell align="center">
                        <IconButton
                          size="small"
                          title={t('catalog.categoriesPage.moveUp')}
                          disabled={index <= 0}
                          onClick={() => move(c, -1)}
                        >
                          <ArrowUpwardIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          title={t('catalog.categoriesPage.moveDown')}
                          disabled={index >= categories.length - 1}
                          onClick={() => move(c, 1)}
                        >
                          <ArrowDownwardIcon fontSize="small" />
                        </IconButton>
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
                label={t('catalog.categoriesPage.code')}
                placeholder="e.g. CAT-DESSERTS"
                required
                fullWidth
                disabled={!!editing}
                helperText={editing ? t('catalog.categoriesPage.codeLocked') : undefined}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
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
