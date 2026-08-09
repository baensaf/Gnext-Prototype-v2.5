import type { Branch, BranchOperatingHour } from 'src/api/tenantApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router';

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
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  CardContent,
  TableContainer,
} from '@mui/material';

import { tenantApi } from 'src/api/tenantApi';

const DAY_NAMES = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export function BranchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [branch, setBranch] = useState<Branch | null>(null);
  const [hours, setHours] = useState<BranchOperatingHour[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const b = await tenantApi.getBranchById(id);
      const h = await tenantApi.getBranchHours(id);
      setBranch(b);
      setHours(h);
    } catch (err: any) {
      setError(err.detail || 'Failed to load branch details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  const handleHourChange = (dayIndex: number, field: keyof BranchOperatingHour, value: any) => {
    setHours((prev) =>
      prev.map((item) => (item.day_of_week === dayIndex ? { ...item, [field]: value } : item))
    );
  };

  const handleSaveHours = async () => {
    if (!id) return;
    try {
      await tenantApi.updateBranchHours(id, hours);
      setSuccess('Operating hours updated successfully');
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to update operating hours');
    }
  };

  if (loading) return <Typography>Loading branch details...</Typography>;
  if (!branch) return <Typography color="error">Branch not found</Typography>;

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', mb: 3, gap: 2 }}>
        <IconButton onClick={() => navigate('/app/operations/branches')}>
          <ArrowBackIcon />
        </IconButton>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            {branch.name} (<code>{branch.code}</code>)
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {branch.address || 'No address specified'} | {branch.phone || 'No phone'}
          </Typography>
        </Box>
      </Stack>

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
              7-Day Operating Hours Schedule
            </Typography>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleSaveHours}
              sx={{ fontWeight: 'bold' }}
            >
              Save Schedule
            </Button>
          </Stack>

          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Day of Week</TableCell>
                  <TableCell align="center">Is Closed</TableCell>
                  <TableCell>Open Time</TableCell>
                  <TableCell>Close Time</TableCell>
                  <TableCell align="center">Spans Midnight</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {DAY_NAMES.map((dayName, index) => {
                  const hourRow = hours.find((h) => h.day_of_week === index) || {
                    day_of_week: index,
                    open_time: '08:00:00',
                    close_time: '23:00:00',
                    is_closed: false,
                    spans_midnight: false,
                  };

                  return (
                    <TableRow key={index}>
                      <TableCell sx={{ fontWeight: 'bold' }}>{dayName}</TableCell>
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
