import { useTranslation } from 'react-i18next';

import { Card, Alert, Stack, Container, Typography } from '@mui/material';

export function SimulationPaymentsPrintersPage() {
  const { t } = useTranslation();

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Alert severity="info" icon={false}>
          <Typography variant="subtitle2" dir="ltr">
            SIMULATED ENVIRONMENT
          </Typography>
          {t('simulation.hardwareNotice', 'Payment POS Devices & Kitchen Printer Hardware Simulation Console')}
        </Alert>

        <Card sx={{ p: 4 }}>
          <Typography variant="h5" sx={{ mb: 2 }}>
            {t('simulation.hardwareTitle', 'Hardware Failure & Response Simulator')}
          </Typography>
          <Typography color="text.secondary">
            {t('simulation.hardwareDesc', 'Simulate mobile POS timeouts, paper-out printer errors, network drops, and device failover rerouting.')}
          </Typography>
        </Card>
      </Stack>
    </Container>
  );
}

export default SimulationPaymentsPrintersPage;
