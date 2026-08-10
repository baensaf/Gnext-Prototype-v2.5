import { useParams, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Container,
  Typography,
  Button,
  Card,
  Grid,
  Stack,
  Chip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

export function CampaignDetailPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 2, mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/discounts/campaigns')}>
          {t('common.back', 'Back to Campaigns')}
        </Button>
        <Typography variant="h4">
          {t('discounts.campaignDetail', 'Discount Campaign')}
        </Typography>
        <Chip label="ACTIVE" color="success" />
      </Stack>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {t('discounts.campaignRules', 'Campaign Rules & Limits')}
            </Typography>
            <Stack spacing={1.5}>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('discounts.campaignId', 'Campaign ID')}:</Typography>
                <Typography dir="ltr">{campaignId}</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('discounts.name', 'Campaign Name')}:</Typography>
                <Typography>Summer Special 15%</Typography>
              </Stack>
            </Stack>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}

export default CampaignDetailPage;
