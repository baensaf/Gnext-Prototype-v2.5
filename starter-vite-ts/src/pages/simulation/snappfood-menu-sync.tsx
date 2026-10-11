import { useTranslation } from 'react-i18next';
import React, { useMemo, useState, useEffect, useCallback } from 'react';

import SyncIcon from '@mui/icons-material/Sync';
import SendIcon from '@mui/icons-material/Send';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import {
  Box,
  Chip,
  Grid,
  Card,
  Stack,
  Alert,
  Table,
  Button,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Accordion,
  Typography,
  TableContainer,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';

import { httpClient as axios } from 'src/api/httpClient';
import { useBranchContext } from 'src/contexts/branch-context';

type OurRow = { entity_type: 'PRODUCT' | 'VARIANT'; entity_id: string; name: string; external_id: number | null };
type SfRow = {
  product_code: string;
  title: string;
  category: string;
  price_toman: number;
  product_id: number | null;
  is_reviewed: boolean;
  status: 'MATCHED' | 'SUGGESTED' | 'UNMATCHED';
  match: OurRow | null;
};
type Preview = { vendor_code: string; snappfood_products: SfRow[]; not_on_snappfood: OurRow[]; ours: OurRow[] };
type Plan = {
  vendor_code: string;
  counts: Record<string, number>;
  new_on_snappfood: string[];
  warnings: Array<{ item: string; problem: string }>;
  calls: Array<{ method: string; path: string; body: unknown }>;
  sent_at?: string;
};

const NONE = '';
const keyOf = (r: { entity_type: string; entity_id: string }) => `${r.entity_type}:${r.entity_id}`;

/**
 * The Snappfood menu sync, simulated: match a branch's Snappfood menu to ours, then send ours
 * with the annex's calls. Each branch is a Snappfood vendor. Nothing leaves the building; every
 * call is in the integration log with the body a live connection would send.
 */
export function SnappfoodMenuSync() {
  const { t } = useTranslation();
  const { branches } = useBranchContext();
  const [branchId, setBranchId] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!branchId && branches.length) setBranchId(branches[0].id);
  }, [branches, branchId]);

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err: any) {
      setError(err?.detail || err?.message || t('simulation.snappfood.menuSync.failed'));
    } finally {
      setBusy(false);
    }
  }, [t]);

  const showPreview = (p: Preview) => {
    setPreview(p);
    setChoices(Object.fromEntries(p.snappfood_products.map((r) => [r.product_code, r.match ? keyOf(r.match) : NONE])));
  };

  const load = () =>
    run(async () => {
      setPlan(null);
      showPreview((await axios.get(`/api/v1/simulation/snappfood/menu-sync/${branchId}/match`)).data);
    });

  useEffect(() => {
    if (branchId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const saveMatches = () =>
    run(async () => {
      const matches = (preview?.snappfood_products || []).map((r) => {
        const [entity_type, entity_id] = (choices[r.product_code] || NONE).split(':');
        return { product_code: r.product_code, entity_type: entity_type || null, entity_id: entity_id || null };
      });
      showPreview((await axios.put(`/api/v1/simulation/snappfood/menu-sync/${branchId}/match`, { matches })).data);
      setNotice(t('simulation.snappfood.menuSync.matchesSaved'));
    });

  const reset = () =>
    run(async () => {
      setPlan(null);
      showPreview((await axios.post(`/api/v1/simulation/snappfood/menu-sync/${branchId}/reset`)).data);
    });

  const previewSend = () => run(async () => setPlan((await axios.get(`/api/v1/simulation/snappfood/menu-sync/${branchId}/preview`)).data));

  const send = () =>
    run(async () => {
      setPlan((await axios.post(`/api/v1/simulation/snappfood/menu-sync/${branchId}/push`)).data);
      showPreview((await axios.get(`/api/v1/simulation/snappfood/menu-sync/${branchId}/match`)).data);
      setNotice(t('simulation.snappfood.menuSync.sent'));
    });

  const chosenElsewhere = useMemo(() => {
    const counts = new Map<string, number>();
    Object.values(choices).filter(Boolean).forEach((k) => counts.set(k, (counts.get(k) || 0) + 1));
    return counts;
  }, [choices]);

  const statusChip = (r: SfRow) => {
    const color = r.status === 'MATCHED' ? 'success' : r.status === 'SUGGESTED' ? 'info' : 'default';
    return <Chip size="small" color={color} label={t(`simulation.snappfood.menuSync.status.${r.status}`)} />;
  };

  return (
    <Stack spacing={3}>
      <Alert severity="info">{t('simulation.snappfood.menuSync.intro')}</Alert>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
        <TextField select size="small" label={t('simulation.snappfood.menuSync.branch')} value={branchId} onChange={(e) => setBranchId(e.target.value)} sx={{ minWidth: 260 }}>
          {branches.map((b) => (
            <MenuItem key={b.id} value={b.id}>
              {b.name}
            </MenuItem>
          ))}
        </TextField>
        {preview && (
          <Typography variant="body2" color="text.secondary">
            {t('simulation.snappfood.menuSync.vendorCode', { code: preview.vendor_code })}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Button startIcon={<RestartAltIcon />} color="inherit" onClick={reset} disabled={busy || !branchId}>
          {t('simulation.snappfood.menuSync.reset')}
        </Button>
      </Stack>

      {/* Step 1: match */}
      <Card variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
          {t('simulation.snappfood.menuSync.matchTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('simulation.snappfood.menuSync.matchHelp')}
        </Typography>
        {preview && (
          <TableContainer sx={{ maxHeight: 460 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>{t('simulation.snappfood.menuSync.colSnappfood')}</TableCell>
                  <TableCell>{t('simulation.snappfood.menuSync.colCategory')}</TableCell>
                  <TableCell align="right">{t('simulation.snappfood.menuSync.colPrice')}</TableCell>
                  <TableCell>{t('simulation.snappfood.menuSync.colStatus')}</TableCell>
                  <TableCell sx={{ minWidth: 240 }}>{t('simulation.snappfood.menuSync.colOurs')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.snappfood_products.map((r) => (
                  <TableRow key={r.product_code}>
                    <TableCell>
                      <Typography variant="body2">{r.title}</Typography>
                      <Typography variant="caption" color="text.secondary" component="code" dir="ltr">
                        {r.product_code}
                        {r.product_id ? ` · #${r.product_id}` : ''}
                      </Typography>
                      {!r.is_reviewed && <Chip size="small" variant="outlined" color="warning" label={t('simulation.snappfood.menuSync.inReview')} sx={{ ms: 1 }} />}
                    </TableCell>
                    <TableCell>{r.category}</TableCell>
                    <TableCell align="right">{r.price_toman.toLocaleString('en-US')}</TableCell>
                    <TableCell>{statusChip(r)}</TableCell>
                    <TableCell>
                      <TextField
                        select
                        size="small"
                        fullWidth
                        value={choices[r.product_code] ?? NONE}
                        onChange={(e) => setChoices((c) => ({ ...c, [r.product_code]: e.target.value }))}
                        error={!!choices[r.product_code] && (chosenElsewhere.get(choices[r.product_code]) || 0) > 1}
                      >
                        <MenuItem value={NONE}>{t('simulation.snappfood.menuSync.noMatch')}</MenuItem>
                        {preview.ours.map((o) => (
                          <MenuItem key={keyOf(o)} value={keyOf(o)}>
                            {o.name}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {preview && preview.not_on_snappfood.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t('simulation.snappfood.menuSync.notOnSnappfood', { names: preview.not_on_snappfood.map((o) => o.name).join('، ') })}
          </Alert>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button variant="contained" startIcon={<SyncIcon />} onClick={saveMatches} disabled={busy || !preview}>
            {t('simulation.snappfood.menuSync.saveMatches')}
          </Button>
        </Stack>
      </Card>

      {/* Step 2: send */}
      <Card variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
          {t('simulation.snappfood.menuSync.sendTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('simulation.snappfood.menuSync.sendHelp')}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
          <Button variant="outlined" onClick={previewSend} disabled={busy || !branchId}>
            {t('simulation.snappfood.menuSync.preview')}
          </Button>
          <Button variant="contained" color="success" startIcon={<SendIcon />} onClick={send} disabled={busy || !branchId}>
            {t('simulation.snappfood.menuSync.send')}
          </Button>
        </Stack>

        {plan && (
          <Stack spacing={2}>
            <Grid container spacing={1}>
              {Object.entries(plan.counts).map(([k, v]) => (
                <Grid key={k} size={{ xs: 6, sm: 4, md: 2 }}>
                  <Card variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
                    <Typography variant="h6">{v}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t(`simulation.snappfood.menuSync.count.${k}`)}
                    </Typography>
                  </Card>
                </Grid>
              ))}
            </Grid>
            {plan.warnings.length > 0 && (
              <Alert severity="error">
                <Typography variant="subtitle2">{t('simulation.snappfood.menuSync.warnings')}</Typography>
                {plan.warnings.map((w, i) => (
                  <Typography key={i} variant="body2">
                    {w.item}: <span dir="ltr">{w.problem}</span>
                  </Typography>
                ))}
              </Alert>
            )}
            {plan.new_on_snappfood.length > 0 && (
              <Alert severity="info">{t('simulation.snappfood.menuSync.newOnSnappfood', { names: plan.new_on_snappfood.join('، ') })}</Alert>
            )}
            <Box>
              {plan.calls.map((call, i) => (
                <Accordion key={i} disableGutters variant="outlined">
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="body2" component="code" dir="ltr" sx={{ fontWeight: 600 }}>
                      {call.method} {call.path}
                    </Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box component="pre" dir="ltr" sx={{ m: 0, p: 1.5, bgcolor: 'background.neutral', borderRadius: 1, fontSize: 12, overflow: 'auto', maxHeight: 360 }}>
                      {JSON.stringify(call.body, null, 2)}
                    </Box>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Box>
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
