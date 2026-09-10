import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import {
  Box,
  Card,
  Grid,
  Stack,
  Alert,
  Button,
  TextField,
  Typography,
  CircularProgress,
} from '@mui/material';

import { httpClient as axios } from 'src/api/httpClient';
import { DashboardContent } from 'src/layouts/dashboard';
import { useIsHeadOffice } from 'src/store/useAuthStore';
import { useBranchContext } from 'src/contexts/branch-context';

import { Iconify } from 'src/components/iconify';
import { SettingScopeNotice } from 'src/components/setting-scope';

interface RolePolicy {
  cashierMaxPct: number;
  cashierMaxFixed: number;
  supervisorMaxPct: number;
  supervisorMaxFixed: number;
  managerMaxPct: number;
  managerMaxFixed: number;
  adminMaxPct: number;
  adminMaxFixed: number;
}

interface DiscountAuthorizationsPageProps {
  isEmbedded?: boolean;
}

export default function DiscountAuthorizationsPage({ isEmbedded = false }: DiscountAuthorizationsPageProps) {
  const { t } = useTranslation();
  // DISCOUNT_AUTHORIZATIONS is not on the overridable list, so this is the chain's single
  // policy and the server refuses a branch account writing it.
  const isHeadOffice = useIsHeadOffice();
  const { selectedBranch } = useBranchContext();

  const [policy, setPolicy] = useState<RolePolicy>({
    cashierMaxPct: 10,
    cashierMaxFixed: 50000,
    supervisorMaxPct: 20,
    supervisorMaxFixed: 150000,
    managerMaxPct: 30,
    managerMaxFixed: 300000,
    adminMaxPct: 100,
    adminMaxFixed: 10000000,
  });

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchPolicy = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get('/api/v1/settings');
      const data = res.data;
      const authSetting = data?.DISCOUNT_AUTHORIZATIONS || data?.DISCOUNTS || {};

      setPolicy({
        cashierMaxPct: authSetting.cashierMaxPct ?? 10,
        cashierMaxFixed: authSetting.cashierMaxFixed ?? 50000,
        supervisorMaxPct: authSetting.supervisorMaxPct ?? 20,
        supervisorMaxFixed: authSetting.supervisorMaxFixed ?? 150000,
        managerMaxPct: authSetting.managerMaxPct ?? 30,
        managerMaxFixed: authSetting.managerMaxFixed ?? 300000,
        adminMaxPct: authSetting.adminMaxPct ?? 100,
        adminMaxFixed: authSetting.adminMaxFixed ?? 10000000,
      });
    } catch (err: any) {
      setError(err.detail || err.message || t('authPolicy.failedToLoad', 'Failed to load discount authorization policy'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchPolicy();
  }, [fetchPolicy]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await axios.patch('/api/v1/settings/DISCOUNT_AUTHORIZATIONS', policy);
      setSuccess(t('authPolicy.savedSuccess', 'Role-based manual discount authorization policy saved successfully.'));
    } catch (err: any) {
      setError(err.detail || err.message || t('authPolicy.failedToSave', 'Failed to save discount authorization settings'));
    } finally {
      setSaving(false);
    }
  };

  const content = (
    <Box sx={{ width: '100%' }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant={isEmbedded ? 'h5' : 'h4'} sx={{ fontWeight: 'bold' }}>
            {t('authPolicy.title', 'Cashier Manual Discount Authorizations')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('authPolicy.subtitle', 'Configure role-based percentage and fixed-amount manual discount thresholds and escalation PIN approvals.')}
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Iconify icon={'solar:copy-bold' as any} />}
          onClick={handleSave}
          disabled={saving || loading || !isHeadOffice}
        >
          {saving ? <CircularProgress size={24} /> : t('common.savePolicy', 'Save Policy')}
        </Button>
      </Stack>

      <SettingScopeNotice kind="CHAIN" isHeadOffice={isHeadOffice} branchName={selectedBranch?.name} />

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

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={3}>
          {/* Cashier Limit Card */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ p: 3 }}>
              <Typography variant="h6" color="primary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Iconify icon={'solar:user-id-bold' as any} />
                {t('authPolicy.cashierRole', 'Cashier Role Limits')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {t('authPolicy.cashierDesc', 'Maximum discount a standard POS cashier can apply without manager approval.')}
              </Typography>
              <Stack spacing={2}>
                <TextField
                  type="number"
                  label={t('authPolicy.maxPct', 'Max Percentage Discount (%)')}
                  value={policy.cashierMaxPct}
                  onChange={(e) => setPolicy({ ...policy, cashierMaxPct: Number(e.target.value) })}
                  disabled={!isHeadOffice}
                  helperText={t('authPolicy.defaultPct', 'Default: {{pct}}%', { pct: 10 })}
                />
                <TextField
                  type="number"
                  label={t('authPolicy.maxFixed', 'Max Fixed Amount Deduction (IRR)')}
                  value={policy.cashierMaxFixed}
                  onChange={(e) => setPolicy({ ...policy, cashierMaxFixed: Number(e.target.value) })}
                  disabled={!isHeadOffice}
                  helperText={t('authPolicy.defaultAmount', 'Default: {{amount}} IRR', { amount: '50,000' })}
                />
              </Stack>
            </Card>
          </Grid>

          {/* Supervisor Limit Card */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ p: 3 }}>
              <Typography variant="h6" color="warning.main" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Iconify icon={'solar:user-id-bold' as any} />
                {t('authPolicy.supervisorRole', 'Supervisor Role Limits')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {t('authPolicy.supervisorDesc', 'Authorized limit for floor supervisors entering approval PIN.')}
              </Typography>
              <Stack spacing={2}>
                <TextField
                  type="number"
                  label={t('authPolicy.maxPct', 'Max Percentage Discount (%)')}
                  value={policy.supervisorMaxPct}
                  onChange={(e) => setPolicy({ ...policy, supervisorMaxPct: Number(e.target.value) })}
                  disabled={!isHeadOffice}
                  helperText={t('authPolicy.defaultPct', 'Default: {{pct}}%', { pct: 20 })}
                />
                <TextField
                  type="number"
                  label={t('authPolicy.maxFixed', 'Max Fixed Amount Deduction (IRR)')}
                  value={policy.supervisorMaxFixed}
                  onChange={(e) => setPolicy({ ...policy, supervisorMaxFixed: Number(e.target.value) })}
                  disabled={!isHeadOffice}
                  helperText={t('authPolicy.defaultAmount', 'Default: {{amount}} IRR', { amount: '150,000' })}
                />
              </Stack>
            </Card>
          </Grid>

          {/* Manager Limit Card */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ p: 3 }}>
              <Typography variant="h6" color="success.main" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Iconify icon={'solar:shield-check-bold' as any} />
                {t('authPolicy.managerRole', 'Manager Role Limits')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {t('authPolicy.managerDesc', 'Maximum policy limit permitted by store manager PIN approval.')}
              </Typography>
              <Stack spacing={2}>
                <TextField
                  type="number"
                  label={t('authPolicy.maxPct', 'Max Percentage Discount (%)')}
                  value={policy.managerMaxPct}
                  onChange={(e) => setPolicy({ ...policy, managerMaxPct: Number(e.target.value) })}
                  disabled={!isHeadOffice}
                  helperText={t('authPolicy.defaultPct', 'Default: {{pct}}%', { pct: 30 })}
                />
                <TextField
                  type="number"
                  label={t('authPolicy.maxFixed', 'Max Fixed Amount Deduction (IRR)')}
                  value={policy.managerMaxFixed}
                  onChange={(e) => setPolicy({ ...policy, managerMaxFixed: Number(e.target.value) })}
                  disabled={!isHeadOffice}
                  helperText={t('authPolicy.defaultAmount', 'Default: {{amount}} IRR', { amount: '300,000' })}
                />
              </Stack>
            </Card>
          </Grid>

          {/* Enforcement Notice */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card sx={{ p: 3, bgcolor: 'background.neutral' }}>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Iconify icon={'solar:info-circle-bold' as any} color="info" />
                {t('authPolicy.enforcementTitle', 'Backend Policy Enforcement')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('authPolicy.enforcementDesc', 'Discounts exceeding a user’s role threshold are blocked at the quote level and require a manager PIN (seeded PIN 2468) to proceed.')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('authPolicy.auditNotice', 'Discounts exceeding maximum manager policy limit (30%) are rejected outright by server-side evaluation. All requests write immutable audit trails.')}
              </Typography>
            </Card>
          </Grid>
        </Grid>
      )}
    </Box>
  );

  return isEmbedded ? content : <DashboardContent>{content}</DashboardContent>;
}
