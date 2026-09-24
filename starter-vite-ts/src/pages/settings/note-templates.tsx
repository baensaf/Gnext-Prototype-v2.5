import type { NoteTemplate, NoteTemplateScope } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
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
  Select,
  Switch,
  MenuItem,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  InputLabel,
  Typography,
  IconButton,
  CardContent,
  FormControl,
  TableContainer,
} from '@mui/material';

import { catalogApi } from 'src/api/catalogApi';
import { useIsHeadOffice } from 'src/store/useAuthStore';
import { useBranchContext } from 'src/contexts/branch-context';

import { SettingScopeNotice } from 'src/components/setting-scope';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

const SCOPES: NoteTemplateScope[] = ['ITEM', 'ORDER'];

/**
 * The fixed phrases a cashier taps instead of typing a note.
 *
 * One set for the chain, like reason codes: a kitchen ticket has to read the same at every
 * site, and letting each branch invent its own wording is how "no onion" becomes five
 * spellings the line cook stops trusting.
 */
export function NoteTemplatesPage() {
  const { t } = useTranslation();
  const { selectedBranch, isHeadOffice: atHeadOffice } = useBranchContext();
  // As Moadian: a head-office account, with the header at head office. Inside a branch this
  // is that branch's read of the chain's list, which the hub now labels as such.
  const isHeadOffice = useIsHeadOffice() && atHeadOffice;

  const [templates, setTemplates] = useState<NoteTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<NoteTemplate | null>(null);
  const [scope, setScope] = useState<NoteTemplateScope>('ORDER');
  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [sortOrder, setSortOrder] = useState('0');

  const loadData = async () => {
    try {
      // Retired phrases are shown here and nowhere else: this is where they come back.
      const data = await catalogApi.getNoteTemplates(undefined, true);
      setTemplates(data || []);
      setError(null);
    } catch (err: any) {
      setError(err?.detail || t('settings.notesPage.loadError', 'Failed to load note templates'));
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOpenCreate = () => {
    setEditing(null);
    setScope('ORDER');
    setText('');
    setCategory('');
    setSortOrder('0');
    setDrawerOpen(true);
  };

  const handleOpenEdit = (template: NoteTemplate) => {
    setEditing(template);
    setScope(template.scope);
    setText(template.text);
    setCategory(template.category || '');
    setSortOrder(String(template.sort_order ?? 0));
    setDrawerOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      scope,
      text: text.trim(),
      category: category.trim() || null,
      sort_order: Number(sortOrder) || 0,
    };
    try {
      if (editing) {
        await catalogApi.updateNoteTemplate(editing.id, payload);
      } else {
        await catalogApi.createNoteTemplate(payload);
      }
      setSuccess(t('settings.notesPage.saveSuccess', 'Note template saved'));
      setDrawerOpen(false);
      loadData();
    } catch (err: any) {
      setError(err?.detail || t('settings.notesPage.saveError', 'Failed to save note template'));
    }
  };

  const handleToggleActive = async (template: NoteTemplate, active: boolean) => {
    try {
      if (active) {
        await catalogApi.updateNoteTemplate(template.id, { is_active: true });
      } else {
        // Retire rather than delete: the phrase is on tickets that have already printed.
        await catalogApi.archiveNoteTemplate(template.id);
      }
      loadData();
    } catch (err: any) {
      setError(err?.detail || t('settings.notesPage.statusError', 'Failed to change the template status'));
    }
  };

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('settings.notesPage.title', 'Order Note Templates')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.notesPage.title', 'Note Templates') },
        ]}
        action={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleOpenCreate}
            disabled={!isHeadOffice}
            sx={{ fontWeight: 'bold' }}
          >
            {t('settings.notesPage.create', 'Add Phrase')}
          </Button>
        }
      />

      <SettingScopeNotice kind="CHAIN" isHeadOffice={isHeadOffice} branchName={selectedBranch?.name} />

      <Alert severity="info" variant="outlined" sx={{ mb: 3 }}>
        {t(
          'settings.notesPage.help',
          'These phrases appear as one-tap chips on the register when a cashier adds a note. Order phrases apply to the whole ticket; item phrases apply to a single line.'
        )}
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 0 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('settings.notesPage.colScope', 'Applies To')}</TableCell>
                  <TableCell>{t('settings.notesPage.colText', 'Phrase')}</TableCell>
                  <TableCell>{t('settings.notesPage.colCategory', 'Group')}</TableCell>
                  <TableCell align="center">{t('settings.notesPage.colOrder', 'Order')}</TableCell>
                  <TableCell align="center">{t('settings.reasonsPage.colActive', 'Active')}</TableCell>
                  <TableCell align="right">{t('common.actions', 'Actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {templates.map((template) => (
                  <TableRow key={template.id} sx={{ opacity: template.is_active ? 1 : 0.5 }}>
                    <TableCell>
                      <Chip
                        label={
                          template.scope === 'ORDER'
                            ? t('settings.notesPage.scopeOrder', 'Whole order')
                            : t('settings.notesPage.scopeItem', 'Single item')
                        }
                        size="small"
                        color={template.scope === 'ORDER' ? 'primary' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{template.text}</TableCell>
                    <TableCell>
                      {template.category ? (
                        <Chip label={template.category} size="small" />
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">{template.sort_order}</TableCell>
                    <TableCell align="center">
                      <Switch
                        checked={template.is_active}
                        disabled={!isHeadOffice}
                        onChange={(e) => handleToggleActive(template, e.target.checked)}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        disabled={!isHeadOffice}
                        onClick={() => handleOpenEdit(template)}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}

                {templates.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                      <Typography variant="body2" color="text.secondary">
                        {t(
                          'settings.notesPage.empty',
                          'No phrases yet. Cashiers can still type notes freely; adding phrases here makes the common ones one tap.'
                        )}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 420, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            {editing
              ? t('settings.notesPage.edit', 'Edit Phrase')
              : t('settings.notesPage.create', 'Add Phrase')}
          </Typography>
          <form onSubmit={handleSave}>
            <Stack spacing={2.5}>
              <FormControl fullWidth>
                <InputLabel>{t('settings.notesPage.colScope', 'Applies To')}</InputLabel>
                <Select
                  value={scope}
                  label={t('settings.notesPage.colScope', 'Applies To')}
                  onChange={(e) => setScope(e.target.value as NoteTemplateScope)}
                >
                  {SCOPES.map((option) => (
                    <MenuItem key={option} value={option}>
                      {option === 'ORDER'
                        ? t('settings.notesPage.scopeOrder', 'Whole order')
                        : t('settings.notesPage.scopeItem', 'Single item')}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label={t('settings.notesPage.colText', 'Phrase')}
                required
                fullWidth
                value={text}
                onChange={(e) => setText(e.target.value)}
                helperText={t(
                  'settings.notesPage.textHelp',
                  'Exactly as it should print on the kitchen ticket.'
                )}
              />

              <TextField
                label={t('settings.notesPage.colCategory', 'Group')}
                fullWidth
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                helperText={t('settings.notesPage.categoryHelp', 'Optional, e.g. Allergies or Delivery.')}
              />

              <TextField
                label={t('settings.notesPage.colOrder', 'Order')}
                type="number"
                fullWidth
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                helperText={t('settings.notesPage.orderHelp', 'Lower numbers appear first on the register.')}
              />

              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                disabled={!isHeadOffice || !text.trim()}
                sx={{ fontWeight: 'bold' }}
              >
                {t('common.save', 'Save')}
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>
    </Box>
  );
}
