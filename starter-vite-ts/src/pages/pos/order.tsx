import type { OrderHeader } from 'src/api/orderApi';
import type { DiningTable } from 'src/api/dineInApi';
import type { DeliveryZone } from 'src/api/deliveryApi';
import type { ManualDiscount } from 'src/api/discountsApi';
import type { Customer, CustomerAddress } from 'src/api/customerApi';
import type {
  Product,
  Category,
  OptionItem,
  OptionGroup,
  DailyStockLine,
  ProductVariant,
  ProductAvailability,
} from 'src/api/catalogApi';

import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import ClearIcon from '@mui/icons-material/Clear';
import PauseIcon from '@mui/icons-material/Pause';
import DeleteIcon from '@mui/icons-material/Delete';
import RemoveIcon from '@mui/icons-material/Remove';
import SearchIcon from '@mui/icons-material/Search';
import EditNoteIcon from '@mui/icons-material/EditNote';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import TableBarIcon from '@mui/icons-material/TableBar';
import VerifiedIcon from '@mui/icons-material/Verified';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PointOfSaleIcon from '@mui/icons-material/PointOfSale';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import TakeoutDiningIcon from '@mui/icons-material/TakeoutDining';
import DeliveryDiningIcon from '@mui/icons-material/DeliveryDining';
import DoNotDisturbOnOutlinedIcon from '@mui/icons-material/DoNotDisturbOnOutlined';
import {
  Box,
  Tab,
  Card,
  Chip,
  Tabs,
  Grid,
  Menu,
  Badge,
  Stack,
  Alert,
  Paper,
  Radio,
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
  RadioGroup,
  CardContent,
  FormControl,
  DialogTitle,
  ToggleButton,
  DialogContent,
  DialogActions,
  InputAdornment,
  LinearProgress,
  CircularProgress,
  FormControlLabel,
  ToggleButtonGroup,
} from '@mui/material';

import { fTime } from 'src/utils/format-time';
import { MoneyUtil } from 'src/utils/money.util';

import { orderApi } from 'src/api/orderApi';
import { dineInApi } from 'src/api/dineInApi';
import { paymentApi } from 'src/api/paymentApi';
import { catalogApi } from 'src/api/catalogApi';
import { settingsApi } from 'src/api/settingsApi';
import { customerApi } from 'src/api/customerApi';
import { deliveryApi } from 'src/api/deliveryApi';
import { discountsApi } from 'src/api/discountsApi';
import { useBranchContext } from 'src/contexts/branch-context';

import { CheckoutModal } from 'src/components/CheckoutModal';
import { toast, showErrorToast } from 'src/components/snackbar';
import { ApprovalModal } from 'src/components/approval/ApprovalModal';
import { useRegisterShift } from 'src/components/shift/use-register-shift';
import { PosShiftBar, PosShiftGate } from 'src/components/shift/pos-shift';

import { PosStopDialog } from './pos-stop-dialog';

interface CartItem {
  product: Product;
  selectedVariant?: ProductVariant;
  quantity: number;
  selectedOptions: OptionItem[];
  lineSubtotal: string;
}

const DISCOUNT_REASONS = [
  { code: 'CUSTOMER_SATISFACTION', label: 'Customer Satisfaction / Courtesy' },
  { code: 'STAFF_DISCOUNT', label: 'Staff / Employee Privilege' },
  { code: 'DAMAGED_ITEM', label: 'Minor Defect / Packaging Issue' },
  { code: 'VIP_COURTESY', label: 'VIP Club Member Courtesy' },
];

function formatRejectionReason(reason?: string, fallback: string = 'Discount was not applied') {
  switch (reason) {
    case 'INVALID_OR_INACTIVE_COUPON':
      return 'Coupon code is invalid or inactive';
    case 'COUPON_NOT_YET_ACTIVE':
      return 'Coupon code is not active yet';
    case 'COUPON_EXPIRED':
      return 'Coupon code has expired';
    case 'COUPON_MAX_USES_REACHED':
      return 'Coupon has reached its maximum usage limit';
    case 'COUPON_ALREADY_REDEEMED_BY_CUSTOMER':
      return 'Coupon has already been used by this customer';
    case 'COUPON_MINIMUM_NOT_MET':
      return 'Order subtotal does not meet the minimum required for this coupon';
    case 'NEVER_DISCOUNT':
      return 'Selected items in cart are excluded from discounts';
    default:
      return reason || fallback;
  }
}

