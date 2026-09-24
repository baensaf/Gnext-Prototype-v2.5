import type { SettingItem, SettingScope } from 'src/config/settings-catalogue';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import TuneIcon from '@mui/icons-material/Tune';
import SearchIcon from '@mui/icons-material/Search';
import StorefrontIcon from '@mui/icons-material/Storefront';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import CorporateFareIcon from '@mui/icons-material/CorporateFare';
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
  ToggleButton,
  InputAdornment,
  ToggleButtonGroup,
} from '@mui/material';

import { RouterLink } from 'src/routes/components';

import { useIsSettingOnOffer, useSettingsCatalogue } from 'src/config/settings-catalogue';

export function SettingsHubPage() {
  const theme = useTheme();
  const { t } = useTranslation();
  const categories = useSettingsCatalogue();
  const isOnOffer = useIsSettingOnOffer();
  const [searchQuery, setSearchQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<SettingScope | 'ALL'>('ALL');
  const isRtl = theme.direction === 'rtl';

  // The sidebar already hides what a role cannot open, and what does not belong in the scope
  // the header is set to. Offering it here anyway made the hub the one place that promised
  // a page the menu had taken away.
  const onOffer = (item: SettingItem) => isOnOffer(item.path);
  // Inside a branch everything left is per-branch, so a filter with one live option is noise.
  const offeredScopes = new Set(categories.flatMap((c) => c.items.filter(onOffer).map((i) => i.scope)));
  const showScopeFilter = offeredScopes.size > 1;

  const filteredCategories = categories
    .map((category) => {
      const filteredItems = category.items.filter((item) => {
        if (!onOffer(item)) return false;
        if (showScopeFilter && scopeFilter !== 'ALL' && item.scope !== scopeFilter) return false;
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
            <Typography variant="body2" sx={{ maxWidth: 640, mt: 1.5, opacity: 0.75 }}>
              {t(
                'settings.hub.scopeLegend',
                'Organization settings are defined once at head office and apply to every branch. Per-branch settings are configured separately at each location.'
              )}
            </Typography>
          </Box>

          <Stack spacing={1.5} sx={{ width: { md: 'auto', xs: '100%' } }}>
            {showScopeFilter && (
              <ToggleButtonGroup
                exclusive
                onChange={(_, next) => next && setScopeFilter(next)}
                size="small"
                sx={{
                  bgcolor: 'background.paper',
                  borderRadius: 2,
                  boxShadow: 2,
                  '& .MuiToggleButton-root': { fontWeight: 700, px: 2, textTransform: 'none' },
                }}
                value={scopeFilter}
              >
                <ToggleButton value="ALL">{t('settings.hub.scope.all', 'All')}</ToggleButton>
                <ToggleButton value="ORG">
                  <CorporateFareIcon sx={{ fontSize: 16, mr: 0.75 }} />
                  {t('settings.hub.scope.org', 'Organization')}
                </ToggleButton>
                <ToggleButton value="BRANCH">
                  <StorefrontIcon sx={{ fontSize: 16, mr: 0.75 }} />
                  {t('settings.hub.scope.branch', 'Per Branch')}
                </ToggleButton>
              </ToggleButtonGroup>
            )}

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
              'Try searching for keywords like "currency", "branches", "hardware", "approvals", or "reset", or clear the scope filter.'
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
                              <Chip
                                color={item.scope === 'ORG' ? 'primary' : 'default'}
                                icon={
                                  item.scope === 'ORG' ? (
                                    <CorporateFareIcon sx={{ fontSize: 13 }} />
                                  ) : (
                                    <StorefrontIcon sx={{ fontSize: 13 }} />
                                  )
                                }
                                label={
                                  item.scope === 'ORG'
                                    ? t('settings.hub.scope.org', 'Organization')
                                    : t('settings.hub.scope.branch', 'Per Branch')
                                }
                                size="small"
                                sx={{ fontSize: '0.65rem', fontWeight: 700, height: 20 }}
                                variant={item.scope === 'ORG' ? 'filled' : 'outlined'}
                              />
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
