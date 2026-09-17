import type { Branch } from 'src/api/tenantApi';
import type { BranchAgent, EnrolmentCode, NewEnrolmentCode, EnrolmentCodeState } from 'src/api/agentsApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import KeyIcon from '@mui/icons-material/VpnKey';
import BlockIcon from '@mui/icons-material/Block';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
import CopyIcon from '@mui/icons-material/ContentCopy';
import {
  Box,
  Card,
  Chip,
  Stack,
  Table,
  Alert,
  Button,
  Dialog,
  Select,
  Switch,
  Tooltip,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  IconButton,
  InputLabel,
  CardHeader,
  DialogTitle,
  FormControl,
  DialogActions,
  DialogContent,
  TableContainer,
  FormControlLabel,
  CircularProgress,
} from '@mui/material';

import { fDateTime } from 'src/utils/format-time';

import { tenantApi } from 'src/api/tenantApi';
import { agentsApi } from 'src/api/agentsApi';
import { useScopedBranchId } from 'src/contexts/branch-context';

import { ConfirmDialog } from 'src/components/confirm-dialog';
import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

const CODE_STATE_COLOR: Record<EnrolmentCodeState, 'info' | 'success' | 'default' | 'warning'> = {
  PENDING: 'info',
  USED: 'success',
  EXPIRED: 'warning',
  CANCELLED: 'default',
};

/**
 * Head office decides which PC speaks for each branch: it hands out a one-time code for the
 * installer, sees the agents that enrolled with one, and revokes an agent it no longer trusts.
 */
