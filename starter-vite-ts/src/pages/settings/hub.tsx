import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import TuneIcon from '@mui/icons-material/Tune';
import GavelIcon from '@mui/icons-material/Gavel';
import PrintIcon from '@mui/icons-material/Print';
import ShieldIcon from '@mui/icons-material/Shield';
import SearchIcon from '@mui/icons-material/Search';
import PaymentsIcon from '@mui/icons-material/Payments';
import TranslateIcon from '@mui/icons-material/Translate';
import StorefrontIcon from '@mui/icons-material/Storefront';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import CountertopsIcon from '@mui/icons-material/Countertops';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import {
  Box,
  Card,
  Chip,
  Grid,
  Stack,
  Divider,
  useTheme,
  TextField,
  ButtonBase,
  Typography,
  CardContent,
  InputAdornment,
} from '@mui/material';

import { RouterLink } from 'src/routes/components';

interface SettingItem {
  badge?: {
    color: 'default' | 'error' | 'info' | 'primary' | 'secondary' | 'success' | 'warning';
    label: string;
  };
  description: string;
  icon: React.ReactNode;
  id: string;
  path: string;
  tags: string[];
  title: string;
}

interface SettingCategory {
  categoryDescription: string;
  categoryTitle: string;
  icon: React.ReactNode;
  id: string;
  items: SettingItem[];
}

