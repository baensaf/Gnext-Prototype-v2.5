import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import VisibilityIcon from '@mui/icons-material/Visibility';
import {
  Box,
  Card,
  Chip,
  Stack,
  Table,
  Alert,
  Tooltip,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  TableContainer,
} from '@mui/material';

import { canReachPath } from 'src/config/role-access';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

// ----------------------------------------------------------------------

/**
 * The three ways an account can stand in this chain.
 *
 * Head office is a role AND the absence of a branch, which is why it is a column here
 * rather than a fourth role: an ADMIN pinned to a branch reads as the middle column, not
 * the right-hand one, and that distinction is the one people get wrong.
 */
const COLUMNS = [
  { id: 'CASHIER', role: 'CASHIER', headOffice: false },
  { id: 'MANAGER', role: 'MANAGER', headOffice: false },
  { id: 'HEAD_OFFICE', role: 'ADMIN', headOffice: true },
] as const;

type Access = 'FULL' | 'READ' | 'NONE';

type Capability = {
  /** The screen this capability lives on; screen access is computed from it, not asserted. */
  path: string;
  labelKey: string;
  label: string;
  /**
   * Who may change things here, as the API enforces it. Screen access says what you can
   * open; this says what you can do once you are there, and the two are not the same —
   * a branch manager opens the product catalogue and may not edit a line of it.
   */
  write: Record<string, Access>;
  note?: string;
};

