import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import RefreshIcon from '@mui/icons-material/Refresh';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import {
  Box,
  Tab,
  Card,
  Grid,
  Chip,
  Tabs,
  Alert,
  Stack,
  Table,
  Button,
  Select,
  Dialog,
  Divider,
  MenuItem,
  TableRow,
  Accordion,
  TableBody,
  TableCell,
  TableHead,
  TextField,
  Typography,
  InputLabel,
  FormControl,
  DialogTitle,
  DialogContent,
  DialogActions,
  TableContainer,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';

import { RouterLink } from 'src/routes/components';

import { fTime } from 'src/utils/format-time';

import { httpClient as axios } from 'src/api/httpClient';
import { tenantApi, type Branch } from 'src/api/tenantApi';

import { CustomBreadcrumbs } from 'src/components/custom-breadcrumbs';

export function SimulationSnappfoodPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [logs, setLogs] = useState<any[]>([]);
  const [selectedLog, setSelectedLog] = useState<any>(null);

  // --- 1. OAuth2 State ---
  const [authEnv, setAuthEnv] = useState<'staging' | 'production'>('staging');
  const [clientId, setClientId] = useState<string>('sf_vendor_client_001');
  const [clientSecret, setClientSecret] = useState<string>('sf_sec_key_xyz987');
  const [username, setUsername] = useState<string>('restaurant_admin');
  const [password, setPassword] = useState<string>('password123');
  const [tokenResponse, setTokenResponse] = useState<any>(null);

  // --- 2. Webhook Generator (v4.3.0) State ---
  const [customerName, setCustomerName] = useState<string>('حمید بیانک');
  const [customerPhone, setCustomerPhone] = useState<string>('+989991111111');
  const [deliverAddress, setDeliverAddress] = useState<string>('تهران، زعفرانیه، ولیعصر، پلاک ۲');
  const [expeditionType, setExpeditionType] = useState<string>('DELIVERY');
  // 0 leaves the bill to the server, which prices a basket of real menu items.
  const [price, setPrice] = useState<number>(0);
  const [paidPrice, setPaidPrice] = useState<number>(0);
  const [otherDiscounts] = useState<number>(0);
  const [notes, setNotes] = useState<string>('غذا داخل باکس قرار داده شود - اردر تست');
  const [bikerName, setBikerName] = useState<string>('علی تهرانی');
  const [bikerStatusV2, setBikerStatusV2] = useState<string>('REQUESTED');
  const [couponType, setCouponType] = useState<string>('none');
  const [generatedResult, setGeneratedResult] = useState<any>(null);
  // Empty means the backend picks the first restaurant, as it did before there was a choice.
  const [webhookBranchId, setWebhookBranchId] = useState<string>('');
  const [restaurants, setRestaurants] = useState<Branch[]>([]);

  // --- 3. Order Action Stepper State ---
  const [orderCode, setOrderCode] = useState<string>('SF-1001');
  const [currentStatus, setCurrentStatus] = useState<number>(56);
  const [declineReasonId, setDeclineReasonId] = useState<number>(113);
  const [rejectComment, setRejectComment] = useState<string>('پیک در حال حاضر در دسترس نیست');
  const [acceptDeliveryTime, setAcceptDeliveryTime] = useState<number>(30);
  const [acceptRiderPickupTime, setAcceptRiderPickupTime] = useState<number>(15);
  const [acceptDelta, setAcceptDelta] = useState<number>(0);
  const [actionResponse, setActionResponse] = useState<any>(null);

  // --- 4. Vendor Automation API Bench State ---
  const [apiEndpoint, setApiEndpoint] = useState<string>('GET_CATALOG');
  const [syncCategoryId, setSyncCategoryId] = useState<number>(100);
  const [syncCategoryCode, setSyncCategoryCode] = useState<string>('qz4P2lplwD');
  const [syncProductId, setSyncProductId] = useState<number>(12345);
  const [syncProductCode, setSyncProductCode] = useState<string>('BAxxxxV1y');
  const [apiResponse, setApiResponse] = useState<any>(null);

  const fetchLogs = async () => {
    try {
      const res = await axios.get('/api/v1/simulation/logs?provider=SNAPPFOOD');
      setLogs(res.data || []);
    } catch (err) {
      console.error('Failed to fetch simulation logs:', err);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  // Snappfood registers one webhook per branch; the simulator picks which one it calls.
  useEffect(() => {
    tenantApi
      .getBranches()
      .then((list) =>
        setRestaurants(list.filter((b) => b.is_active && (b.branch_type ?? 'RESTAURANT') === 'RESTAURANT'))
      )
      .catch(() => setRestaurants([]));
  }, []);

  // Handler: Request OAuth Token
  const handleRequestToken = async (simulatedError?: number) => {
    setLoading(true);
    try {
      if (simulatedError) {
        setTokenResponse({
          status: simulatedError,
          error: simulatedError === 3001 ? 'invalid_grant' : 'unauthorized_client',
          message: `Simulated OAuth2 Error Code ${simulatedError}: Token is invalid or client unauthorized.`,
        });
        return;
      }
      const res = await axios.post('/api/v1/simulation/snappfood/token', {
        grant_type: 'password',
        scope: 'automation',
        client_id: clientId,
        client_secret: clientSecret,
        username,
        password,
      });
      setTokenResponse(res.data);
    } catch (err: any) {
      setTokenResponse(err.response?.data || { error: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Handler: Generate Order Webhook (v4.3.0)
  const handleGenerateWebhook = async () => {
    setLoading(true);
    try {
      let orderCoupon = null;
      if (couponType === 'extra_item') {
        orderCoupon = {
          rewardCode: 'extra_item',
          title: 'نوشابه رایگان',
          description: 'برای اولین سفارش از این رستوران',
          rewardParams: { item: 'نوشابه رایگان', VmsFoodId: 101 },
        };
      } else if (couponType === 'free_delivery_fee') {
        orderCoupon = {
          rewardCode: 'free_delivery_fee',
          title: 'ارسال رایگان',
          description: 'تخفیف پیک اسنپ‌فود',
          rewardParams: { delivery_fee: 1, sf_share: 100 },
        };
      } else if (couponType === 'total_discount') {
        orderCoupon = {
          rewardCode: 'total_discount',
          title: 'تخفیف ۲۵٪',
          description: 'تخفیف کل سفارش',
          rewardParams: { total: 25, max_discount_amount: 30000, sf_share: 0 },
        };
      }

      const res = await axios.post('/api/v1/simulation/snappfood/orders', {
        customer_name: customerName,
        customer_phone: customerPhone,
        address: deliverAddress,
        expeditionType,
        price,
        paidPrice,
        otherDiscounts,
        notes,
        bikerName,
        bikerStatusV2,
        orderCoupon,
        branch_id: webhookBranchId || undefined,
      });
      setGeneratedResult(res.data);
      if (res.data?.order?.order_number) {
        const cleanCode = res.data.order.order_number.replace('SNP-', '');
        setOrderCode(cleanCode);
        setCurrentStatus(56);
      }
      fetchLogs();
    } catch (err: any) {
      alert('Error generating webhook: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  // Handler: Replay Duplicate Webhook
  const handleReplayDuplicate = async () => {
    if (!generatedResult?.log_id) {
      alert('Generate a webhook order first to replay!');
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post('/api/v1/simulation/snappfood/duplicates', {
        sourceWebhookReceiptId: generatedResult.log_id,
      });
      setGeneratedResult(res.data);
      fetchLogs();
    } catch (err: any) {
      alert('Error replaying duplicate: ' + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  // Handler: Execute Order Lifecycle Action (ACK, PICK, ACCEPT, REJECT, CANCEL)
  const handleExecuteAction = async (action: 'ACK' | 'PICK' | 'ACCEPT' | 'REJECT' | 'CANCEL' | 'MODIFY') => {
    setLoading(true);
    try {
      let res;
      if (action === 'ACK') {
        res = await axios.post(`/api/v1/simulation/snappfood/va/v1/order/${orderCode}/ack`);
      } else if (action === 'PICK') {
        res = await axios.post(`/api/v1/simulation/snappfood/va/v1/order/${orderCode}/pick`);
      } else if (action === 'ACCEPT') {
        res = await axios.post(`/api/v1/simulation/snappfood/va/v1/order/${orderCode}/accept`, {
          packingPrice: 200,
          delta: acceptDelta,
          deliveryTime: acceptDeliveryTime,
          riderPickupTime: acceptRiderPickupTime,
        });
      } else if (action === 'REJECT') {
        res = await axios.post(`/api/v1/simulation/snappfood/va/v1/order/${orderCode}/reject`, {
          reasonId: declineReasonId,
          comment: rejectComment,
        });
      } else {
        res = await axios.post(`/api/v1/simulation/snappfood/orders/${orderCode}/action`, { action });
      }

      setActionResponse(res.data);
      if (res.data?.statusCode) {
        setCurrentStatus(res.data.statusCode);
      }
      fetchLogs();
    } catch (err: any) {
      setActionResponse(err.response?.data || { error: err.message });
      alert('Action error: ' + (err.response?.data?.detail || err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  // Handler: Snappfood support answering an order the store rejected or reported.
  // 54 cancels it; 56 sends it back for the store to accept again with a new time.
  const handleSupportDecision = async (statusCode: 54 | 56) => {
    setLoading(true);
    try {
      const res = await axios.post(`/api/v1/simulation/snappfood/orders/${orderCode}/support`, { statusCode });
      setActionResponse(res.data);
      setCurrentStatus(statusCode);
      fetchLogs();
    } catch (err: any) {
      setActionResponse(err.response?.data || { error: err.message });
      alert('Action error: ' + (err.response?.data?.detail || err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  // Handler: Test Vendor Automation Endpoints (v4.3.0)
  const handleRunVendorApi = async () => {
    setLoading(true);
    try {
      let res;
      if (apiEndpoint === 'GET_CATALOG') {
        res = await axios.get('/api/v1/simulation/snappfood/va/v1.1/product?vendorCode=0q54rd');
      } else if (apiEndpoint === 'SYNC_CATEGORY') {
        res = await axios.post('/api/v1/simulation/snappfood/va/v1/category/sync/categoryId', {
          vendorCode: '0q54rd',
          categories: [{ categoryId: syncCategoryId, categoryCode: syncCategoryCode }],
        });
      } else if (apiEndpoint === 'SYNC_PRODUCT') {
        res = await axios.post('/api/v1/simulation/snappfood/va/v1/product/sync/productId', {
          vendorCode: '0q54rd',
          products: [{ productId: syncProductId, productCode: syncProductCode }],
        });
      } else if (apiEndpoint === 'TOGGLE_PRODUCT') {
        res = await axios.patch('/api/v1/simulation/snappfood/va/v1/product', {
          vendorCode: '0q54rd',
          products: [{ id: 8, active: true, disable: true, disableUntil: '2026-12-31' }],
        });
      } else if (apiEndpoint === 'GET_TOPPINGS') {
        res = await axios.get('/api/v1/simulation/snappfood/va/v1/topping/groups');
      } else if (apiEndpoint === 'GET_STATUS') {
        res = await axios.get('/api/v1/simulation/snappfood/va/v1/vendor/status?vendorCode=0q54rd');
      } else if (apiEndpoint === 'GET_DELIVERIES') {
        res = await axios.get('/api/v1/simulation/snappfood/va/v1/vendor/vendorDeliveries?vendorCode=0y57dp');
      } else if (apiEndpoint === 'GET_DECLINE_REASONS') {
        res = await axios.get('/api/v1/simulation/snappfood/va/v1/order/decline-reason');
      } else if (apiEndpoint === 'LATEST_ORDERS') {
        res = await axios.post('/api/v1/simulation/snappfood/va/v1/order/latest', { vendorCode: '0q54rd' });
      }
      setApiResponse(res?.data);
      fetchLogs();
    } catch (err: any) {
      setApiResponse(err.response?.data || { error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (code: number) => {
    switch (code) {
      case 56:
        return <Chip label="56: New Order" color="primary" sx={{ fontWeight: 'bold' }} />;
      case 714:
        return <Chip label="714: Sent to Store" color="info" sx={{ fontWeight: 'bold' }} />;
      case 61:
        return <Chip label="61: Received (Ack)" color="info" sx={{ fontWeight: 'bold' }} />;
      case 713:
        return <Chip label="713: Opened (Pick)" color="warning" sx={{ fontWeight: 'bold' }} />;
      case 42:
        return <Chip label="42: Accepted" color="success" sx={{ fontWeight: 'bold' }} />;
      case 51:
        return <Chip label="51: Rejected" color="error" sx={{ fontWeight: 'bold' }} />;
      case 54:
        return <Chip label="54: Cancelled" color="default" sx={{ fontWeight: 'bold' }} />;
      case 71:
        return <Chip label="71: Extra Payment" color="secondary" sx={{ fontWeight: 'bold' }} />;
      default:
        return <Chip label={`${code}: Status`} color="default" />;
    }
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <CustomBreadcrumbs
        heading={t('simulation.snappfood.title', 'Snappfood Annex v4.3.0 Console')}
        links={[
          { name: t('nav.dashboard', 'Home'), href: '/app/dashboard' },
          { name: t('simulation.breadcrumb', 'Simulation Hub'), href: '/app/simulation' },
          { name: t('simulation.snappfood.title', 'Snappfood Simulator') },
        ]}
        action={
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={fetchLogs}
            disabled={loading}
            sx={{ fontWeight: 'bold' }}
          >
            {t('simulation.hub.refreshLogs', 'Refresh Status & Logs')}
          </Button>
        }
      />

      <Stack spacing={3}>
        {/* Header Alert */}
        <Alert severity="info" icon={false} sx={{ borderLeft: '6px solid #e91e63', borderRadius: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
            <Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Chip label="v4.3.0 Ready" color="secondary" size="small" sx={{ fontWeight: 'bold' }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                  {t('simulation.snappfood.title', 'Snappfood Annex v4.3.0 Console')}
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                {t(
                  'simulation.snappfood.subtitle',
                  'Comprehensive test bench for Snappfood OAuth2 Authentication, v4.3.0 Webhooks (bikerStatusV2, paidPrice, orderCoupon), Order Status Stepper, & Vendor Automation APIs.'
                )}
              </Typography>
            </Box>
          </Box>
        </Alert>

        {/* Main Tabs */}
        <Card sx={{ borderRadius: 3, boxShadow: 3 }}>
          <Tabs
            value={activeTab}
            onChange={(_, val) => setActiveTab(val)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ borderBottom: 1, borderColor: 'divider', px: 2, pt: 1 }}
          >
            <Tab label={t('simulation.snappfood.tabs.oauth', '🔐 OAuth2 Auth & Token (/token)')} sx={{ fontWeight: 'bold' }} />
            <Tab label={t('simulation.snappfood.tabs.webhook', '🚀 Webhook Generator (v4.3.0)')} sx={{ fontWeight: 'bold' }} />
            <Tab label={t('simulation.snappfood.tabs.stepper', '🔄 Order Lifecycle Stepper')} sx={{ fontWeight: 'bold' }} />
            <Tab label={t('simulation.snappfood.tabs.vendorApi', '🛠️ Vendor Automation APIs (20+ Endpoints)')} sx={{ fontWeight: 'bold' }} />
            <Tab label={t('simulation.snappfood.tabs.logs', '📜 Integration Audit Logs')} sx={{ fontWeight: 'bold' }} />
          </Tabs>

          <Box sx={{ p: 3 }}>
            {/* TAB 0: OAUTH2 TOKEN SIMULATOR */}
            {activeTab === 0 && (
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Card sx={{ p: 3, bgcolor: 'background.neutral', borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                      {t('simulation.snappfood.oauth.cardTitle', 'OAuth2 Password Grant Simulator')}
                    </Typography>
                    <Stack spacing={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel>{t('simulation.snappfood.oauth.envLabel', 'Environment / Server Endpoint')}</InputLabel>
                        <Select value={authEnv} label={t('simulation.snappfood.oauth.envLabel', 'Environment / Server Endpoint')} onChange={(e) => setAuthEnv(e.target.value as any)}>
                          <MenuItem value="staging">{t('simulation.snappfood.oauth.staging', 'Staging (https://staging-auth.snappfood.dev/token)')}</MenuItem>
                          <MenuItem value="production">{t('simulation.snappfood.oauth.production', 'Production (https://auth.snappfood.ir/token)')}</MenuItem>
                        </Select>
                      </FormControl>
                      <TextField label={t('simulation.snappfood.oauth.clientId', 'Client ID')} size="small" value={clientId} onChange={(e) => setClientId(e.target.value)} fullWidth />
                      <TextField label={t('simulation.snappfood.oauth.clientSecret', 'Client Secret')} size="small" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} fullWidth />
                      <TextField label={t('simulation.snappfood.oauth.username', 'Username')} size="small" value={username} onChange={(e) => setUsername(e.target.value)} fullWidth />
                      <TextField label={t('simulation.snappfood.oauth.password', 'Password')} size="small" type="password" value={password} onChange={(e) => setPassword(e.target.value)} fullWidth />

                      <Box sx={{ display: 'flex', gap: 2, pt: 1, flexWrap: 'wrap' }}>
                        <Button variant="contained" color="primary" onClick={() => handleRequestToken()} disabled={loading}>
                          {t('simulation.snappfood.oauth.requestToken', 'Request Access Token')}
                        </Button>
                        <Button variant="outlined" color="error" onClick={() => handleRequestToken(3001)} disabled={loading}>
                          {t('simulation.snappfood.oauth.simulateError', 'Simulate Token Error 3001')}
                        </Button>
                      </Box>
                    </Stack>
                  </Card>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                  <Card sx={{ p: 3, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                      {t('simulation.snappfood.oauth.responseTitle', 'Token Response Output')}
                    </Typography>
                    {tokenResponse ? (
                      <Box component="pre" sx={{ p: 2, bgcolor: '#1e1e1e', color: '#00ffcc', borderRadius: 1, overflow: 'auto', fontSize: 13 }}>
                        {JSON.stringify(tokenResponse, null, 2)}
                      </Box>
                    ) : (
                      <Typography color="text.secondary">
                        {t('simulation.snappfood.oauth.noToken', 'No token requested yet. Click "Request Access Token".')}
                      </Typography>
                    )}
                  </Card>
                </Grid>
              </Grid>
            )}

            {/* TAB 1: WEBHOOK GENERATOR (v4.3.0) */}
            {activeTab === 1 && (
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 7 }}>
                  <Card sx={{ p: 3, borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                      {t('simulation.snappfood.webhook.cardTitle', 'Generate v4.3.0 Order Webhook (HMAC Signed)')}
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12 }}>
                        <FormControl fullWidth size="small">
                          <InputLabel shrink>{t('simulation.snappfood.webhook.branch', 'Receiving branch')}</InputLabel>
                          <Select
                            displayEmpty
                            notched
                            value={webhookBranchId}
                            label={t('simulation.snappfood.webhook.branch', 'Receiving branch')}
                            onChange={(e) => setWebhookBranchId(e.target.value)}
                          >
                            <MenuItem value="">{t('simulation.snappfood.webhook.branchAuto', 'Automatic (first restaurant)')}</MenuItem>
                            {restaurants.map((branch) => (
                              <MenuItem key={branch.id} value={branch.id}>
                                {branch.name}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField label={t('simulation.snappfood.webhook.customerName', 'Customer Name')} size="small" value={customerName} onChange={(e) => setCustomerName(e.target.value)} fullWidth />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField label={t('simulation.snappfood.webhook.phone', 'Phone Number')} size="small" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} fullWidth />
                      </Grid>
                      <Grid size={{ xs: 12 }}>
                        <TextField label={t('simulation.snappfood.webhook.address', 'Delivery Address')} size="small" value={deliverAddress} onChange={(e) => setDeliverAddress(e.target.value)} fullWidth />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <FormControl fullWidth size="small">
                          <InputLabel>{t('simulation.snappfood.webhook.expeditionType', 'Expedition Type')}</InputLabel>
                          <Select value={expeditionType} label={t('simulation.snappfood.webhook.expeditionType', 'Expedition Type')} onChange={(e) => setExpeditionType(e.target.value)}>
                            <MenuItem value="DELIVERY">DELIVERY</MenuItem>
                            <MenuItem value="ZF_EXPRESS">ZF_EXPRESS</MenuItem>
                            <MenuItem value="MIARE">MIARE</MenuItem>
                            <MenuItem value="PICKUP">PICKUP</MenuItem>
                            <MenuItem value="PICK_MAN">PICK_MAN</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <TextField label={t('simulation.snappfood.webhook.totalPrice', 'Total Price (Toman)')} type="number" size="small" value={price} onChange={(e) => setPrice(Number(e.target.value))} fullWidth helperText={t('simulation.snappfood.webhook.priceFromBasket', '0 = priced from the menu basket')} />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <TextField label={t('simulation.snappfood.webhook.paidPrice', 'Paid Price (Toman)')} type="number" size="small" value={paidPrice} onChange={(e) => setPaidPrice(Number(e.target.value))} fullWidth />
                      </Grid>

                      {/* v4.3.0 Biker & Coupon details */}
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <TextField label={t('simulation.snappfood.webhook.bikerName', 'Biker Name')} size="small" value={bikerName} onChange={(e) => setBikerName(e.target.value)} fullWidth />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <FormControl fullWidth size="small">
                          <InputLabel>{t('simulation.snappfood.webhook.bikerStatus', 'Biker Status V2')}</InputLabel>
                          <Select value={bikerStatusV2} label={t('simulation.snappfood.webhook.bikerStatus', 'Biker Status V2')} onChange={(e) => setBikerStatusV2(e.target.value)}>
                            <MenuItem value="REQUESTED">REQUESTED</MenuItem>
                            <MenuItem value="ASSIGNED">ASSIGNED</MenuItem>
                            <MenuItem value="ACK">ACK</MenuItem>
                            <MenuItem value="AT_RESTAURANT">AT_RESTAURANT</MenuItem>
                            <MenuItem value="PICKED">PICKED</MenuItem>
                            <MenuItem value="DELIVERED">DELIVERED</MenuItem>
                            <MenuItem value="CANCELED">CANCELED</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <FormControl fullWidth size="small">
                          <InputLabel>{t('simulation.snappfood.webhook.orderCoupon', 'Order Coupon')}</InputLabel>
                          <Select value={couponType} label={t('simulation.snappfood.webhook.orderCoupon', 'Order Coupon')} onChange={(e) => setCouponType(e.target.value)}>
                            <MenuItem value="none">{t('simulation.snappfood.webhook.noCoupon', 'No Coupon')}</MenuItem>
                            <MenuItem value="extra_item">{t('simulation.snappfood.webhook.extraItemCoupon', 'extra_item (Free Beverage / Item)')}</MenuItem>
                            <MenuItem value="free_delivery_fee">{t('simulation.snappfood.webhook.freeDeliveryCoupon', 'free_delivery_fee (Free Delivery)')}</MenuItem>
                            <MenuItem value="total_discount">{t('simulation.snappfood.webhook.totalDiscountCoupon', 'total_discount (25% Total Discount)')}</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>

                      <Grid size={{ xs: 12 }}>
                        <TextField label={t('simulation.snappfood.webhook.notes', 'Vendor Notes / Comment')} multiline rows={2} size="small" value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth />
                      </Grid>

                      <Grid size={{ xs: 12 }}>
                        <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap' }}>
                          <Button variant="contained" color="secondary" onClick={handleGenerateWebhook} disabled={loading}>
                            {t('simulation.snappfood.webhook.submit', 'Submit Webhook (Post Order)')}
                          </Button>
                          <Button variant="outlined" color="warning" onClick={handleReplayDuplicate} disabled={loading}>
                            {t('simulation.snappfood.webhook.replay', 'Replay (Test Duplicate Suppression)')}
                          </Button>
                        </Box>
                      </Grid>
                    </Grid>
                  </Card>
                </Grid>

                <Grid size={{ xs: 12, md: 5 }}>
                  <Card sx={{ p: 3, borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                      {t('simulation.snappfood.webhook.responseTitle', 'Webhook Response & Order Created')}
                    </Typography>
                    {generatedResult ? (
                      <Stack spacing={2}>
                        <Alert severity={generatedResult.duplicate ? 'warning' : 'success'}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                            {generatedResult.duplicate
                              ? t('simulation.snappfood.webhook.duplicateAlert', 'DUPLICATE WEBHOOK IGNORED (Exactly-Once Enforced)')
                              : t('simulation.snappfood.webhook.successAlert', 'ORDER CREATED SUCCESSFULLY')}
                          </Typography>
                          Log ID: {generatedResult.log_id || 'N/A'}
                        </Alert>

                        {/* Order Navigation Quick Links */}
                        {generatedResult?.order?.id && (
                          <Stack direction="row" spacing={1}>
                            <Button
                              component={RouterLink}
                              href={`/app/orders/${generatedResult.order.id}`}
                              variant="outlined"
                              size="small"
                              startIcon={<ReceiptLongIcon />}
                            >
                              {t('simulation.snappfood.webhook.viewInOrders', 'View in Orders Directory')}
                            </Button>
                            <Button
                              component={RouterLink}
                              href="/app/pos"
                              variant="outlined"
                              color="secondary"
                              size="small"
                              startIcon={<PointOfSaleIcon />}
                            >
                              {t('simulation.snappfood.webhook.openInPos', 'Open POS Register')}
                            </Button>
                          </Stack>
                        )}

                        <Box component="pre" sx={{ p: 2, bgcolor: '#1e1e1e', color: '#66ff66', borderRadius: 1, overflow: 'auto', maxHeight: 350, fontSize: 12 }}>
                          {JSON.stringify(generatedResult, null, 2)}
                        </Box>
                      </Stack>
                    ) : (
                      <Typography color="text.secondary">
                        {t('simulation.snappfood.webhook.noOrder', 'No order generated yet. Fill the form and click Submit Webhook.')}
                      </Typography>
                    )}
                  </Card>
                </Grid>
              </Grid>
            )}

            {/* TAB 2: ORDER LIFECYCLE STEPPER */}
            {activeTab === 2 && (
              <Stack spacing={3}>
                <Card sx={{ p: 3, borderRadius: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
                    <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                      {t('simulation.snappfood.stepper.title', 'Order Status Lifecycle State Machine')}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Typography variant="subtitle2">{t('simulation.snappfood.stepper.targetCode', 'Target Order Code')}:</Typography>
                      <TextField size="small" value={orderCode} onChange={(e) => setOrderCode(e.target.value)} sx={{ width: 140 }} />
                    </Box>
                  </Box>

                  <Box sx={{ p: 2, bgcolor: 'background.neutral', borderRadius: 2, mb: 3 }}>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'center' }}>
                      <Typography variant="subtitle2">{t('simulation.snappfood.stepper.currentState', 'Current State Code')}:</Typography>
                      {getStatusBadge(currentStatus)}
                    </Box>
                  </Box>

                  {/* Actions Bar */}
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                    {t('simulation.snappfood.stepper.availableActions', 'Available Vendor Actions (API Endpoints):')}
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <Button fullWidth variant="outlined" color="info" onClick={() => handleExecuteAction('ACK')} disabled={loading}>
                        {t('simulation.snappfood.stepper.ack', '1. Ack Order (POST /ack) → Code 61')}
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <Button fullWidth variant="outlined" color="warning" onClick={() => handleExecuteAction('PICK')} disabled={loading}>
                        {t('simulation.snappfood.stepper.pick', '2. Pick Order (POST /pick) → Code 713')}
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <Button fullWidth variant="contained" color="success" onClick={() => handleExecuteAction('ACCEPT')} disabled={loading}>
                        {t('simulation.snappfood.stepper.accept', '3. Accept Order (POST /accept) → Code 42')}
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <Button fullWidth variant="contained" color="error" onClick={() => handleExecuteAction('REJECT')} disabled={loading}>
                        {t('simulation.snappfood.stepper.reject', '4. Reject Order (POST /reject) → Code 51')}
                      </Button>
                    </Grid>
                  </Grid>

                  <Typography variant="subtitle2" sx={{ mt: 3, mb: 1, fontWeight: 'bold' }}>
                    {t('simulation.snappfood.stepper.supportActions')}
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <Button fullWidth variant="outlined" color="error" onClick={() => handleSupportDecision(54)} disabled={loading}>
                        {t('simulation.snappfood.stepper.supportCancel')}
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <Button fullWidth variant="outlined" color="primary" onClick={() => handleSupportDecision(56)} disabled={loading}>
                        {t('simulation.snappfood.stepper.supportResend')}
                      </Button>
                    </Grid>
                  </Grid>

                  {/* Accept / Reject Detail Options */}
                  <Accordion sx={{ mt: 3, boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
                    <AccordionSummary>
                      <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                        {t('simulation.snappfood.stepper.optionsTitle', 'Accept & Reject Parameters Customization')}
                      </Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Grid container spacing={2}>
                        <Grid size={{ xs: 12, sm: 4 }}>
                          <TextField label={t('simulation.snappfood.stepper.deliveryTime', 'Accept: deliveryTime (Max 70m)')} type="number" size="small" value={acceptDeliveryTime} onChange={(e) => setAcceptDeliveryTime(Number(e.target.value))} fullWidth />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 4 }}>
                          <TextField label={t('simulation.snappfood.stepper.riderPickupTime', 'Accept: riderPickupTime (min)')} type="number" size="small" value={acceptRiderPickupTime} onChange={(e) => setAcceptRiderPickupTime(Number(e.target.value))} fullWidth />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 4 }}>
                          <TextField label={t('simulation.snappfood.stepper.delta', 'Accept: delta (Max 500)')} type="number" size="small" value={acceptDelta} onChange={(e) => setAcceptDelta(Number(e.target.value))} fullWidth />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <FormControl fullWidth size="small">
                            <InputLabel>{t('simulation.snappfood.stepper.declineReason', 'Reject: Decline Reason')}</InputLabel>
                            <Select value={declineReasonId} label={t('simulation.snappfood.stepper.declineReason', 'Reject: Decline Reason')} onChange={(e) => setDeclineReasonId(Number(e.target.value))}>
                              <MenuItem value={113}>{t('simulation.snappfood.stepper.reasonNoBiker', '113: Restaurant has no rider')}</MenuItem>
                              <MenuItem value={153}>{t('simulation.snappfood.stepper.reasonDelay', '153: Delivery delay')}</MenuItem>
                              <MenuItem value={154}>{t('simulation.snappfood.stepper.reasonDeliveryFee', '154: Delivery fee changed')}</MenuItem>
                            </Select>
                          </FormControl>
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField label={t('simulation.snappfood.stepper.rejectComment', 'Reject: Comment')} size="small" value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} fullWidth />
                        </Grid>
                      </Grid>
                    </AccordionDetails>
                  </Accordion>
                </Card>

                {actionResponse && (
                  <Card sx={{ p: 3, borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ mb: 1, fontWeight: 'bold' }}>
                      {t('simulation.snappfood.stepper.actionResponse', 'Action Response')}
                    </Typography>
                    <Box component="pre" sx={{ p: 2, bgcolor: '#1e1e1e', color: '#ffcc00', borderRadius: 1, fontSize: 13 }}>
                      {JSON.stringify(actionResponse, null, 2)}
                    </Box>
                  </Card>
                )}
              </Stack>
            )}

            {/* TAB 3: VENDOR AUTOMATION APIS */}
            {activeTab === 3 && (
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 5 }}>
                  <Card sx={{ p: 3, borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                      {t('simulation.snappfood.vendorApi.title', 'Vendor Automation API Test Console (v4.3.0)')}
                    </Typography>
                    <Stack spacing={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel>{t('simulation.snappfood.vendorApi.selectEndpoint', 'Select Endpoint')}</InputLabel>
                        <Select value={apiEndpoint} label={t('simulation.snappfood.vendorApi.selectEndpoint', 'Select Endpoint')} onChange={(e) => setApiEndpoint(e.target.value)}>
                          <MenuItem value="GET_CATALOG">{t('simulation.snappfood.vendorApi.getCatalog', 'GET /va/v1.1/product/ (Get Catalog)')}</MenuItem>
                          <MenuItem value="SYNC_CATEGORY">{t('simulation.snappfood.vendorApi.syncCategory', 'POST /va/v1/category/sync/categoryId (Sync Category)')}</MenuItem>
                          <MenuItem value="SYNC_PRODUCT">{t('simulation.snappfood.vendorApi.syncProduct', 'POST /va/v1/product/sync/productId (Sync Product)')}</MenuItem>
                          <MenuItem value="TOGGLE_PRODUCT">{t('simulation.snappfood.vendorApi.toggleProduct', 'PUT /va/v1/product/ (Toggle Product Status)')}</MenuItem>
                          <MenuItem value="GET_TOPPINGS">{t('simulation.snappfood.vendorApi.getToppings', 'GET /va/v1/topping/groups (Get Toppings)')}</MenuItem>
                          <MenuItem value="GET_STATUS">{t('simulation.snappfood.vendorApi.getStatus', 'GET /va/v1/vendor/status (Get Vendor Status)')}</MenuItem>
                          <MenuItem value="GET_DELIVERIES">{t('simulation.snappfood.vendorApi.getDeliveries', 'GET /va/v1/vendor/vendorDeliveries (Service Polygons)')}</MenuItem>
                          <MenuItem value="GET_DECLINE_REASONS">{t('simulation.snappfood.vendorApi.getDeclineReasons', 'GET /va/v1/order/decline-reason (Decline Reasons)')}</MenuItem>
                          <MenuItem value="LATEST_ORDERS">{t('simulation.snappfood.vendorApi.latestOrders', 'POST /va/v1/order/latest (Recent Orders)')}</MenuItem>
                        </Select>
                      </FormControl>

                      {apiEndpoint === 'SYNC_CATEGORY' && (
                        <Stack spacing={2}>
                          <TextField label={t('simulation.snappfood.vendorApi.categoryId', 'Category ID')} type="number" size="small" value={syncCategoryId} onChange={(e) => setSyncCategoryId(Number(e.target.value))} fullWidth />
                          <TextField label={t('simulation.snappfood.vendorApi.categoryCode', 'Category Code')} size="small" value={syncCategoryCode} onChange={(e) => setSyncCategoryCode(e.target.value)} fullWidth />
                        </Stack>
                      )}

                      {apiEndpoint === 'SYNC_PRODUCT' && (
                        <Stack spacing={2}>
                          <TextField label={t('simulation.snappfood.vendorApi.productId', 'Product ID')} type="number" size="small" value={syncProductId} onChange={(e) => setSyncProductId(Number(e.target.value))} fullWidth />
                          <TextField label={t('simulation.snappfood.vendorApi.productCode', 'Product Code')} size="small" value={syncProductCode} onChange={(e) => setSyncProductCode(e.target.value)} fullWidth />
                        </Stack>
                      )}

                      <Button variant="contained" color="primary" onClick={handleRunVendorApi} disabled={loading}>
                        {t('simulation.snappfood.vendorApi.execute', 'Execute API Endpoint')}
                      </Button>
                    </Stack>
                  </Card>
                </Grid>

                <Grid size={{ xs: 12, md: 7 }}>
                  <Card sx={{ p: 3, borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                      {t('simulation.snappfood.vendorApi.response', 'API Response Payload')}
                    </Typography>
                    {apiResponse ? (
                      <Box component="pre" sx={{ p: 2, bgcolor: '#1e1e1e', color: '#00e676', borderRadius: 1, overflow: 'auto', maxHeight: 400, fontSize: 13 }}>
                        {JSON.stringify(apiResponse, null, 2)}
                      </Box>
                    ) : (
                      <Typography color="text.secondary">
                        {t('simulation.snappfood.vendorApi.placeholder', 'Select an endpoint and click Execute API Endpoint.')}
                      </Typography>
                    )}
                  </Card>
                </Grid>
              </Grid>
            )}

            {/* TAB 4: INTEGRATION AUDIT LOGS */}
            {activeTab === 4 && (
              <Stack spacing={2}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  {t('simulation.logs.title', 'Snappfood Webhook & Integration Receipts Audit')}
                </Typography>
                <TableContainer component={Card} sx={{ borderRadius: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'background.neutral' }}>
                        <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.logs.table.timestamp', 'Time')}</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.logs.table.eventType', 'Event Type')}</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.logs.table.reference', 'Idempotency Key')}</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.logs.table.hmac', 'Duplicate?')}</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.logs.table.status', 'Status')}</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>{t('simulation.logs.table.actions', 'Action')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {logs.length > 0 ? (
                        logs.map((log) => (
                          <TableRow key={log.id} hover>
                            <TableCell>{fTime(log.created_at || Date.now())}</TableCell>
                            <TableCell>
                              <Chip label={log.event_type} size="small" variant="outlined" color="primary" />
                            </TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{log.idempotency_key || 'N/A'}</TableCell>
                            <TableCell>{log.is_duplicate ? <Chip label="DUPLICATE" color="warning" size="small" /> : 'NO'}</TableCell>
                            <TableCell>
                              <Chip label={log.status} color={log.status === 'SUCCESS' ? 'success' : 'error'} size="small" />
                            </TableCell>
                            <TableCell>
                              <Button size="small" variant="outlined" onClick={() => setSelectedLog(log)}>
                                {t('simulation.logs.table.actions', 'Inspect Payload')}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                            {t('simulation.logs.table.noLogs', 'No Snappfood integration logs recorded yet.')}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Stack>
            )}
          </Box>
        </Card>
      </Stack>

      {/* Log Inspection Dialog */}
      <Dialog open={Boolean(selectedLog)} onClose={() => setSelectedLog(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('simulation.logs.modal.title', 'Inspect Integration Receipt')} [{selectedLog?.idempotency_key}]
        </DialogTitle>
        <DialogContent dividers>
          {selectedLog && (
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2">{t('simulation.logs.modal.provider', 'Provider')}: {selectedLog.provider}</Typography>
                <Typography variant="subtitle2">{t('simulation.logs.modal.eventType', 'Event')}: {selectedLog.event_type}</Typography>
                <Typography variant="subtitle2">{t('simulation.logs.modal.hmacSignature', 'HMAC')}: {selectedLog.hmac_signature ? 'VERIFIED' : 'NONE'}</Typography>
              </Box>
              <Divider />
              <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                {t('simulation.logs.modal.inboundRequest', 'Request Payload (v4.3.0):')}
              </Typography>
              <Box component="pre" sx={{ p: 2, bgcolor: '#1e1e1e', color: '#00ffcc', borderRadius: 1, fontSize: 12, overflow: 'auto', maxHeight: 250 }}>
                {JSON.stringify(selectedLog.request_payload, null, 2)}
              </Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                {t('simulation.logs.modal.outboundResponse', 'Response Payload:')}
              </Typography>
              <Box component="pre" sx={{ p: 2, bgcolor: '#1e1e1e', color: '#ffcc00', borderRadius: 1, fontSize: 12, overflow: 'auto', maxHeight: 200 }}>
                {JSON.stringify(selectedLog.response_payload, null, 2)}
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedLog(null)}>
            {t('simulation.logs.modal.close', 'Close')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default SimulationSnappfoodPage;