export function PosOrderPage() {
  const { t } = useTranslation();

  const { selectedBranchId, setSelectedBranchId } = useBranchContext();
  // The register this device is and the shift open on it; the till stays shut without one.
  const register = useRegisterShift();
  const shiftBlocked = !register.shift;
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [products, setProducts] = useState<Product[]>([]);
  const [availabilities, setAvailabilities] = useState<ProductAvailability[]>([]);
  // 86 from the tile: long-press, right-click or the tile's stop button opens it.
  const [stopProduct, setStopProduct] = useState<Product | null>(null);
  const longPress = React.useRef<{ timer?: number; fired: boolean }>({ fired: false });
  // Items outside their selling window right now (breakfast after 11:00), with the window.
  const [offSchedule, setOffSchedule] = useState<Map<string, string>>(new Map());
  // Today's stock counts at this branch; a product at zero is sold out until tomorrow's count.
  const [dailyStock, setDailyStock] = useState<DailyStockLine[]>([]);
  // This branch's in-store prices (its price list's, else base), keyed `product:variant`. The
  // server charges these, so the grid and cart show them too.
  const [branchPrices, setBranchPrices] = useState<Map<string, string>>(new Map());
  const priceOf = useCallback(
    (product: Product, variant?: ProductVariant | null) =>
      branchPrices.get(`${product.id}:${variant?.id || ''}`) ?? (variant ? variant.base_price : product.base_price || '0'),
    [branchPrices]
  );
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerAddresses, setCustomerAddresses] = useState<CustomerAddress[]>([]);
  const [selectedDeliveryAddressId, setSelectedDeliveryAddressId] = useState<string>('');
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [selectedDeliveryZoneId, setSelectedDeliveryZoneId] = useState<string>('');
  const [deliveryOptionsLoading, setDeliveryOptionsLoading] = useState(false);
  const [deliveryOptionsError, setDeliveryOptionsError] = useState<string | null>(null);
  const [addAddressOpen, setAddAddressOpen] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);
  const [newAddress, setNewAddress] = useState({ title: '', address_text: '', postal_code: '', is_default: false });
  const [orderType, setOrderType] = useState<'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'>('DINE_IN');
  const [tableNumber, setTableNumber] = useState('T-01');
  const [selectedTableId, setSelectedTableId] = useState<string>('');
  const [diningTables, setDiningTables] = useState<DiningTable[]>([]);
  const [tableMenuAnchorEl, setTableMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [customTableInput, setCustomTableInput] = useState('');

  // Order Notes Dialog state
  const [orderNotes, setOrderNotes] = useState<string>('');
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [tempNotesInput, setTempNotesInput] = useState<string>('');

  // Quick Add Customer Dialog state
  const [quickAddCustomerOpen, setQuickAddCustomerOpen] = useState(false);
  const [newCustFirstName, setNewCustFirstName] = useState('');
  const [newCustLastName, setNewCustLastName] = useState('');
  const [newCustMobile, setNewCustMobile] = useState('');
  const [newCustEmail, setNewCustEmail] = useState('');
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);

  const handleQuickAddCustomer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newCustFirstName.trim() || !newCustMobile.trim()) {
      setCustomerError('First name and Mobile number are required');
      return;
    }
    try {
      setCreatingCustomer(true);
      setCustomerError(null);
      const created = await customerApi.createCustomer({
        code: newCustMobile.trim(),
        first_name: newCustFirstName.trim(),
        last_name: newCustLastName.trim(),
        mobile: newCustMobile.trim(),
        // No credit limit: credit is granted centrally, by head office, not at the counter.
        email: newCustEmail.trim() || undefined,
      });
      const updatedList = await customerApi.getCustomers();
      setCustomers(updatedList);
      setSelectedCustomerId(created.id);
      setNewCustFirstName('');
      setNewCustLastName('');
      setNewCustMobile('');
      setNewCustEmail('');
      setQuickAddCustomerOpen(false);
    } catch (err: any) {
      setCustomerError(err.detail || err.message || 'Failed to create customer');
    } finally {
      setCreatingCustomer(false);
    }
  };

  // Search & Filtering
  const [searchQuery, setSearchQuery] = useState('');

  // Option & Variant Customization Dialog
  const [optionDialogOpen, setOptionDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productVariants, setProductVariants] = useState<ProductVariant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [optionGroups, setOptionGroups] = useState<OptionGroup[]>([]);
  const [checkedOptionIds, setCheckedOptionIds] = useState<string[]>([]);

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeDraftOrderId, setActiveDraftOrderId] = useState<string | null>(null);

  // Held Orders Drawer state
  const [heldOrdersDrawerOpen, setHeldOrdersDrawerOpen] = useState(false);
  const [heldOrders, setHeldOrders] = useState<OrderHeader[]>([]);
  const [loadingHeldOrders, setLoadingHeldOrders] = useState(false);
  const [loadingInitialData, setLoadingInitialData] = useState(true);
  const [holdingOrder, setHoldingOrder] = useState(false);
  const [resumingOrderId, setResumingOrderId] = useState<string | null>(null);
  const [holdSuccessMessage, setHoldSuccessMessage] = useState<string | null>(null);

  // Coupon state
  const [couponInput, setCouponInput] = useState('');
  const [appliedCouponCode, setAppliedCouponCode] = useState('');

  // Manual Discount Modal state
  const [manualDiscountModalOpen, setManualDiscountModalOpen] = useState(false);
  const [manualCalcType, setManualCalcType] = useState<'PERCENTAGE' | 'FIXED_AMOUNT'>('PERCENTAGE');
  const [manualValue, setManualValue] = useState<string>('');
  const [manualReasonCode, setManualReasonCode] = useState<string>('CUSTOMER_SATISFACTION');
  const [manualApprovalRequestId, setManualApprovalRequestId] = useState<string | undefined>(undefined);
  const [appliedManualDiscount, setAppliedManualDiscount] = useState<ManualDiscount | null>(null);

  // Quote & Totals
  const [appliedDiscountAmount, setAppliedDiscountAmount] = useState<string>('0');
  const [quotedTaxAmount, setQuotedTaxAmount] = useState<string>('0');
  const [quotedDeliveryFee, setQuotedDeliveryFee] = useState<string>('0');
  const [discountMessage, setDiscountMessage] = useState<string | null>(null);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [approvalReason, setApprovalReason] = useState<string | null>(null);

  // Approval Modal
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);

  // Success state
  const [placedOrder, setPlacedOrder] = useState<OrderHeader | null>(null);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const customerSelectRef = React.useRef<HTMLDivElement | null>(null);
  const deliveryRestoreRef = React.useRef<{ customerId?: string; addressId?: string; zoneId?: string }>({});

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
      setLoadingInitialData(true);
      // Today's stops load with the stock counts below, for the selected branch.
      const [cList, pList, custs, tList] = await Promise.all([
        catalogApi.getCategories(),
        catalogApi.getProducts(),
        customerApi.getCustomers(),
        dineInApi.getTables(undefined, selectedBranchId).catch(() => [] as DiningTable[]),
      ]);
      setCategories(cList);
      if (cList.length > 0) setActiveTab(cList[0].id);
      // A product taken off the menu is not sold; the register refuses it too.
      setProducts(pList.filter((p) => p.is_active !== false));
      setCustomers(custs);
      setDiningTables(tList);
      if (tList.length > 0 && (!tableNumber || tableNumber === 'T-01')) {
        setTableNumber(tList[0].code || tList[0].table_number || 'T-01');
        setSelectedTableId(tList[0].id);
      }
    } catch {
      setError('Failed to load POS catalog data');
    } finally {
      setLoadingInitialData(false);
    }
  };

  useEffect(() => {
    loadInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Selling windows open and close, and items get 86'd from other screens, while the register
  // sits open, so the grid checks each minute. Stops are this branch's plus chain-wide ones.
  useEffect(() => {
    const refresh = () => {
      catalogApi
        .getOffScheduleProducts(selectedBranchId || undefined)
        .then((list) => setOffSchedule(new Map(list.map((o) => [o.product_id, o.windows]))))
        .catch(() => setOffSchedule(new Map()));
      catalogApi
        .getAvailabilities(selectedBranchId || undefined)
        // A stop on one channel (Snappfood only) leaves the item on sale at the counter.
        .then((list) => setAvailabilities(list.filter((a) => !a.channel)))
        .catch(() => undefined);
      catalogApi
        .getBranchPrices(selectedBranchId || undefined)
        .then((sheet) => setBranchPrices(new Map(sheet.items.map((i) => [`${i.product_id}:${i.variant_id || ''}`, i.price]))))
        .catch(() => undefined);
    };
    const refreshStock = () =>
      catalogApi
        .getDailyStock(selectedBranchId || undefined)
        .then(setDailyStock)
        .catch(() => setDailyStock([]));
    refresh();
    refreshStock();
    const stockTimer = window.setInterval(refreshStock, 60_000);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(stockTimer);
    };
  }, [selectedBranchId]);

  useEffect(() => {
    if (selectedBranchId) {
      fetchHeldOrders(selectedBranchId);
    }
  }, [selectedBranchId, fetchHeldOrders]);

  useEffect(() => {
    if (orderType !== 'DELIVERY' || !selectedCustomerId) {
      setCustomerAddresses([]);
      setSelectedDeliveryAddressId('');
      return undefined;
    }
    let cancelled = false;
    setDeliveryOptionsLoading(true);
    setDeliveryOptionsError(null);
    const restoreAddressId = deliveryRestoreRef.current.customerId === selectedCustomerId
      ? deliveryRestoreRef.current.addressId
      : undefined;
    if (!restoreAddressId) setSelectedDeliveryAddressId('');
    customerApi.getAddresses(selectedCustomerId)
      .then((addresses) => {
        if (cancelled) return;
        setCustomerAddresses(addresses);
        const defaultAddress = addresses.find((address) => address.is_default);
        if (restoreAddressId && addresses.some((address) => address.id === restoreAddressId)) {
          setSelectedDeliveryAddressId(restoreAddressId);
        } else if (defaultAddress) setSelectedDeliveryAddressId(defaultAddress.id);
        else if (addresses.length === 1) setSelectedDeliveryAddressId(addresses[0].id);
      })
      .catch(() => !cancelled && setDeliveryOptionsError('Unable to load this customer’s delivery addresses.'))
      .finally(() => !cancelled && setDeliveryOptionsLoading(false));
    return () => { cancelled = true; };
  }, [orderType, selectedCustomerId]);

  useEffect(() => {
    if (orderType !== 'DELIVERY' || !selectedBranchId) {
      setDeliveryZones([]);
      setSelectedDeliveryZoneId('');
      return undefined;
    }
    let cancelled = false;
    setDeliveryOptionsLoading(true);
    setDeliveryOptionsError(null);
    const restoreZoneId = deliveryRestoreRef.current.zoneId;
    if (!restoreZoneId) setSelectedDeliveryZoneId('');
    deliveryApi.getZones(selectedBranchId)
      .then((zones) => {
        if (cancelled) return;
        const activeZones = zones.filter((zone) => zone.is_active && zone.branch_id === selectedBranchId);
        setDeliveryZones(activeZones);
        if (restoreZoneId && activeZones.some((zone) => zone.id === restoreZoneId)) setSelectedDeliveryZoneId(restoreZoneId);
      })
      .catch(() => !cancelled && setDeliveryOptionsError('Unable to load delivery zones for this branch.'))
      .finally(() => !cancelled && setDeliveryOptionsLoading(false));
    return () => { cancelled = true; };
  }, [orderType, selectedBranchId]);

  useEffect(() => {
    if (orderType !== 'DELIVERY' || !selectedDeliveryAddressId || deliveryZones.length === 0 || selectedDeliveryZoneId) return;
    const postalCode = customerAddresses.find((address) => address.id === selectedDeliveryAddressId)?.postal_code?.trim();
    if (!postalCode) return;
    const matches = deliveryZones.filter((zone) => (zone.postal_prefixes || []).some((prefix) => postalCode.startsWith(prefix)));
    const longestPrefix = Math.max(...matches.flatMap((zone) => (zone.postal_prefixes || []).filter((prefix) => postalCode.startsWith(prefix)).map((prefix) => prefix.length)));
    const bestMatches = matches.filter((zone) => (zone.postal_prefixes || []).some((prefix) => prefix.length === longestPrefix && postalCode.startsWith(prefix)));
    if (bestMatches.length === 1) setSelectedDeliveryZoneId(bestMatches[0].id);
  }, [orderType, selectedDeliveryAddressId, customerAddresses, deliveryZones, selectedDeliveryZoneId]);

  const handleOpenProductOptions = async (p: Product) => {
    setSelectedProduct(p);
    setCheckedOptionIds([]);
    try {
      const [vList, groups] = await Promise.all([
        catalogApi.getProductVariants(p.id).catch(() => [] as ProductVariant[]),
        // A product offers only the add-on groups attached to it; the register refuses any other choice.
        catalogApi
          .getProductById(p.id)
          .then((full) => (full.optionGroups || []) as OptionGroup[])
          .catch(() => [] as OptionGroup[]),
      ]);

      // A variant or add-on taken off sale today is not offered; nor is an add-on this
      // product leaves out of its group.
      const live = availabilities.filter(
        (a) => a.is_suspended && (!a.suspended_until || new Date(a.suspended_until) > new Date())
      );
      const stoppedVariants = new Set(live.filter((a) => a.product_id === p.id && a.variant_id).map((a) => a.variant_id));
      const stoppedAddons = new Set(live.filter((a) => a.option_item_id).map((a) => a.option_item_id));
      const soldOutVariants = new Set(
        dailyStock.filter((s) => s.product_id === p.id && s.variant_id && s.remaining <= 0).map((s) => s.variant_id)
      );
      const onSale = (vList || []).filter((v) => !stoppedVariants.has(v.id) && !soldOutVariants.has(v.id));
      if ((vList || []).length > 0 && onSale.length === 0) {
        setError(t('pos.itemSuspendedNotice', { name: p.name }));
        return;
      }
      const offered = (groups || []).map((g) => ({
        ...g,
        items: (g.items || []).filter(
          (i) => !(g.excluded_item_ids || []).includes(i.id) && !stoppedAddons.has(i.id)
        ),
      }));

      setProductVariants(onSale);
      setOptionGroups(offered);

      const defaultVariant = onSale.find((v) => v.is_default) || onSale[0];
      setSelectedVariantId(defaultVariant?.id || '');

      if (onSale.length > 1 || offered.length > 0) {
        setOptionDialogOpen(true);
      } else {
        addToCart(p, defaultVariant, []);
      }
    } catch {
      addToCart(p, undefined, []);
    }
  };

  const addToCart = (product: Product, variant: ProductVariant | undefined, options: OptionItem[]) => {
    if (placedOrder) setPlacedOrder(null);
    if (holdSuccessMessage) setHoldSuccessMessage(null);

    const basePrice = priceOf(product, variant);
    const optionsSum = options.reduce((sum, o) => MoneyUtil.add(sum, o.price_delta || '0', 2), '0');
    const itemUnitPrice = MoneyUtil.add(basePrice, optionsSum, 2);

    setCart((prev) => {
      const existingIndex = prev.findIndex(
        (ci) =>
          ci.product.id === product.id &&
          ci.selectedVariant?.id === variant?.id &&
          JSON.stringify(ci.selectedOptions) === JSON.stringify(options),
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
          selectedVariant: variant,
          quantity: 1,
          selectedOptions: options,
          lineSubtotal: itemUnitPrice,
        },
      ];
    });
  };

  // No line goes to the kitchen with a required group empty (a combo's drink, a burger's
  // bread) or a group overfilled; the register refuses the same.
  const unfilledSlot = optionGroups.find((g) => {
    const count = (g.items || []).filter((i) => checkedOptionIds.includes(i.id)).length;
    const min = Math.max(g.min_selection || 0, g.is_required ? 1 : 0);
    return count < min || (!!g.max_selection && count > g.max_selection);
  });

  const handleConfirmAddWithOptions = () => {
    if (!selectedProduct) return;

    const chosenVariant = productVariants.find((v) => v.id === selectedVariantId);

    const chosenOptions: OptionItem[] = [];
    optionGroups.forEach((g) => {
      g.items?.forEach((i) => {
        if (checkedOptionIds.includes(i.id)) {
          chosenOptions.push(i);
        }
      });
    });

    addToCart(selectedProduct, chosenVariant, chosenOptions);
    setOptionDialogOpen(false);
    setSelectedProduct(null);
    setProductVariants([]);
    setSelectedVariantId('');
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
      const basePrice = priceOf(copy[index].product, copy[index].selectedVariant);
      const unitPrice = MoneyUtil.add(basePrice, optionsSum, 2);

      copy[index] = {
        ...copy[index],
        quantity: newQty,
        lineSubtotal: MoneyUtil.multiply(unitPrice, newQty.toString(), 2),
      };
      return copy;
    });
  };

  const handleClearCart = useCallback(() => {
    setCart([]);
    setActiveDraftOrderId(null);
    setCouponInput('');
    setAppliedCouponCode('');
    setManualValue('');
    setAppliedManualDiscount(null);
    setManualApprovalRequestId(undefined);
    setAppliedDiscountAmount('0');
    setQuotedTaxAmount('0');
    setQuotedDeliveryFee('0');
    setDiscountMessage(null);
    setApprovalRequired(false);
    setApprovalReason(null);
    setOrderNotes('');
    setSelectedCustomerId('');
    setSelectedDeliveryAddressId('');
    setSelectedDeliveryZoneId('');
    setCustomerAddresses([]);
    deliveryRestoreRef.current = {};
    setError(null);
  }, []);

  const deliveryReady = useCallback(() => {
    if (orderType !== 'DELIVERY') return true;
    if (!selectedCustomerId) {
      setError(t('pos.deliveryContext.customerRequired'));
      toast.warning(t('pos.deliveryContext.customerRequired'));
      customerSelectRef.current?.focus();
      return false;
    }
    if (!selectedDeliveryAddressId) {
      setError(t('pos.deliveryContext.addressRequired'));
      toast.warning(t('pos.deliveryContext.addressRequired'));
      return false;
    }
    if (!selectedDeliveryZoneId) {
      setError(t('pos.deliveryContext.zoneRequired'));
      toast.warning(t('pos.deliveryContext.zoneRequired'));
      return false;
    }
    return true;
  }, [orderType, selectedCustomerId, selectedDeliveryAddressId, selectedDeliveryZoneId, t]);

  const handleCreateAddress = async () => {
    if (!selectedCustomerId || !newAddress.title.trim() || !newAddress.address_text.trim()) {
      setDeliveryOptionsError(t('pos.deliveryContext.fieldsRequired'));
      return;
    }
    try {
      setAddingAddress(true);
      const created = await customerApi.createAddress(selectedCustomerId, {
        title: newAddress.title.trim(),
        address_text: newAddress.address_text.trim(),
        postal_code: newAddress.postal_code.trim() || undefined,
        is_default: newAddress.is_default,
      });
      const addresses = await customerApi.getAddresses(selectedCustomerId);
      setCustomerAddresses(addresses);
      setSelectedDeliveryAddressId(created.id);
      setSelectedDeliveryZoneId('');
      setNewAddress({ title: '', address_text: '', postal_code: '', is_default: false });
      setAddAddressOpen(false);
      setDeliveryOptionsError(null);
    } catch (err: any) {
      setDeliveryOptionsError(err.detail || err.message || t('pos.deliveryContext.addFailed'));
    } finally {
      setAddingAddress(false);
    }
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
    if (!deliveryReady()) return;

    try {
      setHoldingOrder(true);
      const orderPayload: any = {
        branch_id: selectedBranchId,
        order_type: orderType,
        customer_id: selectedCustomerId || undefined,
        delivery_address_id: orderType === 'DELIVERY' ? selectedDeliveryAddressId : undefined,
        delivery_zone_id: orderType === 'DELIVERY' ? selectedDeliveryZoneId : undefined,
        coupon_code: appliedCouponCode || undefined,
        table_id: orderType === 'DINE_IN' ? selectedTableId || undefined : undefined,
        table_number: orderType === 'DINE_IN' ? tableNumber : undefined,
        notes: orderNotes.trim() || undefined,
        items: cart.map((ci) => ({
          product_id: ci.product.id,
          variant_id: ci.selectedVariant?.id || undefined,
          variant_name: ci.selectedVariant?.name || undefined,
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
      toast.success(`Order #${draft.order_number} held in Drafts`);
      handleClearCart();
      await fetchHeldOrders(selectedBranchId);
      setError(null);
    } catch (err: any) {
      const msg = err.detail || err.message || 'Failed to hold order';
      setError(msg);
      showErrorToast(err, msg);
    } finally {
      setHoldingOrder(false);
    }
  };

  // Resume a Held Order
  const handleResumeOrder = async (order: OrderHeader) => {
    try {
      setResumingOrderId(order.id);
      const fullOrder = await orderApi.getOrderById(order.id);
      deliveryRestoreRef.current = {
        customerId: fullOrder.customer_id,
        addressId: fullOrder.customer_address_id,
        zoneId: fullOrder.delivery_zone_id,
      };
      setActiveDraftOrderId(fullOrder.id);
      setSelectedBranchId(fullOrder.branch_id);
      setOrderType((fullOrder.order_type as any) || 'DINE_IN');
      if (fullOrder.table_number) setTableNumber(fullOrder.table_number);
      setSelectedTableId(fullOrder.table_id || '');
      setSelectedCustomerId(fullOrder.customer_id || '');
      setSelectedDeliveryAddressId(fullOrder.customer_address_id || '');
      setSelectedDeliveryZoneId(fullOrder.delivery_zone_id || '');
      setCouponInput(fullOrder.coupon_code || '');
      setAppliedCouponCode(fullOrder.coupon_code || '');
      setOrderNotes(fullOrder.notes || '');

      // Reconstruct cart items
      const loadedCart: CartItem[] = await Promise.all((fullOrder.items || []).map(async (item) => {
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

        let selectedVariant: ProductVariant | undefined;
        if ((item as any).variant_id) {
          const variants = prod.variants?.length
            ? prod.variants
            : await catalogApi.getProductVariants(item.product_id).catch(() => [] as ProductVariant[]);
          selectedVariant = variants.find((variant) => variant.id === (item as any).variant_id);
          if (!selectedVariant) {
            selectedVariant = {
              id: (item as any).variant_id,
              product_id: item.product_id,
              code: 'HELD-VARIANT',
              name: (item as any).variant_name || 'Selected variant',
              base_price: item.unit_price,
              is_default: false,
              sort_order: 0,
              is_active: true,
            };
          }
        }

        const selectedOpts: OptionItem[] = (item.options || []).map((opt: any) => ({
          id: opt.option_item_id || opt.id,
          name: opt.option_item_name || opt.option_name || opt.name || 'Modifier',
          price_delta: opt.price_delta || '0',
          option_group_id: '',
          code: opt.code || 'OPT',
          is_default: false,
          sort_order: 0,
        }));

        return {
          product: prod,
          selectedVariant,
          quantity: Number(item.quantity) || 1,
          selectedOptions: selectedOpts,
          lineSubtotal: (item as any).subtotal || (item as any).line_total || MoneyUtil.multiply(item.unit_price, item.quantity?.toString() || '1', 2),
        };
      }));

      setCart(loadedCart);
      setHeldOrdersDrawerOpen(false);
      setHoldSuccessMessage(null);
      setError(null);
      toast.success(`Resumed draft #${fullOrder.order_number}`);
    } catch (err: any) {
      setError('Failed to resume held draft order');
      showErrorToast(err, 'Failed to resume held draft order');
    } finally {
      setResumingOrderId(null);
    }
  };

  // Discard a Held Order
  const handleDiscardHeldOrder = async (orderId: string) => {
    try {
      await orderApi.cancelOrder(orderId, undefined, 'Discarded from held drafts');
      if (activeDraftOrderId === orderId) {
        handleClearCart();
      } else if (selectedBranchId) {
        fetchHeldOrders(selectedBranchId);
      }
      toast.info('Held draft order discarded');
      setError(null);
    } catch (err: any) {
      const msg = 'Failed to discard held draft';
      setError(msg);
      showErrorToast(err, msg);
    }
  };

  // Cart financial math via decimal-safe MoneyUtil
  const cartSubtotal = cart.reduce((sum, item) => MoneyUtil.add(sum, item.lineSubtotal, 2), '0');
  const cartTax = quotedTaxAmount;
  const subtotalPlusTax = MoneyUtil.add(MoneyUtil.add(cartSubtotal, cartTax, 2), quotedDeliveryFee, 2);
  const cartTotalDue = MoneyUtil.greaterThan(subtotalPlusTax, appliedDiscountAmount)
    ? MoneyUtil.subtract(subtotalPlusTax, appliedDiscountAmount, 2)
    : '0';

  // Live Auto-Quote
  const evaluateQuote = useCallback(async () => {
    if (cart.length === 0) {
      setAppliedDiscountAmount('0');
      setQuotedTaxAmount('0');
      setQuotedDeliveryFee('0');
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
          deliveryFee: orderType === 'DELIVERY'
            ? (deliveryZones.find((zone) => zone.id === selectedDeliveryZoneId)?.fee || '0')
            : '0',
          items: cart.map((ci) => ({
            productId: ci.product.id,
            variantId: ci.selectedVariant?.id || undefined,
            unitPrice: priceOf(ci.product, ci.selectedVariant).toString(),
            quantity: ci.quantity.toString(),
          })),
        },
      };

      if (appliedCouponCode.trim()) {
        payload.couponCode = appliedCouponCode.trim();
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
      setQuotedTaxAmount(MoneyUtil.format(quoteRes.taxTotal || '0', 2));
      setQuotedDeliveryFee(MoneyUtil.format(quoteRes.deliveryFee || (orderType === 'DELIVERY' ? deliveryZones.find((zone) => zone.id === selectedDeliveryZoneId)?.fee || '0' : '0'), 2));

      setApprovalRequired(!!quoteRes.approvalRequired);
      setApprovalReason(quoteRes.approvalReason || null);

      const applied = quoteRes.consideredDiscounts?.find((d) => d.status === 'APPLIED');
      const rejected = quoteRes.consideredDiscounts?.find((d) => d.status === 'REJECTED');

      if (applied) {
        const approvedBadge = appliedManualDiscount?.approvalRequestId ? ' [Manager Approved]' : '';
        const msg = `Applied ${applied.name}${approvedBadge}: -${MoneyUtil.formatCurrency(discAmount)} IRR`;
        setDiscountMessage(msg);
        setError(null);
        if (appliedCouponCode) {
          toast.success(msg);
        }
      } else if (rejected) {
        setDiscountMessage(null);
        const reasonMsg = formatRejectionReason(rejected.rejectionReason);
        if (appliedCouponCode) {
          toast.error(reasonMsg);
          setAppliedCouponCode('');
        }
      } else {
        setDiscountMessage(null);
      }
    } catch (err: any) {
      if (appliedCouponCode) {
        showErrorToast(err, 'Failed to evaluate coupon discount');
        setAppliedCouponCode('');
      }
    }
  }, [cart, selectedCustomerId, appliedCouponCode, appliedManualDiscount, selectedBranchId, orderType, selectedDeliveryZoneId, deliveryZones, priceOf]);

  useEffect(() => {
    evaluateQuote();
  }, [evaluateQuote]);

  // Coupon Actions
  const handleApplyCoupon = () => {
    const trimmed = couponInput.trim().toUpperCase();
    if (!trimmed) {
      toast.error('Please enter a coupon code');
      return;
    }
    if (cart.length === 0) {
      toast.error('Cart is empty. Add items to order before applying a coupon.');
      return;
    }
    setAppliedManualDiscount(null);
    setAppliedCouponCode(trimmed);
  };

  const handleClearCoupon = () => {
    setCouponInput('');
    setAppliedCouponCode('');
    setDiscountMessage(null);
    setError(null);
  };

  // Manual Discount Actions
  const handleApplyManualDiscount = () => {
    if (!manualValue || !MoneyUtil.greaterThan(manualValue, '0')) {
      const msg = 'Please enter a valid discount amount or percentage';
      setError(msg);
      toast.error(msg);
      return;
    }

    if (manualCalcType === 'PERCENTAGE' && Number(manualValue) > 30) {
      const msg = 'Percentage discount exceeds maximum policy ceiling of 30%';
      setError(msg);
      toast.error(msg);
      return;
    }

    if (manualCalcType === 'FIXED_AMOUNT' && Number(manualValue) > 300000) {
      const msg = 'Fixed discount exceeds maximum policy ceiling of 300,000 IRR';
      setError(msg);
      toast.error(msg);
      return;
    }

    const exceedsCashierLimit =
      (manualCalcType === 'PERCENTAGE' && Number(manualValue) > 10) ||
      (manualCalcType === 'FIXED_AMOUNT' && Number(manualValue) > 50000);

    if (exceedsCashierLimit) {
      // Prompt Manager PIN authorization immediately
      setApprovalReason(
        `Manual discount ${manualValue}${manualCalcType === 'PERCENTAGE' ? '%' : ' IRR'} exceeds standard Cashier limit (10% / 50,000 IRR). Manager PIN authorization required.`
      );
      setManualDiscountModalOpen(false);
      setApprovalModalOpen(true);
      setError(null);
      return;
    }

    setCouponInput('');
    setAppliedCouponCode('');
    setAppliedManualDiscount({
      calculation_type: manualCalcType,
      value: manualValue,
      reasonCode: manualReasonCode,
      approvalRequestId: undefined,
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
      setCouponInput('');
      setAppliedCouponCode('');
      setAppliedManualDiscount({
        calculation_type: manualCalcType,
        value: manualValue,
        reasonCode: manualReasonCode,
        approvalRequestId: requestId,
      });
    }
    setApprovalRequired(false);
    setApprovalReason(null);
    setError(null);
  };

  // Submit must carry the same manual discount that was priced into the on-screen quote.
  // Sending only the approval id makes the server price the order differently from what
  // the cashier saw and the manager approved.
  const buildSubmitPayload = useCallback(() => {
    if (!appliedManualDiscount || !MoneyUtil.greaterThan(appliedManualDiscount.value, '0')) {
      return undefined;
    }
    const approvalRequestId = appliedManualDiscount.approvalRequestId || manualApprovalRequestId;
    return {
      manualDiscount: { ...appliedManualDiscount, approvalRequestId },
      ...(approvalRequestId ? { approvalRequestIds: [approvalRequestId] } : {}),
    };
  }, [appliedManualDiscount, manualApprovalRequestId]);

  // 1-Click Direct Terminal POS Checkout (90% Iranian Standard)
  const [terminalPayLoading, setTerminalPayLoading] = useState(false);

  const handleDirectTerminalPay = useCallback(async () => {
    if (cart.length === 0) {
      toast.warning(t('pos.cartEmpty', 'Cart is empty. Add items first.'));
      return;
    }
    if (!selectedBranchId) {
      setError('Please select a branch');
      return;
    }
    if (!deliveryReady()) return;
    if (approvalRequired) {
      setError('Cannot place order: Manager approval is required for this discount.');
      setApprovalModalOpen(true);
      return;
    }

    setTerminalPayLoading(true);
    try {
      const orderPayload: any = {
        branch_id: selectedBranchId,
        order_type: orderType,
        customer_id: selectedCustomerId || undefined,
        delivery_address_id: orderType === 'DELIVERY' ? selectedDeliveryAddressId : undefined,
        delivery_zone_id: orderType === 'DELIVERY' ? selectedDeliveryZoneId : undefined,
        coupon_code: appliedCouponCode || undefined,
        table_id: orderType === 'DINE_IN' ? selectedTableId || undefined : undefined,
        table_number: orderType === 'DINE_IN' ? tableNumber : undefined,
        notes: orderNotes.trim() || undefined,
        items: cart.map((ci) => ({
          product_id: ci.product.id,
          variant_id: ci.selectedVariant?.id || undefined,
          variant_name: ci.selectedVariant?.name || undefined,
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

      const submitPayload = buildSubmitPayload();
      const submitted = await orderApi.submitOrder(draftId, submitPayload);

      // Instantly query active payment methods to find POS / CARD
      const pms = await settingsApi.getPaymentMethods();
      const activeMethods = pms.filter((m) => m.is_active);
      const preferredPos =
        activeMethods.find(
          (m) =>
            m.kind === 'CARD' ||
            m.kind === 'POS' ||
            m.code?.toUpperCase().includes('POS') ||
            m.name?.includes('کارتخوان') ||
            m.name?.toLowerCase().includes('card')
        ) || activeMethods[0];

      if (preferredPos) {
        const payRes = await paymentApi.postPayment({
          order_id: submitted.id,
          payment_method_id: preferredPos.id,
          amount: submitted.due_amount || submitted.total_amount || '0',
          reference_number: `POS-${Date.now().toString().slice(-6)}`,
        });
        setPlacedOrder(payRes.order || submitted);
      } else {
        setPlacedOrder(submitted);
      }

      setCheckoutModalOpen(true);
      toast.success(`سفارش #${submitted.order_number || ''} ثبت و با کارتخوان تسویه شد!`);
      handleClearCart();
      fetchHeldOrders(selectedBranchId);
      setError(null);
    } catch (err: any) {
      const msg = err.detail || err.message || 'Direct Terminal Pay failed';
      setError(msg);
      showErrorToast(err, msg);
    } finally {
      setTerminalPayLoading(false);
    }
  }, [
    cart,
    selectedBranchId,
    approvalRequired,
    orderType,
    selectedCustomerId,
    appliedCouponCode,
    tableNumber,
    selectedTableId,
    orderNotes,
    selectedDeliveryAddressId,
    selectedDeliveryZoneId,
    deliveryReady,
    activeDraftOrderId,
    buildSubmitPayload,
    fetchHeldOrders,
    handleClearCart,
    t,
  ]);

  // Order Placement (Pay Later / Open Checkout)
  const handlePlaceOrder = useCallback(async () => {
    if (cart.length === 0) {
      setError('Cart is empty');
      return;
    }
    if (!selectedBranchId) {
      setError('Please select a branch');
      return;
    }
    if (!deliveryReady()) return;
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
        delivery_address_id: orderType === 'DELIVERY' ? selectedDeliveryAddressId : undefined,
        delivery_zone_id: orderType === 'DELIVERY' ? selectedDeliveryZoneId : undefined,
        coupon_code: appliedCouponCode || undefined,
        table_id: orderType === 'DINE_IN' ? selectedTableId || undefined : undefined,
        table_number: orderType === 'DINE_IN' ? tableNumber : undefined,
        notes: orderNotes.trim() || undefined,
        items: cart.map((ci) => ({
          product_id: ci.product.id,
          variant_id: ci.selectedVariant?.id || undefined,
          variant_name: ci.selectedVariant?.name || undefined,
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

      const submitPayload = buildSubmitPayload();
      const submitted = await orderApi.submitOrder(draftId, submitPayload);

      setPlacedOrder(submitted);
      setCheckoutModalOpen(true);
      toast.success(`Order #${submitted.order_number || ''} submitted successfully!`);
      handleClearCart();
      fetchHeldOrders(selectedBranchId);
      setError(null);
    } catch (err: any) {
      const msg = err.detail || err.message || 'Failed to place order';
      setError(msg);
      showErrorToast(err, msg);
    }
  }, [
    cart,
    selectedBranchId,
    approvalRequired,
    orderType,
    selectedCustomerId,
    appliedCouponCode,
    tableNumber,
    selectedTableId,
    orderNotes,
    selectedDeliveryAddressId,
    selectedDeliveryZoneId,
    deliveryReady,
    activeDraftOrderId,
    buildSubmitPayload,
    fetchHeldOrders,
    handleClearCart,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (notesModalOpen) setNotesModalOpen(false);
        else if (optionDialogOpen) setOptionDialogOpen(false);
        else if (heldOrdersDrawerOpen) setHeldOrdersDrawerOpen(false);
        else if (manualDiscountModalOpen) setManualDiscountModalOpen(false);
        else if (checkoutModalOpen) setCheckoutModalOpen(false);
        else if (quickAddCustomerOpen) setQuickAddCustomerOpen(false);
        else if (approvalModalOpen) setApprovalModalOpen(false);
        else if (addAddressOpen) setAddAddressOpen(false);
        else if (searchQuery) setSearchQuery('');
        return;
      }
      // Let an open dialog own non-Escape keys so forms retain normal typing behavior.
      if (notesModalOpen || optionDialogOpen || manualDiscountModalOpen || checkoutModalOpen || quickAddCustomerOpen || approvalModalOpen || addAddressOpen) return;
      // No shift, no till: the shortcuts would ring up and take payment behind the gate.
      if (shiftBlocked) return;
      // F2 or Ctrl+F / Ctrl+K: Focus search input
      if (e.key === 'F2' || ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'k'))) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // F4: Toggle Held Orders Drawer
      if (e.key === 'F4') {
        e.preventDefault();
        setHeldOrdersDrawerOpen((prev) => !prev);
        return;
      }

      // F6: Open Manual Discount Modal
      if (e.key === 'F6') {
        e.preventDefault();
        if (cart.length > 0) {
          setManualDiscountModalOpen(true);
        } else {
          toast.warning('Add items to cart before applying discount');
        }
        return;
      }

      // F8: Fast Place Order / Cash Tender
      if (e.key === 'F8') {
        e.preventDefault();
        if (placedOrder) {
          setCheckoutModalOpen(true);
        } else if (cart.length > 0) {
          handlePlaceOrder();
        }
        return;
      }

      // F9: 1-Click Direct Terminal POS Checkout
      if (e.key === 'F9') {
        e.preventDefault();
        if (placedOrder) {
          setCheckoutModalOpen(true);
        } else if (cart.length > 0) {
          handleDirectTerminalPay();
        }
        return;
      }

    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    cart.length,
    placedOrder,
    handlePlaceOrder,
    handleDirectTerminalPay,
    notesModalOpen,
    optionDialogOpen,
    heldOrdersDrawerOpen,
    manualDiscountModalOpen,
    checkoutModalOpen,
    quickAddCustomerOpen,
    approvalModalOpen,
    addAddressOpen,
    searchQuery,
    shiftBlocked,
  ]);

  // Product Filtering (Search + Category)
  const filteredProducts = products.filter((p) => {
    const matchesCategory = !activeTab || p.category_id === activeTab;
    const q = searchQuery.toLowerCase().trim();
    if (!q) return matchesCategory;

    const matchesName = (p.name || '').toLowerCase().includes(q);
    const matchesCode = (p.code || '').toLowerCase().includes(q);
    return matchesCategory && (matchesName || matchesCode);
  });

  // An 86'd product stays on the grid rather than vanishing: the cashier needs
  // to see that the item exists and is off today, so they can tell the guest.
  // A suspension row whose timer has run out is history, not a stop.
  const suspendedProductIds = new Set(
    availabilities
      // Only whole-product stops grey the tile; a stop on one variant or on an add-on
      // leaves the rest of the product on sale.
      .filter((a) => !a.variant_id && !a.option_item_id && !!a.product_id)
      .filter((a) => a.is_suspended && (!a.suspended_until || new Date(a.suspended_until) > new Date()))
      .map((a) => a.product_id as string),
  );
  const soldOutProductIds = new Set(
    dailyStock.filter((s) => !s.variant_id && s.remaining <= 0).map((s) => s.product_id)
  );

  return (
    <Box aria-busy={loadingInitialData || holdingOrder || Boolean(resumingOrderId)}>
      {loadingInitialData && <LinearProgress sx={{ mb: 2 }} />}
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

      {shiftBlocked ? <PosShiftGate register={register} /> : <PosShiftBar register={register} />}

      {/* Hidden rather than unmounted while no shift is open, so a half-built cart survives
          a shift being opened in the middle of it. */}
      <Grid container spacing={2.5} sx={{ display: shiftBlocked ? 'none' : undefined }}>
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
                inputRef={searchInputRef}
                fullWidth
                size="small"
                placeholder="Search products by English/Persian name, SKU or code (e.g. Cheese, همبرگر, PROD-01)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                slotProps={{
                  htmlInput: { 'aria-keyshortcuts': 'F2 Control+F Meta+F Control+K Meta+K' },
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
                    {filteredProducts.map((p) => {
                      const offWindow = offSchedule.get(p.id);
                      const soldOut = soldOutProductIds.has(p.id);
                      const isSuspended = suspendedProductIds.has(p.id) || offWindow !== undefined || soldOut;
                      return (
                      <Grid size={{ xs: 6, sm: 6, md: 4, lg: 3 }} key={p.id}>
                        <Paper
                          variant="outlined"
                          aria-disabled={isSuspended}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setStopProduct(p);
                          }}
                          onPointerDown={() => {
                            longPress.current.fired = false;
                            longPress.current.timer = window.setTimeout(() => {
                              longPress.current.fired = true;
                              setStopProduct(p);
                            }, 600);
                          }}
                          onPointerUp={() => window.clearTimeout(longPress.current.timer)}
                          onPointerLeave={() => window.clearTimeout(longPress.current.timer)}
                          sx={{
                            position: 'relative',
                            p: 1.5,
                            borderRadius: 2.5,
                            cursor: isSuspended ? 'not-allowed' : 'pointer',
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            transition: 'all 0.2s ease-in-out',
                            bgcolor: 'background.paper',
                            ...(isSuspended
                              ? { opacity: 0.55, borderColor: 'error.light' }
                              : {
                                  '&:hover': {
                                    transform: 'translateY(-2px)',
                                    boxShadow: (theme) => `0 4px 12px ${theme.palette.primary.main}25`,
                                    borderColor: 'primary.main',
                                  },
                                }),
                          }}
                          onClick={() => {
                            // The press that opened the stop dialog is not also a sale.
                            if (longPress.current.fired) {
                              longPress.current.fired = false;
                              return;
                            }
                            if (soldOut && !suspendedProductIds.has(p.id)) {
                              setError(t('pos.itemSoldOutNotice', { defaultValue: '{{name}} is sold out today.', name: p.name }));
                              return;
                            }
                            if (offWindow !== undefined && !suspendedProductIds.has(p.id)) {
                              setError(t('pos.itemOffScheduleNotice', { name: p.name, windows: offWindow }));
                              return;
                            }
                            if (isSuspended) {
                              setError(t('pos.itemSuspendedNotice', { name: p.name }));
                              return;
                            }
                            handleOpenProductOptions(p);
                          }}
                        >
                          <IconButton
                            size="small"
                            aria-label={t('pos.stop.open', { name: p.name })}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setStopProduct(p);
                            }}
                            sx={{ position: 'absolute', top: 4, insetInlineEnd: 4, p: 0.5, color: 'text.disabled', '&:hover': { color: 'error.main' } }}
                          >
                            <DoNotDisturbOnOutlinedIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                          <Box>
                            {/* Room for the stop button, so the chips never sit under it. */}
                            <Box sx={{ paddingInlineEnd: '24px' }}>
                            {isSuspended && (
                              <Chip
                                label={
                                  suspendedProductIds.has(p.id)
                                    ? t('pos.itemSuspended')
                                    : soldOut
                                      ? t('pos.itemSoldOut', 'Sold out')
                                      : t('pos.itemOffSchedule', { windows: offWindow })
                                }
                                size="small"
                                color="error"
                                sx={{ fontSize: '0.625rem', height: 18, mb: 0.75, fontWeight: 700 }}
                              />
                            )}
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
                            </Box>
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
                            {MoneyUtil.formatCurrency(priceOf(p))} IRR
                          </Typography>
                        </Paper>
                      </Grid>
                      );
                    })}
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
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                  <Tooltip title="View and resume held draft orders">
                    <Button
                      size="small"
                      color="warning"
                      variant="outlined"
                      startIcon={
                        <Badge
                          badgeContent={heldOrders.length}
                          color="warning"
                          sx={{ '& .MuiBadge-badge': { fontSize: '0.65rem', height: 16, minWidth: 16 } }}
                        >
                          <PauseIcon fontSize="small" />
                        </Badge>
                      }
                      onClick={() => {
                        fetchHeldOrders();
                        setHeldOrdersDrawerOpen(true);
                      }}
                      aria-keyshortcuts="F4"
                      sx={{ textTransform: 'none', fontWeight: 600, py: 0.25, px: 1 }}
                    >
                      Held
                    </Button>
                  </Tooltip>
                  {cart.length > 0 && (
                    <Button
                      size="small"
                      color="error"
                      startIcon={<DeleteIcon fontSize="small" />}
                      onClick={handleClearCart}
                      sx={{ textTransform: 'none', py: 0.25, px: 1 }}
                    >
                      Clear
                    </Button>
                  )}
                </Stack>
              </Stack>

              {/* Order Parameters (Segmented Order Type Switch + Customer/Table) */}
              <Stack spacing={1.25} sx={{ mb: 1.5 }}>
                <ToggleButtonGroup
                  value={orderType}
                  exclusive
                  fullWidth
                  size="small"
                  onChange={(_, newType) => {
                    if (newType) {
                      setOrderType(newType);
                    }
                  }}
                  sx={{
                    bgcolor: 'background.neutral',
                    p: 0.5,
                    borderRadius: 1.5,
                    '& .MuiToggleButton-root': {
                      py: 0.75,
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      border: 'none',
                      borderRadius: 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 0.75,
                      color: 'text.secondary',
                      transition: 'all 0.15s ease-in-out',
                      '&.Mui-selected': {
                        bgcolor: 'background.paper',
                        color: 'primary.main',
                        boxShadow: (theme) => theme.customShadows?.z1 || '0 1px 3px rgba(0,0,0,0.1)',
                        fontWeight: 700,
                        '&:hover': {
                          bgcolor: 'background.paper',
                        },
                      },
                      '&:hover': {
                        bgcolor: 'action.hover',
                      },
                    },
                  }}
                >
                  <ToggleButton value="DINE_IN">
                    <RestaurantIcon sx={{ fontSize: 18 }} />
                    {t('pos.dineIn')}
                  </ToggleButton>
                  <ToggleButton value="TAKEAWAY">
                    <TakeoutDiningIcon sx={{ fontSize: 18 }} />
                    {t('pos.takeaway')}
                  </ToggleButton>
                  <ToggleButton value="DELIVERY">
                    <DeliveryDiningIcon sx={{ fontSize: 18 }} />
                    {t('pos.delivery')}
                  </ToggleButton>
                </ToggleButtonGroup>

                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>{t('pos.customer')}</InputLabel>
                    <Select
                      inputRef={customerSelectRef}
                      value={selectedCustomerId}
                      label={t('pos.customer')}
                      displayEmpty
                      renderValue={(value) => {
                        if (!value)
                          return orderType === 'DELIVERY'
                            ? t('pos.deliveryContext.customerRequired')
                            : t('pos.walkInCustomer');
                        const customer = customers.find((item) => item.id === value);
                        return customer ? `${customer.first_name} ${customer.last_name} (${customer.mobile})` : t('pos.selectCustomer');
                      }}
                      onChange={(e) => {
                        deliveryRestoreRef.current = {};
                        setSelectedCustomerId(e.target.value);
                        setSelectedDeliveryAddressId('');
                        setSelectedDeliveryZoneId('');
                      }}
                    >
                      {orderType !== 'DELIVERY' && <MenuItem value="">{t('pos.walkInCustomer')}</MenuItem>}
                      {customers.map((c) => (
                        <MenuItem key={c.id} value={c.id}>
                          {c.first_name} {c.last_name} ({c.mobile})
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <Tooltip title={t('pos.quickRegisterCustomer')}>
                    <IconButton
                      color="primary"
                      onClick={() => {
                        setCustomerError(null);
                        setQuickAddCustomerOpen(true);
                      }}
                      sx={{
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(0, 167, 111, 0.16)' : 'primary.lighter',
                        color: 'primary.main',
                        borderRadius: 1.25,
                        p: 0.85,
                        border: '1px solid',
                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(0, 167, 111, 0.24)' : 'primary.light',
                        '&:hover': {
                          bgcolor: 'primary.main',
                          color: 'primary.contrastText',
                        },
                        flexShrink: 0,
                      }}
                    >
                      <PersonAddIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>

                  <Tooltip title={orderNotes ? "Edit Order / Kitchen Note" : "Add Order / Kitchen Note"}>
                    <IconButton
                      color={orderNotes ? "info" : "default"}
                      onClick={() => {
                        setTempNotesInput(orderNotes);
                        setNotesModalOpen(true);
                      }}
                      sx={{
                        bgcolor: orderNotes
                          ? (theme) => theme.palette.mode === 'dark' ? 'rgba(0, 184, 217, 0.16)' : 'info.lighter'
                          : 'action.hover',
                        color: orderNotes ? 'info.main' : 'text.secondary',
                        borderRadius: 1.25,
                        p: 0.85,
                        border: '1px solid',
                        borderColor: orderNotes ? 'info.light' : 'divider',
                        '&:hover': {
                          bgcolor: orderNotes ? 'info.main' : 'action.selected',
                          color: orderNotes ? 'info.contrastText' : 'text.primary',
                        },
                        flexShrink: 0,
                      }}
                    >
                      <Badge color="info" variant="dot" invisible={!orderNotes}>
                        <EditNoteIcon fontSize="small" />
                      </Badge>
                    </IconButton>
                  </Tooltip>

                  {orderType === 'DINE_IN' && (
                    <>
                      <Tooltip title={tableNumber ? `Dining Table: ${tableNumber}` : 'Select Dining Table'}>
                        <IconButton
                          color="warning"
                          onClick={(e) => {
                            setCustomTableInput(tableNumber || '');
                            setTableMenuAnchorEl(e.currentTarget);
                          }}
                          sx={{
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255, 171, 0, 0.16)' : 'warning.lighter',
                            color: (theme) => theme.palette.mode === 'dark' ? 'warning.main' : 'warning.darker',
                            borderRadius: 1.25,
                            p: 0.85,
                            border: '1px solid',
                            borderColor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255, 171, 0, 0.24)' : 'warning.light',
                            '&:hover': {
                              bgcolor: 'warning.main',
                              color: 'warning.contrastText',
                            },
                            flexShrink: 0,
                          }}
                        >
                          <Badge
                            color="warning"
                            badgeContent={tableNumber || 0}
                            invisible={!tableNumber}
                            sx={{
                              '& .MuiBadge-badge': {
                                fontSize: '0.65rem',
                                fontWeight: 700,
                                height: 18,
                                minWidth: 18,
                                borderRadius: 1,
                                px: 0.5,
                                bgcolor: 'warning.main',
                                color: 'warning.contrastText',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                              },
                            }}
                          >
                            <TableBarIcon fontSize="small" />
                          </Badge>
                        </IconButton>
                      </Tooltip>

                      <Menu
                        anchorEl={tableMenuAnchorEl}
                        open={Boolean(tableMenuAnchorEl)}
                        onClose={() => setTableMenuAnchorEl(null)}
                        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                        slotProps={{
                          paper: {
                            sx: {
                              minWidth: 260,
                              maxWidth: 340,
                              p: 1,
                              borderRadius: 1.5,
                              boxShadow: (theme) => theme.customShadows?.dropdown || 4,
                            },
                          },
                        }}
                      >
                        <Box sx={{ px: 1, py: 0.5, mb: 0.5 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            Select Dining Table
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {tableNumber ? `Current Selection: ${tableNumber}` : 'Assign a table for this dine-in order'}
                          </Typography>
                        </Box>
                        <Divider sx={{ my: 0.5 }} />

                        {diningTables.length > 0 ? (
                          <Box sx={{ maxHeight: 220, overflowY: 'auto' }}>
                            {diningTables.map((tbl) => {
                              const val = tbl.code || tbl.table_number;
                              const isSelected = tableNumber === val;
                              return (
                                <MenuItem
                                  key={tbl.id}
                                  selected={isSelected}
                                  onClick={() => {
                                    setTableNumber(val);
                                    setSelectedTableId(tbl.id);
                                    setTableMenuAnchorEl(null);
                                  }}
                                  sx={{
                                    borderRadius: 1,
                                    my: 0.25,
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                  }}
                                >
                                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                    {isSelected ? (
                                      <CheckIcon fontSize="small" color="warning" />
                                    ) : (
                                      <TableBarIcon fontSize="small" sx={{ color: 'text.secondary', opacity: 0.6 }} />
                                    )}
                                    <Box>
                                      <Typography variant="body2" sx={{ fontWeight: isSelected ? 700 : 500 }}>
                                        {tbl.code || `Table ${tbl.table_number}`}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        {tbl.seating_capacity} seats
                                      </Typography>
                                    </Box>
                                  </Stack>
                                  <Chip
                                    label={tbl.status}
                                    size="small"
                                    color={tbl.status === 'AVAILABLE' ? 'success' : tbl.status === 'OCCUPIED' ? 'warning' : 'default'}
                                    sx={{ height: 18, fontSize: '0.65rem', fontWeight: 600 }}
                                  />
                                </MenuItem>
                              );
                            })}
                          </Box>
                        ) : (
                          <Box sx={{ p: 1 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                              No registered dining tables found. Enter table identifier:
                            </Typography>
                          </Box>
                        )}

                        <Divider sx={{ my: 0.75 }} />
                        <Box sx={{ p: 1, pt: 0.5 }}>
                          <Stack direction="row" spacing={0.75}>
                            <TextField
                              size="small"
                              placeholder="Custom Table #"
                              value={customTableInput}
                              onChange={(e) => setCustomTableInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && customTableInput.trim()) {
                                  setTableNumber(customTableInput.trim());
                                  setSelectedTableId('');
                                  setTableMenuAnchorEl(null);
                                }
                              }}
                              sx={{ '& .MuiInputBase-input': { py: 0.75, fontSize: '0.8125rem' } }}
                            />
                            <Button
                              size="small"
                              variant="contained"
                              color="warning"
                              disabled={!customTableInput.trim()}
                              onClick={() => {
                                if (customTableInput.trim()) {
                                  setTableNumber(customTableInput.trim());
                                  setSelectedTableId('');
                                  setTableMenuAnchorEl(null);
                                }
                              }}
                              sx={{ minWidth: 50, px: 1.5, fontSize: '0.75rem', fontWeight: 700 }}
                            >
                              Set
                            </Button>
                          </Stack>
                        </Box>
                      </Menu>
                    </>
                  )}
                </Stack>

                {orderType === 'DELIVERY' && (
                  <Stack spacing={1} sx={{ p: 1.25, border: 1, borderColor: 'primary.light', borderRadius: 1.5, bgcolor: 'background.neutral' }}>
                    {!selectedCustomerId ? (
                      <Alert severity="warning" sx={{ py: 0.25 }}>{t('pos.deliveryContext.customerRequired')}</Alert>
                    ) : (
                      <>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <FormControl fullWidth size="small" disabled={deliveryOptionsLoading} error={Boolean(selectedCustomerId && !selectedDeliveryAddressId)}>
                            <InputLabel>{t('pos.deliveryContext.addressLabel')}</InputLabel>
                            <Select value={selectedDeliveryAddressId} label={t('pos.deliveryContext.addressLabel')} onChange={(e) => { setSelectedDeliveryAddressId(e.target.value); setSelectedDeliveryZoneId(''); }}>
                              {customerAddresses.map((address) => (
                                <MenuItem key={address.id} value={address.id}>
                                  {address.title}{address.is_default ? ` (${t('pos.deliveryContext.addressDefault')})` : ''} — {address.address_text.length > 45 ? `${address.address_text.slice(0, 45)}…` : address.address_text}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          <Button size="small" variant="outlined" onClick={() => setAddAddressOpen(true)} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('pos.deliveryContext.addAddress')}</Button>
                        </Stack>
                        {customerAddresses.length === 0 && !deliveryOptionsLoading && <Alert severity="info" sx={{ py: 0.25 }}>{t('pos.deliveryContext.noAddresses')}</Alert>}
                        <FormControl fullWidth size="small" disabled={deliveryOptionsLoading} error={Boolean(selectedCustomerId && !selectedDeliveryZoneId)}>
                          <InputLabel>{t('pos.deliveryContext.zoneLabel')}</InputLabel>
                          <Select value={selectedDeliveryZoneId} label={t('pos.deliveryContext.zoneLabel')} onChange={(e) => setSelectedDeliveryZoneId(e.target.value)}>
                            {deliveryZones.map((zone) => (
                              <MenuItem key={zone.id} value={zone.id}>
                                {t('pos.deliveryContext.zoneOption', {
                                  name: zone.name,
                                  fee: MoneyUtil.formatCurrency(zone.fee),
                                  minutes: zone.estimated_minutes,
                                })}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        {deliveryOptionsLoading && <LinearProgress />}
                        {deliveryOptionsError && <Alert severity="error" sx={{ py: 0.25 }}>{deliveryOptionsError}</Alert>}
                      </>
                    )}
                  </Stack>
                )}

                {/* Active Note Preview Card */}
                {orderNotes && (
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 0.85,
                      px: 1.25,
                      borderRadius: 1.25,
                      bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(0, 184, 217, 0.08)' : 'info.lighter',
                      borderColor: 'info.light',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 1,
                    }}
                  >
                    <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <EditNoteIcon color="info" fontSize="small" sx={{ flexShrink: 0 }} />
                      <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.primary' }} noWrap>
                        Note: {orderNotes}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
                      <Button
                        size="small"
                        color="info"
                        onClick={() => {
                          setTempNotesInput(orderNotes);
                          setNotesModalOpen(true);
                        }}
                        sx={{ py: 0, px: 0.75, minWidth: 0, fontSize: '0.75rem', textTransform: 'none', fontWeight: 600 }}
                      >
                        Edit
                      </Button>
                      <IconButton
                        size="small"
                        onClick={() => setOrderNotes('')}
                        sx={{ p: 0.25 }}
                      >
                        <ClearIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Stack>
                  </Paper>
                )}
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
                              {item.product.name} {item.selectedVariant ? `(${item.selectedVariant.name})` : ''}
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
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleApplyCoupon();
                    }
                  }}
                  fullWidth
                  slotProps={{
                    input: {
                      endAdornment: (couponInput || appliedCouponCode) ? (
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
                  variant={appliedCouponCode && appliedCouponCode === couponInput.trim() ? 'contained' : 'outlined'}
                  color={appliedCouponCode && appliedCouponCode === couponInput.trim() ? 'success' : 'primary'}
                  size="small"
                  onClick={handleApplyCoupon}
                  disabled={!couponInput.trim() || (appliedCouponCode === couponInput.trim())}
                  sx={{ fontWeight: 'bold', flexShrink: 0, px: 1.75 }}
                >
                  {appliedCouponCode && appliedCouponCode === couponInput.trim() ? 'Applied' : 'Apply'}
                </Button>
                <Tooltip title="Configure Cashier Manual Discount in modal">
                  <Button
                    variant={appliedManualDiscount ? 'contained' : 'outlined'}
                    color={appliedManualDiscount ? 'warning' : 'inherit'}
                    size="small"
                    startIcon={<LocalOfferIcon fontSize="small" />}
                  onClick={() => setManualDiscountModalOpen(true)}
                  aria-keyshortcuts="F6"
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
                  <Typography variant="body2" color="text.secondary">{t('pos.totals.subtotal')}</Typography>
                  <Typography variant="body2">{t('pos.amountIrr', { amount: MoneyUtil.formatCurrency(cartSubtotal) })}</Typography>
                </Stack>
                <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">{t('pos.totals.tax')}</Typography>
                  <Typography variant="body2">{t('pos.amountIrr', { amount: MoneyUtil.formatCurrency(cartTax) })}</Typography>
                </Stack>
                {orderType === 'DELIVERY' && (
                  <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">{t('pos.totals.delivery')}</Typography>
                    <Typography variant="body2">{t('pos.amountIrr', { amount: MoneyUtil.formatCurrency(quotedDeliveryFee) })}</Typography>
                  </Stack>
                )}
                {MoneyUtil.greaterThan(appliedDiscountAmount, '0') && (
                  <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" color="error.main" sx={{ fontWeight: 600 }}>
                      {t('pos.totals.discount')}
                    </Typography>
                    <Typography variant="body2" color="error.main" sx={{ fontWeight: 'bold' }}>
                      -{t('pos.amountIrr', { amount: MoneyUtil.formatCurrency(appliedDiscountAmount) })}
                    </Typography>
                  </Stack>
                )}
                <Divider />
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', pt: 0.5 }}>
                  <Typography variant="h6" sx={{ fontWeight: 'bold' }}>{t('pos.totals.totalDue')}</Typography>
                  <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                    {t('pos.amountIrr', { amount: MoneyUtil.formatCurrency(cartTotalDue) })}
                  </Typography>
                </Stack>
              </Stack>

              {/* Bottom Place Order CTA */}
              <Stack spacing={1}>
                {/* 1-Click Direct Terminal Pay (90% Standard in Iran) */}
                <Button
                  variant="contained"
                  color="primary"
                  size="large"
                  fullWidth
                  disabled={cart.length === 0 || terminalPayLoading}
                  onClick={handleDirectTerminalPay}
                  aria-keyshortcuts="F9"
                  startIcon={terminalPayLoading ? <CircularProgress size={22} color="inherit" /> : <PointOfSaleIcon sx={{ fontSize: 24 }} />}
                  sx={{
                    fontWeight: 800,
                    py: 1.35,
                    fontSize: '1.02rem',
                    borderRadius: 1.5,
                    boxShadow: (theme) => theme.customShadows?.primary || 3,
                  }}
                >
                  {terminalPayLoading
                    ? 'در حال ارسال به کارتخوان و تسویه...'
                    : 'پرداخت سریع کارتخوان (PC-POS)'}
                </Button>

                <Stack direction="row" spacing={1.5}>
                  <Button
                    variant="outlined"
                    color="warning"
                    disabled={cart.length === 0 || holdingOrder}
                    onClick={handleHoldOrder}
                    startIcon={holdingOrder ? <CircularProgress size={18} color="inherit" /> : <PauseIcon />}
                    sx={{ fontWeight: 'bold', py: 1, flexShrink: 0 }}
                  >
                    {holdingOrder ? 'Holding…' : 'Hold'}
                  </Button>
                  <Button
                    variant="outlined"
                    color="inherit"
                    size="medium"
                    fullWidth
                    disabled={cart.length === 0}
                    onClick={handlePlaceOrder}
                    aria-keyshortcuts="F8"
                    sx={{ fontWeight: 'bold', py: 1, fontSize: '0.92rem' }}
                  >
                    {activeDraftOrderId ? 'Update & Place' : 'Place Order'}
                  </Button>
                </Stack>
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
        aria-keyshortcuts="Escape"
      >
        <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
          <LocalOfferIcon color="primary" />
          Apply Manual Cashier Discount
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
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
                    setError(null);
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
                onChange={(e) => {
                  setManualValue(e.target.value);
                  setError(null);
                }}
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
                  ? ['5', '10', '15', '20', '25', '30'].map((pct) => (
                      <Chip
                        key={pct}
                        label={`${pct}%`}
                        size="small"
                        variant={manualValue === pct ? 'filled' : 'outlined'}
                        color={Number(pct) > 10 ? 'warning' : 'primary'}
                        onClick={() => {
                          handleSelectPreset(pct);
                          setError(null);
                        }}
                        sx={{ fontWeight: 600, cursor: 'pointer' }}
                      />
                    ))
                  : ['20000', '50000', '100000', '200000', '300000'].map((amt) => (
                      <Chip
                        key={amt}
                        label={`${MoneyUtil.formatCurrency(amt)}`}
                        size="small"
                        variant={manualValue === amt ? 'filled' : 'outlined'}
                        color={Number(amt) > 50000 ? 'warning' : 'primary'}
                        onClick={() => {
                          handleSelectPreset(amt);
                          setError(null);
                        }}
                        sx={{ fontWeight: 600, cursor: 'pointer' }}
                      />
                    ))}
              </Stack>

              {manualValue && Number(manualValue) > 0 && (
                <Typography
                  variant="caption"
                  sx={{
                    display: 'block',
                    mt: 1,
                    fontWeight: 600,
                    color:
                      (manualCalcType === 'PERCENTAGE' && Number(manualValue) > 10) ||
                      (manualCalcType === 'FIXED_AMOUNT' && Number(manualValue) > 50000)
                        ? 'warning.main'
                        : 'success.main',
                  }}
                >
                  {(manualCalcType === 'PERCENTAGE' && Number(manualValue) > 10) ||
                  (manualCalcType === 'FIXED_AMOUNT' && Number(manualValue) > 50000)
                    ? '🔒 Requires Manager PIN authorization on Apply'
                    : '✓ Within standard Cashier authorization limit'}
                </Typography>
              )}
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
            color={
              (manualCalcType === 'PERCENTAGE' && Number(manualValue) > 10) ||
              (manualCalcType === 'FIXED_AMOUNT' && Number(manualValue) > 50000)
                ? 'warning'
                : 'primary'
            }
            startIcon={
              (manualCalcType === 'PERCENTAGE' && Number(manualValue) > 10) ||
              (manualCalcType === 'FIXED_AMOUNT' && Number(manualValue) > 50000) ? (
                <LockOpenIcon />
              ) : undefined
            }
            onClick={handleApplyManualDiscount}
            disabled={!manualValue || Number(manualValue) <= 0}
            sx={{ fontWeight: 'bold' }}
          >
            {(manualCalcType === 'PERCENTAGE' && Number(manualValue) > 10) ||
            (manualCalcType === 'FIXED_AMOUNT' && Number(manualValue) > 50000)
              ? 'Authorize & Apply (PIN)'
              : 'Apply to Cart'}
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
                    {MoneyUtil.formatCurrency(
                      MoneyUtil.greaterThan(ho.total_amount || ho.grand_total || '0', '0')
                        ? (ho.total_amount || ho.grand_total || '0')
                        : (ho.items || []).reduce(
                            (sum, item) => MoneyUtil.add(
                              sum,
                              item.line_total || item.subtotal || MoneyUtil.multiply(item.unit_price || '0', item.quantity || '0'),
                            ),
                            '0',
                          )
                    )} IRR
                  </Typography>
                </Stack>

                <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
                  <AccessTimeIcon sx={{ fontSize: 14 }} />
                  {fTime(ho.placed_at || (ho as any).created_at)}
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
                    disabled={Boolean(resumingOrderId)}
                    startIcon={resumingOrderId === ho.id ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon fontSize="small" />}
                    onClick={() => handleResumeOrder(ho)}
                    sx={{ textTransform: 'none', fontWeight: 'bold' }}
                  >
                    {resumingOrderId === ho.id ? 'Resuming…' : 'Resume Order'}
                  </Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </Drawer>

      {/* Option & Variant Customization Dialog */}
      <Dialog open={optionDialogOpen} onClose={() => setOptionDialogOpen(false)} maxWidth="sm" fullWidth aria-keyshortcuts="Escape">
        <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Configure {selectedProduct?.name}</span>
          <Chip label="V5 Preview" color="info" size="small" sx={{ fontWeight: 'bold' }} />
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {/* Variant Selection Section */}
          {productVariants.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                  Select Variant / Size
                </Typography>
                <Chip label="V5" size="small" color="info" sx={{ height: 18, fontSize: '0.65rem', fontWeight: 'bold' }} />
              </Stack>
              <RadioGroup
                value={selectedVariantId}
                onChange={(e) => setSelectedVariantId(e.target.value)}
              >
                <Grid container spacing={1}>
                  {productVariants.map((v) => (
                    <Grid key={v.id} size={{ xs: 12, sm: 6 }}>
                      <Paper
                        variant="outlined"
                        onClick={() => setSelectedVariantId(v.id)}
                        sx={{
                          p: 1.5,
                          borderRadius: 2,
                          cursor: 'pointer',
                          borderColor: selectedVariantId === v.id ? 'primary.main' : 'divider',
                          bgcolor: selectedVariantId === v.id ? 'action.hover' : 'background.paper',
                          borderWidth: selectedVariantId === v.id ? 2 : 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <FormControlLabel
                          value={v.id}
                          control={<Radio size="small" />}
                          label={
                            <Box>
                              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                {v.name}
                              </Typography>
                              {v.sku && (
                                <Typography variant="caption" color="text.secondary">
                                  SKU: {v.sku}
                                </Typography>
                              )}
                            </Box>
                          }
                          sx={{ m: 0 }}
                        />
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                          {MoneyUtil.formatCurrency(selectedProduct ? priceOf(selectedProduct, v) : v.base_price)} IRR
                        </Typography>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
              </RadioGroup>
            </Box>
          )}

          {/* Modifier Groups Section */}
          {optionGroups.length > 0 && (
            <Box>
              {productVariants.length > 0 && <Divider sx={{ my: 2 }} />}
              <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                  Optional Customizations & Modifiers
                </Typography>
                <Chip label="V5" size="small" color="info" sx={{ height: 18, fontSize: '0.65rem', fontWeight: 'bold' }} />
              </Stack>
              {optionGroups.map((g) => (
                <Box key={g.id} sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 0.5, color: 'text.secondary' }}>
                    {g.name} {g.is_required ? '(Required)' : ''}
                  </Typography>
                  {g.items?.map((item) => (
                    <FormControlLabel
                      key={item.id}
                      control={
                        <Checkbox
                          checked={checkedOptionIds.includes(item.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              // A one-choice group swaps its choice rather than adding a second.
                              const inGroup = new Set(g.items?.map((i) => i.id));
                              setCheckedOptionIds((prev) =>
                                g.max_selection === 1
                                  ? [...prev.filter((id) => !inGroup.has(id)), item.id]
                                  : [...prev, item.id]
                              );
                            } else {
                              setCheckedOptionIds((prev) => prev.filter((id) => id !== item.id));
                            }
                          }}
                        />
                      }
                      label={`${item.name} (+${MoneyUtil.formatCurrency(item.price_delta)} IRR)`}
                      sx={{ display: 'block', mb: 0.5 }}
                    />
                  ))}
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOptionDialogOpen(false)}>Cancel</Button>
          {unfilledSlot && (
            <Typography variant="caption" color="warning.main" sx={{ mr: 'auto', ml: 2 }}>
              {t('pos.comboChooseSlot', { slot: unfilledSlot.name })}
            </Typography>
          )}
          <Button
            variant="contained"
            onClick={handleConfirmAddWithOptions}
            disabled={!!unfilledSlot}
            sx={{ fontWeight: 'bold', px: 3 }}
          >
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

      <Dialog open={addAddressOpen} onClose={() => !addingAddress && setAddAddressOpen(false)} maxWidth="xs" fullWidth aria-keyshortcuts="Escape">
        <DialogTitle>{t('pos.deliveryContext.dialogTitle')}</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label={t('pos.deliveryContext.titleField')} size="small" autoFocus required value={newAddress.title} onChange={(e) => setNewAddress((current) => ({ ...current, title: e.target.value }))} />
            <TextField label={t('pos.deliveryContext.addressField')} size="small" multiline rows={3} required value={newAddress.address_text} onChange={(e) => setNewAddress((current) => ({ ...current, address_text: e.target.value }))} />
            <TextField label={t('pos.deliveryContext.postalField')} size="small" value={newAddress.postal_code} onChange={(e) => setNewAddress((current) => ({ ...current, postal_code: e.target.value }))} />
            <FormControlLabel control={<Checkbox checked={newAddress.is_default} onChange={(e) => setNewAddress((current) => ({ ...current, is_default: e.target.checked }))} />} label={t('pos.deliveryContext.setDefault')} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddAddressOpen(false)} disabled={addingAddress}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={handleCreateAddress} disabled={addingAddress}>
            {addingAddress ? t('pos.deliveryContext.savingAddress') : t('pos.deliveryContext.saveAddress')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Quick Add Customer Dialog */}
      <Dialog
        open={quickAddCustomerOpen}
        onClose={() => !creatingCustomer && setQuickAddCustomerOpen(false)}
        maxWidth="xs"
        fullWidth
        aria-keyshortcuts="Escape"
      >
        <form onSubmit={handleQuickAddCustomer}>
          <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
            <PersonAddIcon color="primary" />
            Quick Register Customer
          </DialogTitle>
          <DialogContent sx={{ pt: 1 }}>
            {customerError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {customerError}
              </Alert>
            )}
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                size="small"
                label="First Name"
                required
                fullWidth
                autoFocus
                value={newCustFirstName}
                onChange={(e) => setNewCustFirstName(e.target.value)}
              />
              <TextField
                size="small"
                label="Last Name"
                fullWidth
                value={newCustLastName}
                onChange={(e) => setNewCustLastName(e.target.value)}
              />
              <TextField
                size="small"
                label="Mobile / Phone Number"
                required
                fullWidth
                value={newCustMobile}
                placeholder="0912..."
                onChange={(e) => setNewCustMobile(e.target.value)}
              />
              <TextField
                size="small"
                label="Email (Optional)"
                type="email"
                fullWidth
                value={newCustEmail}
                onChange={(e) => setNewCustEmail(e.target.value)}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button
              onClick={() => setQuickAddCustomerOpen(false)}
              disabled={creatingCustomer}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={creatingCustomer}
              startIcon={creatingCustomer ? <CircularProgress size={16} color="inherit" /> : <PersonAddIcon />}
              sx={{ fontWeight: 'bold' }}
            >
              {creatingCustomer ? 'Saving...' : 'Save & Select'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Order Notes Dialog */}
      <Dialog
        open={notesModalOpen}
        onClose={() => setNotesModalOpen(false)}
        maxWidth="xs"
        fullWidth
        aria-keyshortcuts="Escape"
      >
        <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
          <EditNoteIcon color="primary" />
          Order & Kitchen Instructions
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Add special instructions for kitchen preparation, courier delivery, or customer preferences.
          </Typography>
          <TextField
            multiline
            rows={3}
            fullWidth
            size="small"
            autoFocus
            label="Special Instructions / Notes"
            placeholder="e.g. Extra napkins, no onions, allergies, gate code 1234..."
            value={tempNotesInput}
            onChange={(e) => setTempNotesInput(e.target.value)}
            sx={{ mb: 2 }}
          />

          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, display: 'block', fontWeight: 600 }}>
            Quick Tags:
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
            {[
              'No Onions',
              'Extra Spicy',
              'Less Ice',
              'Allergy Alert',
              'Cutlery Needed',
              'Call on Arrival',
              'Urgent / Rush',
            ].map((tag) => (
              <Chip
                key={tag}
                label={tag}
                size="small"
                variant={tempNotesInput.includes(tag) ? 'filled' : 'outlined'}
                color="primary"
                onClick={() => {
                  setTempNotesInput((prev) =>
                    prev ? (prev.includes(tag) ? prev : `${prev}, ${tag}`) : tag
                  );
                }}
                sx={{ fontWeight: 600, cursor: 'pointer' }}
              />
            ))}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          {tempNotesInput && (
            <Button
              color="error"
              onClick={() => {
                setTempNotesInput('');
                setOrderNotes('');
                setNotesModalOpen(false);
              }}
              sx={{ mr: 'auto' }}
            >
              Clear Note
            </Button>
          )}
          <Button onClick={() => setNotesModalOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setOrderNotes(tempNotesInput.trim());
              setNotesModalOpen(false);
            }}
            sx={{ fontWeight: 'bold' }}
          >
            Save Note
          </Button>
        </DialogActions>
      </Dialog>

      <PosStopDialog
        product={stopProduct}
        branchId={selectedBranchId || null}
        availabilities={availabilities}
        onClose={() => setStopProduct(null)}
        onDone={(message) => {
          setStopProduct(null);
          toast.success(message);
          catalogApi
            .getAvailabilities(selectedBranchId || undefined)
            .then((list) => setAvailabilities(list.filter((a) => !a.channel)))
            .catch(() => undefined);
        }}
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
