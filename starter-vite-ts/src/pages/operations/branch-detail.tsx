import type { Branch, BranchOperatingHour } from 'src/api/tenantApi';

import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router';
import React, { useState, useEffect, useCallback } from 'react';

import SaveIcon from '@mui/icons-material/Save';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  Box,
  Card,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Switch,
  TableRow,
  useTheme,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  CardContent,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { tenantApi } from 'src/api/tenantApi';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

const DAY_KEYS = ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;

export function BranchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const theme = useTheme();

  const [branch, setBranch] = useState<Branch | null>(null);
  const [hours, setHours] = useState<BranchOperatingHour[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const b = await tenantApi.getBranchById(id);
      const h = await tenantApi.getBranchHours(id);
      setBranch(b);
      setHours(h || []);
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.branchDetail.loadError', 'Failed to load branch details'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleHourChange = (dayIndex: number, field: keyof BranchOperatingHour, value: any) => {
    setHours((prev) =>
      prev.map((item) => (item.day_of_week === dayIndex ? { ...item, [field]: value } : item))
    );
  };

  const handleSaveHours = async () => {
    if (!id) return;
    try {
      await tenantApi.updateBranchHours(id, hours);
      setSuccess(t('operations.branchDetail.saveSuccess', 'Branch operating hours schedule saved successfully'));
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.branchDetail.saveError', 'Failed to update operating hours'));
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!branch) {
    return (
      <Box sx={{ p: 4 }}>
        <Alert severity="error">{t('operations.branchDetail.notFound', 'Branch not found')}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={`${branch.name} (${branch.code})`}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('operations.branches.title', 'Branches'), href: '/app/operations/branches' },
          { name: branch.name },
        ]}
        action={
          <Button
            variant="outlined"
            startIcon={
              <ArrowBackIcon
                sx={{
                  transform: theme.direction === 'rtl' ? 'rotate(180deg)' : 'none',
                }}
              />
            }
            onClick={() => navigate('/app/operations/branches')}
          >
            {t('operations.branchDetail.backToBranches', 'Back to Branches')}
          </Button>
        }
      />

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {branch.address || t('operations.branchDetail.noAddress', 'No address specified')} | {branch.phone || t('operations.branchDetail.noPhone', 'No phone')}
      </Typography>

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

      <Card sx={{ borderRadius: 3, boxShadow: 2, mb: 4 }}>
        <CardContent>
          <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
              {t('operations.branchDetail.title', 'Branch Operating Hours Schedule')}
            </Typography>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleSaveHours}
              sx={{ fontWeight: 'bold' }}
            >
              {t('operations.branchDetail.saveSchedule', 'Save Schedule')}
            </Button>
          </Stack>

          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('operations.branchDetail.dayOfWeek', 'Day of Week')}</TableCell>
                  <TableCell align="center">{t('operations.branchDetail.isClosed', 'Is Closed')}</TableCell>
                  <TableCell>{t('operations.branchDetail.openTime', 'Open Time')}</TableCell>
                  <TableCell>{t('operations.branchDetail.closeTime', 'Close Time')}</TableCell>
                  <TableCell align="center">{t('operations.branchDetail.spansMidnight', 'Spans Midnight')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {DAY_KEYS.map((dayKey, index) => {
                  const hourRow = hours.find((h) => h.day_of_week === index) || {
                    day_of_week: index,
                    open_time: '08:00:00',
                    close_time: '23:00:00',
                    is_closed: false,
                    spans_midnight: false,
                  };

                  return (
                    <TableRow key={dayKey} hover>
                      <TableCell sx={{ fontWeight: 'bold' }}>
                        {t(`operations.branchDetail.days.${dayKey}`, dayKey)}
                      </TableCell>
                      <TableCell align="center">
                        <Switch
                          checked={hourRow.is_closed}
                          onChange={(e) => handleHourChange(index, 'is_closed', e.target.checked)}
                          color="error"
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          type="time"
                          size="small"
                          disabled={hourRow.is_closed}
                          value={hourRow.open_time ? hourRow.open_time.substring(0, 5) : '08:00'}
                          onChange={(e) => handleHourChange(index, 'open_time', `${e.target.value}:00`)}
                        />
                      </TableCell>
                      <TableCell>
                        <TextField
                          type="time"
                          size="small"
                          disabled={hourRow.is_closed}
                          value={hourRow.close_time ? hourRow.close_time.substring(0, 5) : '23:00'}
                          onChange={(e) => handleHourChange(index, 'close_time', `${e.target.value}:00`)}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Switch
                          checked={hourRow.spans_midnight}
                          disabled={hourRow.is_closed}
                          onChange={(e) => handleHourChange(index, 'spans_midnight', e.target.checked)}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
}