export function AgentsPage() {
  const { t } = useTranslation();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [agents, setAgents] = useState<BranchAgent[]>([]);
  const [codes, setCodes] = useState<EnrolmentCode[]>([]);
  const [branchId, setBranchId] = useScopedBranchId();
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [codeDialogOpen, setCodeDialogOpen] = useState(false);
  const [codeBranchId, setCodeBranchId] = useState('');
  const [creating, setCreating] = useState(false);
  const [newCode, setNewCode] = useState<NewEnrolmentCode | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<BranchAgent | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [cancelTarget, setCancelTarget] = useState<EnrolmentCode | null>(null);

  const errorText = useCallback(
    (err: any, fallbackKey: string, fallback: string) => err?.detail || err?.message || t(fallbackKey, fallback),
    [t]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [branchList, agentList, codeList] = await Promise.all([
        tenantApi.getBranches(),
        agentsApi.list({ branchId: branchId || undefined, includeRevoked }),
        agentsApi.listCodes(branchId || undefined),
      ]);
      setBranches(branchList || []);
      setAgents(agentList || []);
      setCodes(codeList || []);
      setError(null);
    } catch (err: any) {
      setError(errorText(err, 'operations.agents.loadError', 'Failed to load branch agents'));
    } finally {
      setLoading(false);
    }
  }, [branchId, includeRevoked, errorText]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const branchLabel = (id: string) => {
    const b = branches.find((x) => x.id === id);
    return b ? `${b.name} (${b.code})` : '—';
  };

  const openCodeDialog = () => {
    setCodeBranchId(branchId || '');
    setNewCode(null);
    setCodeDialogOpen(true);
  };

  const closeCodeDialog = () => {
    setCodeDialogOpen(false);
    // The code is shown once; forget it as soon as the dialog closes.
    setNewCode(null);
  };

  const handleCreateCode = async () => {
    if (!codeBranchId) return;
    setCreating(true);
    try {
      setNewCode(await agentsApi.createCode(codeBranchId));
      loadData();
    } catch (err: any) {
      setError(errorText(err, 'operations.agents.createCodeError', 'Failed to create an enrolment code'));
      setCodeDialogOpen(false);
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!newCode) return;
    try {
      await navigator.clipboard.writeText(newCode.code);
      setSuccess(t('operations.agents.codeCopied', 'Code copied'));
    } catch {
      // Clipboard can be blocked; the code is on screen to read out anyway.
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    try {
      await agentsApi.revoke(revokeTarget.id, revokeReason.trim() || undefined);
      setSuccess(t('operations.agents.revokeSuccess', 'Agent revoked'));
      setRevokeTarget(null);
      setRevokeReason('');
      loadData();
    } catch (err: any) {
      setError(errorText(err, 'operations.agents.revokeError', 'Failed to revoke the agent'));
    }
  };

  const handleCancelCode = async () => {
    if (!cancelTarget) return;
    try {
      await agentsApi.cancelCode(cancelTarget.id);
      setSuccess(t('operations.agents.cancelCodeSuccess', 'Enrolment code cancelled'));
      setCancelTarget(null);
      loadData();
    } catch (err: any) {
      setError(errorText(err, 'operations.agents.cancelCodeError', 'Failed to cancel the code'));
    }
  };

  const codeBranchHasAgent = agents.some((a) => a.branch_id === codeBranchId && a.status === 'ACTIVE');

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('operations.agents.title', 'Branch Agents')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('operations.agents.title', 'Branch Agents') },
        ]}
        action={
          <Stack direction="row" spacing={1.5}>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadData}>
              {t('common.refresh', 'Refresh')}
            </Button>
            <Button variant="contained" startIcon={<KeyIcon />} onClick={openCodeDialog}>
              {t('operations.agents.createCode', 'New enrolment code')}
            </Button>
          </Stack>
        }
        sx={{ mb: 2 }}
      />

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 820 }}>
        {t(
          'operations.agents.intro',
          'Each branch runs one agent on its PC. The agent connects to the cloud and drives the branch printers and card terminals. Give the installer a one-time enrolment code; revoke an agent to cut it off at once.'
        )}
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

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3, alignItems: { sm: 'center' } }}>
        <FormControl size="small" sx={{ minWidth: 260 }}>
          <InputLabel>{t('operations.agents.filterBranch', 'Branch')}</InputLabel>
          <Select
            value={branchId}
            label={t('operations.agents.filterBranch', 'Branch')}
            onChange={(e) => setBranchId(e.target.value)}
          >
            <MenuItem value="">{t('operations.agents.allBranches', 'All branches')}</MenuItem>
            {branches.map((b) => (
              <MenuItem key={b.id} value={b.id}>
                {b.name} ({b.code})
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControlLabel
          control={<Switch checked={includeRevoked} onChange={(e) => setIncludeRevoked(e.target.checked)} />}
          label={t('operations.agents.showRevoked', 'Show revoked agents')}
        />
      </Stack>

      <Card sx={{ mb: 3 }}>
        <CardHeader title={t('operations.agents.agentsTitle', 'Agents')} sx={{ pb: 1 }} />
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('operations.agents.colBranch', 'Branch')}</TableCell>
                <TableCell>{t('operations.agents.colPc', 'PC')}</TableCell>
                <TableCell>{t('operations.agents.colVersion', 'Version')}</TableCell>
                <TableCell>{t('operations.agents.colStatus', 'Status')}</TableCell>
                <TableCell>{t('operations.agents.colEnrolled', 'Enrolled')}</TableCell>
                <TableCell>{t('operations.agents.colLastSeen', 'Last seen')}</TableCell>
                <TableCell align="right">{t('operations.agents.colActions', 'Actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 5 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : agents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      {t('operations.agents.noAgents', 'No agent has enrolled for this selection yet.')}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                agents.map((a) => (
                  <TableRow key={a.id} hover>
                    <TableCell>{a.branch_name ? `${a.branch_name} (${a.branch_code})` : branchLabel(a.branch_id)}</TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {a.hostname || '—'}
                      </Typography>
                      {a.os && (
                        <Typography variant="caption" color="text.secondary">
                          {a.os}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{a.agent_version ? <code>{a.agent_version}</code> : '—'}</TableCell>
                    <TableCell>
                      {a.status === 'ACTIVE' ? (
                        <Chip size="small" color="success" label={t('operations.agents.statusActive', 'Active')} />
                      ) : (
                        <Tooltip title={a.revoke_reason || ''}>
                          <Chip size="small" label={t('operations.agents.statusRevoked', 'Revoked')} />
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell>{fDateTime(a.enrolled_at)}</TableCell>
                    <TableCell>
                      {a.last_seen_at ? fDateTime(a.last_seen_at) : t('operations.agents.neverSeen', 'Never')}
                    </TableCell>
                    <TableCell align="right">
                      {a.status === 'ACTIVE' && (
                        <Tooltip title={t('operations.agents.revoke', 'Revoke')}>
                          <IconButton color="error" onClick={() => setRevokeTarget(a)}>
                            <BlockIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Card>
        <CardHeader
          title={t('operations.agents.codesTitle', 'Enrolment codes')}
          subheader={t('operations.agents.codesSubtitle', 'Each code works once and expires 24 hours after it is created.')}
          sx={{ pb: 1 }}
        />
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('operations.agents.colBranch', 'Branch')}</TableCell>
                <TableCell>{t('operations.agents.colState', 'State')}</TableCell>
                <TableCell>{t('operations.agents.colCreated', 'Created')}</TableCell>
                <TableCell>{t('operations.agents.colExpires', 'Expires')}</TableCell>
                <TableCell align="right">{t('operations.agents.colActions', 'Actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!loading && codes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 4 }}>
                    <Typography color="text.secondary">
                      {t('operations.agents.noCodes', 'No enrolment codes yet.')}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                codes.map((c) => (
                  <TableRow key={c.id} hover>
                    <TableCell>{branchLabel(c.branch_id)}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={CODE_STATE_COLOR[c.state]}
                        label={t(`operations.agents.codeState.${c.state}`, c.state)}
                      />
                    </TableCell>
                    <TableCell>{fDateTime(c.created_at)}</TableCell>
                    <TableCell>{fDateTime(c.expires_at)}</TableCell>
                    <TableCell align="right">
                      {c.state === 'PENDING' && (
                        <Tooltip title={t('operations.agents.cancelCode', 'Cancel code')}>
                          <IconButton onClick={() => setCancelTarget(c)}>
                            <CloseIcon />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={codeDialogOpen} onClose={closeCodeDialog} fullWidth maxWidth="xs">
        <DialogTitle>{t('operations.agents.createCode', 'New enrolment code')}</DialogTitle>
        <DialogContent>
          {newCode ? (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <Typography variant="body2">{branchLabel(newCode.branch_id)}</Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'center' }}>
                <Typography
                  dir="ltr"
                  sx={{ fontFamily: 'monospace', fontSize: 32, fontWeight: 700, letterSpacing: 4 }}
                >
                  {newCode.code}
                </Typography>
                <Tooltip title={t('operations.agents.copy', 'Copy')}>
                  <IconButton onClick={handleCopy}>
                    <CopyIcon />
                  </IconButton>
                </Tooltip>
              </Stack>
              <Typography variant="caption" color="text.secondary" align="center">
                {t('operations.agents.expiresAt', 'Expires {{time}}', { time: fDateTime(newCode.expires_at) })}
              </Typography>
              <Alert severity="warning">
                {t(
                  'operations.agents.codeShownOnce',
                  'This code is shown only now. On the branch PC run: gnext-agent.exe enrol --code followed by the code.'
                )}
              </Alert>
            </Stack>
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <FormControl fullWidth required>
                <InputLabel>{t('operations.agents.filterBranch', 'Branch')}</InputLabel>
                <Select
                  value={codeBranchId}
                  label={t('operations.agents.filterBranch', 'Branch')}
                  onChange={(e) => setCodeBranchId(e.target.value)}
                >
                  {branches
                    .filter((b) => b.is_active)
                    .map((b) => (
                      <MenuItem key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
              {codeBranchHasAgent && (
                <Alert severity="info">
                  {t(
                    'operations.agents.replaceWarning',
                    'This branch already has an agent. When the new code is used, the current agent is revoked.'
                  )}
                </Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeCodeDialog}>
            {newCode ? t('operations.agents.done', 'Done') : t('common.cancel', 'Cancel')}
          </Button>
          {!newCode && (
            <Button variant="contained" disabled={!codeBranchId || creating} onClick={handleCreateCode}>
              {t('operations.agents.generate', 'Generate code')}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!revokeTarget}
        onClose={() => {
          setRevokeTarget(null);
          setRevokeReason('');
        }}
        onConfirm={handleRevoke}
        title={t('operations.agents.revokeTitle', 'Revoke agent')}
        content={
          <Stack spacing={2}>
            <Typography variant="body2">
              {t(
                'operations.agents.revokeContent',
                'The agent on {{pc}} stops working for {{branch}} at once. To use this PC again, enrol it with a new code.',
                {
                  pc: revokeTarget?.hostname || '—',
                  branch: revokeTarget ? branchLabel(revokeTarget.branch_id) : '',
                }
              )}
            </Typography>
            <TextField
              size="small"
              fullWidth
              label={t('operations.agents.revokeReason', 'Reason (optional)')}
              value={revokeReason}
              slotProps={{ htmlInput: { maxLength: 255 } }}
              onChange={(e) => setRevokeReason(e.target.value)}
            />
          </Stack>
        }
        confirmLabel={t('operations.agents.revoke', 'Revoke')}
        confirmColor="error"
      />

      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancelCode}
        title={t('operations.agents.cancelCode', 'Cancel code')}
        content={t('operations.agents.cancelCodeContent', 'The code will no longer enrol an agent.')}
        confirmLabel={t('operations.agents.cancelCode', 'Cancel code')}
        confirmColor="warning"
      />
    </Box>
  );
}
