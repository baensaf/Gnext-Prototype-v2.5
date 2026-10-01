import type { WeekHours } from 'src/utils/opening-hours';
import type { BranchDetails } from 'src/components/branch';
import type { Pin } from 'src/components/branch/branch-location-map';

import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { lazy, useState, Suspense } from 'react';

import CheckIcon from '@mui/icons-material/Check';
import {
  Box,
  Card,
  Step,
  Alert,
  Stack,
  Button,
  Divider,
  Stepper,
  StepLabel,
  Typography,
  CardContent,
  CircularProgress,
} from '@mui/material';

import { WEEK, defaultWeek, rowsFromWeek, weekProblems, runsPastMidnight } from 'src/utils/opening-hours';

import { tenantApi } from 'src/api/tenantApi';
import { useBranchContextOptional } from 'src/contexts/branch-context';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';
import { emptyDetails, BranchHoursEditor, BranchDetailsFields } from 'src/components/branch';

// Leaflet is only loaded when a map is on screen.
const BranchLocationMap = lazy(() =>
  import('src/components/branch/branch-location-map').then((m) => ({ default: m.BranchLocationMap }))
);

const STEPS = ['details', 'location', 'hours', 'review'] as const;
type StepKey = (typeof STEPS)[number];

/**
 * Head office adds a branch in four steps: details, the pin on the map, the weekly hours, and
 * a last look. Nothing is saved until the end, and then everything is saved together. The
 * pin is required.
 */
