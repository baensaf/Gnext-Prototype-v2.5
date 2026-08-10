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

export function ShiftDetailPage() {
  const { shiftId } = useParams<{ shiftId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 2, mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/cashier/shifts')}>
          {t('common.back', 'Back to Shifts')}
        </Button>
        <Typography variant="h4">
          {t('cashier.shiftDetail', 'Shift Detail')} <span dir="ltr">#{shiftId}</span>
        </Typography>
        <Chip label="CLOSED" color="primary" />
      </Stack>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {t('cashier.shiftSummary', 'Shift Balances')}
            </Typography>
            <Stack spacing={1.5}>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('cashier.openingFloat', 'Opening Float')}:</Typography>
                <Typography dir="ltr">50,000 IRR</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('cashier.expectedCash', 'Expected Cash')}:</Typography>
                <Typography dir="ltr">159,000 IRR</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('cashier.actualCash', 'Actual Cash')}:</Typography>
                <Typography dir="ltr">159,000 IRR</Typography>
              </Stack>
            </Stack>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}

export default ShiftDetailPage;
