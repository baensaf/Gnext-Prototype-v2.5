import axios from 'axios';
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import {
  Box,
  Tab,
  Card,
  Grid,
  Chip,
  Tabs,
  Paper,
  Badge,
  Stack,
  Button,
  Dialog,
  Divider,
  TextField,
  Typography,
  IconButton,
  CardContent,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
} from '@mui/material';

interface KioskProduct {
  id: string;
  name: string;
  category_id: string;
  base_price: string;
  image_url?: string;
  option_groups?: Array<{
    id: string;
    name: string;
    min_selection?: number;
    max_selection?: number;
    items: Array<{
      id: string;
      name: string;
      price: string;
    }>;
  }>;
}

interface CartItem {
  cart_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  options: Array<{
    option_group_id: string;
    option_item_id: string;
    option_item_name: string;
    additional_price: number;
  }>;
  notes?: string;
}

export function KioskPage() {
  const { i18n } = useTranslation();

  // Kiosk Flow Steps: 0: WELCOME, 1: CATALOG, 2: PAYMENT_SIMULATION, 3: SUCCESS_RECEIPT
  const [kioskStep, setKioskStep] = useState<number>(0);
  const [orderType, setOrderType] = useState<'DINE_IN' | 'TAKEAWAY'>('TAKEAWAY');

  // Customer identity
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [identityDialogOpen, setIdentityDialogOpen] = useState(false);

  // Data state
  const [loading, setLoading] = useState(false);
  const [bootstrapData, setBootstrapData] = useState<any>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Item customization modal
  const [customizingProduct, setCustomizingProduct] = useState<KioskProduct | null>(null);
  const [customQuantity, setCustomQuantity] = useState(1);
  const [selectedOptionsMap, setSelectedOptionsMap] = useState<Record<string, any>>({});
  const [itemNotes, setItemNotes] = useState('');

  // Cart
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartDrawerOpen, setCartDrawerOpen] = useState(false);

  // Active Order & Payment state
  const [activeOrder, setActiveOrder] = useState<any>(null);
  const [receiptData, setReceiptData] = useState<any>(null);

  const fetchBootstrap = async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/v1/kiosk/bootstrap');
      setBootstrapData(res.data);
    } catch (err) {
      console.error('Failed to load kiosk bootstrap context:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBootstrap();
  }, []);

  const toggleLanguage = () => {
    const nextLang = i18n.language === 'fa' ? 'en' : 'fa';
    i18n.changeLanguage(nextLang);
  };

  const handleStartOrder = (type: 'DINE_IN' | 'TAKEAWAY') => {
    setOrderType(type);
    if (bootstrapData?.customer_identity_policy === 'REQUIRED') {
      setIdentityDialogOpen(true);
    } else {
      setKioskStep(1);
    }
  };

  const handleConfirmIdentity = () => {
    if (bootstrapData?.customer_identity_policy === 'REQUIRED' && !customerPhone.trim()) {
      alert('Phone number is required to proceed.');
      return;
    }
    setIdentityDialogOpen(false);
    setKioskStep(1);
  };

  const handleOpenProductCustomizer = (product: KioskProduct) => {
    setCustomizingProduct(product);
    setCustomQuantity(1);
    setSelectedOptionsMap({});
    setItemNotes('');
  };

  const handleToggleOptionItem = (group: any, item: any) => {
    setSelectedOptionsMap((prev) => ({
      ...prev,
      [group.id]: {
        option_group_id: group.id,
        option_item_id: item.id,
        option_item_name: item.name,
        additional_price: parseFloat(item.price || '0'),
      },
    }));
  };

  const handleAddToCart = () => {
    if (!customizingProduct) return;

    const basePrice = parseFloat(customizingProduct.base_price || '0');
    const optionList = Object.values(selectedOptionsMap);
    const optionsTotal = optionList.reduce((acc, opt) => acc + opt.additional_price, 0);

    const unitPrice = basePrice + optionsTotal;
    const lineTotal = unitPrice * customQuantity;

    const newCartItem: CartItem = {
      cart_id: `cart-${Date.now()}-${Math.random().toString().slice(-4)}`,
      product_id: customizingProduct.id,
      product_name: customizingProduct.name,
      quantity: customQuantity,
      unit_price: unitPrice,
      line_total: lineTotal,
      options: optionList,
      notes: itemNotes,
    };

    setCart((prev) => [...prev, newCartItem]);
    setCustomizingProduct(null);
  };

  const handleRemoveCartItem = (cartId: string) => {
    setCart((prev) => prev.filter((i) => i.cart_id !== cartId));
  };

  const calculateSubtotal = () => cart.reduce((acc, item) => acc + item.line_total, 0);
  const calculateTax = () => calculateSubtotal() * 0.09;
  const calculateTotal = () => calculateSubtotal() + calculateTax();

  const handleProceedToPayment = async () => {
    if (cart.length === 0) return;
    setLoading(true);
    try {
      const orderPayload = {
        branch_id: bootstrapData?.branch?.id || 'branch-1',
        order_type: orderType,
        customer_name: customerName || 'Kiosk Guest',
        customer_phone: customerPhone || undefined,
        items: cart.map((c) => ({
          product_id: c.product_id,
          quantity: c.quantity,
          notes: c.notes,
          options: c.options.map((o) => ({
            option_group_id: o.option_group_id,
            option_item_id: o.option_item_id,
            additional_price: o.additional_price,
          })),
        })),
      };

      const res = await axios.post('/api/v1/kiosk/orders', orderPayload);
      setActiveOrder(res.data);
      setCartDrawerOpen(false);
      setKioskStep(2);
      triggerSimulatedPosPayment(res.data.id);
    } catch (err) {
      alert('Order creation failed: ' + ((err as any).response?.data?.message || (err as any).message));
    } finally {
      setLoading(false);
    }
  };

  const triggerSimulatedPosPayment = async (orderId: string) => {
    setTimeout(async () => {
      try {
        const res = await axios.post('/api/v1/kiosk/pay', { order_id: orderId });
        setReceiptData(res.data.receipt);
        setKioskStep(3);
      } catch (err) {
        alert('Terminal Payment Failed');
      }
    }, 3000);
  };

  const handleResetKiosk = () => {
    setKioskStep(0);
    setCart([]);
    setActiveOrder(null);
    setReceiptData(null);
    setCustomerPhone('');
    setCustomerName('');
  };

  // STEP 0: WELCOME & ORDER TYPE SELECTOR
  if (kioskStep === 0) {
    return (
      <Box
        sx={{
          minHeight: '85vh',
          bgcolor: 'background.default',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
        }}
      >
        <Stack direction="row" sx={{ justifyContent: 'space-between', width: '100%', maxWidth: 900, mb: 4 }}>
          <Chip label="SELF-SERVICE KIOSK" color="primary" sx={{ fontWeight: 'bold', fontSize: '1rem', p: 1 }} />
          <Button variant="outlined" size="large" onClick={toggleLanguage}>
            {i18n.language === 'fa' ? 'English' : 'فارسی'}
          </Button>
        </Stack>

        <Paper sx={{ p: 6, borderRadius: 4, textAlign: 'center', maxWidth: 800, width: '100%', boxShadow: 8 }}>
          <Typography variant="h3" sx={{ fontWeight: 'bold', mb: 1 }}>
            Welcome to {bootstrapData?.branch?.name || 'Gnext Restaurant'}
          </Typography>
          <Typography variant="h6" color="text.secondary" sx={{ mb: 5 }}>
            Touch screen to choose order type and explore menu
          </Typography>

          <Grid container spacing={4}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Paper
                elevation={4}
                sx={{
                  p: 4,
                  borderRadius: 3,
                  cursor: 'pointer',
                  border: '2px solid transparent',
                  '&:hover': { borderColor: 'primary.main', bgcolor: 'primary.lighter' },
                }}
                onClick={() => handleStartOrder('DINE_IN')}
              >
                <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 1 }}>
                  🍽️
                </Typography>
                <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                  EAT IN
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Dine inside the restaurant
                </Typography>
              </Paper>
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <Paper
                elevation={4}
                sx={{
                  p: 4,
                  borderRadius: 3,
                  cursor: 'pointer',
                  border: '2px solid transparent',
                  '&:hover': { borderColor: 'secondary.main', bgcolor: 'secondary.lighter' },
                }}
                onClick={() => handleStartOrder('TAKEAWAY')}
              >
                <Typography variant="h4" sx={{ fontWeight: 'bold', mb: 1 }}>
                  🛍️
                </Typography>
                <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                  TAKEAWAY
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Pack to go
                </Typography>
              </Paper>
            </Grid>
          </Grid>
        </Paper>

        {/* Identity Dialog */}
        <Dialog open={identityDialogOpen} onClose={() => setIdentityDialogOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle>Customer Identification</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Please enter your phone number to continue your kiosk order.
              </Typography>
              <TextField
                label="Phone Number"
                fullWidth
                required={bootstrapData?.customer_identity_policy === 'REQUIRED'}
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />
              <TextField
                label="Your Name (Optional)"
                fullWidth
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleConfirmIdentity} variant="contained" fullWidth size="large">
              Continue to Menu
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  // STEP 1: CATALOG TOUCH BROWSER
  const filteredProducts =
    selectedCategory === 'ALL'
      ? bootstrapData?.products || []
      : (bootstrapData?.products || []).filter((p: any) => p.category_id === selectedCategory);

  return (
    <Box sx={{ minHeight: '85vh', p: 3, bgcolor: 'background.default' }}>
      {/* Kiosk Header */}
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Button variant="outlined" onClick={handleResetKiosk}>
            ← Cancel Order
          </Button>
          <Chip label={`MODE: ${orderType}`} color="secondary" sx={{ fontWeight: 'bold' }} />
        </Stack>

        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          <Button variant="outlined" onClick={toggleLanguage}>
            🌐 {i18n.language === 'fa' ? 'English' : 'فارسی'}
          </Button>
          <Badge badgeContent={cart.length} color="error">
            <Button
              variant="contained"
              size="large"
              color="primary"
              onClick={() => setCartDrawerOpen(true)}
            >
              🛒 Cart (${calculateTotal().toFixed(2)})
            </Button>
          </Badge>
        </Stack>
      </Stack>

      {/* Category Tabs */}
      <Tabs
        value={selectedCategory}
        onChange={(_, val) => setSelectedCategory(val)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="ALL ITEMS" value="ALL" sx={{ fontWeight: 'bold', fontSize: '1.1rem' }} />
        {(bootstrapData?.categories || []).map((cat: any) => (
          <Tab key={cat.id} label={cat.name} value={cat.id} sx={{ fontWeight: 'bold', fontSize: '1.1rem' }} />
        ))}
      </Tabs>

      {/* Products Grid */}
      <Grid container spacing={3}>
        {filteredProducts.map((product: KioskProduct) => (
          <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={product.id}>
            <Card
              sx={{
                borderRadius: 3,
                boxShadow: 3,
                cursor: 'pointer',
                transition: '0.2s',
                '&:hover': { transform: 'scale(1.02)' },
              }}
              onClick={() => handleOpenProductCustomizer(product)}
            >
              <Box
                sx={{
                  height: 120,
                  bgcolor: 'primary.lighter',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '3rem',
                }}
              >
                🍔
              </Box>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 1 }}>
                  {product.name}
                </Typography>
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="h6" color="primary.main" sx={{ fontWeight: 'bold' }}>
                    ${parseFloat(product.base_price || '0').toFixed(2)}
                  </Typography>
                  <Button size="small" variant="contained">
                    Add +
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      {/* Item Customizer Modal */}
      <Dialog open={Boolean(customizingProduct)} onClose={() => setCustomizingProduct(null)} maxWidth="sm" fullWidth>
        {customizingProduct && (
          <>
            <DialogTitle>Customize: {customizingProduct.name}</DialogTitle>
            <DialogContent dividers>
              <Stack spacing={3}>
                <Typography variant="h6" color="primary.main" sx={{ fontWeight: 'bold' }}>
                  Base Price: ${parseFloat(customizingProduct.base_price || '0').toFixed(2)}
                </Typography>

                {/* Option Groups */}
                {customizingProduct.option_groups?.map((group) => (
                  <Box key={group.id}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                      {group.name}
                    </Typography>
                    <Grid container spacing={1}>
                      {group.items.map((item) => {
                        const isSelected = selectedOptionsMap[group.id]?.option_item_id === item.id;
                        return (
                          <Grid size={{ xs: 6 }} key={item.id}>
                            <Paper
                              sx={{
                                p: 1.5,
                                textAlign: 'center',
                                cursor: 'pointer',
                                border: '2px solid',
                                borderColor: isSelected ? 'primary.main' : 'divider',
                                bgcolor: isSelected ? 'primary.lighter' : 'background.paper',
                              }}
                              onClick={() => handleToggleOptionItem(group, item)}
                            >
                              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                {item.name}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                +${parseFloat(item.price || '0').toFixed(2)}
                              </Typography>
                            </Paper>
                          </Grid>
                        );
                      })}
                    </Grid>
                  </Box>
                ))}

                {/* Quantity */}
                <Stack direction="row" spacing={2} sx={{ alignItems: 'center', justifyContent: 'center' }}>
                  <Button variant="outlined" onClick={() => setCustomQuantity((q) => Math.max(1, q - 1))}>
                    -
                  </Button>
                  <Typography variant="h4" sx={{ fontWeight: 'bold', px: 2 }}>
                    {customQuantity}
                  </Typography>
                  <Button variant="outlined" onClick={() => setCustomQuantity((q) => q + 1)}>
                    +
                  </Button>
                </Stack>
              </Stack>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setCustomizingProduct(null)}>Cancel</Button>
              <Button variant="contained" size="large" onClick={handleAddToCart}>
                Add to Cart
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* Cart Drawer / Modal */}
      <Dialog open={cartDrawerOpen} onClose={() => setCartDrawerOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Your Order Summary</DialogTitle>
        <DialogContent dividers>
          {cart.length === 0 ? (
            <Typography align="center" color="text.secondary" sx={{ py: 4 }}>
              Your cart is empty.
            </Typography>
          ) : (
            <Stack spacing={2}>
              {cart.map((item) => (
                <Paper key={item.cart_id} sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                      {item.quantity}x {item.product_name}
                    </Typography>
                    {item.options.map((opt, idx) => (
                      <Typography key={idx} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        + {opt.option_item_name} (${opt.additional_price.toFixed(2)})
                      </Typography>
                    ))}
                  </Box>
                  <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                      ${item.line_total.toFixed(2)}
                    </Typography>
                    <IconButton color="error" onClick={() => handleRemoveCartItem(item.cart_id)}>
                      ✕
                    </IconButton>
                  </Stack>
                </Paper>
              ))}

              <Divider sx={{ my: 1 }} />

              <Stack spacing={1}>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">Subtotal:</Typography>
                  <Typography>${calculateSubtotal().toFixed(2)}</Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography color="text.secondary">Tax (9%):</Typography>
                  <Typography>${calculateTax().toFixed(2)}</Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                    Total:
                  </Typography>
                  <Typography variant="h6" color="primary.main" sx={{ fontWeight: 'bold' }}>
                    ${calculateTotal().toFixed(2)}
                  </Typography>
                </Stack>
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCartDrawerOpen(false)}>Continue Browsing</Button>
          <Button
            variant="contained"
            color="success"
            size="large"
            disabled={cart.length === 0 || loading}
            onClick={handleProceedToPayment}
          >
            Pay Now (${calculateTotal().toFixed(2)})
          </Button>
        </DialogActions>
      </Dialog>

      {/* STEP 2: SIMULATED PAYMENT STEP */}
      {kioskStep === 2 && (
        <Dialog open maxWidth="xs" fullWidth>
          <DialogContent sx={{ textAlign: 'center', py: 6 }}>
            <CircularProgress size={60} sx={{ mb: 3 }} />
            <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 1 }}>
              Insert or Tap Card
            </Typography>
            <Typography color="text.secondary">Simulating Network Card POS Terminal authorization...</Typography>
          </DialogContent>
        </Dialog>
      )}

      {/* STEP 3: SUCCESS RECEIPT DISPLAY */}
      {kioskStep === 3 && receiptData && (
        <Dialog open maxWidth="sm" fullWidth>
          <DialogTitle sx={{ textAlign: 'center', bgcolor: 'success.main', color: 'success.contrastText' }}>
            ORDER SUCCESSFUL!
          </DialogTitle>
          <DialogContent dividers sx={{ p: 4 }}>
            <Paper sx={{ p: 4, fontFamily: 'monospace' }} variant="outlined">
              <Typography variant="h5" align="center" sx={{ fontWeight: 'bold', mb: 1 }}>
                {receiptData.header}
              </Typography>
              <Typography variant="h4" align="center" color="primary.main" sx={{ fontWeight: 'bold', mb: 2 }}>
                ORDER #{receiptData.order_number}
              </Typography>
              <Divider sx={{ my: 2 }} />

              <Typography>Order Type: {receiptData.order_type}</Typography>
              <Typography>Terminal Ref: {receiptData.reference_number}</Typography>
              <Typography sx={{ mt: 1, fontWeight: 'bold', display: 'block' }}>
                Total Paid: ${receiptData.total_paid} ({receiptData.payment_method})
              </Typography>
              <Typography color="success.main" sx={{ fontWeight: 'bold', mt: 2, display: 'block' }}>
                Status: {receiptData.status}
              </Typography>
            </Paper>
          </DialogContent>
          <DialogActions>
            <Button variant="contained" size="large" fullWidth onClick={handleResetKiosk}>
              Done / Start New Kiosk Order
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
}

export default KioskPage;