export function BranchNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const branchScope = useBranchContextOptional();

  const [step, setStep] = useState(0);
  const [details, setDetails] = useState<BranchDetails>(emptyDetails);
  const [pin, setPin] = useState<Pin | null>(null);
  const [week, setWeek] = useState<WeekHours>(defaultWeek);
  const [tried, setTried] = useState<Partial<Record<StepKey, boolean>>>({});
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepKey = STEPS[step];
  const hoursOk = Object.keys(weekProblems(week)).length === 0;
  const ready: Record<StepKey, boolean> = {
    details: !!details.name.trim(),
    location: !!pin,
    hours: hoursOk,
    review: true,
  };

  const next = () => {
    setTried((prev) => ({ ...prev, [stepKey]: true }));
    if (ready[stepKey]) setStep((s) => s + 1);
  };

  const create = async () => {
    if (!pin) return;
    setSaving(true);
    setError(null);
    try {
      const branch = await tenantApi.createBranch({
        name: details.name.trim(),
        address: details.address.trim(),
        phone: details.phone.trim(),
        time_zone: details.time_zone,
        branch_type: details.branch_type,
        latitude: pin.latitude,
        longitude: pin.longitude,
        hours: rowsFromWeek(week),
      });
      await branchScope?.refreshBranches();
      navigate(`/app/operations/branches/${branch.id}`, { state: { created: true } });
    } catch (err: any) {
      if (err.code === 'BRANCH_TITLE_TAKEN') {
        setNameError(t('branchMgmt.details.titleTaken', 'Another branch of the chain already has this title.'));
        setStep(0);
      } else {
        setError(err.detail || err.message || t('operations.branches.createError', 'Failed to create branch'));
      }
    } finally {
      setSaving(false);
    }
  };

  const stepLabels: Record<StepKey, string> = {
    details: t('branchMgmt.steps.details', 'Details'),
    location: t('branchMgmt.steps.location', 'Location'),
    hours: t('branchMgmt.steps.hours', 'Opening hours'),
    review: t('branchMgmt.steps.review', 'Review'),
  };

  return (
    <Box sx={{ pb: 6, maxWidth: 960, mx: 'auto' }}>
      <CustomBreadcrumbs
        heading={t('branchMgmt.new.heading', 'Add a branch')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('operations.branches.title', 'Branches'), href: '/app/operations/branches' },
          { name: t('branchMgmt.new.heading', 'Add a branch') },
        ]}
      />

      <Stepper activeStep={step} alternativeLabel sx={{ mb: 4 }}>
        {STEPS.map((key, index) => (
          <Step key={key} completed={index < step}>
            <StepLabel>{stepLabels[key]}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card sx={{ borderRadius: 3 }}>
        <CardContent sx={{ p: { xs: 2, md: 4 } }}>
          {stepKey === 'details' && (
            <>
              <StepIntro
                title={t('branchMgmt.new.detailsTitle', 'What is the branch called, and where?')}
                body={t('branchMgmt.new.detailsBody', 'The title is the name staff and customers see. You can change any of this later.')}
              />
              <BranchDetailsFields
                value={details}
                onChange={(d) => {
                  setDetails(d);
                  setNameError(null);
                }}
                showErrors={tried.details}
                nameError={nameError}
              />
            </>
          )}

          {stepKey === 'location' && (
            <>
              <StepIntro
                title={t('branchMgmt.new.locationTitle', 'Place the branch on the map')}
                body={t('branchMgmt.new.locationBody', 'Search the address, then click the map or drag the pin to the front door. Delivery zones are drawn around this pin.')}
              />
              <Suspense fallback={<MapLoading />}>
                <BranchLocationMap value={pin} onChange={setPin} />
              </Suspense>
              {tried.location && !pin && (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  {t('branchMgmt.new.pinRequired', 'A branch cannot be added without its pin on the map.')}
                </Alert>
              )}
            </>
          )}

          {stepKey === 'hours' && (
            <>
              <StepIntro
                title={t('branchMgmt.new.hoursTitle', 'When is the branch open?')}
                body={t('branchMgmt.new.hoursBody', 'Add a second shift for a lunch and dinner split. A shift that closes after midnight, such as 18:00–02:00, belongs to the day it opens. Outside these hours the till still sells, with a warning.')}
              />
              <BranchHoursEditor value={week} onChange={setWeek} />
            </>
          )}

          {stepKey === 'review' && (
            <>
              <StepIntro
                title={t('branchMgmt.new.reviewTitle', 'Check and add the branch')}
                body={t('branchMgmt.new.reviewBody', 'It starts active, with no tills, printers, staff or menu stops. Set those up next.')}
              />
              <Stack spacing={2.5} divider={<Divider flexItem />}>
                <ReviewRow label={stepLabels.details} onEdit={() => setStep(0)}>
                  <Typography sx={{ fontWeight: 600 }}>{details.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {[details.address, details.phone].filter(Boolean).join(' · ') ||
                      t('branchMgmt.details.noAddressPhone', 'No address or phone')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {details.time_zone}
                  </Typography>
                </ReviewRow>
                <ReviewRow label={stepLabels.location} onEdit={() => setStep(1)}>
                  <Suspense fallback={<MapLoading height={180} />}>
                    <BranchLocationMap value={pin} height={180} />
                  </Suspense>
                </ReviewRow>
                <ReviewRow label={stepLabels.hours} onEdit={() => setStep(2)}>
                  <WeekSummary week={week} />
                </ReviewRow>
              </Stack>
            </>
          )}
        </CardContent>

        <Divider />
        <Stack direction="row" sx={{ p: 2, justifyContent: 'space-between' }}>
          <Button
            color="inherit"
            onClick={() => (step === 0 ? navigate('/app/operations/branches') : setStep((s) => s - 1))}
            disabled={saving}
          >
            {step === 0 ? t('common.cancel', 'Cancel') : t('branchMgmt.new.back', 'Back')}
          </Button>
          {stepKey === 'review' ? (
            <Button
              variant="contained"
              startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <CheckIcon />}
              onClick={create}
              disabled={saving || !pin}
            >
              {t('branchMgmt.new.create', 'Add branch')}
            </Button>
          ) : (
            <Button variant="contained" onClick={next} disabled={stepKey === 'hours' && !hoursOk}>
              {t('branchMgmt.new.next', 'Next')}
            </Button>
          )}
        </Stack>
      </Card>
    </Box>
  );
}

function StepIntro({ title, body }: { title: string; body: string }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h6">{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {body}
      </Typography>
    </Box>
  );
}

function ReviewRow({ label, onEdit, children }: { label: string; onEdit: () => void; children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ width: { sm: 160 }, flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
      <Box>
        <Button size="small" onClick={onEdit}>
          {t('common.edit', 'Edit')}
        </Button>
      </Box>
    </Stack>
  );
}

function MapLoading({ height = 380 }: { height?: number }) {
  return (
    <Box sx={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <CircularProgress size={28} />
    </Box>
  );
}

/** The week in one line per day: "Sat 11:00–15:00, 18:00–02:00". */
export function WeekSummary({ week }: { week: WeekHours }) {
  const { t } = useTranslation();
  return (
    <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 2, rowGap: 0.5 }}>
      {WEEK.map(({ key, day }) => {
        const shifts = week[day] || [];
        return (
          <Box key={key} sx={{ display: 'contents' }}>
            <Typography component="dt" variant="body2" color="text.secondary">
              {t(`operations.branchDetail.days.${key}`, key)}
            </Typography>
            <Typography component="dd" variant="body2" sx={{ m: 0 }}>
              {shifts.length === 0
                ? t('branchMgmt.hours.closed', 'Closed')
                : shifts
                    .map((s) =>
                      s.open === s.close
                        ? t('branchMgmt.hours.allDay', '24 hours')
                        : `${s.open}–${s.close}${runsPastMidnight(s) ? ` (${t('branchMgmt.hours.nextDayShort', 'next day')})` : ''}`
                    )
                    .join(t('branchMgmt.listSeparator', ', '))}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}
