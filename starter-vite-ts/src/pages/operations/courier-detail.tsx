import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router';

import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  Card,
  Grid,
  Chip,
  Stack,
  Button,
  Container,
  Typography,
} from '@mui/material';

export function CourierDetailPage() {
  const { courierId } = useParams<{ courierId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 2, mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/delivery/couriers')}>
          {t('common.back', 'Back to Couriers')}
        </Button>
        <Typography variant="h4">
          {t('delivery.courierDetail', 'Courier Profile')}
        </Typography>
        <Chip label="ACTIVE" color="success" />
      </Stack>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {t('delivery.courierInfo', 'Courier Details')}
            </Typography>
            <Stack spacing={1.5}>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('delivery.courierId', 'Courier ID')}:</Typography>
                <Typography dir="ltr">{courierId}</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('delivery.courierName', 'Name')}:</Typography>
                <Typography>Ali Rezaei</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('delivery.phone', 'Phone')}:</Typography>
                <Typography dir="ltr">+98 912 345 6789</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('delivery.vehicle', 'Vehicle')}:</Typography>
                <Typography>Motorcycle (Tehran 12 - 345 A 67)</Typography>
              </Stack>
            </Stack>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}

export default CourierDetailPage;
