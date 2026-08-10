import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router';

import PrintIcon from '@mui/icons-material/Print';
import CancelIcon from '@mui/icons-material/Cancel';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  Card,
  Grid,
  Chip,
  Table,
  Paper,
  Alert,
  Stack,
  Button,
  Divider,
  TableRow,
  Container,
  TableBody,
  TableCell,
  TableHead,
  Typography,
  TableContainer,
  CircularProgress,
} from '@mui/material';

export function OrdersDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadOrder() {
      try {
        setLoading(true);
        const res = await fetch(`/api/v1/orders/${id}`);
        if (!res.ok) throw new Error(`Order ${id} not found`);
        const data = await res.json();
        setOrder(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load order details');
      } finally {
        setLoading(false);
      }
    }
    if (id) loadOrder();
  }, [id]);

  if (loading) {
    return (
      <Container sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error || !order) {
    return (
      <Container sx={{ py: 4 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/orders')} sx={{ mb: 2 }}>
          {t('common.back', 'Back to Orders')}
        </Button>
        <Alert severity="error">{error || 'Order detail not found'}</Alert>
      </Container>
    );
  }

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack sx={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/app/orders')}>
            {t('common.back', 'Back')}
          </Button>
          <Typography variant="h4">
            {t('orders.detailTitle', 'Order')} <span dir="ltr">#{order.order_number || id}</span>
          </Typography>
          <Chip label={order.status || 'SUBMITTED'} color="primary" />
        </Stack>
        <Stack sx={{ flexDirection: 'row', gap: 1 }}>
          <Button variant="outlined" startIcon={<PrintIcon />}>
            {t('common.reprint', 'Reprint Receipt')}
          </Button>
          {order.status !== 'CANCELLED' && (
            <Button variant="contained" color="error" startIcon={<CancelIcon />}>
              {t('common.cancelOrder', 'Cancel Order')}
            </Button>
          )}
        </Stack>
      </Stack>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card sx={{ p: 3, mb: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {t('orders.itemsTitle', 'Order Items')}
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('orders.product', 'Product')}</TableCell>
                    <TableCell align="right">{t('orders.qty', 'Qty')}</TableCell>
                    <TableCell align="right">{t('orders.unitPrice', 'Unit Price')}</TableCell>
                    <TableCell align="right">{t('orders.total', 'Total')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(order.items || []).map((item: any, idx: number) => (
                    <TableRow key={idx}>
                      <TableCell>{item.product_name || item.name || 'Item'}</TableCell>
                      <TableCell align="right">{item.quantity || 1}</TableCell>
                      <TableCell align="right"><span dir="ltr">{parseFloat(item.unit_price || 0).toLocaleString()} IRR</span></TableCell>
                      <TableCell align="right"><span dir="ltr">{parseFloat(item.line_total || item.total_amount || 0).toLocaleString()} IRR</span></TableCell>
                    </TableRow>
                  ))}
                  {(!order.items || order.items.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={4} align="center">
                        {t('common.noData', 'No items recorded for this order.')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              {t('orders.summary', 'Order Summary')}
            </Typography>
            <Stack spacing={1.5}>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('orders.subtotal', 'Subtotal')}</Typography>
                <Typography dir="ltr">{parseFloat(order.subtotal_amount || 0).toLocaleString()} IRR</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('orders.tax', 'Tax (9%)')}</Typography>
                <Typography dir="ltr">{parseFloat(order.tax_amount || 0).toLocaleString()} IRR</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('orders.discount', 'Discount')}</Typography>
                <Typography dir="ltr">{parseFloat(order.discount_amount || 0).toLocaleString()} IRR</Typography>
              </Stack>
              <Divider />
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography variant="subtitle1">{t('orders.totalAmount', 'Total Amount')}</Typography>
                <Typography variant="subtitle1" dir="ltr">{parseFloat(order.total_amount || 0).toLocaleString()} IRR</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="success.main">{t('orders.paidAmount', 'Paid Amount')}</Typography>
                <Typography color="success.main" dir="ltr">{parseFloat(order.paid_amount || 0).toLocaleString()} IRR</Typography>
              </Stack>
            </Stack>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}

export default OrdersDetailPage;
