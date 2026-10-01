import type { Branch } from 'src/api/tenantApi';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import { useTheme } from '@mui/material/styles';
import PlaceIcon from '@mui/icons-material/Place';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import {
  Box,
  Card,
  Chip,
  Table,
  Alert,
  Stack,
  Button,
  Switch,
  Tooltip,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  TableContainer,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';

import { paths } from 'src/routes/paths';

import { tenantApi } from 'src/api/tenantApi';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import { BranchOpenChip, useBranchOpenStatus } from 'src/components/branch';

/**
 * Head office's list of the chain's branches: whether each is open now, and whether it has
 * its pin. A row opens the branch; archived ones are shown on request.
 */
export function BranchesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBranches(await tenantApi.getBranches({ archived: showArchived }));
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.branches.loadError', 'Failed to load branches'));
    } finally {
      setLoading(false);
    }
  }, [showArchived, t]);

  useEffect(() => {
    load();
  }, [load]);

  const archivedCount = branches.filter((b) => b.deleted_at).length;

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('operations.branches.title', 'Branches')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('operations.branches.title', 'Branches') },
        ]}
        action={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate(paths.app.operations.branchNew)}>
            {t('branchMgmt.list.add', 'Add branch')}
          </Button>
        }
      />

      <Stack direction="row" sx={{ mb: 2, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {t('branchMgmt.list.intro', 'Head office adds and runs the chain\'s branches. Open a branch to change its details, hours or location.')}
        </Typography>
        <FormControlLabel
          control={<Switch size="small" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />}
          label={
            <Typography variant="body2">
              {showArchived && archivedCount
                ? t('branchMgmt.list.showArchivedCount', { defaultValue: 'Show archived ({{count}})', count: archivedCount })
                : t('branchMgmt.list.showArchived', 'Show archived')}
            </Typography>
          }
        />
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card sx={{ borderRadius: 3 }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>{t('branchMgmt.list.branch', 'Branch')}</TableCell>
                <TableCell>{t('branchMgmt.details.phone', 'Phone')}</TableCell>
                <TableCell>{t('branchMgmt.list.now', 'Now')}</TableCell>
                <TableCell>{t('branchMgmt.tabs.location', 'Location')}</TableCell>
                <TableCell>{t('branchMgmt.details.timeZone', 'Time zone')}</TableCell>
                <TableCell>{t('operations.branches.status', 'Status')}</TableCell>
                <TableCell padding="checkbox" />
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
                  <TableCell colSpan={7} align="center" sx={{ py: 6 }}>
                    <Typography color="text.secondary" sx={{ mb: 2 }}>
                      {t('branchMgmt.list.empty', 'No branches yet.')}
                    </Typography>
                    <Button variant="outlined" startIcon={<AddIcon />} onClick={() => navigate(paths.app.operations.branchNew)}>
                      {t('branchMgmt.list.add', 'Add branch')}
                    </Button>
                  </TableCell>
                </TableRow>
              ) : (
                branches.map((branch) => (
                  <BranchRow key={branch.id} branch={branch} onOpen={() => navigate(paths.app.operations.branchDetail(branch.id))} />
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </Box>
  );
}

function BranchRow({ branch, onOpen }: { branch: Branch; onOpen: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const archived = !!branch.deleted_at || !branch.is_active;
  const status = useBranchOpenStatus(archived ? null : branch.id, branch.time_zone);
  const hasPin = branch.latitude !== null && branch.latitude !== undefined;

  return (
    <TableRow hover onClick={onOpen} sx={{ cursor: 'pointer', ...(archived && { opacity: 0.6 }) }}>
      <TableCell>
        <Typography sx={{ fontWeight: 600 }}>{branch.name}</Typography>
        <Typography variant="caption" color="text.secondary">
          {branch.address || t('operations.branchDetail.noAddress', 'No address specified')}
        </Typography>
      </TableCell>
      <TableCell dir="ltr" sx={{ textAlign: theme.direction === 'rtl' ? 'right' : 'left' }}>
        {branch.phone || '—'}
      </TableCell>
      <TableCell>{archived ? '—' : <BranchOpenChip status={status} />}</TableCell>
      <TableCell>
        {hasPin ? (
          <Tooltip title={`${Number(branch.latitude).toFixed(5)}, ${Number(branch.longitude).toFixed(5)}`}>
            <PlaceIcon fontSize="small" color="primary" />
          </Tooltip>
        ) : (
          <Chip size="small" color="warning" variant="outlined" label={t('branchMgmt.location.missing', 'No pin on the map')} />
        )}
      </TableCell>
      <TableCell>
        <Typography variant="body2" dir="ltr" component="span">
          {branch.time_zone || 'Asia/Tehran'}
        </Typography>
      </TableCell>
      <TableCell>
        <Chip
          size="small"
          color={archived ? 'default' : 'success'}
          variant={archived ? 'outlined' : 'filled'}
          label={archived ? t('operations.branches.archived', 'Archived') : t('operations.branches.active', 'Active')}
        />
      </TableCell>
      <TableCell padding="checkbox">
        <ChevronRightIcon color="action" sx={{ transform: theme.direction === 'rtl' ? 'rotate(180deg)' : 'none' }} />
      </TableCell>
    </TableRow>
  );
}
