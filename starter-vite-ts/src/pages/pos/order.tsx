import type { Branch } from 'src/api/tenantApi';
import type { OrderHeader } from 'src/api/orderApi';
import type { Customer } from 'src/api/customerApi';
import type { Product, Category, OptionItem, OptionGroup } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect } from 'react';

import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import {
  Box,
  Tab,
  Card,
  Tabs,
  Grid,
  Stack,
  Alert,
  Paper,
  Button,
  Select,
  Dialog,
  Divider,
  MenuItem,
  Checkbox,
  TextField,
  Typography,
  IconButton,
  InputLabel,
  CardContent,
  FormControl,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControlLabel,
} from '@mui/material';

import { orderApi } from 'src/api/orderApi';
import { tenantApi } from 'src/api/tenantApi';
import { catalogApi } from 'src/api/catalogApi';
import { customerApi } from 'src/api/customerApi';
import { discountsApi } from 'src/api/discountsApi';

import { CheckoutModal } from 'src/components/CheckoutModal';

interface CartItem {
  product: Product;
  quantity: number;
  selectedOptions: OptionItem[];
  lineSubtotal: number;
}

export function PosOrderPage() {
  const { t } = useTranslation();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [orderType, setOrderType] = useState<'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'>('DINE_IN');
  const [tableNumber, setTableNumber] = useState('T-01');

  // Option Customization Dialog
  const [optionDialogOpen, setOptionDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [optionGroups, setOptionGroups] = useState<OptionGroup[]>([]);
  const [checkedOptionIds, setCheckedOptionIds] = useState<string[]>([]);

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [couponCode, setCouponCode] = useState('');
  const [appliedDiscountAmount, setAppliedDiscountAmount] = useState<number>(0);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);

  // Success state
  const [placedOrder, setPlacedOrder] = useState<OrderHeader | null>(null);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInitialData = async () => {
    try {
      const bList = await tenantApi.getBranches();
      setBranches(bList);
      if (bList.length > 0) setSelectedBranchId(bList[0].id);

      const cList = await catalogApi.getCategories();
      setCategories(cList);
      if (cList.length > 0) setActiveTab(cList[0].id);

      const pList = await catalogApi.getProducts();
      setProducts(pList);

      const custs = await customerApi.getCustomers();
      setCustomers(custs);
    } catch (err: any) {
      setError('Failed to load POS catalog data');
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  const handleOpenProductOptions = async (p: Product) => {
    setSelectedProduct(p);
    setCheckedOptionIds([]);
    try {
      const groups = await catalogApi.getOptionGroups();
      setOptionGroups(groups);
      setOptionDialogOpen(true);
    } catch (err: any) {
      // Add directly without options
      addToCart(p, []);
    }
  };

  const addToCart = (product: Product, options: OptionItem[]) => {
    let optionsSum = 0;
    options.forEach((o) => {
      optionsSum += Number(o.price_delta);
    });

    const itemUnitPrice = Number(product.base_price) + optionsSum;

    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (ci) => ci.product.id === product.id && JSON.stringify(ci.selectedOptions) === JSON.stringify(options),
      );

      if (existingIndex > -1) {
        const copy = [...prev];
        const newQty = copy[existingIndex].quantity + 1;
        copy[existingIndex] = {
          ...copy[existingIndex],
          quantity: newQty,
          lineSubtotal: newQty * itemUnitPrice,
        };
        return copy;
      }

      return [
        ...prev,
        {
          product,
          quantity: 1,
          selectedOptions: options,
          lineSubtotal: itemUnitPrice,
        },
      ];
    });
  };

  const handleConfirmAddWithOptions = () => {
    if (!selectedProduct) return;

    const chosenOptions: OptionItem[] = [];
    optionGroups.forEach((g) => {
      g.items?.forEach((i) => {
        if (checkedOptionIds.includes(i.id)) {
          chosenOptions.push(i);
        }
      });
    });

    addToCart(selectedProduct, chosenOptions);
    setOptionDialogOpen(false);
    setSelectedProduct(null);
  };

  const updateQuantity = (index: number, delta: number) => {
    setCart((prev) => {
      const copy = [...prev];
      const newQty = copy[index].quantity + delta;
      if (newQty <= 0) {
        return copy.filter((_, i) => i !== index);
      }

      let optionsSum = 0;
      copy[index].selectedOptions.forEach((o) => (optionsSum += Number(o.price_delta)));
      const unitPrice = Number(copy[index].product.base_price) + optionsSum;

      copy[index] = {
        ...copy[index],
        quantity: newQty,
        lineSubtotal: newQty * unitPrice,
      };
      return copy;
    });
  };

  // Cart financial math
  const cartSubtotal = cart.reduce((sum, item) => sum + item.lineSubtotal, 0);
  const cartTax = cartSubtotal * 0.1; // 10% VAT
  const cartTotalDue = Math.max(0, cartSubtotal + cartTax - appliedDiscountAmount);

  const handleApplyCoupon = async () => {
    if (!couponCode) return;
    try {
      const res = await discountsApi.validateCoupon(couponCode, cartSubtotal.toString());
      setAppliedDiscountAmount(Number(res.calculatedAmount));
      setCouponMessage(`Applied ${res.discount.name} (-${Number(res.calculatedAmount).toLocaleString()} IRR)`);
      setError(null);
    } catch (err: any) {
      setCouponMessage(null);
      setError(err.detail || 'Failed to apply coupon code');
    }
  };

  const handlePlaceOrder = async () => {
    if (cart.length === 0) {
      setError('Cart is empty');
      return;
    }
    if (!selectedBranchId) {
      setError('Please select a branch');
      return;
    }

    try {
      const orderPayload = {
        branch_id: selectedBranchId,
        order_type: orderType,
        customer_id: selectedCustomerId || undefined,
        coupon_code: couponCode || undefined,
        table_number: orderType === 'DINE_IN' ? tableNumber : undefined,
        items: cart.map((ci) => ({
          product_id: ci.product.id,
          quantity: ci.quantity,
          options: ci.selectedOptions.map((o) => ({ option_item_id: o.id })),
        })),
      };

      const res = await orderApi.createOrder(orderPayload);
      setPlacedOrder(res);
      setCart([]);
      setCouponCode('');
      setAppliedDiscountAmount(0);
      setCouponMessage(null);
      setError(null);
    } catch (err: any) {
      setError(err.detail || 'Failed to place order');
    }
  };

  const filteredProducts = activeTab
    ? products.filter((p) => p.category_id === activeTab)
    : products;

  return (
    <Box>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            POS Register & Order Placement
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Simulate real-time cashier order creation, option customization, and discount application
          </Typography>
        </Box>

        <Box sx={{ minWidth: 240 }}>
          <FormControl fullWidth size="small">
            <InputLabel>Active Branch</InputLabel>
            <Select
              value={selectedBranchId}
              label="Active Branch"
              onChange={(e) => setSelectedBranchId(e.target.value)}
            >
              {branches.map((b) => (
                <MenuItem key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {placedOrder && (
        <Alert
          severity="success"
          icon={<CheckCircleIcon fontSize="inherit" />}
          sx={{ mb: 3 }}
          onClose={() => setPlacedOrder(null)}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => setCheckoutModalOpen(true)}
              sx={{ fontWeight: 'bold' }}
            >
              Checkout / Pay Now
            </Button>
          }
        >
          <strong>Order Placed Successfully!</strong> Order Number: <code>{placedOrder.order_number}</code> | Total: {Number(placedOrder.total_amount).toLocaleString()} IRR
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* Left Column: Product Catalog */}
        <Grid size={{ xs: 12, md: 7, lg: 8 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 2, mb: 3 }}>
            <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
              <Tabs
                value={activeTab}
                onChange={(_, val) => setActiveTab(val)}
                variant="scrollable"
                scrollButtons="auto"
              >
                {categories.map((c) => (
                  <Tab key={c.id} label={c.name} value={c.id} sx={{ fontWeight: 'bold' }} />
                ))}
              </Tabs>
            </Box>

            <CardContent sx={{ p: 3 }}>
              <Grid container spacing={2}>
                {filteredProducts.map((p) => (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={p.id}>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 2,
                        borderRadius: 3,
                        cursor: 'pointer',
                        transition: 'transform 0.2s',
                        '&:hover': { transform: 'scale(1.02)', borderColor: 'primary.main' },
                      }}
                      onClick={() => handleOpenProductOptions(p)}
                    >
                      <Typography variant="caption" color="text.secondary">
                        <code>{p.code}</code>
                      </Typography>
                      <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                        {p.name}
                      </Typography>
                      <Typography variant="body1" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                        {Number(p.base_price).toLocaleString()} IRR
                      </Typography>
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Right Column: Active Order Cart Panel */}
        <Grid size={{ xs: 12, md: 5, lg: 4 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 3 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <ShoppingCartIcon color="primary" />
                Active Cart ({cart.length} items)
              </Typography>

              {/* Order Parameters */}
              <Stack spacing={2} sx={{ mb: 3 }}>
                <Stack direction="row" spacing={2}>
                  <FormControl fullWidth size="small">
                    <InputLabel>Order Type</InputLabel>
                    <Select
                      value={orderType}
                      label="Order Type"
                      onChange={(e) => setOrderType(e.target.value as any)}
                    >
                      <MenuItem value="DINE_IN">Dine-In</MenuItem>
                      <MenuItem value="TAKEAWAY">Takeaway</MenuItem>
                      <MenuItem value="DELIVERY">Delivery</MenuItem>
                    </Select>
                  </FormControl>

                  {orderType === 'DINE_IN' && (
                    <TextField
                      size="small"
                      label="Table #"
                      value={tableNumber}
                      onChange={(e) => setTableNumber(e.target.value)}
                      sx={{ width: 120 }}
                    />
                  )}
                </Stack>

                <FormControl fullWidth size="small">
                  <InputLabel>Customer</InputLabel>
                  <Select
                    value={selectedCustomerId}
                    label="Customer"
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                  >
                    <MenuItem value="">Walk-In Guest</MenuItem>
                    {customers.map((c) => (
                      <MenuItem key={c.id} value={c.id}>
                        {c.first_name} {c.last_name} ({c.mobile})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>

              <Divider sx={{ mb: 2 }} />

              {/* Cart Items List */}
              <Stack spacing={1.5} sx={{ maxHeight: 220, overflowY: 'auto', mb: 2 }}>
                {cart.length === 0 && (
                  <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 3 }}>
                    Cart is empty. Click a product on the left to add items.
                  </Typography>
                )}
                {cart.map((item, idx) => (
                  <Paper key={idx} variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <Box>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                          {item.product.name}
                        </Typography>
                        {item.selectedOptions.map((o) => (
                          <Typography key={o.id} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            + {o.name} ({Number(o.price_delta).toLocaleString()} IRR)
                          </Typography>
                        ))}
                        <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'primary.main', mt: 0.5 }}>
                          {item.lineSubtotal.toLocaleString()} IRR
                        </Typography>
                      </Box>

                      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                        <IconButton size="small" onClick={() => updateQuantity(idx, -1)}>
                          <RemoveIcon fontSize="small" />
                        </IconButton>
                        <Typography variant="body2" sx={{ fontWeight: 'bold', px: 1 }}>
                          {item.quantity}
                        </Typography>
                        <IconButton size="small" onClick={() => updateQuantity(idx, 1)}>
                          <AddIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
              </Stack>

              {/* Coupon Input */}
              <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <TextField
                  size="small"
                  placeholder="Coupon Code (e.g. WELCOME500K)"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  fullWidth
                />
                <Button variant="outlined" size="small" onClick={handleApplyCoupon} sx={{ fontWeight: 'bold' }}>
                  Apply
                </Button>
              </Stack>

              {couponMessage && (
                <Alert severity="success" sx={{ mb: 2, py: 0 }}>
                  {couponMessage}
                </Alert>
              )}

              <Divider sx={{ mb: 2 }} />

              {/* Financial Totals Summary */}
              <Stack spacing={1} sx={{ mb: 3 }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">Subtotal:</Typography>
                  <Typography variant="body2">{cartSubtotal.toLocaleString()} IRR</Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">VAT Tax (10%):</Typography>
                  <Typography variant="body2">{cartTax.toLocaleString()} IRR</Typography>
                </Stack>
                {appliedDiscountAmount > 0 && (
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="error.main">Discount Deduction:</Typography>
                    <Typography variant="body2" color="error.main">-{appliedDiscountAmount.toLocaleString()} IRR</Typography>
                  </Stack>
                )}
                <Divider />
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Total Due:</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                    {cartTotalDue.toLocaleString()} IRR
                  </Typography>
                </Stack>
              </Stack>

              <Button
                variant="contained"
                size="large"
                fullWidth
                disabled={cart.length === 0}
                onClick={handlePlaceOrder}
                sx={{ fontWeight: 'bold', py: 1.5 }}
              >
                Place Order
              </Button>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Option Customization Dialog */}
      <Dialog open={optionDialogOpen} onClose={() => setOptionDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          Customize {selectedProduct?.name}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {optionGroups.map((g) => (
            <Box key={g.id} sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                {g.name}
              </Typography>
              {g.items?.map((item) => (
                <FormControlLabel
                  key={item.id}
                  control={
                    <Checkbox
                      checked={checkedOptionIds.includes(item.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setCheckedOptionIds((prev) => [...prev, item.id]);
                        } else {
                          setCheckedOptionIds((prev) => prev.filter((id) => id !== item.id));
                        }
                      }}
                    />
                  }
                  label={`${item.name} (+${Number(item.price_delta).toLocaleString()} IRR)`}
                />
              ))}
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOptionDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleConfirmAddWithOptions} sx={{ fontWeight: 'bold' }}>
            Add to Cart
          </Button>
        </DialogActions>
      </Dialog>

      <CheckoutModal
        open={checkoutModalOpen}
        orderId={placedOrder?.id || null}
        onClose={() => setCheckoutModalOpen(false)}
      />
    </Box>
  );
}
