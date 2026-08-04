import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  Typography,
  Grid,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Stack,
  TextField,
} from '@mui/material';
import axios from 'axios';

export function ReportViewerPage() {
  const [catalog, setCatalog] = useState<any[]>([]);
  const [selectedReportCode, setSelectedReportCode] = useState('sales-summary');
  const [reportResult, setReportResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Filters
  const [startDate, setStartDate] = useState('2026-08-01');
  const [endDate, setEndDate] = useState('2026-08-31');

  const fetchCatalog = async () => {
    try {
      const res = await axios.get('/api/v1/reports/catalog');
      setCatalog(res.data);
    } catch (err) {
      console.error('Failed to load report catalog:', err);
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

  const handleExport = async (format: 'CSV' | 'XLSX') => {
    try {
      const res = await axios.post('/api/v1/reports/export', {
        reportCode: selectedReportCode,
        filters: { startDate, endDate },
        format,
      });

      if (format === 'CSV') {
        const blob = new Blob([res.data.content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', res.data.filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        alert('XLSX Export Download Initiated: ' + res.data.filename);
      }
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
            Export XLSX
          </Button>
        </Stack>
      </Stack>

      {/* Filter Bar */}
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
      </Card>

      {/* Report Data Table */}
      <Card sx={{ p: 3, borderRadius: 3 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
            Report Results ({reportResult?.rows?.length || 0} rows)
          </Typography>

          <Chip label="Filter Basis: Business Date" color="info" size="small" sx={{ fontWeight: 'bold' }} />
        </Stack>

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
      </Card>
    </Box>
  );
}

export default ReportViewerPage;
