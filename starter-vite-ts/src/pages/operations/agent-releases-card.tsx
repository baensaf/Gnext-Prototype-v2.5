import type { AgentReleaseRow } from 'src/api/agentsApi';

import { useTranslation } from 'react-i18next';
import { useState, useEffect, useCallback } from 'react';

import UploadIcon from '@mui/icons-material/Upload';
import {
  Card,
  Chip,
  Stack,
  Table,
  Alert,
  Button,
  Dialog,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  CardHeader,
  Typography,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
} from '@mui/material';

import { fDateTime } from 'src/utils/format-time';

import { agentsApi } from 'src/api/agentsApi';

import { toast, showErrorToast } from 'src/components/snackbar';

// ----------------------------------------------------------------------

const formatSize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** Orders agent versions (major.minor.patch) numerically, as the cloud and the agent do. */
export function compareAgentVersions(a: string, b: string) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

const newest = (rows: AgentReleaseRow[]) =>
  rows.reduce<AgentReleaseRow | null>((top, r) => (!top || compareAgentVersions(r.version, top.version) > 0 ? r : top), null);

type Props = {
  /** Told the newest published version (or null) whenever the list loads. */
  onLatestPublished?: (version: string | null) => void;
};

/**
 * Builds of the branch agent. Agents check for the newest published one on start and every
 * hour, and at once when a build is published while they are online. CI uploads every new
 * build unpublished, so a newer build waiting to be published is called out above the list.
 */
export function AgentReleasesCard({ onLatestPublished }: Props) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AgentReleaseRow[]>([]);
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [minVersion, setMinVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await agentsApi.listReleases();
      setRows(list);
      setError(null);
      onLatestPublished?.(newest(list.filter((r) => r.published))?.version ?? null);
    } catch (err: any) {
      setError(err?.detail || err?.message || t('operations.agents.releases.loadError', 'Could not load agent releases'));
    }
  }, [t, onLatestPublished]);

  useEffect(() => {
    load();
  }, [load]);

  const latestPublished = newest(rows.filter((r) => r.published));
  const waiting = newest(rows);
  const unpublishedNewer =
    waiting && !waiting.published && (!latestPublished || compareAgentVersions(waiting.version, latestPublished.version) > 0)
      ? waiting
      : null;

  const handleUpload = async () => {
    if (!file) return;
    setBusy(true);
    try {
      await agentsApi.uploadRelease({ version: version.trim(), minAgentVersion: minVersion.trim(), notes: notes.trim(), file });
      toast.success(t('operations.agents.releases.uploaded', 'Build uploaded. Publish it when ready.'));
      setOpen(false);
      setVersion('');
      setMinVersion('');
      setNotes('');
      setFile(null);
      load();
    } catch (err: any) {
      showErrorToast(err, t('operations.agents.releases.uploadError', 'Upload failed'));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row: AgentReleaseRow) => {
    setBusy(true);
    try {
      if (row.published) await agentsApi.unpublishRelease(row.id);
      else await agentsApi.publishRelease(row.id);
      load();
    } catch (err: any) {
      showErrorToast(err, t('operations.agents.releases.publishError', 'Could not change the release'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card sx={{ mt: 3 }}>
      <CardHeader
        title={t('operations.agents.releases.title', 'Agent releases')}
        subheader={t(
          'operations.agents.releases.subtitle',
          'Agents install the newest published build by themselves, after checking its SHA-256.'
        )}
        action={
          <Button variant="outlined" startIcon={<UploadIcon />} onClick={() => setOpen(true)}>
            {t('operations.agents.releases.upload', 'Upload build')}
          </Button>
        }
        sx={{ pb: 1 }}
      />
      {error && (
        <Alert severity="error" sx={{ mx: 2 }}>
          {error}
        </Alert>
      )}
      {unpublishedNewer && (
        <Alert
          severity="warning"
          sx={{ mx: 2, mb: 1 }}
          action={
            <Button color="inherit" size="small" onClick={() => toggle(unpublishedNewer)} disabled={busy}>
              {t('operations.agents.releases.publish', 'Publish')}
            </Button>
          }
        >
          {latestPublished
            ? t(
                'operations.agents.releases.unpublishedNewer',
                'Build {{v}} is uploaded but not published. Agents stay on {{current}} until you publish it.',
                { v: unpublishedNewer.version, current: latestPublished.version }
              )
            : t(
                'operations.agents.releases.unpublishedNewerNone',
                'Build {{v}} is uploaded but not published. No agent can update until you publish it.',
                { v: unpublishedNewer.version }
              )}
        </Alert>
      )}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('operations.agents.colVersion', 'Version')}</TableCell>
              <TableCell>{t('operations.agents.releases.size', 'Size')}</TableCell>
              <TableCell>SHA-256</TableCell>
              <TableCell>{t('operations.agents.colCreated', 'Created')}</TableCell>
              <TableCell>{t('operations.agents.colStatus', 'Status')}</TableCell>
              <TableCell align="right">{t('operations.agents.colActions', 'Actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                  <Typography color="text.secondary">
                    {t('operations.agents.releases.none', 'No agent build has been uploaded yet.')}
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <code dir="ltr">{r.version}</code>
                    {r.min_agent_version && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        {t('operations.agents.releases.minShort', 'needs ≥ {{v}}', { v: r.min_agent_version })}
                      </Typography>
                    )}
                    {r.notes && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        {r.notes}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {formatSize(r.size_bytes)}
                    {r.has_installer && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        {t('operations.agents.releases.hasInstaller', '+ installer')}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <code dir="ltr" title={r.sha256}>
                      {r.sha256.slice(0, 12)}…
                    </code>
                  </TableCell>
                  <TableCell>{fDateTime(r.created_at)}</TableCell>
                  <TableCell>
                    {r.published ? (
                      <Chip size="small" color="success" label={t('operations.agents.releases.published', 'Published')} />
                    ) : (
                      <Chip size="small" label={t('operations.agents.releases.draft', 'Not published')} />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" color={r.published ? 'warning' : 'primary'} onClick={() => toggle(r)} disabled={busy}>
                      {r.published
                        ? t('operations.agents.releases.unpublish', 'Withdraw')
                        : t('operations.agents.releases.publish', 'Publish')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('operations.agents.releases.upload', 'Upload build')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label={t('operations.agents.colVersion', 'Version')}
              placeholder="1.0.3"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              slotProps={{ htmlInput: { dir: 'ltr' } }}
              required
            />
            <TextField
              label={t('operations.agents.releases.minVersion', 'Oldest agent still allowed to connect (optional)')}
              placeholder="1.0.0"
              value={minVersion}
              onChange={(e) => setMinVersion(e.target.value)}
              slotProps={{ htmlInput: { dir: 'ltr' } }}
            />
            <TextField
              label={t('operations.agents.releases.notes', 'Notes')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              multiline
              minRows={2}
            />
            <Button variant="outlined" component="label">
              {file ? file.name : t('operations.agents.releases.chooseFile', 'Choose gnext-agent.exe')}
              <input hidden type="file" accept=".exe" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={handleUpload} disabled={busy || !file || !version.trim()}>
            {t('operations.agents.releases.upload', 'Upload build')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
