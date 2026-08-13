import type { Branch } from 'src/api/tenantApi';
import type { OrderHeader } from 'src/api/orderApi';
import type { Customer } from 'src/api/customerApi';
import type { ManualDiscount } from 'src/api/discountsApi';
import type { Product, Category, OptionItem, OptionGroup } from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import ClearIcon from '@mui/icons-material/Clear';
import PauseIcon from '@mui/icons-material/Pause';
import SearchIcon from '@mui/icons-material/Search';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteIcon from '@mui/icons-material/Delete';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import VerifiedIcon from '@mui/icons-material/Verified';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import {
  Box,
  Tab,
  Card,
  Chip,
  Tabs,
  Grid,
  Badge,
  Stack,
  Alert,
  Paper,
  Drawer,
  Button,
  Select,
  Dialog,
  Divider,
  Tooltip,
  MenuItem,
  Checkbox,
  TextField,
  Typography,
  IconButton,
  InputLabel,
  CardContent,
  FormControl,
  DialogTitle,
  ToggleButton,
  DialogContent,
  DialogActions,
  InputAdornment,
  FormControlLabel,
  CircularProgress,
  ToggleButtonGroup,
} from '@mui/material';

import { MoneyUtil } from 'src/utils/money.util';

import { orderApi } from 'src/api/orderApi';
import { tenantApi } from 'src/api/tenantApi';
import { catalogApi } from 'src/api/catalogApi';
import { customerApi } from 'src/api/customerApi';
import { discountsApi } from 'src/api/discountsApi';

import { CheckoutModal } from 'src/components/CheckoutModal';
import { ApprovalModal } from 'src/components/approval/ApprovalModal';

interface CartItem {
  product: Product;
  quantity: number;
  selectedOptions: OptionItem[];
  lineSubtotal: string;
}

const DISCOUNT_REASONS = [
  { code: 'CUSTOMER_SATISFACTION', label: 'Customer Satisfaction / Courtesy' },
  { code: 'STAFF_DISCOUNT', label: 'Staff / Employee Privilege' },
  { code: 'PROMOTION_OVERRIDE', label: 'Promotion Override' },
  { code: 'DAMAGED_ITEM', label: 'Minor Defect / Packaging Issue' },
  { code: 'VIP_COURTESY', label: 'VIP Club Member Courtesy' },
];

