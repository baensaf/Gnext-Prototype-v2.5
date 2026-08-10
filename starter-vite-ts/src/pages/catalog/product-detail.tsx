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

export function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 2, mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/catalog/products')}>
          {t('common.back', 'Back to Products')}
        </Button>
        <Typography variant="h4">
          {t('catalog.productDetail', 'Product Details')}
        </Typography>
        <Chip label="ACTIVE" color="success" />
      </Stack>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {t('catalog.info', 'Product Configuration')}
            </Typography>
            <Stack spacing={1.5}>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('catalog.productId', 'Product ID')}:</Typography>
                <Typography dir="ltr">{productId}</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('catalog.name', 'Product Name')}:</Typography>
                <Typography>Espresso Double</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('catalog.unitPrice', 'Base Price')}:</Typography>
                <Typography dir="ltr">50,000 IRR</Typography>
              </Stack>
            </Stack>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}

export default ProductDetailPage;
