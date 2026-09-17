import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useNavigate } from 'react-router';

import PrintIcon from '@mui/icons-material/Print';
import CancelIcon from '@mui/icons-material/Cancel';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import {
  Box,
  Card,
  Grid,
  Chip,
  Link,
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

import { paths } from 'src/routes/paths';

import { MoneyUtil } from 'src/utils/money.util';
import { fDateTime } from 'src/utils/format-time';

import { httpClient as axios } from 'src/api/httpClient';
import { useWorkspaceScope } from 'src/contexts/branch-context';
import { canReachPath, fitsWorkspace } from 'src/config/role-access';
import { useAuthStore, useIsHeadOffice } from 'src/store/useAuthStore';

import { MoadianOrderPanel } from 'src/components/moadian/moadian-order-panel';

export function OrdersDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  // Refunds are handed back at the branch; head office looks the order up but does not
  // get a button into a desk its menu does not have.
  const canRefundHere = fitsWorkspace('/app/refunds', useWorkspaceScope());
  // A name links to its profile only for an account the router would let through to it:
  // customers and accounts are head office's, couriers their branch's.
  const role = useAuthStore((state) => state.user?.role);
  const isHeadOffice = useIsHeadOffice();
  const canOpen = (path: string) => canReachPath(role, path, isHeadOffice);

  useEffect(() => {
    async function loadOrder() {
      try {
        setLoading(true);
        const res = await axios.get(`/api/v1/orders/${id}`);
        setOrder(res.data);
      } catch (err: any) {
        setError(err.detail || err.message || 'Order not found');
      } finally {
        setLoading(false);
      }
    }
    if (id) loadOrder();
  }, [id]);

  if (loading) {
    return (
      <Container sx={{ py: 5, textAlign: 'center' }}>
        <CircularProgress />
      </Container>
    );
  }

  if (error || !order) {
    return (
      <Container sx={{ py: 3 }}>
        <Alert severity="error">{error || 'Order could not be loaded'}</Alert>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)} sx={{ mt: 2 }}>
          {t('common.back', 'Back')}
        </Button>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack sx={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(-1)}>
          {t('common.back', 'Back')}
        </Button>
        <Stack sx={{ flexDirection: 'row', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<PrintIcon />}
            onClick={() => navigate(`/app/pos/receipt/${order.id}`)}
          >
            {t('orders.printReceipt', 'Thermal Receipt')}
          </Button>
          {/* Snappfood took the customer's money and refunds it itself. */}
          {canRefundHere && order.channel !== 'AGGREGATOR' && ['SUBMITTED', 'PENDING', 'ACCEPTED'].includes(order.state) && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<CancelIcon />}
              onClick={() => navigate(`/app/refunds`)}
            >
              {t('orders.refundCancel', 'Refund / Cancel')}
            </Button>
          )}
        </Stack>
      </Stack>

      <Card sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Typography variant="caption" color="text.secondary">
              {t('orders.orderNumber', 'Order Number')}
            </Typography>
            <Typography variant="h6">{order.order_number}</Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Typography variant="caption" color="text.secondary">
              {t('orders.type', 'Order Type')}
            </Typography>
            <Typography variant="h6">{order.order_type}</Typography>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Typography variant="caption" color="text.secondary">
              {t('orders.status', 'Status')}
            </Typography>
            <Box sx={{ mt: 0.5 }}>
              <Chip label={order.state} color="primary" />
            </Box>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Typography variant="caption" color="text.secondary">
              {t('orders.placedAt', 'Placed At')}
            </Typography>
            <Typography variant="body1">
              {order.placed_at ? fDateTime(order.placed_at) : '-'}
            </Typography>
          </Grid>
        </Grid>
      </Card>

      <Card sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          {t('orders.people.title')}
        </Typography>
        <Grid container spacing={2}>
          {[
            {
              key: 'customer',
              label: t('orders.people.customer'),
              name: order.people?.customer
                ? `${order.people.customer.first_name || ''} ${order.people.customer.last_name || ''}`.trim() ||
                  order.people.customer.code
                : null,
              href: order.people?.customer ? paths.app.customers.detail(order.people.customer.id) : null,
              empty: t('orders.people.noCustomer'),
            },
            {
              key: 'takenBy',
              label: t('orders.people.takenBy'),
              name: order.people?.taken_by
                ? order.people.taken_by.display_name || order.people.taken_by.username
                : null,
              href: order.people?.taken_by ? paths.app.settings.userDetail(order.people.taken_by.id) : null,
              empty: t('orders.people.notRecorded'),
            },
            ...(order.order_type === 'DELIVERY' || order.people?.courier
              ? [
                  {
                    key: 'courier',
                    label: t('orders.people.courier'),
                    name: order.people?.courier?.name ?? null,
                    href: order.people?.courier ? paths.app.delivery.courierDetail(order.people.courier.id) : null,
                    empty: t('orders.people.noCourier'),
                  },
                ]
              : []),
          ].map((person) => (
            <Grid key={person.key} size={{ xs: 12, sm: 4 }}>
              <Typography variant="caption" color="text.secondary">
                {person.label}
              </Typography>
              {person.name && person.href && canOpen(person.href) ? (
                <Link
                  component="button"
                  variant="subtitle1"
                  onClick={() => navigate(person.href!)}
                  sx={{ display: 'block', textAlign: 'start' }}
                >
                  {person.name}
                </Link>
              ) : (
                <Typography variant="subtitle1" color={person.name ? 'text.primary' : 'text.secondary'}>
                  {person.name || person.empty}
                </Typography>
              )}
            </Grid>
          ))}
        </Grid>
      </Card>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Card sx={{ p: 3 }}>
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
                      <TableCell align="right"><span dir="ltr">{MoneyUtil.formatCurrency(item.unit_price || '0')} IRR</span></TableCell>
                      <TableCell align="right"><span dir="ltr">{MoneyUtil.formatCurrency(item.line_total || item.total_amount || '0')} IRR</span></TableCell>
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
                <Typography dir="ltr">{MoneyUtil.formatCurrency(order.subtotal_amount || '0')} IRR</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('orders.tax', 'Tax (9%)')}</Typography>
                <Typography dir="ltr">{MoneyUtil.formatCurrency(order.tax_amount || '0')} IRR</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="text.secondary">{t('orders.discount', 'Discount')}</Typography>
                <Typography dir="ltr">{MoneyUtil.formatCurrency(order.discount_amount || '0')} IRR</Typography>
              </Stack>
              <Divider />
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography variant="subtitle1">{t('orders.totalAmount', 'Total Amount')}</Typography>
                <Typography variant="subtitle1" dir="ltr">{MoneyUtil.formatCurrency(order.total_amount || '0')} IRR</Typography>
              </Stack>
              <Stack sx={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Typography color="success.main">{t('orders.paidAmount', 'Paid Amount')}</Typography>
                <Typography color="success.main" dir="ltr">{MoneyUtil.formatCurrency(order.paid_amount || '0')} IRR</Typography>
              </Stack>
            </Stack>
          </Card>
        </Grid>

        <Grid size={{ xs: 12 }}>
          <MoadianOrderPanel orderId={order.id} orderState={order.state} />
        </Grid>
      </Grid>
    </Container>
  );
}

export default OrdersDetailPage;
