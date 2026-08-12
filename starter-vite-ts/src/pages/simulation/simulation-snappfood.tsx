import { useTranslation } from 'react-i18next';

import React, { useState, useEffect } from 'react';

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
  Container,
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

import { httpClient as axios } from 'src/api/httpClient';

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
  const [price, setPrice] = useState<number>(1910);
  const [paidPrice, setPaidPrice] = useState<number>(1910);
  const [otherDiscounts] = useState<number>(0);
  const [notes, setNotes] = useState<string>('غذا داخل باکس قرار داده شود - اردر تست');
  const [bikerName, setBikerName] = useState<string>('علی تهرانی');
  const [bikerStatusV2, setBikerStatusV2] = useState<string>('REQUESTED');
  const [couponType, setCouponType] = useState<string>('none');
  const [generatedResult, setGeneratedResult] = useState<any>(null);

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
        return <Chip label="56: New Order (سفارش جدید)" color="primary" sx={{ fontWeight: 'bold' }} />;
      case 714:
        return <Chip label="714: Sent to Store (ارسال به فروشگاه)" color="info" sx={{ fontWeight: 'bold' }} />;
      case 61:
        return <Chip label="61: Received (دریافت شده - Ack)" color="info" sx={{ fontWeight: 'bold' }} />;
      case 713:
        return <Chip label="713: Opened (باز شده - Pick)" color="warning" sx={{ fontWeight: 'bold' }} />;
      case 42:
        return <Chip label="42: Accepted (تایید شده)" color="success" sx={{ fontWeight: 'bold' }} />;
      case 51:
        return <Chip label="51: Rejected (رد شده)" color="error" sx={{ fontWeight: 'bold' }} />;
      case 54:
        return <Chip label="54: Cancelled (کنسل شده)" color="default" sx={{ fontWeight: 'bold' }} />;
      case 71:
        return <Chip label="71: Extra Payment (پرداخت اضافه)" color="secondary" sx={{ fontWeight: 'bold' }} />;
      default:
        return <Chip label={`${code}: Unknown`} color="default" />;
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Stack spacing={3}>
        {/* Header Alert */}
        <Alert severity="info" icon={false} sx={{ borderLeft: '6px solid #e91e63' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
            <Box>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Chip label="SIMULATED" color="secondary" size="small" sx={{ fontWeight: 'bold' }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                  اسنپ‌فود - نسخه رستورانی ۴.۳.۰ (Snappfood Integration Annex v4.3.0 Console)
                </Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">
                {t('simulation.snappfoodNotice', 'Comprehensive mock test bench for Snappfood OAuth2 Authentication, v4.3.0 Webhooks (bikerStatusV2, paidPrice, orderCoupon), Order Status Stepper, & Vendor Automation APIs.')}
              </Typography>
            </Box>
            <Button variant="contained" color="secondary" onClick={fetchLogs}>
              Refresh Audit Logs
            </Button>
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
            <Tab label="🔐 OAuth2 Auth & Token (/token)" sx={{ fontWeight: 'bold' }} />
            <Tab label="🚀 Webhook Generator (v4.3.0)" sx={{ fontWeight: 'bold' }} />
            <Tab label="🔄 Order Lifecycle Stepper" sx={{ fontWeight: 'bold' }} />
            <Tab label="🛠️ Vendor Automation APIs (20+ Endpoints)" sx={{ fontWeight: 'bold' }} />
            <Tab label="📜 Integration Audit Logs" sx={{ fontWeight: 'bold' }} />
          </Tabs>

          <Box sx={{ p: 3 }}>
            {/* TAB 0: OAUTH2 TOKEN SIMULATOR */}
            {activeTab === 0 && (
              <Grid container spacing={3}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Card sx={{ p: 3, bgcolor: 'background.neutral', borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                      OAuth2 Password Grant Simulator
                    </Typography>
                    <Stack spacing={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Environment / Server Endpoint</InputLabel>
                        <Select value={authEnv} label="Environment" onChange={(e) => setAuthEnv(e.target.value as any)}>
                          <MenuItem value="staging">Staging (https://staging-auth.snappfood.dev/token)</MenuItem>
                          <MenuItem value="production">Production (https://auth.snappfood.ir/token)</MenuItem>
                        </Select>
                      </FormControl>
                      <TextField label="Client ID" size="small" value={clientId} onChange={(e) => setClientId(e.target.value)} fullWidth />
                      <TextField label="Client Secret" size="small" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} fullWidth />
                      <TextField label="Username" size="small" value={username} onChange={(e) => setUsername(e.target.value)} fullWidth />
                      <TextField label="Password" size="small" type="password" value={password} onChange={(e) => setPassword(e.target.value)} fullWidth />

                      <Box sx={{ display: 'flex', gap: 2, pt: 1 }}>
                        <Button variant="contained" color="primary" onClick={() => handleRequestToken()} disabled={loading}>
                          Request Access Token
                        </Button>
                        <Button variant="outlined" color="error" onClick={() => handleRequestToken(3001)} disabled={loading}>
                          Simulate Token Error 3001
                        </Button>
                      </Box>
                    </Stack>
                  </Card>
                </Grid>

                <Grid size={{ xs: 12, md: 6 }}>
                  <Card sx={{ p: 3, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                      Token Response Output
                    </Typography>
                    {tokenResponse ? (
                      <Box component="pre" sx={{ p: 2, bgcolor: '#1e1e1e', color: '#00ffcc', borderRadius: 1, overflow: 'auto', fontSize: 13 }}>
                        {JSON.stringify(tokenResponse, null, 2)}
                      </Box>
                    ) : (
                      <Typography color="text.secondary">No token requested yet. Click &quot;Request Access Token&quot;.</Typography>
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
                      Generate v4.3.0 Order Webhook (HMAC Signed)
                    </Typography>
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField label="Customer Name (نام مشتری)" size="small" value={customerName} onChange={(e) => setCustomerName(e.target.value)} fullWidth />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <TextField label="Phone (تلفن)" size="small" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} fullWidth />
                      </Grid>
                      <Grid size={{ xs: 12 }}>
                        <TextField label="Address (آدرس تحویل)" size="small" value={deliverAddress} onChange={(e) => setDeliverAddress(e.target.value)} fullWidth />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Expedition Type</InputLabel>
                          <Select value={expeditionType} label="Expedition Type" onChange={(e) => setExpeditionType(e.target.value)}>
                            <MenuItem value="DELIVERY">DELIVERY (پیک رستوران)</MenuItem>
                            <MenuItem value="ZF_EXPRESS">ZF_EXPRESS (پیک اکسپرس)</MenuItem>
                            <MenuItem value="MIARE">MIARE (میاره)</MenuItem>
                            <MenuItem value="PICKUP">PICKUP (حضوری)</MenuItem>
                            <MenuItem value="PICK_MAN">PICK_MAN (پیک اختصاصی)</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <TextField label="Total Price (مبلغ کل - تومان)" type="number" size="small" value={price} onChange={(e) => setPrice(Number(e.target.value))} fullWidth />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <TextField label="Paid Price (مبلغ پرداختی)" type="number" size="small" value={paidPrice} onChange={(e) => setPaidPrice(Number(e.target.value))} fullWidth />
                      </Grid>

                      {/* v4.3.0 Biker & Coupon details */}
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <TextField label="Biker Name (نام پیک)" size="small" value={bikerName} onChange={(e) => setBikerName(e.target.value)} fullWidth />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <FormControl fullWidth size="small">
                          <InputLabel>Biker Status V2</InputLabel>
                          <Select value={bikerStatusV2} label="Biker Status V2" onChange={(e) => setBikerStatusV2(e.target.value)}>
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
                          <InputLabel>Order Coupon (کوپن)</InputLabel>
                          <Select value={couponType} label="Order Coupon" onChange={(e) => setCouponType(e.target.value)}>
                            <MenuItem value="none">No Coupon (بدون کوپن)</MenuItem>
                            <MenuItem value="extra_item">extra_item (آیتم اضافه/نوشابه)</MenuItem>
                            <MenuItem value="free_delivery_fee">free_delivery_fee (ارسال رایگان)</MenuItem>
                            <MenuItem value="total_discount">total_discount (تخفیف کل)</MenuItem>
                          </Select>
                        </FormControl>
                      </Grid>

                      <Grid size={{ xs: 12 }}>
                        <TextField label="Vendor Notes / Comment (توضیحات سفارش)" multiline rows={2} size="small" value={notes} onChange={(e) => setNotes(e.target.value)} fullWidth />
                      </Grid>

                      <Grid size={{ xs: 12 }}>
                        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
                          <Button variant="contained" color="secondary" onClick={handleGenerateWebhook} disabled={loading}>
                            Submit Webhook (Post Order)
                          </Button>
                          <Button variant="outlined" color="warning" onClick={handleReplayDuplicate} disabled={loading}>
                            Replay (Test Duplicate Suppression)
                          </Button>
                        </Box>
                      </Grid>
                    </Grid>
                  </Card>
                </Grid>

                <Grid size={{ xs: 12, md: 5 }}>
                  <Card sx={{ p: 3, borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                      Webhook Response & Order Created
                    </Typography>
                    {generatedResult ? (
                      <Stack spacing={2}>
                        <Alert severity={generatedResult.duplicate ? 'warning' : 'success'}>
                          <Typography variant="subtitle2">
                            {generatedResult.duplicate ? 'DUPLICATE WEBHOOK IGNORED (Exactly-Once Enforced)' : 'ORDER CREATED SUCCESSFULLY'}
                          </Typography>
                          Log ID: {generatedResult.log_id || 'N/A'}
                        </Alert>
                        <Box component="pre" sx={{ p: 2, bgcolor: '#1e1e1e', color: '#66ff66', borderRadius: 1, overflow: 'auto', maxHeight: 350, fontSize: 12 }}>
                          {JSON.stringify(generatedResult, null, 2)}
                        </Box>
                      </Stack>
                    ) : (
                      <Typography color="text.secondary">No order generated yet. Fill the form and click Submit Webhook.</Typography>
                    )}
                  </Card>
                </Grid>
              </Grid>
            )}

            {/* TAB 2: ORDER LIFECYCLE STEPPER */}
            {activeTab === 2 && (
              <Stack spacing={3}>
                <Card sx={{ p: 3, borderRadius: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                      Order Status Lifecycle State Machine
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <Typography variant="subtitle2">Target Order Code:</Typography>
                      <TextField size="small" value={orderCode} onChange={(e) => setOrderCode(e.target.value)} sx={{ width: 140 }} />
                    </Box>
                  </Box>

                  <Box sx={{ p: 2, bgcolor: 'background.neutral', borderRadius: 2, mb: 3 }}>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'center' }}>
                      <Typography variant="subtitle2">Current State Code:</Typography>
                      {getStatusBadge(currentStatus)}
                    </Box>
                  </Box>

                  {/* Actions Bar */}
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                    Available Vendor Actions (API Endpoints):
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <Button fullWidth variant="outlined" color="info" onClick={() => handleExecuteAction('ACK')} disabled={loading}>
                        1. Ack Order (POST /ack) → Code 61
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <Button fullWidth variant="outlined" color="warning" onClick={() => handleExecuteAction('PICK')} disabled={loading}>
                        2. Pick Order (POST /pick) → Code 713
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <Button fullWidth variant="contained" color="success" onClick={() => handleExecuteAction('ACCEPT')} disabled={loading}>
                        3. Accept Order (POST /accept) → Code 42
                      </Button>
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <Button fullWidth variant="contained" color="error" onClick={() => handleExecuteAction('REJECT')} disabled={loading}>
                        4. Reject Order (POST /reject) → Code 51
                      </Button>
                    </Grid>
                  </Grid>

                  {/* Accept / Reject Detail Options */}
                  <Accordion sx={{ mt: 3, boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
                    <AccordionSummary>
                      <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                        ⚙️ Accept & Reject Parameters Customization (Max Limits Test)
                      </Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Grid container spacing={2}>
                        <Grid size={{ xs: 12, sm: 4 }}>
                          <TextField label="Accept: deliveryTime (Max 70m)" type="number" size="small" value={acceptDeliveryTime} onChange={(e) => setAcceptDeliveryTime(Number(e.target.value))} fullWidth />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 4 }}>
                          <TextField label="Accept: riderPickupTime (min)" type="number" size="small" value={acceptRiderPickupTime} onChange={(e) => setAcceptRiderPickupTime(Number(e.target.value))} fullWidth />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 4 }}>
                          <TextField label="Accept: delta (Max 500)" type="number" size="small" value={acceptDelta} onChange={(e) => setAcceptDelta(Number(e.target.value))} fullWidth />
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <FormControl fullWidth size="small">
                            <InputLabel>Reject: Decline Reason (دلیل رد)</InputLabel>
                            <Select value={declineReasonId} label="Decline Reason" onChange={(e) => setDeclineReasonId(Number(e.target.value))}>
                              <MenuItem value={113}>113: رستوران پیک ندارد</MenuItem>
                              <MenuItem value={153}>153: تاخیر در زمان ارسال</MenuItem>
                              <MenuItem value={154}>154: تغییر هزینه پیک</MenuItem>
                            </Select>
                          </FormControl>
                        </Grid>
                        <Grid size={{ xs: 12, sm: 6 }}>
                          <TextField label="Reject: Comment" size="small" value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} fullWidth />
                        </Grid>
                      </Grid>
                    </AccordionDetails>
                  </Accordion>
                </Card>

                {actionResponse && (
                  <Card sx={{ p: 3, borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ mb: 1, fontWeight: 'bold' }}>
                      Action Response
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
                      Vendor Automation API Test Console (v4.3.0)
                    </Typography>
                    <Stack spacing={2}>
                      <FormControl fullWidth size="small">
                        <InputLabel>Select Endpoint</InputLabel>
                        <Select value={apiEndpoint} label="Select Endpoint" onChange={(e) => setApiEndpoint(e.target.value)}>
                          <MenuItem value="GET_CATALOG">GET /va/v1.1/product/ (Get Catalog)</MenuItem>
                          <MenuItem value="SYNC_CATEGORY">POST /va/v1/category/sync/categoryId (Sync Category)</MenuItem>
                          <MenuItem value="SYNC_PRODUCT">POST /va/v1/product/sync/productId (Sync Product)</MenuItem>
                          <MenuItem value="TOGGLE_PRODUCT">PUT /va/v1/product/ (Toggle Product Status)</MenuItem>
                          <MenuItem value="GET_TOPPINGS">GET /va/v1/topping/groups (Get Toppings)</MenuItem>
                          <MenuItem value="GET_STATUS">GET /va/v1/vendor/status (Get Vendor Status)</MenuItem>
                          <MenuItem value="GET_DELIVERIES">GET /va/v1/vendor/vendorDeliveries (Service Polygons)</MenuItem>
                          <MenuItem value="GET_DECLINE_REASONS">GET /va/v1/order/decline-reason (Decline Reasons)</MenuItem>
                          <MenuItem value="LATEST_ORDERS">POST /va/v1/order/latest (Recent Orders)</MenuItem>
                        </Select>
                      </FormControl>

                      {apiEndpoint === 'SYNC_CATEGORY' && (
                        <Stack spacing={2}>
                          <TextField label="Category ID" type="number" size="small" value={syncCategoryId} onChange={(e) => setSyncCategoryId(Number(e.target.value))} fullWidth />
                          <TextField label="Category Code" size="small" value={syncCategoryCode} onChange={(e) => setSyncCategoryCode(e.target.value)} fullWidth />
                        </Stack>
                      )}

                      {apiEndpoint === 'SYNC_PRODUCT' && (
                        <Stack spacing={2}>
                          <TextField label="Product ID" type="number" size="small" value={syncProductId} onChange={(e) => setSyncProductId(Number(e.target.value))} fullWidth />
                          <TextField label="Product Code" size="small" value={syncProductCode} onChange={(e) => setSyncProductCode(e.target.value)} fullWidth />
                        </Stack>
                      )}

                      <Button variant="contained" color="primary" onClick={handleRunVendorApi} disabled={loading}>
                        Execute API Endpoint
                      </Button>
                    </Stack>
                  </Card>
                </Grid>

                <Grid size={{ xs: 12, md: 7 }}>
                  <Card sx={{ p: 3, borderRadius: 2 }}>
                    <Typography variant="h6" sx={{ mb: 2, fontWeight: 'bold' }}>
                      API Response Payload
                    </Typography>
                    {apiResponse ? (
                      <Box component="pre" sx={{ p: 2, bgcolor: '#1e1e1e', color: '#00e676', borderRadius: 1, overflow: 'auto', maxHeight: 400, fontSize: 13 }}>
                        {JSON.stringify(apiResponse, null, 2)}
                      </Box>
                    ) : (
                      <Typography color="text.secondary">Select an endpoint and click Execute API Endpoint.</Typography>
                    )}
                  </Card>
                </Grid>
              </Grid>
            )}

            {/* TAB 4: INTEGRATION AUDIT LOGS */}
            {activeTab === 4 && (
              <Stack spacing={2}>
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                  Snappfood Webhook & Integration Receipts Audit
                </Typography>
                <TableContainer component={Card} sx={{ borderRadius: 2 }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'background.neutral' }}>
                        <TableCell sx={{ fontWeight: 'bold' }}>Time</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>Event Type</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>Idempotency Key</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>Duplicate?</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>Action</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {logs.length > 0 ? (
                        logs.map((log) => (
                          <TableRow key={log.id} hover>
                            <TableCell>{new Date(log.created_at || Date.now()).toLocaleTimeString()}</TableCell>
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
                                Inspect Payload
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={6} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                            No Snappfood integration logs recorded yet.
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
          Inspect Integration Receipt [{selectedLog?.idempotency_key}]
        </DialogTitle>
        <DialogContent dividers>
          {selectedLog && (
            <Stack spacing={2}>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Typography variant="subtitle2">Provider: {selectedLog.provider}</Typography>
                <Typography variant="subtitle2">Event: {selectedLog.event_type}</Typography>
                <Typography variant="subtitle2">HMAC: {selectedLog.hmac_signature ? 'VERIFIED' : 'NONE'}</Typography>
              </Box>
              <Divider />
              <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>Request Payload (v4.3.0):</Typography>
              <Box component="pre" sx={{ p: 2, bgcolor: '#1e1e1e', color: '#00ffcc', borderRadius: 1, fontSize: 12, overflow: 'auto', maxHeight: 250 }}>
                {JSON.stringify(selectedLog.request_payload, null, 2)}
              </Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>Response Payload:</Typography>
              <Box component="pre" sx={{ p: 2, bgcolor: '#1e1e1e', color: '#ffcc00', borderRadius: 1, fontSize: 12, overflow: 'auto', maxHeight: 200 }}>
                {JSON.stringify(selectedLog.response_payload, null, 2)}
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSelectedLog(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}

export default SimulationSnappfoodPage;
