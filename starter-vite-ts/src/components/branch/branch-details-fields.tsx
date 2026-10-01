import type { BranchType } from 'src/api/tenantApi';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Stack, MenuItem, TextField, Autocomplete } from '@mui/material';

import { VersionTag } from 'src/components/version-tag';

export type BranchDetails = {
  name: string;
  address: string;
  phone: string;
  time_zone: string;
  branch_type: BranchType;
};

export const emptyDetails = (): BranchDetails => ({
  name: '',
  address: '',
  phone: '',
  time_zone: 'Asia/Tehran',
  branch_type: 'RESTAURANT',
});

/** Every zone the browser knows, the chain's own first. */
function useTimeZones() {
  return useMemo(() => {
    const all: string[] =
      typeof (Intl as any).supportedValuesOf === 'function' ? (Intl as any).supportedValuesOf('timeZone') : [];
    const first = ['Asia/Tehran', 'Asia/Muscat', 'Asia/Dubai'];
    return [...first, ...all.filter((zone) => !first.includes(zone))];
  }, []);
}

type BranchDetailsFieldsProps = {
  value: BranchDetails;
  onChange: (details: BranchDetails) => void;
  /** Shows "required" under an empty title once the user has tried to go on. */
  showErrors?: boolean;
  /** A title error from the server (taken by another branch). */
  nameError?: string | null;
  disabled?: boolean;
};

/** Title, address, phone, time zone and type: the details head office types for a branch. */
export function BranchDetailsFields({ value, onChange, showErrors, nameError, disabled }: BranchDetailsFieldsProps) {
  const { t } = useTranslation();
  const zones = useTimeZones();
  const set = (change: Partial<BranchDetails>) => onChange({ ...value, ...change });
  const nameMissing = showErrors && !value.name.trim();

  return (
    <Stack spacing={2.5}>
      <TextField
        label={t('branchMgmt.details.title', 'Title')}
        required
        fullWidth
        disabled={disabled}
        value={value.name}
        onChange={(e) => set({ name: e.target.value })}
        error={nameMissing || !!nameError}
        helperText={
          nameError ||
          (nameMissing
            ? t('branchMgmt.details.titleRequired', 'Give the branch a title.')
            : t('branchMgmt.details.titleHelp', 'Shown in the header, reports and on receipts. Must differ from the chain\'s other branches.'))
        }
      />
      <TextField
        label={t('branchMgmt.details.address', 'Address')}
        fullWidth
        multiline
        minRows={2}
        disabled={disabled}
        value={value.address}
        onChange={(e) => set({ address: e.target.value })}
        helperText={t('branchMgmt.details.addressHelp', 'Printed on receipts.')}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label={t('branchMgmt.details.phone', 'Phone')}
          fullWidth
          disabled={disabled}
          value={value.phone}
          onChange={(e) => set({ phone: e.target.value })}
          slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'tel' } }}
        />
        <Autocomplete
          fullWidth
          disableClearable
          disabled={disabled}
          options={zones}
          value={value.time_zone}
          onChange={(_, zone) => set({ time_zone: zone })}
          renderInput={(params) => (
            <TextField
              {...params}
              label={t('branchMgmt.details.timeZone', 'Time zone')}
              helperText={t('branchMgmt.details.timeZoneHelp', 'Sets "today", the business day and when the branch is open.')}
            />
          )}
        />
      </Stack>
      <TextField
        select
        fullWidth
        disabled={disabled}
        label={
          <Stack direction="row" spacing={0.75} component="span" sx={{ alignItems: 'center' }}>
            <span>{t('operations.branches.type', 'Type')}</span>
            <VersionTag feature="branches.nonSellingTypes" />
          </Stack>
        }
        value={value.branch_type}
        onChange={(e) => set({ branch_type: e.target.value as BranchType })}
        helperText={t(
          'operations.branches.typeHint',
          'Only a restaurant takes customer orders. Production kitchens and offices get no POS, kiosk or kitchen display, and are left out of sales comparisons.'
        )}
      >
        <MenuItem value="RESTAURANT">{t('operations.branches.types.restaurant', 'Restaurant')}</MenuItem>
        <MenuItem value="COMMISSARY">{t('operations.branches.types.commissary', 'Production Kitchen')}</MenuItem>
        <MenuItem value="OFFICE">{t('operations.branches.types.office', 'Office')}</MenuItem>
      </TextField>
    </Stack>
  );
}
