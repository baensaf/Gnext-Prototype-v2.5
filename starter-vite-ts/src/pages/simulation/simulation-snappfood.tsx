import { useTranslation } from 'react-i18next';

import { Card, Alert, Stack, Container, Typography } from '@mui/material';

export function SimulationSnappfoodPage() {
  const { t } = useTranslation();

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Alert severity="info" icon={false}>
          <Typography variant="subtitle2" dir="ltr">
            SIMULATED ENVIRONMENT
          </Typography>
          {t('simulation.snappfoodNotice', 'Snappfood Webhook Simulator & Integration Testing Console')}
        </Alert>

        <Card sx={{ p: 4 }}>
          <Typography variant="h5" sx={{ mb: 2 }}>
            {t('simulation.snappfoodTitle', 'Snappfood Integration Webhook Test Bench')}
          </Typography>
          <Typography color="text.secondary">
            {t('simulation.snappfoodDesc', 'Simulate incoming Snappfood webhooks, order creation events, HMAC signature validation, and duplicate rejection scenarios.')}
          </Typography>
        </Card>
      </Stack>
    </Container>
  );
}

export default SimulationSnappfoodPage;
