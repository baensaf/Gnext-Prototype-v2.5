import type { ApprovalRule, ApprovalRequest } from 'src/api/approvalApi';

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

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
import { useIsHeadOffice } from 'src/store/useAuthStore';
import { useBranchContext } from 'src/contexts/branch-context';
import { SettingScopeNotice } from 'src/components/setting-scope';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

export function ApprovalsSettingsPage() {
  const { t, i18n } = useTranslation();
  // Approval thresholds carry no branch column: one policy for the chain, set at head office.
  const isHeadOffice = useIsHeadOffice();
  const { selectedBranch } = useBranchContext();

  const DEFAULT_ACTIONS = [
    { code: 'DISCOUNT', label: t('settings.approvalsPage.actions.DISCOUNT', 'Manual Cashier Discount (%)') },
    { code: 'PRICE_OVERRIDE', label: t('settings.approvalsPage.actions.PRICE_OVERRIDE', 'Manual Price Override') },
    { code: 'REFUND', label: t('settings.approvalsPage.actions.REFUND', 'Order Refund') },
    { code: 'CANCEL', label: t('settings.approvalsPage.actions.CANCEL', 'Paid Order Cancellation') },
    { code: 'CREDIT_OVERRIDE', label: t('settings.approvalsPage.actions.CREDIT_OVERRIDE', 'Customer Credit Limit Override') },
    { code: 'REOPEN_ORDER', label: t('settings.approvalsPage.actions.REOPEN_ORDER', 'Reopen Closed Order') },
    { code: 'SHIFT_CLOSE', label: t('settings.approvalsPage.actions.SHIFT_CLOSE', 'Shift Close Overage/Shortage') },
  ];

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
      setError(err?.response?.data?.message || err.detail || t('settings.approvalsPage.loadError', 'Failed to load approval settings'));
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
      setSuccess(
        t('settings.approvalsPage.saveSuccess', 'Approval rule for {{action}} saved successfully', { action })
      );
      setDrawerOpen(false);
      loadData();
    } catch (err: any) {
      setError(err?.response?.data?.message || err.detail || t('settings.approvalsPage.saveError', 'Failed to save approval rule'));
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '—';
    try {
      const d = new Date(dateString);
      const isFa = i18n.language === 'fa';
      return new Intl.DateTimeFormat(isFa ? 'fa-IR-u-ca-persian' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    } catch {
      return dateString;
    }
  };

  const formatTime = (dateString: string | null) => {
    if (!dateString) return '—';
    try {
      const d = new Date(dateString);
      const isFa = i18n.language === 'fa';
      return new Intl.DateTimeFormat(isFa ? 'fa-IR-u-ca-persian' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(d);
    } catch {
      return dateString;
    }
  };

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('settings.approvalsPage.title', 'Approval Workflows & Policies')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('settings.approvalsPage.title', 'Approvals') },
        ]}
        action={
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
              {t('common.refresh', 'Refresh')}
            </Button>
            <Button variant="contained" startIcon={<ShieldIcon />} onClick={() => setDrawerOpen(true)} disabled={!isHeadOffice}>
              {t('settings.approvalsPage.configureRule', 'Configure Policy Rule')}
            </Button>
          </Stack>
        }
      />

      <SettingScopeNotice kind="CHAIN" isHeadOffice={isHeadOffice} branchName={selectedBranch?.name} />

      <Alert severity="info" variant="outlined" sx={{ mb: 3, borderRadius: 2, fontWeight: 500 }}>
        {t(
          'settings.approvalsPage.previewBanner',
          'V5 Preview Module: Advanced multi-step approval workflow rules & Argon2 PIN hashing engine. Retained for V5 architectural evaluation.'
        )}
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
        {t('settings.approvalsPage.activeRulesTitle', 'Active Escalation Rules & Limits')}
      </Typography>

      <TableContainer component={Paper} variant="outlined" sx={{ mb: 4 }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('settings.approvalsPage.colAction', 'Operational Action')}</TableCell>
              <TableCell>{t('settings.approvalsPage.colThreshold', 'Threshold Limit')}</TableCell>
              <TableCell>{t('settings.approvalsPage.colSteps', 'Required Approval Steps')}</TableCell>
              <TableCell>{t('settings.approvalsPage.colRole', 'Required Approver Role')}</TableCell>
              <TableCell>{t('settings.approvalsPage.colStatus', 'Status')}</TableCell>
              <TableCell align="right">
                {t('settings.approvalsPage.colActions', 'Actions')}
              </TableCell>
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
                      <Chip
                        label={`> ${rule.threshold_value} ${rule.threshold_type === 'PERCENTAGE' ? '%' : ''}`}
                        color="warning"
                        size="small"
                      />
                    ) : (
                      <Chip
                        label={t('settings.approvalsPage.defaultNoLimit', 'Default (No Limit)')}
                        variant="outlined"
                        size="small"
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {rule
                      ? rule.required_steps === 2
                        ? t('settings.approvalsPage.stepMulti', '2 Step (Multi-Step)')
                        : t('settings.approvalsPage.stepSingle', '1 Step (Single)')
                      : t('settings.approvalsPage.stepSingle', '1 Step (Single)')}
                  </TableCell>
                  <TableCell>
                    {rule
                      ? rule.approver_role === 'ADMIN'
                        ? t('settings.approvalsPage.roleAdmin', 'Tenant Administrator')
                        : rule.approver_role === 'MANAGER'
                        ? t('settings.approvalsPage.roleManager', 'Branch Manager')
                        : t('settings.approvalsPage.roleSupervisor', 'Supervisor')
                      : t('settings.approvalsPage.roleSupervisor', 'Supervisor')}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={
                        rule?.is_active
                          ? t('settings.approvalsPage.statusActive', 'Active')
                          : t('settings.approvalsPage.statusConfigured', 'Configured')
                      }
                      color={rule?.is_active ? 'success' : 'default'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      color="primary"
                      disabled={!isHeadOffice}
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
        {t('settings.approvalsPage.auditTitle', 'Approval Request Audit Log')}
      </Typography>

      <TableContainer component={Paper} variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>{t('settings.approvalsPage.colReqCode', 'Request Code')}</TableCell>
              <TableCell>{t('settings.approvalsPage.colAction', 'Action')}</TableCell>
              <TableCell>{t('settings.approvalsPage.colStatus', 'Status')}</TableCell>
              <TableCell>{t('settings.approvalsPage.colSteps', 'Current Step')}</TableCell>
              <TableCell>{t('settings.approvalsPage.colExpires', 'Expires At')}</TableCell>
              <TableCell>{t('settings.approvalsPage.colReqDate', 'Requested Date')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {requests.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                    {t('settings.approvalsPage.noRequests', 'No approval requests generated yet.')}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              requests.map((req) => (
                <TableRow key={req.id}>
                  <TableCell>
                    <code>{req.code}</code>
                  </TableCell>
                  <TableCell>
                    {t(`settings.approvalsPage.actions.${req.action}`, req.action)}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={t(`settings.approvalsPage.statuses.${req.status}`, req.status)}
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
                    {req.current_step} / {req.total_steps}
                  </TableCell>
                  <TableCell>{formatTime(req.expires_at)}</TableCell>
                  <TableCell>{formatDate(req.created_at)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Drawer Form */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        <Box sx={{ width: { xs: 320, sm: 400 }, p: 3 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
            {t('settings.approvalsPage.drawerTitle', 'Configure Policy Rule')}
          </Typography>
          <Box component="form" onSubmit={handleSaveRule}>
            <Stack spacing={2.5}>
              <TextField
                select
                label={t('settings.approvalsPage.formAction', 'Action')}
                value={action}
                onChange={(e) => setAction(e.target.value)}
                fullWidth
              >
                {DEFAULT_ACTIONS.map((a) => (
                  <MenuItem key={a.code} value={a.code}>
                    {a.label}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                select
                label={t('settings.approvalsPage.formThresholdType', 'Threshold Type')}
                value={thresholdType}
                onChange={(e) => setThresholdType(e.target.value)}
                fullWidth
              >
                <MenuItem value="PERCENTAGE">{t('settings.approvalsPage.typePercentage', 'Percentage (%)')}</MenuItem>
                <MenuItem value="AMOUNT">{t('settings.approvalsPage.typeAmount', 'Fixed Amount (Base Currency)')}</MenuItem>
              </TextField>

              <TextField
                label={t('settings.approvalsPage.formThresholdValue', 'Threshold Limit Value')}
                value={thresholdValue}
                onChange={(e) => setThresholdValue(e.target.value)}
                required
                fullWidth
                placeholder={t('settings.approvalsPage.formThresholdPlaceholder', 'e.g. 10 for >10%')}
                helperText={t('settings.approvalsPage.formThresholdHelper', 'Operations exceeding this limit require manager PIN approval')}
              />

              <TextField
                select
                label={t('settings.approvalsPage.formSteps', 'Approval Workflow Steps')}
                value={requiredSteps}
                onChange={(e) => setRequiredSteps(e.target.value)}
                fullWidth
              >
                <MenuItem value="1">{t('settings.approvalsPage.stepOption1', '1 Step Approval (Supervisor)')}</MenuItem>
                <MenuItem value="2">{t('settings.approvalsPage.stepOption2', '2 Step Approval (Supervisor → Manager)')}</MenuItem>
              </TextField>

              <TextField
                select
                label={t('settings.approvalsPage.formRole', 'Required Approver Role')}
                value={approverRole}
                onChange={(e) => setApproverRole(e.target.value)}
                fullWidth
              >
                <MenuItem value="SUPERVISOR">{t('settings.approvalsPage.roleSupervisor', 'Supervisor')}</MenuItem>
                <MenuItem value="MANAGER">{t('settings.approvalsPage.roleManager', 'Branch Manager')}</MenuItem>
                <MenuItem value="ADMIN">{t('settings.approvalsPage.roleAdmin', 'Tenant Administrator')}</MenuItem>
              </TextField>

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }}>
                {t('settings.approvalsPage.saveButton', 'Save Policy Rule')}
              </Button>
            </Stack>
          </Box>
        </Box>
      </Drawer>
    </Box>
  );
}
