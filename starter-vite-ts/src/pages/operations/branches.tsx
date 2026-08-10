import type { Branch } from 'src/api/tenantApi';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
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

export function BranchesPage() {
  const { t: _t } = useTranslation();
  const navigate = useNavigate();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const loadBranches = async () => {
    setLoading(true);
    try {
      const data = await tenantApi.getBranches();
      setBranches(data);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load branches');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBranches();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await tenantApi.createBranch({ code, name, phone, address });
      setDrawerOpen(false);
      setCode('');
      setName('');
      setPhone('');
      setAddress('');
      loadBranches();
    } catch (err: any) {
      setError(err.detail || 'Failed to create branch');
    }
  };

  const handleArchive = async (id: string, branchName: string) => {
    if (window.confirm(`Are you sure you want to archive branch "${branchName}"?`)) {
      try {
        await tenantApi.archiveBranch(id);
        loadBranches();
      } catch (err: any) {
        setError(err.detail || 'Failed to archive branch');
      }
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            Branch Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Configure tenant branches, locations, and operating schedules
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDrawerOpen(true)}
          sx={{ fontWeight: 'bold' }}
        >
          Create Branch
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card sx={{ borderRadius: 3, boxShadow: 2 }}>
        <CardContent sx={{ p: 0 }}>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 3 }}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Code</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell>Phone</TableCell>
                  <TableCell>Address</TableCell>
                  <TableCell>Time Zone</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {branches.length === 0 && !loading && (
                  <TableRow>
                    <TableCell colSpan={7} align="center" sx={{ py: 3 }}>
                      No branches found. Click &quot;Create Branch&quot; to add one.
                    </TableCell>
                  </TableRow>
                )}
                {branches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell><code>{b.code}</code></TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{b.name}</TableCell>
                    <TableCell>{b.phone || '—'}</TableCell>
                    <TableCell>{b.address || '—'}</TableCell>
                    <TableCell>{b.time_zone || 'Asia/Tehran'}</TableCell>
                    <TableCell>
                      <Chip
                        label={b.is_active ? 'Active' : 'Archived'}
                        color={b.is_active ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="center">
                      <IconButton
                        title="Hours Schedule"
                        color="primary"
                        onClick={() => navigate(`/app/operations/branches/${b.id}`)}
                      >
                        <AccessTimeIcon />
                      </IconButton>
                      <IconButton
                        title="Archive Branch"
                        color="error"
                        onClick={() => handleArchive(b.id, b.name)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Create Branch Drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Create New Branch
          </Typography>
          <form onSubmit={handleCreate}>
            <Stack spacing={2.5}>
              <TextField
                label="Branch Code"
                placeholder="e.g. TEH-WEST"
                required
                fullWidth
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <TextField
                label="Branch Name"
                placeholder="e.g. Tehran West Branch"
                required
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <TextField
                label="Phone Number"
                placeholder="e.g. +982188000003"
                fullWidth
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <TextField
                label="Address"
                multiline
                rows={3}
                fullWidth
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
              <Button type="submit" variant="contained" size="large" fullWidth sx={{ fontWeight: 'bold' }}>
                Save Branch
              </Button>
            </Stack>
          </form>
        </Box>
      </Drawer>
    </Box>
  );
}
