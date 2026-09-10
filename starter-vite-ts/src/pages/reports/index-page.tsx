import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import SearchIcon from '@mui/icons-material/Search';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import {
  Box,
  Card,
  Grid,
  Stack,
  Alert,
  TextField,
  ButtonBase,
  Typography,
  CardContent,
  LinearProgress,
  InputAdornment,
} from '@mui/material';

import { RouterLink } from 'src/routes/components';

import { httpClient } from 'src/api/httpClient';
import { DashboardContent } from 'src/layouts/dashboard';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

interface CatalogEntry {
  category: string;
  code: string;
  name: string;
}

/**
 * The order categories appear in, roughly the order somebody closing a day works through
 * them: what sold, how it was paid for, what was given away, what is in the drawer, who
 * still owes. Anything the API adds that is not listed here lands at the end.
 */
const CATEGORY_ORDER = [
  'FINANCIAL',
  'CATALOG',
  'PAYMENT',
  'PROMOTION',
  'CASH',
  'CREDIT',
  'CUSTOMER',
  'DELIVERY',
  'TAX',
  'INTEGRATION',
  'SIMULATION',
  'V5_PREVIEW',
];

const CATEGORY_LABELS: Record<string, string> = {
  FINANCIAL: 'Sales & Performance',
  CATALOG: 'Menu & Product',
  PAYMENT: 'Payments',
  PROMOTION: 'Discounts & Promotions',
  CASH: 'Cash & Shifts',
  CREDIT: 'Customer Credit',
  CUSTOMER: 'Customers',
  DELIVERY: 'Delivery & Couriers',
  TAX: 'Tax & Compliance',
  INTEGRATION: 'Integrations',
  SIMULATION: 'Simulation & Hardware',
  V5_PREVIEW: 'Preview',
};

/**
 * Every report the signed-in account may run, on one page, grouped the way the catalogue
 * already groups them. The picker inside the viewer could always reach all of these, but
 * only from a page you had to be standing on first — so twenty-three of the twenty-five
 * were invisible unless you knew they existed.
 *
 * The list is whatever `/reports/catalog` returns, which is filtered by role on the server:
 * a branch manager is never shown a report the run would then refuse.
 */
export function ReportsIndexPage() {
  const { t } = useTranslation();

  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await httpClient.get('/api/v1/reports/catalog');
        if (!cancelled) setCatalog(res.data ?? []);
      } catch (err: any) {
        if (!cancelled) {
          setError(
            err?.detail ||
              t('reports.index.loadFailed', 'Could not load the report catalog. Try again.')
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const term = search.trim().toLowerCase();
  const visible = term
    ? catalog.filter(
        (entry) =>
          entry.name.toLowerCase().includes(term) ||
          entry.code.includes(term) ||
          (CATEGORY_LABELS[entry.category] ?? entry.category).toLowerCase().includes(term)
      )
    : catalog;

  const categories = [...new Set(visible.map((entry) => entry.category))].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? CATEGORY_ORDER.length : ai) - (bi === -1 ? CATEGORY_ORDER.length : bi);
  });

  return (
    <DashboardContent>
      <CustomBreadcrumbs
        heading={t('reports.index.heading', 'Reports & Analytics')}
        links={[
          { name: t('nav.home', 'Home'), href: '/app/dashboard' },
          { name: t('reports.index.heading', 'Reports & Analytics') },
        ]}
        sx={{ mb: 3 }}
      />

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 640 }}>
        {t(
          'reports.index.subtitle',
          'Every report available to your account. Open one to set its date range, save a view, or export it.'
        )}
      </Typography>

      <TextField
        fullWidth
        size="small"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('reports.index.searchPlaceholder', 'Search reports')}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          },
        }}
        sx={{ mb: 4, maxWidth: 420 }}
      />

      {loading && <LinearProgress sx={{ mb: 3 }} />}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {!loading && !error && visible.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t('reports.index.noMatches', 'No report matches “{{term}}”.', { term: search })}
        </Typography>
      )}

      <Stack spacing={4}>
        {categories.map((category) => (
          <Box key={category}>
            <Typography
              variant="overline"
              sx={{ color: 'text.secondary', letterSpacing: '0.08em', display: 'block', mb: 1.5 }}
            >
              {t(
                `reports.index.categories.${category}`,
                CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ')
              )}
            </Typography>

            <Grid container spacing={2}>
              {visible
                .filter((entry) => entry.category === category)
                .map((entry) => (
                  <Grid key={entry.code} size={{ xs: 12, sm: 6, md: 4 }}>
                    <ButtonBase
                      component={RouterLink}
                      href={`/app/reports/${entry.code}`}
                      sx={{ width: 1, textAlign: 'left', borderRadius: 2 }}
                    >
                      <Card
                        variant="outlined"
                        sx={{
                          width: 1,
                          height: 1,
                          transition: (theme) => theme.transitions.create('border-color'),
                          '&:hover': { borderColor: 'primary.main' },
                        }}
                      >
                        <CardContent sx={{ py: 2 }}>
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                          >
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="subtitle2" sx={{ mb: 0.25 }}>
                                {entry.name}
                              </Typography>
                              <Typography
                                variant="caption"
                                sx={{ color: 'text.disabled', fontFamily: 'monospace' }}
                              >
                                {entry.code}
                              </Typography>
                            </Box>
                            <ChevronRightIcon fontSize="small" sx={{ color: 'text.disabled' }} />
                          </Stack>
                        </CardContent>
                      </Card>
                    </ButtonBase>
                  </Grid>
                ))}
            </Grid>
          </Box>
        ))}
      </Stack>
    </DashboardContent>
  );
}

export default ReportsIndexPage;
