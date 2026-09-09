import type { Branch } from 'src/api/tenantApi';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CorporateFareIcon from '@mui/icons-material/CorporateFare';
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
  CircularProgress,
} from '@mui/material';

import { tenantApi } from 'src/api/tenantApi';

import { ConfirmDialog } from 'src/components/confirm-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

export function BranchesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  // Confirm dialog state for archive
  const [archiveConfirm, setArchiveConfirm] = useState<{ id: string; name: string; open: boolean }>({
    open: false,
    id: '',
    name: '',
  });

  const loadBranches = useCallback(async () => {
    setLoading(true);
    try {
      const data = await tenantApi.getBranches();
      setBranches(data || []);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.branches.loadError', 'Failed to load branches'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadBranches();
  }, [loadBranches]);

  const closeDrawer = () => {
    setDrawerOpen(false);
    setEditingId(null);
    setCode('');
    setName('');
    setPhone('');
    setAddress('');
  };

  const openCreate = () => {
    setEditingId(null);
    setCode('');
    setName('');
    setPhone('');
    setAddress('');
    setDrawerOpen(true);
  };

  const openEdit = (branch: Branch) => {
    setEditingId(branch.id);
    setCode(branch.code);
    setName(branch.name);
    setPhone(branch.phone || '');
    setAddress(branch.address || '');
    setDrawerOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        // Code is the stable key other records point at, so an edit changes the
        // human-facing details only and leaves the identifier alone.
        await tenantApi.updateBranch(editingId, { name, phone, address });
        setSuccess(t('operations.branches.updateSuccess', 'Branch updated successfully'));
      } else {
        await tenantApi.createBranch({ code, name, phone, address });
        setSuccess(t('operations.branches.saveSuccess', 'Branch created successfully'));
      }
      closeDrawer();
      loadBranches();
    } catch (err: any) {
      setError(
        err.detail ||
          err.message ||
          (editingId
            ? t('operations.branches.updateError', 'Failed to update branch')
            : t('operations.branches.createError', 'Failed to create branch'))
      );
    }
  };

  const handleConfirmArchive = async () => {
    try {
      await tenantApi.archiveBranch(archiveConfirm.id);
      setArchiveConfirm({ open: false, id: '', name: '' });
      setSuccess(t('operations.branches.archiveSuccess', 'Branch archived successfully'));
      loadBranches();
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.branches.archiveError', 'Failed to archive branch'));
    }
  };

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('operations.branches.title', 'Branch Management')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('operations.branches.title', 'Branch Management') },
        ]}
        action={
          <Stack direction="row" spacing={1.5}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadBranches}>
              {t('common.refresh', 'Refresh')}
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={openCreate}
              sx={{ fontWeight: 'bold' }}
            >
              {t('operations.branches.createBranch', 'Create Branch')}
            </Button>
          </Stack>
        }
      />

      <Alert icon={<CorporateFareIcon fontSize="inherit" />} severity="info" sx={{ mb: 3 }}>
        {t(
          'operations.branches.orgScopeNotice',
          'Organization-level setting. Locations are defined here at head office and are available to the whole chain; each branch then runs its own operations against them.'
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
                  <TableCell>{t('operations.branches.code', 'Code')}</TableCell>
                  <TableCell>{t('operations.branches.name', 'Name')}</TableCell>
                  <TableCell>{t('operations.branches.phone', 'Phone')}</TableCell>
                  <TableCell>{t('operations.branches.address', 'Address')}</TableCell>
                  <TableCell>{t('operations.branches.timeZone', 'Time Zone')}</TableCell>
                  <TableCell>{t('operations.branches.status', 'Status')}</TableCell>
                  <TableCell align="center">{t('operations.branches.actions', 'Actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                      <CircularProgress size={32} />
                    </TableCell>
                  </TableRow>
                ) : branches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">
                        {t('operations.branches.noBranches', 'No branches found. Click "Create Branch" to add one.')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  branches.map((b) => (
                    <TableRow key={b.id} hover>
                      <TableCell><code>{b.code}</code></TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>{b.name}</TableCell>
                      <TableCell>{b.phone || '—'}</TableCell>
                      <TableCell>{b.address || '—'}</TableCell>
                      <TableCell>{b.time_zone || 'Asia/Tehran'}</TableCell>
                      <TableCell>
                        <Chip
                          label={b.is_active ? t('operations.branches.active', 'Active') : t('operations.branches.archived', 'Archived')}
                          color={b.is_active ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="center">
                        <IconButton
                          title={t('operations.branches.edit', 'Edit Branch')}
                          onClick={() => openEdit(b)}
                        >
                          <EditIcon />
                        </IconButton>
                        <IconButton
                          title={t('operations.branches.schedule', 'Hours Schedule')}
                          color="primary"
                          onClick={() => navigate(`/app/operations/branches/${b.id}`)}
                        >
                          <AccessTimeIcon />
                        </IconButton>
                        <IconButton
                          title={t('operations.branches.archive', 'Archive Branch')}
                          color="error"
                          onClick={() => setArchiveConfirm({ open: true, id: b.id, name: b.name })}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create Branch Drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={closeDrawer}
      >
        <Box sx={{ width: { xs: 320, sm: 400 }, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            {editingId
              ? t('operations.branches.editBranch', 'Edit Branch Location')
              : t('operations.branches.newBranch', 'New Branch Location')}
          </Typography>
          <form onSubmit={handleSubmit}>
            <Stack spacing={2.5}>
              <TextField
                label={t('operations.branches.branchCode', 'Branch Code')}
                placeholder="e.g. TEH-WEST"
                required
                fullWidth
                disabled={!!editingId}
                helperText={
                  editingId
                    ? t('operations.branches.codeLocked', 'Branch code cannot be changed after creation.')
                    : undefined
                }
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <TextField
                label={t('operations.branches.branchName', 'Branch Name')}
                placeholder="e.g. Tehran West Branch"
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <TextField
                label={t('operations.branches.phoneNumber', 'Phone Number')}
                placeholder="e.g. +982188000003"
                fullWidth
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <TextField
                label={t('operations.branches.address', 'Address')}
                multiline
                rows={3}
                fullWidth
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                {editingId
                  ? t('operations.branches.updateBranch', 'Update Branch')
                  : t('operations.branches.saveBranch', 'Save Branch')}
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>

      {/* Archive Confirm Dialog */}
      <ConfirmDialog
        open={archiveConfirm.open}
        onClose={() => setArchiveConfirm({ open: false, id: '', name: '' })}
        onConfirm={handleConfirmArchive}
        title={t('operations.branches.archiveConfirmTitle', 'Archive Branch Location')}
        content={t(
          'operations.branches.archiveConfirmContent',
          'Are you sure you want to archive branch "{{name}}"? This will hide the location from active POS routing.',
          { name: archiveConfirm.name }
        )}
        confirmLabel={t('operations.branches.archive', 'Archive')}
        confirmColor="warning"
      />
    </Box>
  );
}
