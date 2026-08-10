import { useTranslation } from 'react-i18next';

import { Card, Alert, Stack, Container, Typography } from '@mui/material';

export function SimulationLogsPage() {
  const { t } = useTranslation();

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack spacing={3}>
        <Alert severity="info" icon={false}>
          <Typography variant="subtitle2" dir="ltr">
            SIMULATED ENVIRONMENT
          </Typography>
          {t('simulation.logsNotice', 'Integration Execution & Webhook Audit Logs')}
        </Alert>

        <Card sx={{ p: 4 }}>
          <Typography variant="h5" sx={{ mb: 2 }}>
            {t('simulation.logsTitle', 'Integration Event Logs')}
          </Typography>
          <Typography color="text.secondary">
            {t('simulation.logsDesc', 'Real-time inspection of external provider payloads, HMAC verification logs, and webhook status codes.')}
          </Typography>
        </Card>
      </Stack>
    </Container>
  );
}

export default SimulationLogsPage;
