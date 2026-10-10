import type { CustomField, CustomFieldType, CustomFieldDraft } from 'src/api/customerApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import {
  Box,
  Card,
  Chip,
  Table,
  Alert,
  Stack,
  Button,
  Dialog,
  Switch,
  MenuItem,
  TableRow,
  useTheme,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  DialogTitle,
  Autocomplete,
  DialogContent,
  DialogActions,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';

import { customerApi } from 'src/api/customerApi';

import { toast } from 'src/components/snackbar';
import { ConfirmDialog } from 'src/components/confirm-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

const TYPES: CustomFieldType[] = ['TEXT', 'NUMBER', 'DATE', 'CHOICE'];
const EMPTY: CustomFieldDraft = { name: '', data_type: 'TEXT', options: [], is_required: false };

/**
 * The questions head office adds to every customer record — gender, a wedding date, a favourite
 * branch. Each one is asked on the register form; archiving one stops asking it and keeps the
 * answers already given.
 */
export function CustomerFieldsPage() {
  const { t } = useTranslation();
  const theme = useTheme();

  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CustomField | 'NEW' | null>(null);
  const [form, setForm] = useState<CustomFieldDraft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState<CustomField | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setFields(await customerApi.getCustomFields());
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('settings.customerFields.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const openNew = () => {
    setForm(EMPTY);
    setEditing('NEW');
  };
  const openEdit = (field: CustomField) => {
    setForm({ name: field.name, data_type: field.data_type, options: field.options, is_required: field.is_required });
    setEditing(field);
  };

  const save = async () => {
    setSaving(true);
    try {
      if (editing === 'NEW') await customerApi.createCustomField(form);
      else if (editing) await customerApi.updateCustomField(editing.id, form);
      toast.success(t('settings.customerFields.saved', { name: form.name }));
      setEditing(null);
      await load();
    } catch (err: any) {
      toast.error(err.detail || err.message || t('settings.customerFields.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!archiving) return;
    try {
      await customerApi.archiveCustomField(archiving.id);
      setArchiving(null);
      await load();
    } catch (err: any) {
      toast.error(err.detail || err.message || t('settings.customerFields.saveError'));
    }
  };

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('settings.customerFields.title')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.customerFields.title') },
        ]}
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={openNew}>
            {t('settings.customerFields.add')}
          </Button>
        }
      />

      <Alert severity="info" sx={{ mb: 3, borderRadius: 2 }}>
        {t('settings.customerFields.hint')}
      </Alert>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card sx={{ p: 3, borderRadius: 2 }}>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}>
            <CircularProgress />
          </Box>
        ) : fields.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center', py: 4 }}>
            {t('settings.customerFields.empty')}
          </Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table sx={{ minWidth: 560 }}>
              <TableHead>
                <TableRow>
                  <TableCell>{t('settings.customerFields.colName')}</TableCell>
                  <TableCell>{t('settings.customerFields.colType')}</TableCell>
                  <TableCell>{t('settings.customerFields.colChoices')}</TableCell>
                  <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'} />
                </TableRow>
              </TableHead>
              <TableBody>
                {fields.map((field) => (
                  <TableRow key={field.id} hover>
                    <TableCell>
                      <Typography variant="subtitle2" component="span">
                        {field.name}
                      </Typography>
                      {field.is_required && (
                        <Chip label={t('settings.customerFields.required')} size="small" sx={{ marginInlineStart: 1 }} />
                      )}
                    </TableCell>
                    <TableCell>{t(`settings.customerFields.types.${field.data_type}`)}</TableCell>
                    <TableCell>{field.data_type === 'CHOICE' ? field.options.join('، ') : '—'}</TableCell>
                    <TableCell align={theme.direction === 'rtl' ? 'left' : 'right'} sx={{ whiteSpace: 'nowrap' }}>
                      <IconButton onClick={() => openEdit(field)} aria-label={t('settings.customerFields.edit', { name: field.name })}>
                        <EditIcon />
                      </IconButton>
                      <IconButton onClick={() => setArchiving(field)} aria-label={t('settings.customerFields.archive', { name: field.name })}>
                        <ArchiveIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Card>

      <Dialog open={!!editing} onClose={() => !saving && setEditing(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{editing === 'NEW' ? t('settings.customerFields.add') : t('settings.customerFields.editTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              autoFocus
              label={t('settings.customerFields.colName')}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              fullWidth
            />
            <TextField
              select
              label={t('settings.customerFields.colType')}
              value={form.data_type}
              onChange={(e) => setForm((f) => ({ ...f, data_type: e.target.value as CustomFieldType }))}
              fullWidth
            >
              {TYPES.map((type) => (
                <MenuItem key={type} value={type}>
                  {t(`settings.customerFields.types.${type}`)}
                </MenuItem>
              ))}
            </TextField>
            {form.data_type === 'CHOICE' && (
              <Autocomplete
                multiple
                freeSolo
                options={[]}
                value={form.options}
                onChange={(_, value) => setForm((f) => ({ ...f, options: value.map(String) }))}
                renderInput={(params) => (
                  <TextField {...params} label={t('settings.customerFields.colChoices')} helperText={t('settings.customerFields.choicesHint')} />
                )}
              />
            )}
            <FormControlLabel
              control={<Switch checked={form.is_required} onChange={(e) => setForm((f) => ({ ...f, is_required: e.target.checked }))} />}
              label={t('settings.customerFields.requiredLabel')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)} disabled={saving}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button variant="contained" onClick={save} disabled={saving || !form.name.trim()}>
            {t('common.save', 'Save')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!archiving}
        onClose={() => setArchiving(null)}
        onConfirm={archive}
        title={t('settings.customerFields.archiveTitle')}
        content={t('settings.customerFields.archiveContent', { name: archiving?.name ?? '' })}
        confirmLabel={t('settings.customerFields.archiveConfirm')}
        confirmColor="warning"
      />
    </Box>
  );
}
