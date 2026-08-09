import axios from 'axios';
import React, { useState, useEffect } from 'react';

import {
  Box,
  Card,
  Grid,
  Chip,
  Table,
  Paper,
  Stack,
  Button,
  Select,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  InputLabel,
  FormControl,
  TableContainer,
} from '@mui/material';

export function ReportViewerPage() {
  const [catalog, setCatalog] = useState<any[]>([]);
  const [selectedReportCode, setSelectedReportCode] = useState('sales-summary');
  const [reportResult, setReportResult] = useState<any>(null);
  const [savedViews, setSavedViews] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [savedViewName, setSavedViewName] = useState('');

  const fetchCatalog = async () => {
    try {
      const res = await axios.get('/api/v1/reports/catalog');
      setCatalog(res.data);
    } catch (err) {
      console.error('Failed to load report catalog:', err);
    }
  };

  const fetchSavedViews = async () => {
    try {
      const res = await axios.get('/api/v1/reports/saved-views', {
        params: { reportCode: selectedReportCode },
      });
      setSavedViews(res.data);
    } catch (err) {
      console.error('Failed to load saved views:', err);
    }
  };

  const handleRunQuery = async () => {
    setLoading(true);
    try {
      const res = await axios.post('/api/v1/reports/query', {
        reportCode: selectedReportCode,
        filters: { startDate, endDate },
      });
      setReportResult(res.data);
    } catch (err) {
      alert('Failed to query report');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveView = async () => {
    if (!savedViewName) return;
    try {
      await axios.post('/api/v1/reports/saved-views', {
        name: savedViewName,
        reportCode: selectedReportCode,
        filters: { startDate, endDate },
      });
      setSavedViewName('');
      fetchSavedViews();
    } catch (err) {
      alert('Failed to save view');
    }
  };

  const handleExport = async (format: 'CSV' | 'XLSX') => {
    try {
      const res = await axios.post('/api/v1/reports/export', {
        reportCode: selectedReportCode,
        filters: { startDate, endDate },
        format,
      });

      const { content_base64, filename } = res.data;
      const mime = format === 'CSV' ? 'text/csv;charset=utf-8;' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      const byteCharacters = atob(content_base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i += 1) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: mime });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      alert('Export failed');
    }
  };

  useEffect(() => {
    fetchCatalog();
    handleRunQuery();
  }, []);

  useEffect(() => {
    handleRunQuery();
    fetchSavedViews();
  }, [selectedReportCode]);

  const headers = reportResult?.rows?.length > 0 ? Object.keys(reportResult.rows[0]) : [];

  return (
    <Box sx={{ p: 3 }}>
      {/* Header & Catalog Selection */}
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Reports Catalog & Analytics
          </Typography>

          <Typography color="text.secondary">
            Execute Section 13 business & operational reports with live summary totals.
          </Typography>
        </Box>

        <Stack direction="row" spacing={2}>
          <Button variant="outlined" color="primary" onClick={() => handleExport('CSV')}>
            Export UTF-8 CSV
          </Button>
          <Button variant="contained" color="primary" onClick={() => handleExport('XLSX')}>
            Export Typed XLSX
          </Button>
        </Stack>
      </Stack>

      {/* Filter & Saved View Bar */}
      <Card sx={{ p: 3, borderRadius: 3, mb: 3 }}>
        <Grid container spacing={2} sx={{ alignItems: 'center' }}>
          <Grid size={{ xs: 12, md: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Select Report</InputLabel>
              <Select
                value={selectedReportCode}
                label="Select Report"
                onChange={(e) => setSelectedReportCode(e.target.value)}
              >
                {catalog.map((rep) => (
                  <MenuItem key={rep.code} value={rep.code}>
                    {rep.name} ({rep.category})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField
              label="Start Date"
              type="date"
              size="small"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Grid>

          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField
              label="End Date"
              type="date"
              size="small"
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Grid>

          <Grid size={{ xs: 12, sm: 2 }}>
            <Button variant="contained" fullWidth onClick={handleRunQuery} disabled={loading}>
              Run Report
            </Button>
          </Grid>
        </Grid>

        {/* Saved Report Views */}
        <Stack direction="row" spacing={2} sx={{ mt: 2, alignItems: 'center' }}>
          <TextField
            label="Save Filter View Name"
            size="small"
            value={savedViewName}
            onChange={(e) => setSavedViewName(e.target.value)}
          />
          <Button variant="outlined" size="small" onClick={handleSaveView} disabled={!savedViewName}>
            Save View
          </Button>
          {savedViews.length > 0 && (
            <Chip label={`${savedViews.length} Saved Filter Views Available`} color="secondary" size="small" />
          )}
        </Stack>
      </Card>

      {/* Report Data Table */}
      <Card sx={{ p: 3, borderRadius: 3 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
            Report Results ({reportResult?.rows?.length || 0} rows)
          </Typography>

          <Chip label="Filter Basis: Business Date" color="info" size="small" sx={{ fontWeight: 'bold' }} />
        </Stack>

        {reportResult?.rows?.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body1" color="text.secondary">
              No data for the selected filters.
            </Typography>
            <Button variant="text" color="primary" sx={{ mt: 1 }} onClick={() => { setStartDate(''); setEndDate(''); handleRunQuery(); }}>
              Clear filters
            </Button>
          </Box>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead sx={{ bgcolor: 'background.neutral' }}>
                <TableRow>
                  {headers.map((h) => (
                    <TableCell key={h} sx={{ fontWeight: 'bold', textTransform: 'capitalize' }}>
                      {h.replace(/_/g, ' ')}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {reportResult?.rows?.map((row: any, idx: number) => (
                  <TableRow key={idx} hover>
                    {headers.map((h) => (
                      <TableCell key={h}>
                        {typeof row[h] === 'object' ? JSON.stringify(row[h]) : String(row[h])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

                {/* Summary Totals Row */}
                {reportResult?.summary_totals && (
                  <TableRow sx={{ bgcolor: 'action.hover' }}>
                    <TableCell sx={{ fontWeight: 'bold' }}>SUMMARY TOTALS</TableCell>
                    {headers.slice(1).map((h) => {
                      const totalVal = reportResult.summary_totals[h] || reportResult.summary_totals[h + '_total'] || '-';
                      return (
                        <TableCell key={h} sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                          {String(totalVal)}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </Box>
  );
}

export default ReportViewerPage;