export function SettingsHubPage() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const isRtl = theme.direction === 'rtl';

  const categories: SettingCategory[] = [
    {
      id: 'organization',
      categoryTitle: t('settings.hub.domains.organization.title', 'Organization & Stores'),
      categoryDescription: t(
        'settings.hub.domains.organization.description',
        'Tenant profile, branch locations, operating schedules, and multi-currency settings.'
      ),
      icon: <StorefrontIcon color="primary" sx={{ fontSize: 28 }} />,
      items: [
        {
          id: 'general',
          title: t('settings.hub.items.general.title', 'General Settings & Currencies'),
          description: t(
            'settings.hub.items.general.description',
            'Tenant organization name, timezone, locale defaults, base currency, and multi-currency limits.'
          ),
          path: '/app/settings/general',
          icon: <TuneIcon sx={{ color: 'primary.main' }} />,
          badge: { color: 'info', label: t('settings.hub.items.general.badge', '9 Currencies') },
          tags: ['general', 'tenant', 'currency', 'timezone', 'locale', 'organization', 'base currency'],
        },
        {
          id: 'branches',
          title: t('settings.hub.items.branches.title', 'Branches & Operating Hours'),
          description: t(
            'settings.hub.items.branches.description',
            'Store locations, operational schedules, table arrangements, tax profiles, and branch statuses.'
          ),
          path: '/app/operations/branches',
          icon: <StorefrontIcon sx={{ color: 'warning.main' }} />,
          badge: { color: 'success', label: t('settings.hub.items.branches.badge', '3 Locations') },
          tags: ['branches', 'stores', 'hours', 'locations', 'tables', 'tax', 'schedules'],
        },
      ],
    },
    {
      id: 'hardware',
      categoryTitle: t('settings.hub.domains.hardware.title', 'Hardware & Peripherals'),
      categoryDescription: t(
        'settings.hub.domains.hardware.description',
        'POS hardware terminals, network receipt printers, kitchen routing, and bump screens.'
      ),
      icon: <PointOfSaleIcon color="info" sx={{ fontSize: 28 }} />,
      items: [
        {
          id: 'terminals',
          title: t('settings.hub.items.terminals.title', 'Terminals Registry'),
          description: t(
            'settings.hub.items.terminals.description',
            'POS hardware register pairing, terminal serial numbers, peripheral setup, and device status.'
          ),
          path: '/app/operations/terminals',
          icon: <PointOfSaleIcon sx={{ color: 'info.main' }} />,
          badge: { color: 'primary', label: t('settings.hub.items.terminals.badge', 'Active Pairs') },
          tags: ['terminals', 'pos', 'registers', 'devices', 'hardware', 'pairing', 'serials'],
        },
        {
          id: 'printers',
          title: t('settings.hub.items.printers.title', 'Printers & Print Routing'),
          description: t(
            'settings.hub.items.printers.description',
            'Network receipt printers, kitchen ticket routing, print templates, and queue failover.'
          ),
          path: '/app/operations/printers',
          icon: <PrintIcon sx={{ color: 'secondary.main' }} />,
          badge: { color: 'secondary', label: t('settings.hub.items.printers.badge', 'Station Routing') },
          tags: ['printers', 'receipts', 'kitchen tickets', 'routing', 'templates', 'queue', 'hardware'],
        },
        {
          id: 'kds',
          title: t('settings.hub.items.kds.title', 'KDS Configuration'),
          description: t(
            'settings.hub.items.kds.description',
            'Kitchen display screens, preparation timers, item routing, and order bumping rules.'
          ),
          path: '/app/operations/kds-configuration',
          icon: <CountertopsIcon sx={{ color: 'info.main' }} />,
          badge: { color: 'info', label: t('settings.hub.items.kds.badge', 'KDS Active') },
          tags: ['kds', 'kitchen', 'screens', 'preparation', 'timers', 'bumping', 'stations'],
        },
      ],
    },
    {
      id: 'security',
      categoryTitle: t('settings.hub.domains.securityAudit.title', 'Security & Approvals'),
      categoryDescription: t(
        'settings.hub.domains.securityAudit.description',
        'PIN escalation governance, role discount authorizations, and anti-fraud thresholds.'
      ),
      icon: <ShieldIcon color="error" sx={{ fontSize: 28 }} />,
      items: [
        {
          id: 'approvals',
          title: t('settings.hub.items.approvals.title', 'Approval Policies & PIN Escalation'),
          description: t(
            'settings.hub.items.approvals.description',
            'Manager override thresholds, void/reprint rules, self-approval prevention, and escalation paths.'
          ),
          path: '/app/settings/approvals',
          icon: <ShieldIcon sx={{ color: 'info.main' }} />,
          badge: { color: 'info', label: t('settings.hub.items.approvals.badge', 'Policy Engine') },
          tags: ['approvals', 'manager', 'security', 'limits', 'overrides', 'policy', 'escalations', 'pin'],
        },
        {
          id: 'discountAuthorizations',
          title: t('settings.hub.items.discountAuthorizations.title', 'Manual Discount Authorizations'),
          description: t(
            'settings.hub.items.discountAuthorizations.description',
            'Role-based manual discount percentage and fixed amount caps for cashiers, supervisors, and managers.'
          ),
          path: '/app/settings/discount-authorizations',
          icon: <GavelIcon sx={{ color: 'warning.main' }} />,
          badge: { color: 'warning', label: t('settings.hub.items.discountAuthorizations.badge', 'Role Limits') },
          tags: ['discounts', 'authorizations', 'roles', 'limits', 'cashier', 'supervisor', 'manager', 'caps', 'policy'],
        },
      ],
    },
    {
      id: 'workflow',
      categoryTitle: t('settings.hub.domains.orderPos.title', 'Order & Financial Policies'),
      categoryDescription: t(
        'settings.hub.domains.orderPos.description',
        'Order lifecycle states, auto-acceptance rules, reason codes, and payment gateways.'
      ),
      icon: <ReceiptLongIcon color="warning" sx={{ fontSize: 28 }} />,
      items: [
        {
          id: 'orderWorkflow',
          title: t('settings.hub.items.orderWorkflow.title', 'Order Workflow Settings'),
          description: t(
            'settings.hub.items.orderWorkflow.description',
            'Order lifecycle states, auto-acceptance rules, dining modes, and kitchen routing.'
          ),
          path: '/app/settings/order-workflow',
          icon: <ReceiptLongIcon sx={{ color: 'warning.main' }} />,
          badge: { color: 'warning', label: t('settings.hub.items.orderWorkflow.badge', 'Workflow V2') },
          tags: ['order', 'workflow', 'lifecycle', 'auto accept', 'dining', 'kitchen routing'],
        },
        {
          id: 'payments',
          title: t('settings.hub.items.payments.title', 'Payments & Refund Methods'),
          description: t(
            'settings.hub.items.payments.description',
            'EFT POS terminals, card gateways, cash drawers, refund limits, and payment methods.'
          ),
          path: '/app/settings/payments-refunds',
          icon: <PaymentsIcon sx={{ color: 'success.main' }} />,
          badge: { color: 'success', label: t('settings.hub.items.payments.badge', 'Gateways Ready') },
          tags: ['payments', 'refunds', 'gateways', 'eft', 'cash drawer', 'cards', 'transactions'],
        },
        {
          id: 'reasons',
          title: t('settings.hub.items.reasons.title', 'Reason Codes & Compliance'),
          description: t(
            'settings.hub.items.reasons.description',
            'Predefined audit reason codes for order voids, customer refunds, cash variances, and discounts.'
          ),
          path: '/app/settings/reasons',
          icon: <GavelIcon sx={{ color: 'error.main' }} />,
          badge: { color: 'default', label: t('settings.hub.items.reasons.badge', 'Audit Ready') },
          tags: ['reasons', 'audit', 'voids', 'refunds', 'variances', 'compliance', 'codes'],
        },
      ],
    },
    {
      id: 'system',
      categoryTitle: t('settings.hub.domains.localizationData.title', 'System & Localization'),
      categoryDescription: t(
        'settings.hub.domains.localizationData.description',
        'Language and media localization, bulk Excel import/export, and data resets.'
      ),
      icon: <TranslateIcon color="secondary" sx={{ fontSize: 28 }} />,
      items: [
        {
          id: 'localization',
          title: t('settings.hub.items.localization.title', 'Language & Media Localization'),
          description: t(
            'settings.hub.items.localization.description',
            'English/Persian language switcher, RTL/LTR layout controls, and media asset localization.'
          ),
          path: '/app/settings/localization',
          icon: <TranslateIcon sx={{ color: 'secondary.main' }} />,
          badge: { color: 'secondary', label: t('settings.hub.items.localization.badge', 'EN / FA RTL') },
          tags: ['localization', 'language', 'persian', 'english', 'rtl', 'ltr', 'media', 'i18n'],
        },
        {
          id: 'importExport',
          title: t('settings.hub.items.importExport.title', 'Data Import & Export Wizard'),
          description: t(
            'settings.hub.items.importExport.description',
            'Bulk upload products, prices, modifier groups, and customers using standardized Excel templates.'
          ),
          path: '/app/catalog/import-export',
          icon: <FileUploadIcon sx={{ color: 'success.main' }} />,
          badge: { color: 'success', label: t('settings.hub.items.importExport.badge', 'Excel Wizard') },
          tags: ['import', 'export', 'excel', 'wizard', 'bulk', 'upload', 'migration', 'data'],
        },
        {
          id: 'dataReset',
          title: t('settings.hub.items.dataReset.title', 'Data Reset & System Seeds'),
          description: t(
            'settings.hub.items.dataReset.description',
            'Wipe transaction logs, seed mock products, reset sequence numbers, and reset environment state.'
          ),
          path: '/app/settings/data-reset',
          icon: <RestartAltIcon sx={{ color: 'error.main' }} />,
          badge: { color: 'error', label: t('settings.hub.items.dataReset.badge', 'Admin Tools') },
          tags: ['data reset', 'reset', 'seed', 'wipe', 'maintenance', 'database', 'environment'],
        },
      ],
    },
  ];

  const filteredCategories = categories
    .map((category) => {
      const filteredItems = category.items.filter((item) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.tags.some((tag) => tag.toLowerCase().includes(q))
        );
      });
      return { ...category, items: filteredItems };
    })
    .filter((category) => category.items.length > 0);

  return (
    <Box sx={{ pb: 6 }}>
      {/* Header Banner */}
      <Box
        sx={{
          background: `linear-gradient(135deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 60%, ${theme.palette.secondary.main} 100%)`,
          borderRadius: 3,
          boxShadow: 4,
          color: 'common.white',
          mb: 4,
          overflow: 'hidden',
          p: { md: 4, xs: 3 },
          position: 'relative',
        }}
      >
        <Stack
          spacing={3}
          sx={{
            alignItems: { md: 'center', xs: 'flex-start' },
            flexDirection: { md: 'row', xs: 'column' },
            justifyContent: 'space-between',
          }}
        >
          <Box>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1 }}>
              <TuneIcon sx={{ fontSize: 32 }} />
              <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: '-0.5px' }}>
                {t('settings.hub.title', 'Settings Hub')}
              </Typography>
            </Stack>
            <Typography variant="body1" sx={{ maxWidth: 640, opacity: 0.9 }}>
              {t(
                'settings.hub.subtitle',
                'Centralized configuration portal. Manage business profiles, store branches, hardware registers, security governance, and system tools in one place.'
              )}
            </Typography>
          </Box>

          <TextField
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('settings.hub.searchPlaceholder', 'Search settings...')}
            size="medium"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon color="action" />
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                boxShadow: 2,
              },
              bgcolor: 'background.paper',
              borderRadius: 2,
              width: { md: 320, xs: '100%' },
            }}
            value={searchQuery}
          />
        </Stack>
      </Box>

      {/* Settings Grid by Business Domains */}
      {filteredCategories.length === 0 ? (
        <Card sx={{ borderRadius: 3, p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary" variant="h6">
            {t('settings.hub.noResultsTitle', 'No setting found matching "{{query}}"', { query: searchQuery })}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }} variant="body2">
            {t(
              'settings.hub.noResultsHelp',
              'Try searching for keywords like "currency", "branches", "hardware", "approvals", or "reset".'
            )}
          </Typography>
        </Card>
      ) : (
        <Grid container spacing={3}>
          {filteredCategories.map((category) => (
            <Grid key={category.id} size={{ md: 6, xs: 12 }}>
              <Card
                sx={{
                  borderRadius: 3,
                  boxShadow: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                  '&:hover': {
                    boxShadow: 6,
                  },
                }}
              >
                {/* Category Header */}
                <Box
                  sx={{
                    borderBottom: 1,
                    borderColor: 'divider',
                    bgcolor: (tr) => (tr.palette.mode === 'dark' ? 'grey.800' : 'grey.100'),
                    p: 2.5,
                  }}
                >
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                    <Box
                      sx={{
                        alignItems: 'center',
                        bgcolor: 'background.paper',
                        borderRadius: 2,
                        boxShadow: 1,
                        display: 'flex',
                        justifyContent: 'center',
                        p: 1,
                      }}
                    >
                      {category.icon}
                    </Box>
                    <Box>
                      <Typography sx={{ fontWeight: 700 }} variant="h6">
                        {category.categoryTitle}
                      </Typography>
                      <Typography color="text.secondary" variant="caption">
                        {category.categoryDescription}
                      </Typography>
                    </Box>
                  </Stack>
                </Box>

                {/* Category Items */}
                <CardContent sx={{ flexGrow: 1, p: 0, '&:last-child': { pb: 0 } }}>
                  <Stack divider={<Divider />}>
                    {category.items.map((item) => (
                      <ButtonBase
                        component={RouterLink}
                        href={item.path}
                        key={item.id}
                        sx={{
                          alignItems: 'center',
                          display: 'flex',
                          justifyContent: 'space-between',
                          p: 2.5,
                          textAlign: isRtl ? 'right' : 'left',
                          transition: 'background-color 0.15s ease',
                          width: '100%',
                          '&:hover': {
                            bgcolor: (tr) => (tr.palette.mode === 'dark' ? 'action.hover' : 'primary.50'),
                            '& .chevron-icon': {
                              color: 'primary.main',
                              transform: isRtl ? 'translateX(-4px) rotate(180deg)' : 'translateX(4px)',
                            },
                          },
                        }}
                      >
                        <Stack
                          direction="row"
                          spacing={2}
                          sx={{
                            alignItems: 'flex-start',
                            flexGrow: 1,
                            mr: isRtl ? 0 : 2,
                            ml: isRtl ? 2 : 0,
                          }}
                        >
                          <Box
                            sx={{
                              bgcolor: (tr) => (tr.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
                              borderRadius: 2,
                              display: 'flex',
                              mt: 0.5,
                              p: 1,
                            }}
                          >
                            {item.icon}
                          </Box>

                          <Box sx={{ flexGrow: 1 }}>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                              <Typography color="text.primary" sx={{ fontWeight: 700 }} variant="subtitle1">
                                {item.title}
                              </Typography>
                              {item.badge && (
                                <Chip
                                  color={item.badge.color}
                                  label={item.badge.label}
                                  size="small"
                                  sx={{ fontSize: '0.7rem', fontWeight: 700, height: 20 }}
                                />
                              )}
                            </Stack>
                            <Typography color="text.secondary" sx={{ lineHeight: 1.4 }} variant="body2">
                              {item.description}
                            </Typography>
                          </Box>
                        </Stack>

                        <ChevronRightIcon
                          className="chevron-icon"
                          color="action"
                          sx={{
                            transition: 'transform 0.2s ease, color 0.2s ease',
                            transform: isRtl ? 'rotate(180deg)' : 'none',
                          }}
                        />
                      </ButtonBase>
                    ))}
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}
