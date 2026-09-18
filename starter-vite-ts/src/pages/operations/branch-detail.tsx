import type { Branch, BranchOperatingHour } from 'src/api/tenantApi';

import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
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
  IconButton,
  Typography,
  CardContent,
  TableContainer,
  CircularProgress,
} from '@mui/material';

import { tenantApi } from 'src/api/tenantApi';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

// Iran's week, Saturday first. day_of_week is JavaScript's day number (0 = Sunday), the
// same as the selling windows and the server's next-shift clock use.
const WEEK = [
  { key: 'saturday', day: 6 },
  { key: 'sunday', day: 0 },
  { key: 'monday', day: 1 },
  { key: 'tuesday', day: 2 },
  { key: 'wednesday', day: 3 },
  { key: 'thursday', day: 4 },
  { key: 'friday', day: 5 },
] as const;

/** One opening window of a day. A day with several (lunch, dinner) has several shifts. */
type Shift = Pick<BranchOperatingHour, 'open_time' | 'close_time' | 'spans_midnight'>;
interface DayHours {
  closed: boolean;
  shifts: Shift[];
}

const DEFAULT_SHIFT: Shift = { open_time: '08:00:00', close_time: '23:00:00', spans_midnight: false };

export function BranchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const theme = useTheme();

  const [branch, setBranch] = useState<Branch | null>(null);
  const [week, setWeek] = useState<Record<number, DayHours>>({});
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
      const byDay: Record<number, DayHours> = {};
      for (const { day } of WEEK) {
        const rows = (h || []).filter((r) => r.day_of_week === day);
        const open = rows.filter((r) => !r.is_closed).sort((x, y) => x.open_time.localeCompare(y.open_time));
        byDay[day] = {
          closed: rows.length > 0 && open.length === 0,
          shifts: open.length ? open.map(({ open_time, close_time, spans_midnight }) => ({ open_time, close_time, spans_midnight })) : [DEFAULT_SHIFT],
        };
      }
      setWeek(byDay);
    } catch (err: any) {
      setError(err.detail || err.message || t('operations.branchDetail.loadError', 'Failed to load branch details'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const setDay = (day: number, change: (d: DayHours) => DayHours) =>
    setWeek((prev) => ({ ...prev, [day]: change(prev[day] || { closed: false, shifts: [DEFAULT_SHIFT] }) }));

  const setShift = (day: number, index: number, change: Partial<Shift>) =>
    setDay(day, (d) => ({ ...d, shifts: d.shifts.map((s, i) => (i === index ? { ...s, ...change } : s)) }));

  const handleSaveHours = async () => {
    if (!id) return;
    try {
      const rows = WEEK.flatMap(({ day }) => {
        const d = week[day] || { closed: false, shifts: [DEFAULT_SHIFT] };
        return d.closed
          ? [{ day_of_week: day, is_closed: true } as BranchOperatingHour]
          : d.shifts.map((s) => ({ day_of_week: day, is_closed: false, ...s }) as BranchOperatingHour);
      });
      await tenantApi.updateBranchHours(id, rows);
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
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t(
              'operations.branchDetail.shiftsHelp',
              'Open all day in one stretch, or in shifts (lunch and dinner). An item taken off until the next shift comes back when the next shift here starts.'
            )}
          </Typography>

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
                {WEEK.map(({ key, day }) => {
                  const d = week[day] || { closed: false, shifts: [DEFAULT_SHIFT] };
                  return d.shifts.map((shift, index) => (
                    <TableRow key={`${key}-${index}`} hover>
                      {index === 0 && (
                        <>
                          <TableCell rowSpan={d.shifts.length} sx={{ fontWeight: 'bold', verticalAlign: 'top' }}>
                            {t(`operations.branchDetail.days.${key}`, key)}
                            {!d.closed && (
                              <Box>
                                <Button
                                  size="small"
                                  startIcon={<AddIcon />}
                                  onClick={() =>
                                    setDay(day, (x) => ({
                                      ...x,
                                      shifts: [...x.shifts, { open_time: '19:00:00', close_time: '23:00:00', spans_midnight: false }],
                                    }))
                                  }
                                >
                                  {t('operations.branchDetail.addShift', 'Add shift')}
                                </Button>
                              </Box>
                            )}
                          </TableCell>
                          <TableCell rowSpan={d.shifts.length} align="center" sx={{ verticalAlign: 'top' }}>
                            <Switch
                              checked={d.closed}
                              onChange={(e) => setDay(day, (x) => ({ ...x, closed: e.target.checked }))}
                              color="error"
                            />
                          </TableCell>
                        </>
                      )}
                      <TableCell>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 48 }}>
                            {t('operations.branchDetail.shiftN', { defaultValue: 'Shift {{n}}', n: index + 1 })}
                          </Typography>
                          <TextField
                            type="time"
                            size="small"
                            disabled={d.closed}
                            value={shift.open_time.substring(0, 5)}
                            onChange={(e) => setShift(day, index, { open_time: `${e.target.value}:00` })}
                          />
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <TextField
                          type="time"
                          size="small"
                          disabled={d.closed}
                          value={shift.close_time.substring(0, 5)}
                          onChange={(e) => setShift(day, index, { close_time: `${e.target.value}:00` })}
                        />
                      </TableCell>
                      <TableCell align="center">
                        <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'center' }}>
                          <Switch
                            checked={shift.spans_midnight}
                            disabled={d.closed}
                            onChange={(e) => setShift(day, index, { spans_midnight: e.target.checked })}
                          />
                          {d.shifts.length > 1 && !d.closed && (
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => setDay(day, (x) => ({ ...x, shifts: x.shifts.filter((_, i) => i !== index) }))}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ));
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>
    </Box>
  );
}
