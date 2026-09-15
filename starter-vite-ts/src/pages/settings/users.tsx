import type { Branch } from 'src/api/tenantApi';
import type { AdminUserRow, AdminUserWrite } from 'src/api/usersApi';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import RefreshIcon from '@mui/icons-material/Refresh';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  Box,
  Card,
  Chip,
  Link,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Drawer,
  Switch,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  CardContent,
  TableContainer,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';

import { paths } from 'src/routes/paths';

import { usersApi } from 'src/api/usersApi';
import { tenantApi } from 'src/api/tenantApi';
import { ROLE_LABELS } from 'src/config/role-access';
import { useAuthStore } from 'src/store/useAuthStore';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'OWNER', 'MANAGER', 'SUPERVISOR', 'CASHIER'];

/** Roles that carry their own authority. Everyone else needs one of them to approve. */
const APPROVER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OWNER', 'MANAGER', 'SUPERVISOR'];

const HEAD_OFFICE = '';

const emptyForm: AdminUserWrite = {
  username: '',
  display_name: '',
  role: 'CASHIER',
  branch_id: null,
  is_active: true,
};

export function UsersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentUserId = useAuthStore((state) => state.user?.id);

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [form, setForm] = useState<AdminUserWrite>(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [userRows, branchRows] = await Promise.all([usersApi.list(), tenantApi.getBranches()]);
      setUsers(userRows);
      setBranches(branchRows);
    } catch (err: any) {
      setError(err?.response?.data?.detail || err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setDrawerOpen(true);
  };

  const openEdit = (user: AdminUserRow) => {
    setEditing(user);
    setForm({
      display_name: user.display_name,
      role: user.role,
      branch_id: user.branch_id,
      is_active: user.is_active,
    });
    setDrawerOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await usersApi.update(editing.id, form);
        setSuccess(t('users.updated', 'Account updated.'));
      } else {
        await usersApi.create(form);
        setSuccess(t('users.created', 'Account created on the shared demo password.'));
      }
      setDrawerOpen(false);
      await load();
    } catch (err: any) {
      setError(
        err?.response?.data?.detail || err?.response?.data?.message || err.message || 'Failed to save'
      );
    } finally {
      setSaving(false);
    }
  };

  const roleLabel = (role: string) => t(`auth.roles.${role}`, ROLE_LABELS[role] || role);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <CustomBreadcrumbs
        heading={t('users.title', 'Users & Roles')}
        links={[
          { name: t('nav.settingsGroup', 'Settings & System'), href: '/app/settings' },
          { name: t('users.title', 'Users & Roles') },
        ]}
        action={
          <Stack direction="row" spacing={1}>
            <IconButton onClick={load}>
              <RefreshIcon />
            </IconButton>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
              {t('users.add', 'Add account')}
            </Button>
          </Stack>
        }
        sx={{ mb: 3 }}
      />

      <Alert severity="info" sx={{ mb: 3 }}>
        {t(
          'users.scopeNotice',
          'An account with no branch acts for the whole organization. An account pinned to a branch only ever sees that branch, whatever its role is called.'
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

      <Card>
        <CardContent>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('users.username', 'Username')}</TableCell>
                  <TableCell>{t('users.displayName', 'Name')}</TableCell>
                  <TableCell>{t('users.role', 'Role')}</TableCell>
                  <TableCell>{t('users.scope', 'Scope')}</TableCell>
                  <TableCell>{t('users.approves', 'Approves')}</TableCell>
                  <TableCell>{t('users.status', 'Status')}</TableCell>
                  <TableCell align="center">{t('users.actions', 'Actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id} hover>
                    <TableCell>
                      <Link
                        component="button"
                        variant="body2"
                        onClick={() => navigate(paths.app.settings.userDetail(user.id))}
                        sx={{ fontFamily: 'monospace' }}
                      >
                        {user.username}
                      </Link>
                    </TableCell>
                    <TableCell>{user.display_name}</TableCell>
                    <TableCell>
                      <Chip size="small" label={roleLabel(user.role)} />
                    </TableCell>
                    <TableCell>
                      {user.branch_name || (
                        <Chip size="small" color="info" label={t('auth.headOffice', 'Head office')} />
                      )}
                    </TableCell>
                    <TableCell>{user.has_pin ? t('common.yes', 'Yes') : t('common.no', 'No')}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={user.is_active ? 'success' : 'default'}
                        label={
                          user.is_active ? t('users.active', 'Active') : t('users.disabled', 'Disabled')
                        }
                      />
                    </TableCell>
                    <TableCell align="center">
                      <IconButton
                        size="small"
                        title={t('profile.viewProfile')}
                        onClick={() => navigate(paths.app.settings.userDetail(user.id))}
                      >
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" onClick={() => openEdit(user)}>
                        <EditIcon fontSize="small" />
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
        <Box sx={{ width: 380, p: 3 }}>
          <Typography variant="h6" sx={{ mb: 3 }}>
            {editing ? t('users.edit', 'Edit account') : t('users.add', 'Add account')}
          </Typography>

          <Stack spacing={2.5}>
            <TextField
              label={t('users.username', 'Username')}
              value={editing ? editing.username : form.username || ''}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              // A username is how the account is known everywhere it has already acted;
              // renaming it after the fact would orphan that history.
              disabled={!!editing}
              helperText={
                editing ? t('users.usernameLocked', 'A username cannot be changed.') : undefined
              }
              fullWidth
            />

            <TextField
              label={t('users.displayName', 'Name')}
              value={form.display_name || ''}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
              fullWidth
            />

            <TextField
              select
              label={t('users.role', 'Role')}
              value={form.role || 'CASHIER'}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              helperText={
                APPROVER_ROLES.includes(form.role || '')
                  ? t('users.roleApproves', 'This role can approve with a PIN.')
                  : t(
                      'users.roleNeedsApproval',
                      'This role needs a PIN from someone else to move money back out.'
                    )
              }
              fullWidth
            >
              {ROLES.map((role) => (
                <MenuItem key={role} value={role}>
                  {roleLabel(role)}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              label={t('users.scope', 'Scope')}
              value={form.branch_id || HEAD_OFFICE}
              onChange={(e) => setForm({ ...form, branch_id: e.target.value || null })}
              fullWidth
            >
              <MenuItem value={HEAD_OFFICE}>{t('auth.headOffice', 'Head office')}</MenuItem>
              {branches.map((branch) => (
                <MenuItem key={branch.id} value={branch.id}>
                  {branch.name}
                </MenuItem>
              ))}
            </TextField>

            {!editing && (
              <Alert severity="info">
                {t(
                  'users.passwordNotice',
                  'The new account starts on the shared demo password, and gets the demo approver PIN if its role can approve.'
                )}
              </Alert>
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={form.is_active ?? true}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  disabled={!!editing && editing.id === currentUserId}
                />
              }
              label={t('users.active', 'Active')}
            />

            {!!editing && editing.id === currentUserId && (
              <Alert severity="warning">
                {t(
                  'users.selfEditNotice',
                  'This is the account you are signed in as. Its role, scope and status are locked so you cannot lock yourself out.'
                )}
              </Alert>
            )}

            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={handleSave} disabled={saving}>
                {t('common.save', 'Save')}
              </Button>
              <Button onClick={() => setDrawerOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
            </Stack>
          </Stack>
        </Box>
      </Drawer>
    </Box>
  );
}
