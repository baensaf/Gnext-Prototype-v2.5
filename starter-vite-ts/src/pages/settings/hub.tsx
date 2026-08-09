import React, { useState } from 'react';
import { useNavigate } from 'react-router';

import SyncIcon from '@mui/icons-material/Sync';
import TuneIcon from '@mui/icons-material/Tune';
import GavelIcon from '@mui/icons-material/Gavel';
import SearchIcon from '@mui/icons-material/Search';
import ShieldIcon from '@mui/icons-material/Shield';
import DevicesIcon from '@mui/icons-material/Devices';
import LanguageIcon from '@mui/icons-material/Language';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import StorefrontIcon from '@mui/icons-material/Storefront';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
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
  const navigate = useNavigate();
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');

  const categories: SettingCategory[] = [
    {
      categoryDescription: 'Global system parameters, tenant organization details, and currency profiles',
      categoryTitle: 'System & Organization',
      icon: <LanguageIcon color="primary" sx={{ fontSize: 28 }} />,
      id: 'system-org',
      items: [
        {
          badge: { color: 'info', label: '9 Currencies' },
          description: 'Tenant organization name, timezone, locale defaults, base currency, and precision limits.',
          icon: <TuneIcon sx={{ color: 'primary.main' }} />,
          id: 'general',
          path: '/app/settings/general',
          tags: ['general', 'tenant', 'currency', 'timezone', 'locale', 'organization'],
          title: 'General Settings & Currencies',
        },
      ],
    },
    {
      categoryDescription: 'Branch store management, POS terminal hardware registry, and payment devices',
      categoryTitle: 'Stores & Hardware Devices',
      icon: <StorefrontIcon color="warning" sx={{ fontSize: 28 }} />,
      id: 'stores-hardware',
      items: [
        {
          badge: { color: 'success', label: '3 Locations' },
          description: 'Store locations, operational schedules, table arrangements, tax profiles, and branch statuses.',
          icon: <StorefrontIcon sx={{ color: 'warning.main' }} />,
          id: 'branches',
          path: '/app/settings/branches',
          tags: ['branches', 'stores', 'hours', 'locations', 'tables', 'tax'],
          title: 'Branches & Operating Hours',
        },
        {
          badge: { color: 'primary', label: 'Active Pairs' },
          description: 'POS hardware register pairing, terminal serial numbers, peripheral setup, and device status.',
          icon: <PointOfSaleIcon sx={{ color: 'info.main' }} />,
          id: 'terminals',
          path: '/app/settings/terminals',
          tags: ['terminals', 'pos', 'registers', 'devices', 'hardware', 'pairing'],
          title: 'Terminals Registry',
        },
        {
          badge: { color: 'success', label: 'Gateways Ready' },
          description: 'Payment gateway configurations, card EFT terminals, kitchen printers, barcode scanners, and cash drawers.',
          icon: <DevicesIcon sx={{ color: 'secondary.main' }} />,
          id: 'payments',
          path: '/app/settings/payments',
          tags: ['payments', 'gateways', 'eft', 'printers', 'scanners', 'hardware', 'cash drawer'],
          title: 'Payments & Hardware Devices',
        },
      ],
    },
    {
      categoryDescription: 'Manager approval thresholds, reason codes compliance, and offline synchronization policy',
      categoryTitle: 'Governance & Workflows',
      icon: <ShieldIcon color="info" sx={{ fontSize: 28 }} />,
      id: 'governance-workflows',
      items: [
        {
          badge: { color: 'info', label: 'Slice 7 Policy' },
          description: 'Manager override rules, discount cap policy, self-approval prevention, and escalation thresholds.',
          icon: <ShieldIcon sx={{ color: 'info.main' }} />,
          id: 'approvals',
          path: '/app/settings/approvals',
          tags: ['approvals', 'manager', 'security', 'limits', 'overrides', 'policy'],
          title: 'Approval Policies & Security',
        },
        {
          badge: { color: 'default', label: 'Audit Ready' },
          description: 'Predefined audit reason codes for order voids, customer refunds, cash variances, and item discounts.',
          icon: <GavelIcon sx={{ color: 'error.main' }} />,
          id: 'reasons',
          path: '/app/settings/reasons',
          tags: ['reasons', 'audit', 'voids', 'refunds', 'variances', 'compliance'],
          title: 'Reason Codes & Compliance',
        },
        {
          badge: { color: 'warning', label: 'Sync Engine' },
          description: 'Local IndexedDB storage parameters, background sync interval, manual sync triggers, and queue limits.',
          icon: <SyncIcon sx={{ color: 'warning.main' }} />,
          id: 'offline-sync',
          path: '/app/settings/offline-sync',
          tags: ['offline', 'sync', 'queue', 'storage', 'database', 'engine'],
          title: 'Offline & Sync Engine Settings',
        },
      ],
    },
    {
      categoryDescription: 'Data migration, bulk Excel import wizard, system resets, and baseline database seeding',
      categoryTitle: 'Data Tools & Maintenance',
      icon: <FileUploadIcon color="success" sx={{ fontSize: 28 }} />,
      id: 'data-maintenance',
      items: [
        {
          badge: { color: 'success', label: 'Bulk Tools' },
          description: 'Bulk upload products, prices, modifier groups, and customers using standardized Excel templates.',
          icon: <FileUploadIcon sx={{ color: 'success.main' }} />,
          id: 'import-wizard',
          path: '/app/settings/import-wizard',
          tags: ['import', 'excel', 'wizard', 'bulk', 'upload', 'migration'],
          title: 'Excel Data Import Wizard',
        },
        {
          badge: { color: 'error', label: 'Admin Tools' },
          description: 'Wipe transaction logs, seed mock products, reset sequence numbers, and reset environment state.',
          icon: <RestartAltIcon sx={{ color: 'error.main' }} />,
          id: 'data-reset',
          path: '/app/settings/data-reset',
          tags: ['reset', 'seeds', 'wipe', 'maintenance', 'database', 'environment'],
          title: 'Data Reset & System Seeds',
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
                Settings Hub
              </Typography>
            </Stack>
            <Typography variant="body1" sx={{ maxWidth: 640, opacity: 0.9 }}>
              Centralized configuration portal. Manage business profiles, store branches, hardware registers, security governance, and system tools in one place.
            </Typography>
          </Box>

          <TextField
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search settings..."
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

      {/* Settings Grid by Business Functionality */}
      {filteredCategories.length === 0 ? (
        <Card sx={{ borderRadius: 3, p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary" variant="h6">
            No setting found matching &quot;{searchQuery}&quot;
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }} variant="body2">
            Try searching for keywords like &quot;currency&quot;, &quot;branches&quot;, &quot;hardware&quot;, &quot;approvals&quot;, or &quot;reset&quot;.
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
                    bgcolor: (t) => (t.palette.mode === 'dark' ? 'grey.800' : 'grey.100'),
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
                        key={item.id}
                        onClick={() => navigate(item.path)}
                        sx={{
                          alignItems: 'center',
                          display: 'flex',
                          justifyContent: 'space-between',
                          p: 2.5,
                          textAlign: 'left',
                          transition: 'background-color 0.15s ease',
                          width: '100%',
                          '&:hover': {
                            bgcolor: (t) => (t.palette.mode === 'dark' ? 'action.hover' : 'primary.50'),
                            '& .chevron-icon': {
                              color: 'primary.main',
                              transform: 'translateX(4px)',
                            },
                          },
                        }}
                      >
                        <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start', flexGrow: 1, mr: 2 }}>
                          <Box
                            sx={{
                              bgcolor: (t) => (t.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
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
                          sx={{ transition: 'transform 0.2s ease, color 0.2s ease' }}
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