const GROUPS: { titleKey: string; title: string; rows: Capability[] }[] = [
  {
    titleKey: 'rolesPage.groups.floor',
    title: 'Working the shop',
    rows: [
      {
        path: '/app/pos',
        labelKey: 'rolesPage.caps.pos',
        label: 'Take orders at the register',
        write: { CASHIER: 'FULL', MANAGER: 'FULL', HEAD_OFFICE: 'FULL' },
      },
      {
        path: '/app/dine-in/floor',
        labelKey: 'rolesPage.caps.floor',
        label: 'Seat and release tables',
        write: { CASHIER: 'FULL', MANAGER: 'FULL', HEAD_OFFICE: 'FULL' },
      },
      {
        path: '/app/kds',
        labelKey: 'rolesPage.caps.kds',
        label: 'Work the kitchen display',
        write: { CASHIER: 'FULL', MANAGER: 'FULL', HEAD_OFFICE: 'FULL' },
      },
      {
        path: '/app/cashier/shifts',
        labelKey: 'rolesPage.caps.shift',
        label: 'Open, count and close a till',
        write: { CASHIER: 'FULL', MANAGER: 'FULL', HEAD_OFFICE: 'FULL' },
      },
      {
        path: '/app/refunds',
        labelKey: 'rolesPage.caps.refund',
        label: 'Hand back money',
        write: { CASHIER: 'READ', MANAGER: 'FULL', HEAD_OFFICE: 'FULL' },
        note: 'A cashier raises the refund; it only moves once an approver puts a pin in.',
      },
    ],
  },
  {
    titleKey: 'rolesPage.groups.site',
    title: 'Running one site',
    rows: [
      {
        path: '/app/catalog/availability',
        labelKey: 'rolesPage.caps.availability',
        label: 'Suspend an item that ran out today',
        write: { CASHIER: 'NONE', MANAGER: 'FULL', HEAD_OFFICE: 'FULL' },
      },
      {
        path: '/app/settings/branch-overrides',
        labelKey: 'rolesPage.caps.overrides',
        label: 'Diverge from a head-office setting',
        write: { CASHIER: 'NONE', MANAGER: 'FULL', HEAD_OFFICE: 'FULL' },
        note: 'Only for the groups head office has opened up; the rest are inherited and read-only.',
      },
      {
        path: '/app/operations/terminals',
        labelKey: 'rolesPage.caps.terminals',
        label: 'Register a till or card terminal',
        write: { CASHIER: 'NONE', MANAGER: 'FULL', HEAD_OFFICE: 'FULL' },
      },
      {
        path: '/app/operations/printers',
        labelKey: 'rolesPage.caps.printers',
        label: 'Set up printers and ticket routing',
        write: { CASHIER: 'NONE', MANAGER: 'FULL', HEAD_OFFICE: 'FULL' },
      },
      {
        path: '/app/dine-in/floor',
        labelKey: 'rolesPage.caps.sections',
        label: 'Lay out the dining floor',
        write: { CASHIER: 'NONE', MANAGER: 'FULL', HEAD_OFFICE: 'FULL' },
      },
      {
        path: '/app/delivery/orders',
        labelKey: 'rolesPage.caps.zones',
        label: 'Define delivery zones and couriers',
        write: { CASHIER: 'NONE', MANAGER: 'FULL', HEAD_OFFICE: 'FULL' },
      },
      {
        path: '/app/reports',
        labelKey: 'rolesPage.caps.reports',
        label: 'Read reports',
        write: { CASHIER: 'NONE', MANAGER: 'READ', HEAD_OFFICE: 'READ' },
        note: 'A branch manager’s reports cover their own site. Head office sees every site.',
      },
    ],
  },
  {
    titleKey: 'rolesPage.groups.chain',
    title: 'Deciding for the chain',
    rows: [
      {
        path: '/app/catalog/products',
        labelKey: 'rolesPage.caps.catalog',
        label: 'Write the menu — products, categories, modifiers',
        write: { CASHIER: 'NONE', MANAGER: 'NONE', HEAD_OFFICE: 'FULL' },
        note: 'A branch sees the catalogue and decides what it can serve today. It does not author it.',
      },
      {
        path: '/app/pricing/price-lists',
        labelKey: 'rolesPage.caps.pricing',
        label: 'Set prices',
        write: { CASHIER: 'NONE', MANAGER: 'NONE', HEAD_OFFICE: 'FULL' },
      },
      {
        path: '/app/discounts/customer-rates',
        labelKey: 'rolesPage.caps.discounts',
        label: 'Run coupons and customer rates',
        write: { CASHIER: 'NONE', MANAGER: 'NONE', HEAD_OFFICE: 'FULL' },
      },
      {
        path: '/app/settings/general',
        labelKey: 'rolesPage.caps.chainSettings',
        label: 'Currencies, tender types, reason codes',
        write: { CASHIER: 'NONE', MANAGER: 'NONE', HEAD_OFFICE: 'FULL' },
      },
      {
        path: '/app/settings/discount-authorizations',
        labelKey: 'rolesPage.caps.authority',
        label: 'Set discount caps and approval thresholds',
        write: { CASHIER: 'NONE', MANAGER: 'NONE', HEAD_OFFICE: 'FULL' },
      },
      {
        path: '/app/settings/users',
        labelKey: 'rolesPage.caps.users',
        label: 'Hire, move and deactivate staff — and set their pin',
        write: { CASHIER: 'NONE', MANAGER: 'NONE', HEAD_OFFICE: 'FULL' },
        note: 'Anyone may change their own pin. Setting somebody else’s is head office’s.',
      },
      {
        path: '/app/operations/branches',
        labelKey: 'rolesPage.caps.branches',
        label: 'Open a branch, set its trading hours',
        write: { CASHIER: 'NONE', MANAGER: 'NONE', HEAD_OFFICE: 'FULL' },
      },
      {
        path: '/app/reports/branch-comparison',
        labelKey: 'rolesPage.caps.compare',
        label: 'Compare one branch against another',
        write: { CASHIER: 'NONE', MANAGER: 'NONE', HEAD_OFFICE: 'READ' },
      },
      {
        path: '/app/delivery/rollup',
        labelKey: 'rolesPage.caps.fleetRollup',
        label: 'See every branch’s couriers on one screen',
        write: { CASHIER: 'NONE', MANAGER: 'NONE', HEAD_OFFICE: 'READ' },
      },
      {
        path: '/app/cashier/rollup',
        labelKey: 'rolesPage.caps.shiftRollup',
        label: 'See every branch’s tills, and the drawers left open',
        write: { CASHIER: 'NONE', MANAGER: 'NONE', HEAD_OFFICE: 'READ' },
      },
    ],
  },
];

// ----------------------------------------------------------------------

