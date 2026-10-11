import type { SettingItem } from 'src/config/settings-catalogue';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import SearchIcon from '@mui/icons-material/Search';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import {
  Box,
  Card,
  Link,
  Stack,
  Divider,
  Tooltip,
  TextField,
  Typography,
  InputAdornment,
} from '@mui/material';

import { RouterLink } from 'src/routes/components';

import { pageLabel } from 'src/config/version-labels';
import { useWorkspaceScope } from 'src/contexts/branch-context';
import { useIsSettingOnOffer, useSettingsCatalogue } from 'src/config/settings-catalogue';

import { VersionTag } from 'src/components/version-tag';

/**
 * Every setting on one screen: a row per area, its links beside it. It replaced a grid of
 * cards, each with a description, a scope chip and a badge, that ran to three screens and
 * still left people unsure which settings were theirs to change. A link is listed only
 * where it can be changed, so the scope no longer needs a chip on every line; the one case
 * that does need saying — a chain default a branch may replace — carries a small mark.
 */
export function SettingsHubPage() {
  const { t } = useTranslation();
  const categories = useSettingsCatalogue();
  const onOffer = useIsSettingOnOffer();
  const atHeadOffice = useWorkspaceScope()?.isHeadOffice ?? true;
  const [searchQuery, setSearchQuery] = useState('');

  const q = searchQuery.trim().toLowerCase();
  const matches = (item: SettingItem) =>
    !q ||
    item.title.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q) ||
    item.tags.some((tag) => tag.toLowerCase().includes(q));

  const rows = categories
    .map((category) => ({ ...category, items: category.items.filter((item) => onOffer(item) && matches(item)) }))
    .filter((category) => category.items.length > 0);

  const inheritedHelp = atHeadOffice
    ? t('settings.hub.inherited.headOffice', 'The chain’s default. A branch may set its own.')
    : t('settings.hub.inherited.branch', 'Follows head office unless this branch sets its own.');
  const showsInherited = rows.some((row) => row.items.some((item) => item.scope === 'INHERITED'));

  return (
    <Box sx={{ pb: 6 }}>
      <Stack
        spacing={2}
        sx={{
          alignItems: { md: 'flex-end', xs: 'stretch' },
          flexDirection: { md: 'row', xs: 'column' },
          justifyContent: 'space-between',
          mb: 3,
        }}
      >
        <Box>
          <Typography variant="h4">{t('settings.hub.title', 'Settings')}</Typography>
          <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
            {atHeadOffice
              ? t('settings.hub.subtitle', 'What head office decides for the whole chain.')
              : t('settings.hub.subtitleBranch', 'What this branch sets for itself.')}
          </Typography>
        </Box>

        <TextField
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('settings.hub.searchPlaceholder', 'Search settings...')}
          size="small"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ width: { md: 320, xs: '100%' } }}
          value={searchQuery}
        />
      </Stack>

      {rows.length === 0 ? (
        <Card variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary" variant="h6">
            {t('settings.hub.noResultsTitle', 'No setting found matching "{{query}}"', { query: searchQuery })}
          </Typography>
        </Card>
      ) : (
        <Card variant="outlined">
          <Stack divider={<Divider />}>
            {rows.map((row) => (
              <Stack
                key={row.id}
                spacing={{ md: 4, xs: 2 }}
                sx={{ flexDirection: { md: 'row', xs: 'column' }, p: { md: 3, xs: 2.5 } }}
              >
                <Stack direction="row" spacing={2} sx={{ flexShrink: 0, width: { md: 320, xs: 1 } }}>
                  <Box
                    sx={{
                      alignItems: 'center',
                      bgcolor: 'action.hover',
                      borderRadius: 1.5,
                      color: 'primary.main',
                      display: 'flex',
                      flexShrink: 0,
                      height: 40,
                      justifyContent: 'center',
                      width: 40,
                    }}
                  >
                    {row.icon}
                  </Box>
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      {row.categoryTitle}
                    </Typography>
                    <Typography color="text.secondary" variant="body2">
                      {row.categoryDescription}
                    </Typography>
                  </Box>
                </Stack>

                <Box
                  sx={{
                    alignContent: 'start',
                    columnGap: 3,
                    display: 'grid',
                    flexGrow: 1,
                    gridTemplateColumns: { md: 'repeat(3, 1fr)', sm: 'repeat(2, 1fr)', xs: '1fr' },
                    rowGap: 1.75,
                  }}
                >
                  {row.items.map((item) => (
                    <Stack key={item.id} direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
                      <Tooltip title={item.description} enterDelay={400} placement="bottom-start">
                        <Link
                          color="text.primary"
                          component={RouterLink}
                          href={item.path}
                          underline="hover"
                          variant="subtitle2"
                        >
                          {item.title}
                        </Link>
                      </Tooltip>
                      {item.scope === 'INHERITED' && (
                        <Tooltip title={inheritedHelp}>
                          <CallSplitIcon
                            aria-label={inheritedHelp}
                            sx={{ color: 'text.disabled', cursor: 'help', fontSize: 16 }}
                          />
                        </Tooltip>
                      )}
                      <VersionTag label={pageLabel(item.path)} />
                    </Stack>
                  ))}
                </Box>
              </Stack>
            ))}
          </Stack>
        </Card>
      )}

      {showsInherited && (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', color: 'text.secondary', mt: 1.5, px: 0.5 }}>
          <CallSplitIcon sx={{ fontSize: 16 }} />
          <Typography variant="caption">{inheritedHelp}</Typography>
        </Stack>
      )}
    </Box>
  );
}