export function PosOrderPage() {
  const { t: _t } = useTranslation();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [orderType, setOrderType] = useState<'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'>('DINE_IN');
  const [tableNumber, setTableNumber] = useState('T-01');

  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState('');

  // Option Customization Dialog
  const [optionDialogOpen, setOptionDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [optionGroups, setOptionGroups] = useState<OptionGroup[]>([]);
  const [checkedOptionIds, setCheckedOptionIds] = useState<string[]>([]);

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeDraftOrderId, setActiveDraftOrderId] = useState<string | null>(null);

  // Held Orders Drawer state
  const [heldOrdersDrawerOpen, setHeldOrdersDrawerOpen] = useState(false);
  const [heldOrders, setHeldOrders] = useState<OrderHeader[]>([]);
  const [loadingHeldOrders, setLoadingHeldOrders] = useState(false);
  const [holdSuccessMessage, setHoldSuccessMessage] = useState<string | null>(null);

  // Coupon state
  const [couponCode, setCouponCode] = useState('');

  // Manual Discount Modal state
  const [manualDiscountModalOpen, setManualDiscountModalOpen] = useState(false);
  const [manualCalcType, setManualCalcType] = useState<'PERCENTAGE' | 'FIXED_AMOUNT'>('PERCENTAGE');
  const [manualValue, setManualValue] = useState<string>('');
  const [manualReasonCode, setManualReasonCode] = useState<string>('CUSTOMER_SATISFACTION');
  const [manualApprovalRequestId, setManualApprovalRequestId] = useState<string | undefined>(undefined);
  const [appliedManualDiscount, setAppliedManualDiscount] = useState<ManualDiscount | null>(null);

  // Quote & Totals
  const [appliedDiscountAmount, setAppliedDiscountAmount] = useState<string>('0');
  const [discountMessage, setDiscountMessage] = useState<string | null>(null);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [approvalReason, setApprovalReason] = useState<string | null>(null);

  // Approval Modal
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);

  // Success state
  const [placedOrder, setPlacedOrder] = useState<OrderHeader | null>(null);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHeldOrders = useCallback(async (branchId?: string) => {
    try {
      setLoadingHeldOrders(true);
      const bId = branchId || selectedBranchId;
      const orders = await orderApi.getOrders({ branchId: bId || undefined, state: 'DRAFT' });
      setHeldOrders(orders);
    } catch {
      // ignore
    } finally {
      setLoadingHeldOrders(false);
    }
  }, [selectedBranchId]);

  const loadInitialData = async () => {
    try {
      const bList = await tenantApi.getBranches();
      setBranches(bList);
      const initialBranch = bList.length > 0 ? bList[0].id : '';
      if (initialBranch) setSelectedBranchId(initialBranch);

      const cList = await catalogApi.getCategories();
      setCategories(cList);
      if (cList.length > 0) setActiveTab(cList[0].id);

      const pList = await catalogApi.getProducts();
      setProducts(pList);

      const custs = await customerApi.getCustomers();
      setCustomers(custs);

      if (initialBranch) {
        fetchHeldOrders(initialBranch);
      }
    } catch {
      setError('Failed to load POS catalog data');
    }
  };

  useEffect(() => {
    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedBranchId) {
      fetchHeldOrders(selectedBranchId);
    }
  }, [selectedBranchId, fetchHeldOrders]);

  const handleOpenProductOptions = async (p: Product) => {
    setSelectedProduct(p);
    setCheckedOptionIds([]);
    try {
      const groups = await catalogApi.getOptionGroups();
      if (groups && groups.length > 0) {
        setOptionGroups(groups);
        setOptionDialogOpen(true);
      } else {
        addToCart(p, []);
      }
    } catch {
      addToCart(p, []);
    }
  };

  const addToCart = (product: Product, options: OptionItem[]) => {
    if (placedOrder) setPlacedOrder(null);
    if (holdSuccessMessage) setHoldSuccessMessage(null);

    const optionsSum = options.reduce((sum, o) => MoneyUtil.add(sum, o.price_delta || '0', 2), '0');
    const itemUnitPrice = MoneyUtil.add(product.base_price || '0', optionsSum, 2);

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
          lineSubtotal: MoneyUtil.multiply(itemUnitPrice, newQty.toString(), 2),
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
    if (placedOrder) setPlacedOrder(null);
    if (holdSuccessMessage) setHoldSuccessMessage(null);

    setCart((prev) => {
      const copy = [...prev];
      const newQty = copy[index].quantity + delta;
      if (newQty <= 0) {
        return copy.filter((_, i) => i !== index);
      }

      const optionsSum = copy[index].selectedOptions.reduce(
        (sum, o) => MoneyUtil.add(sum, o.price_delta || '0', 2),
        '0',
      );
      const unitPrice = MoneyUtil.add(copy[index].product.base_price || '0', optionsSum, 2);

      copy[index] = {
        ...copy[index],
        quantity: newQty,
        lineSubtotal: MoneyUtil.multiply(unitPrice, newQty.toString(), 2),
      };
      return copy;
    });
  };

  const handleClearCart = () => {
    setCart([]);
    setActiveDraftOrderId(null);
    setCouponCode('');
    setManualValue('');
    setAppliedManualDiscount(null);
    setManualApprovalRequestId(undefined);
    setAppliedDiscountAmount('0');
    setDiscountMessage(null);
    setApprovalRequired(false);
    setApprovalReason(null);
    setError(null);
  };

  // Hold / Park Cart Order
  const handleHoldOrder = async () => {
    if (cart.length === 0) {
      setError('Cart is empty, cannot hold order');
      return;
    }
    if (!selectedBranchId) {
      setError('Please select an active branch first');
      return;
    }

    try {
      const orderPayload: any = {
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

      let draft: OrderHeader;
      if (activeDraftOrderId) {
        draft = await orderApi.updateDraft(activeDraftOrderId, orderPayload);
      } else {
        draft = await orderApi.createOrder(orderPayload);
      }

      setHoldSuccessMessage(`Order #${draft.order_number} held successfully in Drafts.`);
      handleClearCart();
      fetchHeldOrders(selectedBranchId);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to hold order');
    }
  };

  // Resume a Held Order
  const handleResumeOrder = async (order: OrderHeader) => {
    try {
      const fullOrder = await orderApi.getOrderById(order.id);
      setActiveDraftOrderId(fullOrder.id);
      setSelectedBranchId(fullOrder.branch_id);
      setOrderType((fullOrder.order_type as any) || 'DINE_IN');
      if (fullOrder.table_number) setTableNumber(fullOrder.table_number);
      setSelectedCustomerId(fullOrder.customer_id || '');
      setCouponCode(fullOrder.coupon_code || '');

      // Reconstruct cart items
      const loadedCart: CartItem[] = [];
      for (const item of fullOrder.items || []) {
        const prod: Product = products.find((p) => p.id === item.product_id) || ({
          id: item.product_id,
          name: (item as any).item_name || (item as any).product_name || (item as any).name || 'Product',
          code: 'PROD',
          base_price: item.unit_price,
          category_id: '',
          is_active: true,
          unit_of_measure: 'PCS',
          tax_rate: '0.10',
        } as Product);

        const selectedOpts: OptionItem[] = (item.options || []).map((opt: any) => ({
          id: opt.option_item_id || opt.id,
          name: opt.option_name || opt.name || 'Modifier',
          price_delta: opt.price_delta || '0',
          option_group_id: '',
          code: opt.code || 'OPT',
          is_default: false,
          sort_order: 0,
        }));

        loadedCart.push({
          product: prod,
          quantity: Number(item.quantity) || 1,
          selectedOptions: selectedOpts,
          lineSubtotal: (item as any).subtotal || (item as any).line_total || MoneyUtil.multiply(item.unit_price, item.quantity?.toString() || '1', 2),
        });
      }

      setCart(loadedCart);
      setHeldOrdersDrawerOpen(false);
      setHoldSuccessMessage(null);
      setError(null);
    } catch {
      setError('Failed to resume held draft order');
    }
  };

  // Discard a Held Order
  const handleDiscardHeldOrder = async (orderId: string) => {
    try {
      await orderApi.cancelOrder(orderId, undefined, 'Discarded from held drafts');
      if (activeDraftOrderId === orderId) {
        setActiveDraftOrderId(null);
      }
      fetchHeldOrders(selectedBranchId);
    } catch {
      setError('Failed to discard held draft');
    }
  };

  // Cart financial math via decimal-safe MoneyUtil
  const cartSubtotal = cart.reduce((sum, item) => MoneyUtil.add(sum, item.lineSubtotal, 2), '0');
  const cartTax = MoneyUtil.multiply(cartSubtotal, '0.10', 2); // 10% VAT
  const subtotalPlusTax = MoneyUtil.add(cartSubtotal, cartTax, 2);
  const cartTotalDue = MoneyUtil.greaterThan(subtotalPlusTax, appliedDiscountAmount)
    ? MoneyUtil.subtract(subtotalPlusTax, appliedDiscountAmount, 2)
    : '0';

  // Live Auto-Quote
  const evaluateQuote = useCallback(async () => {
    if (cart.length === 0) {
      setAppliedDiscountAmount('0');
      setDiscountMessage(null);
      setApprovalRequired(false);
      setApprovalReason(null);
      return;
    }

    try {
      const payload: any = {
        orderDraft: {
          branchId: selectedBranchId,
          customerId: selectedCustomerId || undefined,
          orderType,
          items: cart.map((ci) => ({
            productId: ci.product.id,
            unitPrice: (ci.product.base_price || (ci.product as any).price || '0').toString(),
            quantity: ci.quantity.toString(),
          })),
        },
      };

      if (couponCode.trim()) {
        payload.couponCode = couponCode.trim();
      }

      if (appliedManualDiscount && MoneyUtil.greaterThan(appliedManualDiscount.value, '0')) {
        payload.manualDiscount = {
          calculation_type: appliedManualDiscount.calculation_type,
          value: appliedManualDiscount.value,
          reasonCode: appliedManualDiscount.reasonCode,
          approvalRequestId: appliedManualDiscount.approvalRequestId,
        };
      }

      const quoteRes = await discountsApi.quoteDiscounts(payload);

      const discAmount = MoneyUtil.format(quoteRes.discountTotal || '0', 2);
      setAppliedDiscountAmount(discAmount);

      setApprovalRequired(!!quoteRes.approvalRequired);
      setApprovalReason(quoteRes.approvalReason || null);

      const applied = quoteRes.consideredDiscounts?.find((d) => d.status === 'APPLIED');
      const rejected = quoteRes.consideredDiscounts?.find((d) => d.status === 'REJECTED');

      if (applied) {
        const approvedBadge = appliedManualDiscount?.approvalRequestId ? ' [Manager Approved]' : '';
        setDiscountMessage(
          `Applied ${applied.campaignName}${approvedBadge}: -${MoneyUtil.formatCurrency(discAmount)} IRR`
        );
        setError(null);
      } else if (rejected) {
        setDiscountMessage(null);
        if (!quoteRes.approvalRequired) {
          setError(rejected.rejectionReason || 'Discount was not applied');
        }
      } else {
        setDiscountMessage(null);
      }
    } catch {
      // Ignore routine typing auto-quote errors
    }
  }, [cart, selectedCustomerId, couponCode, appliedManualDiscount, selectedBranchId, orderType]);

  useEffect(() => {
    evaluateQuote();
  }, [evaluateQuote]);

  // Coupon Actions
  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    setAppliedManualDiscount(null);
    evaluateQuote();
  };

  const handleClearCoupon = () => {
    setCouponCode('');
    setDiscountMessage(null);
    setError(null);
  };

  // Manual Discount Actions
  const handleApplyManualDiscount = () => {
    if (!manualValue || !MoneyUtil.greaterThan(manualValue, '0')) {
      setError('Please enter a valid discount amount or percentage');
      return;
    }

    if (manualCalcType === 'PERCENTAGE' && Number(manualValue) > 100) {
      setError('Percentage discount cannot exceed 100%');
      return;
    }

    setCouponCode('');
    setAppliedManualDiscount({
      calculation_type: manualCalcType,
      value: manualValue,
      reasonCode: manualReasonCode,
      approvalRequestId: manualApprovalRequestId,
    });
    setManualDiscountModalOpen(false);
    setError(null);
  };

  const handleClearManualDiscount = () => {
    setManualValue('');
    setAppliedManualDiscount(null);
    setManualApprovalRequestId(undefined);
    setApprovalRequired(false);
    setApprovalReason(null);
    setDiscountMessage(null);
    setManualDiscountModalOpen(false);
    setError(null);
  };

  // Preset chip clicks
  const handleSelectPreset = (val: string) => {
    setManualValue(val);
  };

  // Approval Success Handler
  const handleApprovalSuccess = (_pin: string, requestId?: string) => {
    if (requestId) {
      setManualApprovalRequestId(requestId);
      if (appliedManualDiscount) {
        setAppliedManualDiscount({
          ...appliedManualDiscount,
          approvalRequestId: requestId,
        });
      }
    }
    setApprovalRequired(false);
    setApprovalReason(null);
  };

  // Order Placement
  const handlePlaceOrder = async () => {
    if (cart.length === 0) {
      setError('Cart is empty');
      return;
    }
    if (!selectedBranchId) {
      setError('Please select a branch');
      return;
    }
    if (approvalRequired) {
      setError('Cannot place order: Manager approval is required for this discount.');
      setApprovalModalOpen(true);
      return;
    }

    try {
      const orderPayload: any = {
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

      let draftId: string;
      if (activeDraftOrderId) {
        const updated = await orderApi.updateDraft(activeDraftOrderId, orderPayload);
        draftId = updated.id;
      } else {
        const draft = await orderApi.createOrder(orderPayload);
        draftId = draft.id;
      }

      const submitPayload = manualApprovalRequestId ? { approvalRequestIds: [manualApprovalRequestId] } : undefined;
      const submitted = await orderApi.submitOrder(draftId, submitPayload);

      setPlacedOrder(submitted);
      setCheckoutModalOpen(true);
      handleClearCart();
      fetchHeldOrders(selectedBranchId);
      setError(null);
    } catch (err: any) {
      setError(err.detail || err.message || 'Failed to place order');
    }
  };

  // Product Filtering (Search + Category)
  const filteredProducts = products.filter((p) => {
    const matchesCategory = !activeTab || p.category_id === activeTab;
    const q = searchQuery.toLowerCase().trim();
    if (!q) return matchesCategory;

    const matchesName = (p.name || '').toLowerCase().includes(q);
    const matchesCode = (p.code || '').toLowerCase().includes(q);
    return matchesCategory && (matchesName || matchesCode);
  });

  return (
    <Box>
      {/* Header Banner */}
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2.5, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
            POS Register & Order Placement
          </Typography>
          <Typography variant="body2" color="text.secondary">
            High-density cashier touch terminal: search, modifiers, manual discounts modal, supervisor approvals & parked carts
          </Typography>
        </Box>

        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          {/* Held Orders Drawer Trigger Button */}
          <Tooltip title="View and resume parked draft orders">
            <Button
              variant="outlined"
              color="inherit"
              startIcon={
                <Badge badgeContent={heldOrders.length} color="warning">
                  <PauseIcon />
                </Badge>
              }
              onClick={() => {
                fetchHeldOrders();
                setHeldOrdersDrawerOpen(true);
              }}
              sx={{ fontWeight: 600, px: 2, height: 40 }}
            >
              Held Orders ({heldOrders.length})
            </Button>
          </Tooltip>

          <Box sx={{ minWidth: 220 }}>
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
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {holdSuccessMessage && (
        <Alert severity="info" sx={{ mb: 2.5 }} onClose={() => setHoldSuccessMessage(null)}>
          {holdSuccessMessage}
        </Alert>
      )}

      {placedOrder && (
        <Alert
          severity="success"
          icon={<CheckCircleIcon fontSize="inherit" />}
          sx={{ mb: 2.5 }}
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
          <strong>Order Placed Successfully!</strong> Order Number: <code>{placedOrder.order_number}</code> | Total: {MoneyUtil.formatCurrency(placedOrder.total_amount)} IRR
        </Alert>
      )}

      {activeDraftOrderId && (
        <Alert
          severity="warning"
          sx={{ mb: 2.5, py: 0.5 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={handleClearCart}
              sx={{ fontWeight: 600 }}
            >
              Cancel Resumed Draft
            </Button>
          }
        >
          Currently Editing Held Draft Order (Changes will update this draft upon hold or checkout).
        </Alert>
      )}

      <Grid container spacing={2.5}>
        {/* Left Column: High-Density Product Catalog with Categories Rail */}
        <Grid size={{ xs: 12, md: 7, lg: 8 }}>
          <Card
            sx={{
              borderRadius: 3,
              boxShadow: 2,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 700,
              overflow: 'hidden',
            }}
          >
            {/* Catalog Search Header */}
            <Box
              sx={{
                p: 1.5,
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <TextField
                fullWidth
                size="small"
                placeholder="Search products by English/Persian name, SKU or code (e.g. Cheese, همبرگر, PROD-01)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon color="action" fontSize="small" />
                      </InputAdornment>
                    ),
                    endAdornment: searchQuery ? (
                      <InputAdornment position="end">
                        <IconButton size="small" onClick={() => setSearchQuery('')}>
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </InputAdornment>
                    ) : null,
                  },
                }}
              />
              <Chip
                label={`${filteredProducts.length} items`}
                size="small"
                variant="outlined"
                color="primary"
                sx={{ fontWeight: 'bold', flexShrink: 0 }}
              />
            </Box>

            {/* Catalog Body: Category Rail + Product Cards Grid */}
            <Box sx={{ display: 'flex', flexGrow: 1, flexDirection: { xs: 'column', sm: 'row' } }}>
              {/* Vertical Category Rail */}
              <Box
                sx={{
                  width: { xs: '100%', sm: 170, md: 190 },
                  flexShrink: 0,
                  borderRight: { xs: 'none', sm: 1 },
                  borderBottom: { xs: 1, sm: 'none' },
                  borderColor: 'divider',
                  bgcolor: 'background.neutral',
                  p: 1.25,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    px: 1.25,
                    py: 0.75,
                    fontWeight: 700,
                    color: 'text.secondary',
                    textTransform: 'uppercase',
                    letterSpacing: 0.8,
                    fontSize: '0.7rem',
                  }}
                >
                  Categories
                </Typography>
                <Tabs
                  orientation="vertical"
                  variant="scrollable"
                  scrollButtons="auto"
                  value={activeTab}
                  onChange={(_, val) => setActiveTab(val)}
                  sx={{
                    flexGrow: 1,
                    '& .MuiTabs-scroller': {
                      overflowY: 'auto !important',
                    },
                    '& .MuiTab-root': {
                      minHeight: 40,
                      justifyContent: 'flex-start',
                      alignItems: 'center',
                      textAlign: 'left',
                      borderRadius: 2,
                      py: 1,
                      px: 1.5,
                      my: 0.25,
                      fontWeight: 600,
                      fontSize: '0.8125rem',
                      color: 'text.secondary',
                      transition: 'all 0.2s ease',
                      '&.Mui-selected': {
                        bgcolor: 'primary.main',
                        color: 'primary.contrastText',
                        boxShadow: (theme) => `0 2px 8px ${theme.palette.primary.main}35`,
                      },
                      '&:hover:not(.Mui-selected)': {
                        bgcolor: 'action.hover',
                        color: 'text.primary',
                      },
                    },
                    '& .MuiTabs-indicator': {
                      display: 'none',
                    },
                  }}
                >
                  <Tab label="All Items" value="" />
                  {categories.map((c) => (
                    <Tab key={c.id} label={c.name} value={c.id} />
                  ))}
                </Tabs>
              </Box>

              {/* Products Grid: Denser 3-4 column layout */}
              <CardContent sx={{ p: 2, flexGrow: 1, overflowY: 'auto', maxHeight: { xs: 'auto', sm: 720 } }}>
                {filteredProducts.length === 0 ? (
                  <Box sx={{ py: 8, textAlign: 'center' }}>
                    <Typography variant="body1" color="text.secondary">
                      No products found matching your search or category.
                    </Typography>
                  </Box>
                ) : (
                  <Grid container spacing={1.5}>
                    {filteredProducts.map((p) => (
                      <Grid size={{ xs: 6, sm: 6, md: 4, lg: 3 }} key={p.id}>
                        <Paper
                          variant="outlined"
                          sx={{
                            p: 1.5,
                            borderRadius: 2.5,
                            cursor: 'pointer',
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            transition: 'all 0.2s ease-in-out',
                            bgcolor: 'background.paper',
                            '&:hover': {
                              transform: 'translateY(-2px)',
                              boxShadow: (theme) => `0 4px 12px ${theme.palette.primary.main}25`,
                              borderColor: 'primary.main',
                            },
                          }}
                          onClick={() => handleOpenProductOptions(p)}
                        >
                          <Box>
                            <Chip
                              label={p.code}
                              size="small"
                              variant="outlined"
                              sx={{
                                fontSize: '0.625rem',
                                height: 18,
                                mb: 0.75,
                                fontWeight: 700,
                                letterSpacing: 0.5,
                              }}
                            />
                            <Typography
                              variant="subtitle2"
                              sx={{
                                fontWeight: 'bold',
                                mb: 0.5,
                                lineHeight: 1.25,
                                color: 'text.primary',
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {p.name}
                            </Typography>
                          </Box>
                          <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'primary.main', mt: 1 }}>
                            {MoneyUtil.formatCurrency(p.base_price)} IRR
                          </Typography>
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                )}
              </CardContent>
            </Box>
          </Card>
        </Grid>

        {/* Right Column: High-Capacity Order Cart Panel */}
        <Grid size={{ xs: 12, md: 5, lg: 4 }}>
          <Card sx={{ borderRadius: 3, boxShadow: 3, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 700 }}>
            <CardContent sx={{ p: 2.5, display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
              {/* Header: Cart title + Quick Actions */}
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <Typography variant="h6" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <ShoppingCartIcon color="primary" fontSize="small" />
                  Active Cart ({cart.reduce((s, i) => s + i.quantity, 0)} items)
                </Typography>
                {cart.length > 0 && (
                  <Stack direction="row" spacing={0.75}>
                    <Button
                      size="small"
                      color="warning"
                      variant="outlined"
                      startIcon={<PauseIcon fontSize="small" />}
                      onClick={handleHoldOrder}
                      sx={{ textTransform: 'none', fontWeight: 600, py: 0.25, px: 1 }}
                    >
                      Hold
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      startIcon={<DeleteIcon fontSize="small" />}
                      onClick={handleClearCart}
                      sx={{ textTransform: 'none', py: 0.25, px: 1 }}
                    >
                      Clear
                    </Button>
                  </Stack>
                )}
              </Stack>

              {/* Order Parameters (Compact inline layout) */}
              <Stack spacing={1.25} sx={{ mb: 1.5 }}>
                <Stack direction="row" spacing={1.25}>
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
                      sx={{ width: 110, flexShrink: 0 }}
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

              <Divider sx={{ mb: 1.5 }} />

              {/* High-Capacity Scrollable Cart Items List (Displays multiple items comfortably) */}
              <Box sx={{ flexGrow: 1, overflowY: 'auto', minHeight: 220, maxHeight: { xs: 260, md: 340 }, mb: 1.5, pr: 0.5 }}>
                {cart.length === 0 ? (
                  <Box sx={{ py: 6, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      Cart is empty. Tap products to add items.
                    </Typography>
                  </Box>
                ) : (
                  <Stack spacing={1}>
                    {cart.map((item, idx) => (
                      <Paper key={idx} variant="outlined" sx={{ p: 1.25, borderRadius: 2, bgcolor: 'background.paper' }}>
                        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                          <Box sx={{ pr: 1, minWidth: 0 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'text.primary', fontSize: '0.875rem' }} noWrap>
                              {item.product.name}
                            </Typography>
                            {item.selectedOptions.length > 0 && (
                              <Typography
                                variant="caption"
                                sx={{ display: 'block', color: 'text.secondary', fontWeight: 500, fontSize: '0.725rem' }}
                                noWrap
                              >
                                + {item.selectedOptions.map((o) => o.name).join(', ')}
                              </Typography>
                            )}
                            <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'primary.main', mt: 0.25, display: 'block' }}>
                              {MoneyUtil.formatCurrency(item.lineSubtotal)} IRR
                            </Typography>
                          </Box>

                          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                            <IconButton size="small" onClick={() => updateQuantity(idx, -1)} sx={{ p: 0.5 }}>
                              <RemoveIcon fontSize="small" />
                            </IconButton>
                            <Typography variant="body2" sx={{ fontWeight: 'bold', px: 0.75, minWidth: 20, textAlign: 'center' }}>
                              {item.quantity}
                            </Typography>
                            <IconButton size="small" onClick={() => updateQuantity(idx, 1)} sx={{ p: 0.5 }}>
                              <AddIcon fontSize="small" />
                            </IconButton>
                          </Stack>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                )}
              </Box>

              <Divider sx={{ mb: 1.5 }} />

              {/* Compact Coupon Code & Manual Discount Bar */}
              <Stack direction="row" spacing={1} sx={{ mb: 1.25, alignItems: 'center' }}>
                <TextField
                  size="small"
                  placeholder="Coupon Code"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  fullWidth
                  slotProps={{
                    input: {
                      endAdornment: couponCode ? (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={handleClearCoupon} sx={{ p: 0.25 }}>
                            <ClearIcon fontSize="small" />
                          </IconButton>
                        </InputAdornment>
                      ) : null,
                    },
                  }}
                />
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleApplyCoupon}
                  disabled={!couponCode.trim()}
                  sx={{ fontWeight: 'bold', flexShrink: 0, px: 1.75 }}
                >
                  Apply
                </Button>
                <Tooltip title="Configure Cashier Manual Discount in modal">
                  <Button
                    variant={appliedManualDiscount ? 'contained' : 'outlined'}
                    color={appliedManualDiscount ? 'warning' : 'inherit'}
                    size="small"
                    startIcon={<LocalOfferIcon fontSize="small" />}
                    onClick={() => setManualDiscountModalOpen(true)}
                    sx={{ fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap' }}
                  >
                    {appliedManualDiscount ? 'Discount (Active)' : 'Discount'}
                  </Button>
                </Tooltip>
              </Stack>

              {/* Discount Feedback / Active Discount Chip */}
              {discountMessage && (
                <Alert
                  severity="success"
                  icon={<VerifiedIcon fontSize="inherit" />}
                  sx={{ mb: 1.5, py: 0.25, alignItems: 'center', fontSize: '0.8rem' }}
                >
                  {discountMessage}
                </Alert>
              )}

              {/* Supervisor Approval Required Alert */}
              {approvalRequired && (
                <Alert
                  severity="warning"
                  sx={{ mb: 1.5, py: 0.5 }}
                  action={
                    <Button
                      color="inherit"
                      size="small"
                      startIcon={<LockOpenIcon fontSize="small" />}
                      onClick={() => setApprovalModalOpen(true)}
                      sx={{ fontWeight: 'bold' }}
                    >
                      Authorize PIN
                    </Button>
                  }
                >
                  <Typography variant="body2" sx={{ fontWeight: 'bold', fontSize: '0.8rem' }}>
                    Supervisor Approval Required
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', fontSize: '0.725rem' }}>
                    {approvalReason || 'Discount exceeds standard cashier limit.'}
                  </Typography>
                </Alert>
              )}

              {/* Financial Totals Summary */}
              <Stack spacing={0.75} sx={{ mb: 2, mt: 'auto' }}>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">Subtotal:</Typography>
                  <Typography variant="body2">{MoneyUtil.formatCurrency(cartSubtotal)} IRR</Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">VAT (10%):</Typography>
                  <Typography variant="body2">{MoneyUtil.formatCurrency(cartTax)} IRR</Typography>
                </Stack>
                {MoneyUtil.greaterThan(appliedDiscountAmount, '0') && (
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" color="error.main" sx={{ fontWeight: 600 }}>
                      Discount:
                    </Typography>
                    <Typography variant="body2" color="error.main" sx={{ fontWeight: 'bold' }}>
                      -{MoneyUtil.formatCurrency(appliedDiscountAmount)} IRR
                    </Typography>
                  </Stack>
                )}
                <Divider />
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', pt: 0.5 }}>
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Total Due:</Typography>
                  <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                    {MoneyUtil.formatCurrency(cartTotalDue)} IRR
                  </Typography>
                </Stack>
              </Stack>

              {/* Bottom Place Order CTA */}
              <Stack direction="row" spacing={1.5}>
                <Button
                  variant="outlined"
                  color="warning"
                  disabled={cart.length === 0}
                  onClick={handleHoldOrder}
                  startIcon={<PauseIcon />}
                  sx={{ fontWeight: 'bold', py: 1.25, flexShrink: 0 }}
                >
                  Hold
                </Button>
                <Button
                  variant="contained"
                  size="large"
                  fullWidth
                  disabled={cart.length === 0}
                  onClick={handlePlaceOrder}
                  sx={{ fontWeight: 'bold', py: 1.25, fontSize: '1rem' }}
                >
                  {activeDraftOrderId ? 'Update & Place Order' : 'Place Order'}
                </Button>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Manual Discount Modal Dialog */}
      <Dialog
        open={manualDiscountModalOpen}
        onClose={() => setManualDiscountModalOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
          <LocalOfferIcon color="primary" />
          Apply Manual Cashier Discount
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Stack spacing={2}>
            {/* Calculation Type Toggle */}
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', pt: 1 }}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={manualCalcType}
                onChange={(_, val) => {
                  if (val) {
                    setManualCalcType(val);
                    setManualValue('');
                  }
                }}
                sx={{ flexShrink: 0 }}
              >
                <ToggleButton value="PERCENTAGE" sx={{ fontWeight: 600, px: 1.5 }}>
                  % Percent
                </ToggleButton>
                <ToggleButton value="FIXED_AMOUNT" sx={{ fontWeight: 600, px: 1.5 }}>
                  IRR Fixed
                </ToggleButton>
              </ToggleButtonGroup>

              <TextField
                size="small"
                type="number"
                placeholder={manualCalcType === 'PERCENTAGE' ? 'e.g. 10 (%)' : 'e.g. 50000 (IRR)'}
                value={manualValue}
                onChange={(e) => setManualValue(e.target.value)}
                fullWidth
              />
            </Stack>

            {/* Quick Preset Chips */}
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, display: 'block', fontWeight: 600 }}>
                Quick Presets:
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
                {manualCalcType === 'PERCENTAGE'
                  ? ['5', '10', '15', '20', '25'].map((pct) => (
                      <Chip
                        key={pct}
                        label={`${pct}%`}
                        size="small"
                        variant={manualValue === pct ? 'filled' : 'outlined'}
                        color={Number(pct) > 10 ? 'warning' : 'primary'}
                        onClick={() => handleSelectPreset(pct)}
                        sx={{ fontWeight: 600, cursor: 'pointer' }}
                      />
                    ))
                  : ['20000', '50000', '100000', '200000'].map((amt) => (
                      <Chip
                        key={amt}
                        label={`${MoneyUtil.formatCurrency(amt)}`}
                        size="small"
                        variant={manualValue === amt ? 'filled' : 'outlined'}
                        color={Number(amt) > 50000 ? 'warning' : 'primary'}
                        onClick={() => handleSelectPreset(amt)}
                        sx={{ fontWeight: 600, cursor: 'pointer' }}
                      />
                    ))}
              </Stack>
            </Box>

            {/* Reason Selector */}
            <FormControl fullWidth size="small">
              <InputLabel>Discount Justification Reason</InputLabel>
              <Select
                value={manualReasonCode}
                label="Discount Justification Reason"
                onChange={(e) => setManualReasonCode(e.target.value)}
              >
                {DISCOUNT_REASONS.map((r) => (
                  <MenuItem key={r.code} value={r.code}>
                    {r.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2.5, pt: 1 }}>
          {appliedManualDiscount && (
            <Button color="error" onClick={handleClearManualDiscount} sx={{ mr: 'auto' }}>
              Remove Discount
            </Button>
          )}
          <Button onClick={() => setManualDiscountModalOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleApplyManualDiscount}
            disabled={!manualValue || Number(manualValue) <= 0}
            sx={{ fontWeight: 'bold' }}
          >
            Apply to Cart
          </Button>
        </DialogActions>
      </Dialog>

      {/* Held Orders (Parked Carts) Slide-over Drawer */}
      <Drawer
        anchor="right"
        open={heldOrdersDrawerOpen}
        onClose={() => setHeldOrdersDrawerOpen(false)}
        slotProps={{
          paper: {
            sx: { width: { xs: '100%', sm: 420, md: 460 }, p: 3, bgcolor: 'background.paper' },
          },
        }}
      >
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
              <PauseIcon color="warning" />
              Held Draft Orders
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Resume, modify, or discard parked cashier carts
            </Typography>
          </Box>
          <IconButton size="small" onClick={() => setHeldOrdersDrawerOpen(false)}>
            <ClearIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        {loadingHeldOrders ? (
          <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={32} />
          </Box>
        ) : heldOrders.length === 0 ? (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <Typography variant="body1" color="text.secondary">
              No draft orders currently on hold.
            </Typography>
          </Box>
        ) : (
          <Stack spacing={2} sx={{ overflowY: 'auto', flexGrow: 1, pr: 0.5 }}>
            {heldOrders.map((ho) => (
              <Paper
                key={ho.id}
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 2.5,
                  borderColor: ho.id === activeDraftOrderId ? 'primary.main' : 'divider',
                  bgcolor: ho.id === activeDraftOrderId ? 'action.selected' : 'background.paper',
                }}
              >
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                      {ho.order_number}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
                      <Chip label={ho.order_type} size="small" variant="outlined" sx={{ fontWeight: 600, height: 20, fontSize: '0.7rem' }} />
                      {ho.table_number && (
                        <Chip label={`Table: ${ho.table_number}`} size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                      )}
                    </Stack>
                  </Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                    {MoneyUtil.formatCurrency(ho.total_amount || ho.grand_total || '0')} IRR
                  </Typography>
                </Stack>

                <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
                  <AccessTimeIcon sx={{ fontSize: 14 }} />
                  {new Date(ho.placed_at || (ho as any).created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {ho.items?.length ? ` • ${ho.items.length} items` : ''}
                </Typography>

                <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', mt: 1 }}>
                  <Button
                    size="small"
                    color="error"
                    variant="text"
                    startIcon={<DeleteIcon fontSize="small" />}
                    onClick={() => handleDiscardHeldOrder(ho.id)}
                    sx={{ textTransform: 'none' }}
                  >
                    Discard
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<PlayArrowIcon fontSize="small" />}
                    onClick={() => handleResumeOrder(ho)}
                    sx={{ textTransform: 'none', fontWeight: 'bold' }}
                  >
                    Resume Order
                  </Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </Drawer>

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
                  label={`${item.name} (+${MoneyUtil.formatCurrency(item.price_delta)} IRR)`}
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

      {/* Manager Approval Modal */}
      <ApprovalModal
        open={approvalModalOpen}
        onClose={() => setApprovalModalOpen(false)}
        onSuccess={handleApprovalSuccess}
        actionName="DISCOUNT"
        detailsText={approvalReason || 'Manual cashier discount authorization'}
        createRequest
      />

      {/* Checkout / Payment Modal */}
      <CheckoutModal
        open={checkoutModalOpen}
        orderId={placedOrder?.id || null}
        onClose={() => setCheckoutModalOpen(false)}
      />
    </Box>
  );
}