/**
 * What each role may see and do, and what stays with head office.
 *
 * The screen column is computed by asking the same `canReachPath` the sidebar and the
 * router ask, so this page cannot drift into describing a product that is not there — if
 * somebody opens a chain screen to branches, this table says so the moment they do.
 */
export function RolesMatrixPage() {
  const { t } = useTranslation();

  const columnLabel = (id: string) =>
    ({
      CASHIER: t('rolesPage.columns.cashier', 'Cashier'),
      MANAGER: t('rolesPage.columns.manager', 'Branch Manager'),
      HEAD_OFFICE: t('rolesPage.columns.headOffice', 'Head Office'),
    })[id] || id;

  const cells = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        rows: group.rows.map((row) => ({
          ...row,
          access: Object.fromEntries(
            COLUMNS.map((col) => {
              const canOpen = canReachPath(col.role, row.path, col.headOffice);
              const declared = row.write[col.id];
              // A screen you cannot open is a capability you do not have, whatever the
              // product rule says — so the computed answer wins over the declared one.
              return [col.id, canOpen ? declared : 'NONE'];
            })
          ) as Record<string, Access>,
        })),
      })),
    []
  );

  const renderCell = (value: Access, note?: string) => {
    const icon =
      value === 'FULL' ? (
        <CheckIcon fontSize="small" color="success" />
      ) : value === 'READ' ? (
        <VisibilityIcon fontSize="small" color="info" />
      ) : (
        <CloseIcon fontSize="small" sx={{ color: 'text.disabled' }} />
      );

    const label =
      value === 'FULL'
        ? t('rolesPage.legend.full', 'Can do')
        : value === 'READ'
          ? t('rolesPage.legend.read', 'Can see only')
          : t('rolesPage.legend.none', 'No access');

    return (
      <Tooltip title={note ? `${label} — ${note}` : label}>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>{icon}</Box>
      </Tooltip>
    );
  };

  return (
    <Box sx={{ pb: 6 }}>
      <CustomBreadcrumbs
        heading={t('rolesPage.title', 'Roles & Permissions')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('nav.settingsHub', 'Settings'), href: '/app/settings' },
          { name: t('rolesPage.title', 'Roles & Permissions') },
        ]}
      />

      <Alert severity="info" sx={{ mb: 3 }}>
        {t(
          'rolesPage.intro',
          'Head office is a role and the absence of a branch, both at once. An administrator pinned to a branch is that branch’s administrator — they read as the middle column here, not the right-hand one.'
        )}
      </Alert>

      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Chip size="small" icon={<CheckIcon />} color="success" variant="outlined" label={t('rolesPage.legend.full', 'Can do')} />
        <Chip size="small" icon={<VisibilityIcon />} color="info" variant="outlined" label={t('rolesPage.legend.read', 'Can see only')} />
        <Chip size="small" icon={<CloseIcon />} variant="outlined" label={t('rolesPage.legend.none', 'No access')} />
      </Stack>

      {cells.map((group) => (
        <Card key={group.titleKey} sx={{ mb: 3, borderRadius: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, p: 2.5, pb: 1.5 }}>
            {t(group.titleKey, group.title)}
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('rolesPage.capability', 'Capability')}</TableCell>
                  {COLUMNS.map((col) => (
                    <TableCell key={col.id} align="center" sx={{ whiteSpace: 'nowrap' }}>
                      {columnLabel(col.id)}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {group.rows.map((row) => (
                  <TableRow key={row.labelKey} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {t(row.labelKey, row.label)}
                      </Typography>
                      {row.note && (
                        <Typography variant="caption" color="text.secondary">
                          {t(`${row.labelKey}Note`, row.note)}
                        </Typography>
                      )}
                    </TableCell>
                    {COLUMNS.map((col) => (
                      <TableCell key={col.id} align="center">
                        {renderCell(row.access[col.id], row.note)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      ))}

      <Alert severity="warning">
        {t(
          'rolesPage.footer',
          'A branch account is answered about its own branch whatever it asks for — the confinement holds at the API, not only in the branch switcher. Head office asking for nothing in particular gets every site.'
        )}
      </Alert>
    </Box>
  );
}
