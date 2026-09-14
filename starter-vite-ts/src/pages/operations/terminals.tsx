import type { Branch, Terminal } from 'src/api/tenantApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
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
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  InputLabel,
  CardContent,
  FormControl,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { tenantApi } from 'src/api/tenantApi';
import { useScopedBranchId } from 'src/contexts/branch-context';

import { ConfirmDialog } from 'src/components/confirm-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

export function TerminalsPage() {
  const { t } = useTranslation();

  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useScopedBranchId();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [terminalType, setTerminalType] = useState<'CASHIER' | 'KIOSK' | 'KDS'>('CASHIER');
  // The create form starts at the branch you are working in, which is nearly always
  // the one you are registering a terminal for.
  const [branchId, setBranchId] = useScopedBranchId();

  // Confirm dialog state for archive
  const [archiveConfirm, setArchiveConfirm] = useState<{ id: string; name: string; code: string; open: boolean }>({
    open: false,
    id: '',
    name: '',
    code: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const bList = await tenantApi.getBranches();
      setBranches(bList || []);
      const tList = await tenantApi.getTerminals(selectedBranchId || undefined);
      setTerminals(tList || []);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.terminals.loadError', 'Failed to load terminals'));
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId) {
      setError(t('operations.terminals.selectBranchError', 'Please select a branch'));
      return;
    }
    try {
      await tenantApi.createTerminal({ branch_id: branchId, code, name, terminal_type: terminalType });
      setDrawerOpen(false);
      setCode('');
      setName('');
      setBranchId('');
      setSuccess(t('operations.terminals.createSuccess', 'Terminal created successfully'));
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.terminals.createError', 'Failed to create terminal'));
    }
  };

  const handleConfirmArchive = async () => {
    try {
      await tenantApi.archiveTerminal(archiveConfirm.id);
      setArchiveConfirm({ open: false, id: '', name: '', code: '' });
      setSuccess(t('operations.terminals.archiveSuccess', 'Terminal archived successfully'));
      loadData();
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.terminals.archiveError', 'Failed to archive terminal'));
    }
  };

  const getTypeChipColor = (type: string) => {
    switch (type) {
      case 'CASHIER': return 'primary';
      case 'KIOSK': return 'secondary';
      case 'KDS': return 'warning';
      default: return 'default';
    }
  };

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('operations.terminals.title', 'Terminal Registry')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('operations.terminals.title', 'Terminal Registry') },
        ]}
        action={
          <Stack direction="row" spacing={1.5}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
              {t('common.refresh', 'Refresh')}
            </Button>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setDrawerOpen(true)}
              sx={{ fontWeight: 'bold' }}
            >
              {t('operations.terminals.addTerminal', 'Add Terminal')}
            </Button>
          </Stack>
        }
      />

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

      {/* Branch Filter */}
      <Box sx={{ mb: 3, maxWidth: 300 }}>
        <FormControl fullWidth size="small">
          <InputLabel>{t('operations.terminals.filterBranch', 'Filter by Branch')}</InputLabel>
          <Select
            value={selectedBranchId}
            label={t('operations.terminals.filterBranch', 'Filter by Branch')}
            onChange={(e) => setSelectedBranchId(e.target.value)}
          >
            <MenuItem value="">{t('operations.terminals.allBranches', 'All Branches')}</MenuItem>
            {branches.map((b) => (
              <MenuItem key={b.id} value={b.id}>
                {b.name} ({b.code})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 0 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('operations.terminals.colCode', 'Code')}</TableCell>
                  <TableCell>{t('operations.terminals.colName', 'Terminal Name')}</TableCell>
                  <TableCell>{t('operations.terminals.colType', 'Terminal Type')}</TableCell>
                  <TableCell>{t('operations.terminals.colBranch', 'Branch')}</TableCell>
                  <TableCell>{t('operations.terminals.colStatus', 'Status')}</TableCell>
                  <TableCell align="center">{t('operations.terminals.colActions', 'Actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                      <CircularProgress size={32} />
                    </TableCell>
                  </TableRow>
                ) : terminals.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                      <Typography color="text.secondary">
                        {t('operations.terminals.noTerminals', 'No terminals found for this selection.')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  terminals.map((item) => {
                    const branchObj = branches.find((b) => b.id === item.branch_id);
                    return (
                      <TableRow key={item.id} hover>
                        <TableCell><code>{item.code}</code></TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>{item.name}</TableCell>
                        <TableCell>
                          <Chip
                            label={t(`operations.terminals.types.${item.terminal_type}`, item.terminal_type)}
                            color={getTypeChipColor(item.terminal_type) as any}
                            size="small"
                            sx={{ fontWeight: 'bold' }}
                          />
                        </TableCell>
                        <TableCell>{branchObj ? `${branchObj.name} (${branchObj.code})` : '—'}</TableCell>
                        <TableCell>
                          <Chip
                            label={item.is_active ? t('common.active', 'Active') : t('common.archived', 'Archived')}
                            color={item.is_active ? 'success' : 'default'}
                            size="small"
                          />
                        </TableCell>
                        <TableCell align="center">
                          <IconButton
                            title={t('operations.terminals.archive', 'Archive Terminal')}
                            color="error"
                            onClick={() => setArchiveConfirm({ open: true, id: item.id, name: item.name, code: item.code })}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create Terminal Drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        <Box sx={{ width: { xs: 320, sm: 400 }, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            {t('operations.terminals.newTerminal', 'Add New Terminal')}
          </Typography>
          <form onSubmit={handleCreate}>
            <Stack spacing={2.5}>
              <FormControl fullWidth required>
                <InputLabel>{t('operations.terminals.formBranch', 'Branch')}</InputLabel>
                <Select
                  value={branchId}
                  label={t('operations.terminals.formBranch', 'Branch')}
                  onChange={(e) => setBranchId(e.target.value)}
                >
                  {branches.map((b) => (
                    <MenuItem key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label={t('operations.terminals.formCode', 'Terminal Code')}
                placeholder="e.g. TEH-CENTRAL-POS-2"
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />

              <TextField
                label={t('operations.terminals.formName', 'Terminal Name')}
                placeholder="e.g. Cashier Counter 2"
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <FormControl fullWidth required>
                <InputLabel>{t('operations.terminals.formType', 'Terminal Type')}</InputLabel>
                <Select
                  value={terminalType}
                  label={t('operations.terminals.formType', 'Terminal Type')}
                  onChange={(e) => setTerminalType(e.target.value as any)}
                >
                  <MenuItem value="CASHIER">{t('operations.terminals.types.POS', 'CASHIER (POS Touch)')}</MenuItem>
                  <MenuItem value="KIOSK">{t('operations.terminals.types.KIOSK', 'KIOSK (Self-Service)')}</MenuItem>
                  <MenuItem value="KDS">{t('operations.terminals.types.KDS', 'KDS (Kitchen Display)')}</MenuItem>
                </Select>
              </FormControl>

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                {t('operations.terminals.saveTerminal', 'Save Terminal')}
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>

      {/* Archive Confirm Dialog */}
      <ConfirmDialog
        open={archiveConfirm.open}
        onClose={() => setArchiveConfirm({ open: false, id: '', name: '', code: '' })}
        onConfirm={handleConfirmArchive}
        title={t('operations.terminals.archiveConfirmTitle', 'Archive Terminal')}
        content={t(
          'operations.terminals.archiveConfirmContent',
          'Are you sure you want to archive terminal "{{name}}" ({{code}})?',
          { name: archiveConfirm.name, code: archiveConfirm.code }
        )}
        confirmLabel={t('operations.terminals.archive', 'Archive')}
        confirmColor="warning"
      />
    </Box>
  );
}
