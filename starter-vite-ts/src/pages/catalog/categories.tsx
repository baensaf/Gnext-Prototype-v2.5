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
 * Categories nest one level: a top-level category may hold sub-categories, which hold none.
 * The server returns them in tree order (each category followed by its sub-categories), which
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
  const [parentId, setParentId] = useState('');

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

  const siblingsOf = (c: Category) => categories.filter((o) => (o.parent_id || '') === (c.parent_id || ''));
  const hasChildren = (c: Category) => categories.some((o) => o.parent_id === c.id);
  // A parent must be top level, and not the category itself.
  const parentChoices = categories.filter((c) => !c.parent_id && c.id !== editing?.id);

  const openCreate = () => {
    setEditing(null);
    setCode('');
    setName('');
    setParentId('');
    setDrawerOpen(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    setCode(c.code);
    setName(c.name);
    setParentId(c.parent_id || '');
    setDrawerOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) {
        await catalogApi.updateCategory(editing.id, { name, parent_id: parentId || null });
      } else {
        await catalogApi.createCategory({ code, name, parent_id: parentId || null });
      }
      setDrawerOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || t('catalog.categoriesPage.errors.saveFailed'));
    }
  };

  const move = async (c: Category, step: -1 | 1) => {
    const ids = siblingsOf(c).map((o) => o.id);
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
  const archiveBlocked = !!archiving && hasChildren(archiving);

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
                {categories.map((c) => {
                  const siblings = siblingsOf(c);
                  const index = siblings.findIndex((o) => o.id === c.id);
                  return (
                    <TableRow key={c.id}>
                      <TableCell sx={{ ps: c.parent_id ? 5 : 2 }}>
                        <Typography variant={c.parent_id ? 'body2' : 'subtitle2'}>
                          {c.parent_id ? `└ ${c.name}` : c.name}
                        </Typography>
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
                          disabled={index >= siblings.length - 1}
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
                  );
                })}
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
              <TextField
                select
                label={t('catalog.categoriesPage.parent')}
                fullWidth
                value={parentId}
                disabled={!!editing && hasChildren(editing)}
                helperText={
                  editing && hasChildren(editing)
                    ? t('catalog.categoriesPage.parentLocked')
                    : t('catalog.categoriesPage.nestHint')
                }
                onChange={(e) => setParentId(e.target.value)}
              >
                <MenuItem value="">{t('catalog.categoriesPage.noParent')}</MenuItem>
                {parentChoices.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name}
                  </MenuItem>
                ))}
              </TextField>
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
          {archiveBlocked ? (
            <Alert severity="warning">{t('catalog.categoriesPage.archiveHasChildren', { name: archiving?.name })}</Alert>
          ) : archiveCount > 0 ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">
                {t('catalog.categoriesPage.archiveMove', { name: archiving?.name, count: archiveCount })}
              </Typography>
              <TextField select label={t('catalog.categoriesPage.moveTo')} fullWidth value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                {categories
                  .filter((c) => c.id !== archiving?.id)
                  .map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.parent_id ? `└ ${c.name}` : c.name}
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
            disabled={archiveBlocked || (archiveCount > 0 && !moveTo)}
            onClick={handleArchive}
          >
            {t('catalog.categoriesPage.archive')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
