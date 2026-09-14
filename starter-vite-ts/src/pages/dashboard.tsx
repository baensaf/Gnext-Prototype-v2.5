import type { Branch } from 'src/api/tenantApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import StorefrontIcon from '@mui/icons-material/Storefront';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import ShoppingBagIcon from '@mui/icons-material/ShoppingBag';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import {
  Box,
  Grid,
  Card,
  Chip,
  Stack,
  Table,
  Paper,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  CardContent,
  TableContainer,
} from '@mui/material';

import { tenantApi } from 'src/api/tenantApi';
import { useAuthStore } from 'src/store/useAuthStore';
import { httpClient as axios } from 'src/api/httpClient';
import { useBranchContextOptional } from 'src/contexts/branch-context';

export function DashboardPage() {
  const { t } = useTranslation();
  const { tenant, user } = useAuthStore();
  const branchScope = useBranchContextOptional();
  // The header's scope, not the account's: head office switched into a shop is looking at
  // that shop, and the figures below have to agree with the switcher above them.
  const scopedBranchId = branchScope?.isHeadOffice === false ? branchScope.selectedBranchId : '';
  const [branches, setBranches] = useState<Branch[]>([]);
  const [kpis, setKpis] = useState<any>({
    sales_today: '0.00',
    open_orders_count: 0,
    active_shifts_count: 0,
    open_alerts_count: 0,
    branch_health_percentage: 100,
  });

  useEffect(() => {
    tenantApi.getBranches().then(setBranches).catch(() => {});
  }, []);

  useEffect(() => {
    axios
      .get('/api/v1/reports/dashboard-summary', { params: { branchId: scopedBranchId || undefined } })
      .then((res) => setKpis(res.data))
      .catch(() => {});
  }, [scopedBranchId]);

  const shownBranches = scopedBranchId ? branches.filter((b) => b.id === scopedBranchId) : branches;

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 1 }}>
          {t('dashboard.title')}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {t('dashboard.welcome')}, <strong>{user?.displayName}</strong> ({tenant?.name})
        </Typography>

        {/* The same page serves a chain and a single shop; without this you cannot tell
            whether the takings on screen are yours or everybody's. */}
        <Chip
          size="small"
          color={scopedBranchId ? 'default' : 'info'}
          sx={{ mt: 1 }}
          label={
            scopedBranchId
              ? branchScope?.selectedBranch?.name || t('dashboard.scopeBranch', 'This branch')
              : t('dashboard.scopeChain', 'All branches')
          }
        />
      </Box>

      {/* KPI Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
            <CardContent>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                    {t('dashboard.salesToday')}
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5 }}>
                    {kpis.sales_today} IRR
                  </Typography>
                </Box>
                <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'primary.light', color: 'primary.main' }}>
                  <PointOfSaleIcon />
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
            <CardContent>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                    {t('dashboard.openOrders')}
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5 }}>
                    {kpis.open_orders_count}
                  </Typography>
                </Box>
                <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'info.light', color: 'info.main' }}>
                  <ShoppingBagIcon />
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
            <CardContent>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                    {t('dashboard.activeShifts')}
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5 }}>
                    {kpis.active_shifts_count}
                  </Typography>
                </Box>
                <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'warning.light', color: 'warning.main' }}>
                  <StorefrontIcon />
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
            <CardContent>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>
                    {t('dashboard.branchHealth')}
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'success.main', mt: 0.5 }}>
                    {kpis.branch_health_percentage}%
                  </Typography>
                </Box>
                <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'success.light', color: 'success.main' }}>
                  <CheckCircleIcon />
                </Box>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Branch Status Section */}
      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
              {t('dashboard.branchHealth')}
            </Typography>
            <Chip label={t('app.simulatedBadge')} color="warning" size="small" />
          </Stack>

          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('dashboard.code')}</TableCell>
                  <TableCell>{t('dashboard.name')}</TableCell>
                  <TableCell>{t('common.status')}</TableCell>
                  <TableCell>{t('dashboard.timeZone')}</TableCell>
                  <TableCell>{t('dashboard.phone')}</TableCell>
                  <TableCell>{t('dashboard.agentHealth')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shownBranches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell><code>{b.code}</code></TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{b.name}</TableCell>
                    <TableCell>
                      <Chip label={b.is_active ? 'ONLINE' : 'OFFLINE'} color={b.is_active ? 'success' : 'default'} size="small" />
                    </TableCell>
                    <TableCell>{b.time_zone || 'Asia/Tehran'}</TableCell>
                    <TableCell>{b.phone || '—'}</TableCell>
                    <TableCell>
                      <Chip label="HEALTHY" color="info" size="small" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
}

export default DashboardPage;
