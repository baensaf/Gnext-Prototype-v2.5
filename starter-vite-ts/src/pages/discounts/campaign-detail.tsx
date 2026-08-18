import type { DiscountCampaign } from '../../api/discountsApi';

import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router';
import { useState, useEffect, useCallback } from 'react';

import RuleIcon from '@mui/icons-material/Rule';
import LayersIcon from '@mui/icons-material/Layers';
import RefreshIcon from '@mui/icons-material/Refresh';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import {
  Box,
  Card,
  Grid,
  Chip,
  Stack,
  Table,
  Alert,
  Button,
  Divider,
  TableRow,
  TableBody,
  TableCell,
  TableHead,
  Container,
  Typography,
  IconButton,
  CardHeader,
  CardContent,
  CircularProgress,
} from '@mui/material';

import { discountsApi } from '../../api/discountsApi';

export function CampaignDetailPage() {
  const params = useParams<{ id?: string; campaignId?: string }>();
  const id = params.id || params.campaignId;
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [campaign, setCampaign] = useState<DiscountCampaign | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCampaign = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await discountsApi.getDiscountById(id);
      setCampaign(data);
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to load campaign');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchCampaign();
  }, [fetchCampaign]);

  if (loading) {
    return (
      <Container maxWidth="xl" sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error || !campaign) {
    return (
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/discounts/campaigns')} sx={{ mb: 2 }}>
          {t('common.back', 'Back to Campaigns')}
        </Button>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || t('discounts.notFound', 'Campaign not found')}
        </Alert>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={fetchCampaign}>
          {t('common.retry', 'Retry')}
        </Button>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Stack sx={{ flexDirection: { xs: 'column', sm: 'row' }, alignItems: { sm: 'center' }, justifyContent: 'space-between', gap: 2, mb: 3 }}>
        <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/discounts/campaigns')}>
            {t('common.back', 'Back')}
          </Button>
          <Box>
            <Typography variant="h4" sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              {campaign.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" dir="ltr">
              {t('discounts.code', 'Code')}: <strong>{campaign.code}</strong> | ID: {campaign.id}
            </Typography>
          </Box>
        </Stack>
        <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
          <Chip
            label={campaign.is_active ? t('common.active', 'ACTIVE') : t('common.inactive', 'INACTIVE')}
            color={campaign.is_active ? 'success' : 'default'}
            variant="filled"
          />
          <Chip
            label={campaign.discount_type}
            color="primary"
            variant="outlined"
          />
          <IconButton onClick={fetchCampaign} title={t('common.refresh', 'Refresh')}>
            <RefreshIcon />
          </IconButton>
        </Stack>
      </Stack>

      <Grid container spacing={3}>
        {/* Campaign Configuration */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardHeader
              avatar={<LocalOfferIcon color="primary" />}
              title={t('discounts.campaignRules', 'Discount Rules & Value')}
            />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('discounts.type', 'Discount Type')}:</Typography>
                  <Typography sx={{ fontWeight: 600 }}>{campaign.discount_type}</Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('discounts.value', 'Value')}:</Typography>
                  <Typography sx={{ fontWeight: 600, color: 'primary.main' }}>
                    {campaign.discount_type === 'PERCENTAGE'
                      ? `${campaign.percentage}%`
                      : campaign.discount_type === 'FIXED_AMOUNT'
                      ? `${Number(campaign.amount || 0).toLocaleString()} ${campaign.currency_code || 'IRR'}`
                      : campaign.discount_type}
                  </Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('discounts.minSubtotal', 'Minimum Subtotal')}:</Typography>
                  <Typography>
                    {campaign.minimum_subtotal
                      ? `${Number(campaign.minimum_subtotal).toLocaleString()} ${campaign.currency_code || 'IRR'}`
                      : t('common.none', 'None')}
                  </Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('discounts.maxDiscount', 'Max Discount Cap')}:</Typography>
                  <Typography>
                    {campaign.maximum_discount_amount
                      ? `${Number(campaign.maximum_discount_amount).toLocaleString()} ${campaign.currency_code || 'IRR'}`
                      : t('common.unlimited', 'Unlimited')}
                  </Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('discounts.fundingSource', 'Funding Source')}:</Typography>
                  <Typography>{campaign.funding_source || 'MERCHANT'}</Typography>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Stacking & Usage Controls */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardHeader
              avatar={<LayersIcon color="secondary" />}
              title={t('discounts.stackingLimits', 'Stacking & Usage Limits')}
            />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('discounts.priority', 'Priority')}:</Typography>
                  <Typography sx={{ fontWeight: 600 }}>{campaign.priority}</Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('discounts.stackingGroup', 'Stacking Group')}:</Typography>
                  <Chip size="small" label={campaign.stacking_group || 'DEFAULT'} />
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('discounts.isStackable', 'Can Stack')}:</Typography>
                  <Typography>{campaign.is_stackable ? t('common.yes', 'Yes') : t('common.no', 'No (Exclusive)')}</Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('discounts.couponRequired', 'Coupon Required')}:</Typography>
                  <Typography>{campaign.coupon_required ? t('common.yes', 'Yes') : t('common.no', 'No (Automatic)')}</Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('discounts.usageCount', 'Times Redeemed')}:</Typography>
                  <Typography sx={{ fontWeight: 600 }}>{campaign.usage_count || 0}</Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('discounts.usageTotalLimit', 'Global Limit')}:</Typography>
                  <Typography>{campaign.usage_limit_total ? campaign.usage_limit_total.toLocaleString() : t('common.unlimited', 'Unlimited')}</Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('discounts.perCustomerLimit', 'Per-Customer Limit')}:</Typography>
                  <Typography>{campaign.usage_limit_per_customer || t('common.unlimited', 'Unlimited')}</Typography>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Schedule & Effective Dates */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
            <CardHeader
              avatar={<ScheduleIcon color="info" />}
              title={t('discounts.schedule', 'Validity & Schedule')}
            />
            <Divider />
            <CardContent>
              <Stack spacing={2}>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('discounts.effectiveFrom', 'Effective From')}:</Typography>
                  <Typography dir="ltr">{campaign.effective_from ? new Date(campaign.effective_from).toLocaleString() : t('common.immediately', 'Immediately')}</Typography>
                </Stack>
                <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">{t('discounts.effectiveTo', 'Effective Until')}:</Typography>
                  <Typography dir="ltr">{campaign.effective_to ? new Date(campaign.effective_to).toLocaleString() : t('common.never', 'Never (Ongoing)')}</Typography>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        {/* Scopes & Eligibility Criteria */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardHeader
              avatar={<RuleIcon color="action" />}
              title={t('discounts.scopes', 'Target Scopes & Exclusions')}
              subheader={t('discounts.scopesSubtitle', 'Branches, Channels, Categories, Products, and Customer segments')}
            />
            <Divider />
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('discounts.scopeType', 'Scope Type')}</TableCell>
                  <TableCell>{t('discounts.targetId', 'Target Identifier')}</TableCell>
                  <TableCell>{t('discounts.rule', 'Rule')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {campaign.scopes && campaign.scopes.length > 0 ? (
                  campaign.scopes.map((scope) => (
                    <TableRow key={scope.id}>
                      <TableCell>
                        <Chip size="small" label={scope.scope_type} variant="outlined" />
                      </TableCell>
                      <TableCell dir="ltr">
                        {scope.scope_id || t('discounts.allTargets', 'All')}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={scope.is_exclusion ? t('discounts.exclude', 'EXCLUDE') : t('discounts.include', 'INCLUDE')}
                          color={scope.is_exclusion ? 'error' : 'success'}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                      {t('discounts.noScopes', 'No specific scope filters applied (Campaign applies globally).')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}

export default CampaignDetailPage;
