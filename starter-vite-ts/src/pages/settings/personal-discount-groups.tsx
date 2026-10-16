import type { PersonalDiscountGroup } from 'src/api/discountsApi';

import { useTranslation } from 'react-i18next';

import {
  Box,
  Card,
  Table,
  Button,
  Tooltip,
  TableRow,
  MenuItem,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  IconButton,
  Typography,
  InputAdornment,
  TableContainer,
} from '@mui/material';

import { toToman, fromToman, useCurrencyLabel } from 'src/utils/currency';

import { Iconify } from 'src/components/iconify';
import { VersionTag } from 'src/components/version-tag';

type Props = {
  groups: PersonalDiscountGroup[];
  onChange: (groups: PersonalDiscountGroup[]) => void;
  disabled?: boolean;
};

const digits = (v: string) => v.replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[^0-9.]/g, '');
const withCommas = (v: string) => v.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Head office's personal discount groups, edited in one table and saved with the page: the
 * percent, the monthly cap and orders a month, the cap per order, and where it works. An empty
 * limit is no limit. Amounts are typed in tomans and kept in rials.
 */
export function PersonalDiscountGroups({ groups, onChange, disabled }: Props) {
  const { t } = useTranslation();
  const currencyLabel = useCurrencyLabel();

  const set = (i: number, patch: Partial<PersonalDiscountGroup>) =>
    onChange(groups.map((g, k) => (k === i ? { ...g, ...patch } : g)));

  const money = (i: number, field: 'monthly_cap' | 'per_visit_cap') => (
    <TextField
      size="small"
      value={groups[i][field] ? withCommas(toToman(groups[i][field])) : ''}
      placeholder={t('authPolicy.noLimit')}
      onChange={(e) => {
        const typed = digits(e.target.value);
        set(i, { [field]: typed ? fromToman(typed) : null });
      }}
      disabled={disabled}
      slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
      sx={{ width: 150 }}
    />
  );

  return (
    <Card sx={{ p: 3 }}>
      <Typography variant="h6" color="secondary.main" sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Iconify icon={'solar:users-group-rounded-bold' as any} />
        {t('authPolicy.groupsTitle')}
        <VersionTag feature="customers.family" />
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('authPolicy.groupsDesc')}
      </Typography>
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 960 }}>
          <TableHead>
            <TableRow>
              <TableCell>{t('authPolicy.groupName')}</TableCell>
              <TableCell>{t('authPolicy.groupPercent')}</TableCell>
              <TableCell>{`${t('authPolicy.groupMonthlyCap')} (${currencyLabel})`}</TableCell>
              <TableCell>{t('authPolicy.groupUses')}</TableCell>
              <TableCell>{`${t('authPolicy.groupPerVisit')} (${currencyLabel})`}</TableCell>
              <TableCell>{t('authPolicy.groupWhere')}</TableCell>
              <TableCell align="center">{t('authPolicy.groupMembers')}</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {groups.map((g, i) => (
              <TableRow key={g.id || `new-${i}`}>
                <TableCell sx={{ minWidth: 260 }}>
                  <TextField
                    size="small"
                    fullWidth
                    value={g.name}
                    onChange={(e) => set(i, { name: e.target.value })}
                    disabled={disabled}
                  />
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    value={g.percent ? String(Number(g.percent) || g.percent) : ''}
                    onChange={(e) => set(i, { percent: digits(e.target.value) })}
                    disabled={disabled}
                    slotProps={{
                      htmlInput: { dir: 'ltr', inputMode: 'decimal' },
                      input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
                    }}
                    sx={{ width: 96 }}
                  />
                </TableCell>
                <TableCell>{money(i, 'monthly_cap')}</TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    value={g.uses_per_month ?? ''}
                    placeholder={t('authPolicy.noLimit')}
                    onChange={(e) => {
                      const typed = digits(e.target.value).replace('.', '');
                      set(i, { uses_per_month: typed ? Number(typed) : null });
                    }}
                    disabled={disabled}
                    slotProps={{ htmlInput: { dir: 'ltr', inputMode: 'numeric' } }}
                    sx={{ width: 96 }}
                  />
                </TableCell>
                <TableCell>{money(i, 'per_visit_cap')}</TableCell>
                <TableCell>
                  <TextField
                    select
                    size="small"
                    value={g.any_branch ? 'ANY' : 'OWN'}
                    onChange={(e) => set(i, { any_branch: e.target.value === 'ANY' })}
                    disabled={disabled}
                    sx={{ width: 140 }}
                  >
                    <MenuItem value="OWN">{t('authPolicy.ownBranch')}</MenuItem>
                    <MenuItem value="ANY">{t('authPolicy.anyBranch')}</MenuItem>
                  </TextField>
                </TableCell>
                <TableCell align="center">{g.members || 0}</TableCell>
                <TableCell align="right">
                  <Tooltip
                    title={g.members ? t('authPolicy.groupHasMembers', { count: g.members }) : t('authPolicy.removeGroup')}
                  >
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        disabled={disabled || !!g.members}
                        onClick={() => onChange(groups.filter((_, k) => k !== i))}
                        aria-label={t('authPolicy.removeGroup')}
                      >
                        <Iconify icon="solar:trash-bin-trash-bold" width={18} />
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Box sx={{ mt: 2 }}>
        <Button
          size="small"
          startIcon={<Iconify icon="mingcute:add-line" />}
          disabled={disabled}
          onClick={() =>
            onChange([
              ...groups,
              { name: '', percent: '', monthly_cap: null, uses_per_month: null, per_visit_cap: null, any_branch: false },
            ])
          }
        >
          {t('authPolicy.addGroup')}
        </Button>
      </Box>
    </Card>
  );
}
