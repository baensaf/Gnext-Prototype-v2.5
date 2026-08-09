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

export function DashboardPage() {
  const { t } = useTranslation();
  const { tenant, user } = useAuthStore();
  const [branches, setBranches] = useState<Branch[]>([]);

  useEffect(() => {
    tenantApi.getBranches().then(setBranches).catch(() => {});
  }, []);

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 1 }}>
          {t('dashboard.title')}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {t('dashboard.welcome')}, <strong>{user?.displayName}</strong> ({tenant?.name})
        </Typography>
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
                    0 IRR
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
                    0
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
                    0
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
                    100%
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
                  <TableCell>Code</TableCell>
                  <TableCell>Branch Name</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Time Zone</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell>Agent Health</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {branches.map((b) => (
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
