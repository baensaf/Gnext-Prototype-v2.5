import type { Branch, Terminal } from 'src/api/tenantApi';

import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
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
} from '@mui/material';

import { tenantApi } from 'src/api/tenantApi';

export function TerminalsPage() {

  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [terminalType, setTerminalType] = useState<'CASHIER' | 'KIOSK' | 'KDS'>('CASHIER');
  const [branchId, setBranchId] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const bList = await tenantApi.getBranches();
      setBranches(bList);
      const tList = await tenantApi.getTerminals(selectedBranchId || undefined);
      setTerminals(tList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load terminals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedBranchId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchId) {
      setError('Please select a branch');
      return;
    }
    try {
      await tenantApi.createTerminal({ branch_id: branchId, code, name, terminal_type: terminalType });
      setDrawerOpen(false);
      setCode('');
      setName('');
      setBranchId('');
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to create terminal');
    }
  };

  const handleArchive = async (id: string, terminalName: string) => {
    if (window.confirm(`Are you sure you want to archive terminal "${terminalName}"?`)) {
      try {
        await tenantApi.archiveTerminal(id);
        loadData();
      } catch (err: any) {
        setError(err.detail || 'Failed to archive terminal');
      }
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
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Terminal Registry
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage operational POS, Kiosk, and Kitchen KDS terminal hardware
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          Add Terminal
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Branch Filter */}
      <Box sx={{ mb: 3, maxWidth: 300 }}>
        <FormControl fullWidth size="small">
          <InputLabel>Filter by Branch</InputLabel>
          <Select
            value={selectedBranchId}
            label="Filter by Branch"
            onChange={(e) => setSelectedBranchId(e.target.value)}
          >
            <MenuItem value="">All Branches</MenuItem>
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
                  <TableCell>Code</TableCell>
                  <TableCell>Terminal Name</TableCell>
                  <TableCell>Terminal Type</TableCell>
                  <TableCell>Branch</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {terminals.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                      No terminals found for this selection.
                    </TableCell>
                  </TableRow>
                )}
                {terminals.map((t) => {
                  const branchObj = branches.find((b) => b.id === t.branch_id);
                  return (
                    <TableRow key={t.id}>
                      <TableCell><code>{t.code}</code></TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>{t.name}</TableCell>
                      <TableCell>
                        <Chip
                          label={t.terminal_type}
                          color={getTypeChipColor(t.terminal_type) as any}
                          size="small"
                          sx={{ fontWeight: 'bold' }}
                        />
                      </TableCell>
                      <TableCell>{branchObj ? `${branchObj.name} (${branchObj.code})` : '—'}</TableCell>
                      <TableCell>
                        <Chip
                          label={t.is_active ? 'Active' : 'Archived'}
                          color={t.is_active ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                      <TableCell align="center">
                        <IconButton
                          title="Archive Terminal"
                          color="error"
                          onClick={() => handleArchive(t.id, t.name)}
                        >
                          <DeleteIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create Terminal Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Add New Terminal
          </Typography>
          <form onSubmit={handleCreate}>
            <Stack spacing={2.5}>
              <FormControl fullWidth required>
                <InputLabel>Branch</InputLabel>
                <Select
                  value={branchId}
                  label="Branch"
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
                label="Terminal Code"
                placeholder="e.g. TEH-CENTRAL-POS-2"
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />

              <TextField
                label="Terminal Name"
                placeholder="e.g. Cashier Counter 2"
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <FormControl fullWidth required>
                <InputLabel>Terminal Type</InputLabel>
                <Select
                  value={terminalType}
                  label="Terminal Type"
                  onChange={(e) => setTerminalType(e.target.value as any)}
                >
                  <MenuItem value="CASHIER">CASHIER (POS Touch)</MenuItem>
                  <MenuItem value="KIOSK">KIOSK (Self-Service)</MenuItem>
                  <MenuItem value="KDS">KDS (Kitchen Display)</MenuItem>
                </Select>
              </FormControl>

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                Save Terminal
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>
    </Box>
  );
}
