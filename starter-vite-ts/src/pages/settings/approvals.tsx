import type { ApprovalRule, ApprovalRequest } from 'src/api/approvalApi';

import React, { useState, useEffect } from 'react';

import EditIcon from '@mui/icons-material/Edit';
import ShieldIcon from '@mui/icons-material/Shield';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Box,
  Chip,
  Stack,
  Table,
  Paper,
  Alert,
  Button,
  Drawer,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  TableContainer,
} from '@mui/material';

import { approvalApi } from 'src/api/approvalApi';

const DEFAULT_ACTIONS = [
  { code: 'DISCOUNT', label: 'Manual Cashier Discount (%)' },
  { code: 'PRICE_OVERRIDE', label: 'Manual Price Override (IRR)' },
  { code: 'REFUND', label: 'Order Refund (IRR)' },
  { code: 'CANCEL', label: 'Paid Order Cancellation' },
  { code: 'CREDIT_OVERRIDE', label: 'Customer Credit Limit Override' },
  { code: 'REOPEN_ORDER', label: 'Reopen Closed Order' },
  { code: 'SHIFT_CLOSE', label: 'Shift Close Overage/Shortage' },
];

export function ApprovalsSettingsPage() {
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [_loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Edit Rule Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [action, setAction] = useState('DISCOUNT');
  const [thresholdType, setThresholdType] = useState('PERCENTAGE');
  const [thresholdValue, setThresholdValue] = useState('10');
  const [requiredSteps, setRequiredSteps] = useState('1');
  const [approverRole, setApproverRole] = useState('SUPERVISOR');

  const loadData = async () => {
    setLoading(true);
    try {
      const [rList, reqList] = await Promise.all([approvalApi.getRules(), approvalApi.getRequests()]);
      setRules(rList);
      setRequests(reqList);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to load approval settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await approvalApi.saveRule({
        action,
        threshold_type: thresholdType,
        threshold_value: thresholdValue,
        required_steps: parseInt(requiredSteps, 10),
        approver_role: approverRole,
      });
      setSuccess(`Approval rule for ${action} saved successfully`);
      setDrawerOpen(false);
      loadData();
    } catch (err: any) {
      setError(err.detail || 'Failed to save approval rule');
    }
  };

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Stack direction="row" spacing={1.5} sx={{ mb: 0.5, alignItems: 'center' }}>
            <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
              Approval Workflows & Policies
            </Typography>
            <Chip label="V5 Preview" color="info" size="small" sx={{ fontWeight: 'bold' }} />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Multi-step manager escalation rules, Argon2 PIN verification, and approval decision logs
          </Typography>
        </Box>
        <Stack direction="row" spacing={2}>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
            Refresh
          </Button>
          <Button variant="contained" startIcon={<ShieldIcon />} onClick={() => setDrawerOpen(true)}>
            Configure Policy Rule
          </Button>
        </Stack>
      </Stack>

      <Alert severity="info" variant="outlined" sx={{ mb: 3, borderRadius: 2, fontWeight: 500 }}>
        V5 Preview Module: Advanced multi-step approval workflow rules & Argon2 PIN hashing engine. Retained for V5 architectural evaluation.
      </Alert>

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

      {/* Rules Policy Matrix */}
      <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
        Active Escalation Rules & Limits
      </Typography>

      <TableContainer component={Paper} variant="outlined" sx={{ mb: 4 }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Operational Action</TableCell>
              <TableCell>Threshold Limit</TableCell>
              <TableCell>Required Approval Steps</TableCell>
              <TableCell>Required Approver Role</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {DEFAULT_ACTIONS.map((def) => {
              const rule = rules.find((r) => r.action === def.code);
              return (
                <TableRow key={def.code}>
                  <TableCell>
                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                      {def.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      <code>{def.code}</code>
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {rule ? (
                      <Chip label={`> ${rule.threshold_value} ${rule.threshold_type === 'PERCENTAGE' ? '%' : 'IRR'}`} color="warning" size="small" />
                    ) : (
                      <Chip label="Default (No Limit)" variant="outlined" size="small" />
                    )}
                  </TableCell>
                  <TableCell>{rule ? `${rule.required_steps} Step (${rule.required_steps === 2 ? 'Multi-Step' : 'Single'})` : '1 Step'}</TableCell>
                  <TableCell>{rule ? rule.approver_role : 'SUPERVISOR'}</TableCell>
                  <TableCell>
                    <Chip label={rule?.is_active ? 'Active' : 'Configured'} color={rule?.is_active ? 'success' : 'default'} size="small" />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      color="primary"
                      onClick={() => {
                        setAction(def.code);
                        if (rule) {
                          setThresholdType(rule.threshold_type);
                          setThresholdValue(rule.threshold_value);
                          setRequiredSteps(rule.required_steps.toString());
                          setApproverRole(rule.approver_role);
                        }
                        setDrawerOpen(true);
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Audit Log of Approval Requests */}
      <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
        Approval Request Audit Log
      </Typography>

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Request Code</TableCell>
              <TableCell>Action</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Current Step</TableCell>
              <TableCell>Expires At</TableCell>
              <TableCell>Requested Date</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {requests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                    No approval requests generated yet.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              requests.map((req) => (
                <TableRow key={req.id}>
                  <TableCell>
                    <code>{req.code}</code>
                  </TableCell>
                  <TableCell>{req.action}</TableCell>
                  <TableCell>
                    <Chip
                      label={req.status}
                      color={
                        req.status === 'APPROVED'
                          ? 'success'
                          : req.status === 'PENDING'
                            ? 'warning'
                            : req.status === 'EXPIRED'
                              ? 'error'
                              : 'default'
                      }
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    Step {req.current_step} of {req.total_steps}
                  </TableCell>
                  <TableCell>{new Date(req.expires_at).toLocaleTimeString()}</TableCell>
                  <TableCell>{new Date(req.created_at).toLocaleString()}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Drawer Form */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <Box sx={{ width: 400, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            Configure Policy Rule
          </Typography>
          <Box component="form" onSubmit={handleSaveRule}>
            <Stack spacing={2.5}>
              <TextField select label="Action" value={action} onChange={(e) => setAction(e.target.value)} fullWidth>
                {DEFAULT_ACTIONS.map((a) => (
                  <MenuItem key={a.code} value={a.code}>
                    {a.label}
                  </MenuItem>
                ))}
              </TextField>

              <TextField select label="Threshold Type" value={thresholdType} onChange={(e) => setThresholdType(e.target.value)} fullWidth>
                <MenuItem value="PERCENTAGE">Percentage (%)</MenuItem>
                <MenuItem value="AMOUNT">Fixed Amount (IRR)</MenuItem>
              </TextField>

              <TextField
                label="Threshold Limit Value"
                value={thresholdValue}
                onChange={(e) => setThresholdValue(e.target.value)}
                required
                fullWidth
                placeholder="e.g. 10 for >10%"
                helperText="Operations exceeding this limit require manager PIN approval"
              />

              <TextField select label="Approval Workflow Steps" value={requiredSteps} onChange={(e) => setRequiredSteps(e.target.value)} fullWidth>
                <MenuItem value="1">1 Step Approval (Supervisor)</MenuItem>
                <MenuItem value="2">2 Step Approval (Supervisor → Manager)</MenuItem>
              </TextField>

              <TextField select label="Required Approver Role" value={approverRole} onChange={(e) => setApproverRole(e.target.value)} fullWidth>
                <MenuItem value="SUPERVISOR">Supervisor</MenuItem>
                <MenuItem value="MANAGER">Branch Manager</MenuItem>
                <MenuItem value="ADMIN">Tenant Administrator</MenuItem>
              </TextField>

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                Save Policy Rule
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>
    </Box>
  );
}
