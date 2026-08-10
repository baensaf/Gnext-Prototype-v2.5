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

export function SettlementDetailPage() {
  const { settlementId } = useParams<{ settlementId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 2, mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/delivery/settlements')}>
          {t('common.back', 'Back to Settlements')}
        </Button>
        <Typography variant="h4">
          {t('settlements.detailTitle', 'Courier Settlement')} <span dir="ltr">#{settlementId}</span>
        </Typography>
        <Chip label="CLOSED" color="primary" />
      </Stack>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {t('settlements.summary', 'Settlement Summary')}
            </Typography>
            <Stack spacing={1.5}>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('settlements.expectedCash', 'Expected Cash')}:</Typography>
                <Typography dir="ltr">100,000 IRR</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('settlements.actualCash', 'Actual Cash')}:</Typography>
                <Typography dir="ltr">100,000 IRR</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('settlements.variance', 'Variance')}:</Typography>
                <Typography dir="ltr">0 IRR</Typography>
              </Stack>
            </Stack>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}

export default SettlementDetailPage;
