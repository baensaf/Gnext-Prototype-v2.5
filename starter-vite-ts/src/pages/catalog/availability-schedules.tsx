import type { Product, Category, AvailabilitySchedule } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ScheduleIcon from '@mui/icons-material/Schedule';
import {
  Box,
  Chip,
  Paper,
  Stack,
  Alert,
  Table,
  Button,
  Dialog,
  MenuItem,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  IconButton,
  Typography,
  DialogTitle,
  ToggleButton,
  DialogContent,
  DialogActions,
  TableContainer,
  ToggleButtonGroup,
} from '@mui/material';

import { catalogApi } from 'src/api/catalogApi';
import { useBranchContext } from 'src/contexts/branch-context';

// Iran's week starts on Saturday. Values are JavaScript's day numbers, 0 = Sunday.
const WEEK = [6, 0, 1, 2, 3, 4, 5];

type Props = {
  products: Product[];
  categories: Category[];
  scopeName: string;
};

/**
 * Weekly selling windows: breakfast 07:00–11:00, a Friday-only dish. An item with no window
 * sells whenever the shop is open; with windows, only inside one, on the branch's clock. A
 * product's own window replaces its category's. What sells when is a menu decision, so only
 * head office adds or removes windows; a branch sees the ones that apply to it.
 */
export function AvailabilitySchedulesSection({ products, categories, scopeName }: Props) {
  const { t } = useTranslation();
  const { selectedBranchId, canChangeScope } = useBranchContext();

  const [schedules, setSchedules] = useState<AvailabilitySchedule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [targetType, setTargetType] = useState<'category' | 'product'>('category');
  const [targetId, setTargetId] = useState('');
  const [days, setDays] = useState<number[]>(WEEK);
  const [startTime, setStartTime] = useState('07:00');
  const [endTime, setEndTime] = useState('11:00');

  const branchParam = selectedBranchId || undefined;

  const load = useCallback(async () => {
    try {
      setSchedules(await catalogApi.getSchedules(branchParam));
    } catch (err: any) {
      setError(err.detail || t('catalog.schedules.errors.loadFailed', 'Failed to load selling windows'));
    }
  }, [branchParam, t]);

  useEffect(() => {
    load();
  }, [load]);

  const dayName = (day: number) => t(`catalog.schedules.days.${day}`);
  const targetName = (s: AvailabilitySchedule) =>
    s.product_id
      ? products.find((p) => p.id === s.product_id)?.name || s.product_id
      : categories.find((c) => c.id === s.category_id)?.name || s.category_id;

  const handleOpen = () => {
    setTargetType('category');
    setTargetId('');
    setDays(WEEK);
    setStartTime('07:00');
    setEndTime('11:00');
    setOpen(true);
  };

  const handleSave = async () => {
    try {
      await catalogApi.createSchedule({
        productId: targetType === 'product' ? targetId : undefined,
        categoryId: targetType === 'category' ? targetId : undefined,
        branchId: branchParam,
        daysOfWeek: days,
        startTime,
        endTime,
      });
      setOpen(false);
      load();
    } catch (err: any) {
      setError(err.detail || err.message || t('catalog.schedules.errors.saveFailed', 'Failed to save the selling window'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await catalogApi.deleteSchedule(id);
      load();
    } catch (err: any) {
      setError(err.detail || t('catalog.schedules.errors.deleteFailed', 'Failed to remove the selling window'));
    }
  };

  const options = targetType === 'product' ? products : categories;
  const overnight = startTime !== endTime && endTime < startTime;

  return (
    <Box sx={{ mt: 5 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
            {t('catalog.schedules.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('catalog.schedules.subtitle')}
          </Typography>
        </Box>
        {canChangeScope && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpen}>
            {t('catalog.schedules.add')}
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('catalog.schedules.target')}</TableCell>
              <TableCell>{t('catalog.schedules.daysLabel')}</TableCell>
              <TableCell>{t('catalog.schedules.hours')}</TableCell>
              <TableCell>{t('catalog.schedules.scope')}</TableCell>
              {canChangeScope && <TableCell align="right" />}
            </TableRow>
          </TableHead>
          <TableBody>
            {schedules.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Typography variant="body2" color="text.secondary">
                    {t('catalog.schedules.empty')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
            {schedules.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={s.product_id ? t('catalog.schedules.product') : t('catalog.schedules.category')}
                    />
                    <span>{targetName(s)}</span>
                  </Stack>
                </TableCell>
                <TableCell>
                  {WEEK.filter((d) => s.days_of_week.split(',').includes(String(d)))
                    .map(dayName)
                    .join('، ')}
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <ScheduleIcon fontSize="small" color="action" />
                    <span dir="ltr">
                      {s.start_time === s.end_time ? t('catalog.schedules.allDay') : `${s.start_time}–${s.end_time}`}
                    </span>
                  </Stack>
                </TableCell>
                <TableCell>{s.branch_id ? scopeName : t('catalog.availabilityPage.globalScope')}</TableCell>
                {canChangeScope && (
                  <TableCell align="right">
                    <IconButton size="small" color="error" onClick={() => handleDelete(s.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('catalog.schedules.add')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              {t('catalog.availabilityPage.scopeNotice', { scope: scopeName })}
            </Alert>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={targetType}
              onChange={(_, v) => {
                if (v) {
                  setTargetType(v);
                  setTargetId('');
                }
              }}
            >
              <ToggleButton value="category">{t('catalog.schedules.category')}</ToggleButton>
              <ToggleButton value="product">{t('catalog.schedules.product')}</ToggleButton>
            </ToggleButtonGroup>
            <TextField
              select
              fullWidth
              label={targetType === 'product' ? t('catalog.schedules.product') : t('catalog.schedules.category')}
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
            >
              {options.map((o) => (
                <MenuItem key={o.id} value={o.id}>
                  {o.name}
                </MenuItem>
              ))}
            </TextField>
            <ToggleButtonGroup size="small" value={days} onChange={(_, v) => setDays(v)} sx={{ flexWrap: 'wrap' }}>
              {WEEK.map((d) => (
                <ToggleButton key={d} value={d}>
                  {dayName(d)}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Stack direction="row" spacing={2}>
              <TextField
                type="time"
                label={t('catalog.schedules.start')}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
              <TextField
                type="time"
                label={t('catalog.schedules.end')}
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {(startTime === endTime && t('catalog.schedules.allDayHelp')) ||
                (overnight && t('catalog.schedules.overnightHelp')) ||
                t('catalog.schedules.replaceHelp')}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('catalog.availabilityPage.cancel')}</Button>
          <Button variant="contained" disabled={!targetId || days.length === 0} onClick={handleSave}>
            {t('catalog.schedules.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
