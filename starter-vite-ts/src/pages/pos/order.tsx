import type { Theme } from '@mui/material/styles';
import type { OrderHeader } from 'src/api/orderApi';
import type { ReasonCode } from 'src/api/settingsApi';
import type { DeliveryZone } from 'src/api/deliveryApi';
import type { Customer, CustomerAddress } from 'src/api/customerApi';
import type { ManualDiscount, ManualDiscountLimits } from 'src/api/discountsApi';
import type {
  Product,
  Category,
  OptionItem,
  OptionGroup,
  NoteTemplate,
  DailyStockLine,
  ProductVariant,
  ProductAvailability,
} from 'src/api/catalogApi';

import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import React, { useState, useEffect, useCallback } from 'react';

import AddIcon from '@mui/icons-material/Add';
import TuneIcon from '@mui/icons-material/Tune';
import CheckIcon from '@mui/icons-material/Check';
import ClearIcon from '@mui/icons-material/Clear';
import PauseIcon from '@mui/icons-material/Pause';
import DeleteIcon from '@mui/icons-material/Delete';
import RemoveIcon from '@mui/icons-material/Remove';
import SearchIcon from '@mui/icons-material/Search';
import EditNoteIcon from '@mui/icons-material/EditNote';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import VerifiedIcon from '@mui/icons-material/Verified';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
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
  ButtonBase,
  CardContent,
  FormControl,
  DialogTitle,
  ToggleButton,
  DialogContent,
  DialogActions,
  useMediaQuery,
  InputAdornment,
  LinearProgress,
  CircularProgress,
  FormControlLabel,
  ToggleButtonGroup,
} from '@mui/material';

import { fTime } from 'src/utils/format-time';
import { MoneyUtil } from 'src/utils/money.util';
import { useCloudBack } from 'src/utils/cloud-back';
import { newIdempotencyKey } from 'src/utils/idempotency';
import { isNotSentMessage } from 'src/utils/connection-problem';
import { toToman, fromToman, useCurrencyLabel } from 'src/utils/currency';
import { addonMin, isPickOne, addonRuleLabel } from 'src/utils/addon-rule';

import { orderApi } from 'src/api/orderApi';
import { paymentApi } from 'src/api/paymentApi';
import { catalogApi } from 'src/api/catalogApi';
import { settingsApi } from 'src/api/settingsApi';
import { customerApi } from 'src/api/customerApi';
import { deliveryApi } from 'src/api/deliveryApi';
import { discountsApi } from 'src/api/discountsApi';
import { useBranchContext } from 'src/contexts/branch-context';
import { useIncomingOrders } from 'src/contexts/incoming-orders-context';

import { VersionTag } from 'src/components/version-tag';
import { CheckoutModal } from 'src/components/CheckoutModal';
import { toast, showErrorToast } from 'src/components/snackbar';
import { ApprovalModal } from 'src/components/approval/ApprovalModal';
import { CustomerRegisterDialog } from 'src/components/customer-register';
import { OnlineBoard, NewOrderPopup } from 'src/components/online-orders';
import { useRegisterShift } from 'src/components/shift/use-register-shift';
import { PosShiftBar, PosShiftGate, PosShiftAccountLink } from 'src/components/shift/pos-shift';

import { PosStopDialog } from './pos-stop-dialog';
import { useFillViewport } from './use-fill-viewport';
import { PosCustomerPicker } from './pos-customer-picker';
import { ClosedBranchBanner } from './closed-branch-banner';

export interface CartItem {
  product: Product;
  selectedVariant?: ProductVariant;
  quantity: number;
  selectedOptions: OptionItem[];
  lineSubtotal: string;
  /** The product has sizes or add-on groups, so the line offers to change them. */
  hasChoices?: boolean;
}

/** The address list's last entry: opens the add-address dialog. */
const ADD_ADDRESS = '__add__';

/** The order type of a held order, as the cart's own type tabs name it. */
const HELD_TYPE_KEYS: Record<string, string> = {
  DINE_IN: 'orders.types.dineIn',
  TAKEAWAY: 'orders.types.takeaway',
  DELIVERY: 'orders.types.delivery',
  PICKUP: 'orders.types.pickup',
};

/** The reasons a cashier gives for a discount; the label is `pos.discount.reason.<code>`. */
const DISCOUNT_REASONS = ['CUSTOMER_SATISFACTION', 'STAFF_DISCOUNT', 'DAMAGED_ITEM', 'VIP_COURTESY'];

/** Why the server turned a discount down, as the cashier reads it. */
function formatRejectionReason(t: (key: string, fallback?: any) => string, reason?: string) {
  return t(`pos.discount.rejected.${reason || 'OTHER'}`, t('pos.discount.rejected.OTHER'));
}

const CATALOG_LOAD_FAILED = 'Failed to load POS catalog data';

export function PosOrderPage() {
  const currencyLabel = useCurrencyLabel();
  const { t } = useTranslation();
  const currency = useCurrencyLabel();

  const { selectedBranchId, setSelectedBranchId } = useBranchContext();
  // The register this device is and the shift open on it; the till stays shut without one.
  const register = useRegisterShift();
  // A shift whose business day has ended sells nothing more: it is counted and closed first.
  const shiftBlocked = !register.shift || register.dayEnded;
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
  // The picked customer itself, for the picker's label: the till no longer loads a customer
  // list, it searches the server (see PosCustomerPicker).
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [customerAddresses, setCustomerAddresses] = useState<CustomerAddress[]>([]);
  const [selectedDeliveryAddressId, setSelectedDeliveryAddressId] = useState<string>('');
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [selectedDeliveryZoneId, setSelectedDeliveryZoneId] = useState<string>('');
  // The delivery price the cashier typed in place of the zone's fee, in rials; null charges the
  // zone's. Empty while the field is being retyped.
  const [manualDeliveryFee, setManualDeliveryFee] = useState<string | null>(null);
  const [deliveryOptionsLoading, setDeliveryOptionsLoading] = useState(false);
  const [deliveryOptionsError, setDeliveryOptionsError] = useState<string | null>(null);
  const [addAddressOpen, setAddAddressOpen] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);
  const [newAddress, setNewAddress] = useState({ title: '', address_text: '', postal_code: '', is_default: false });
  const [orderType, setOrderType] = useState<'DINE_IN' | 'TAKEAWAY' | 'DELIVERY'>('DINE_IN');

  // Order Notes Dialog state
  const [orderNotes, setOrderNotes] = useState<string>('');
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [tempNotesInput, setTempNotesInput] = useState<string>('');
  // The chain's own phrases, managed in Settings. These used to be a hardcoded English
  // list, which no branch could change and which stayed English on a Persian till.
  const [noteTemplates, setNoteTemplates] = useState<NoteTemplate[]>([]);

  // Quick Add Customer Dialog state
  const [quickAddCustomerOpen, setQuickAddCustomerOpen] = useState(false);
  const [registerPrefill, setRegisterPrefill] = useState<{ mobile?: string; name?: string }>({});

  // Picking (or clearing) the customer starts the delivery choices over.
  const pickCustomer = (customer: Customer | null) => {
    deliveryRestoreRef.current = {};
    setSelectedCustomer(customer);
    setSelectedCustomerId(customer?.id || '');
    setSelectedDeliveryAddressId('');
    setSelectedDeliveryZoneId('');
    setManualDeliveryFee(null);
  };

  // A customer registered at the till is selected on the order straight away; their first
  // address (typed in the same dialog) becomes the delivery address.
  const handleCustomerRegistered = (created: Customer) => {
    setQuickAddCustomerOpen(false);
    pickCustomer(created);
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
  // The cart line the dialog is changing, or null when it adds a new line.
  const [editingLine, setEditingLine] = useState<number | null>(null);

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeDraftOrderId, setActiveDraftOrderId] = useState<string | null>(null);

  // Cart lines follow this branch's prices as they refresh: a list price changed mid-order
  // shows on the lines already in the cart, as the server prices them when the order is saved.
  useEffect(() => {
    setCart((prev) => {
      let changed = false;
      const next = prev.map((ci) => {
        const optionsSum = ci.selectedOptions.reduce((sum, o) => MoneyUtil.add(sum, o.price_delta || '0', 2), '0');
        const unitPrice = MoneyUtil.add(priceOf(ci.product, ci.selectedVariant), optionsSum, 2);
        const lineSubtotal = MoneyUtil.multiply(unitPrice, ci.quantity.toString(), 2);
        if (MoneyUtil.equals(lineSubtotal, ci.lineSubtotal)) return ci;
        changed = true;
        return { ...ci, lineSubtotal };
      });
      return changed ? next : prev;
    });
  }, [priceOf]);

  // Held Orders Drawer state
  const [heldOrdersDrawerOpen, setHeldOrdersDrawerOpen] = useState(false);
  const [heldOrders, setHeldOrders] = useState<OrderHeader[]>([]);
  // What each held order will cost with tax, by id (rials).
  const [heldTotals, setHeldTotals] = useState<Record<string, string>>({});
  const [loadingHeldOrders, setLoadingHeldOrders] = useState(false);
  const [loadingInitialData, setLoadingInitialData] = useState(true);
  const [holdingOrder, setHoldingOrder] = useState(false);
  const [resumingOrderId, setResumingOrderId] = useState<string | null>(null);
  const [discardTarget, setDiscardTarget] = useState<OrderHeader | null>(null);
  const [discardReasonCodes, setDiscardReasonCodes] = useState<ReasonCode[]>([]);
  const [discardReasonCodeId, setDiscardReasonCodeId] = useState('');

  // Coupon state
  const [couponInput, setCouponInput] = useState('');
  const [appliedCouponCode, setAppliedCouponCode] = useState('');

  // Manual Discount Modal state
  const [manualDiscountModalOpen, setManualDiscountModalOpen] = useState(false);
  // Subtotal and VAT stay folded until the cashier asks: all day they read one number, the total.
  const [totalsOpen, setTotalsOpen] = useState(false);
  const [manualCalcType, setManualCalcType] = useState<'PERCENTAGE' | 'FIXED_AMOUNT'>('PERCENTAGE');
  const [manualValue, setManualValue] = useState<string>('');
  // Head office's Discount Authorizations, as the server applies them to this account. The
  // defaults are the server's own until they load.
  const [discountLimits, setDiscountLimits] = useState<ManualDiscountLimits>({
    role: 'CASHIER',
    own: { pct: '10', maxFixed: '50000' },
    ceiling: { pct: '30', maxFixed: '300000' },
  });
  const overOwnLimit =
    (manualCalcType === 'PERCENTAGE' && Number(manualValue) > Number(discountLimits.own.pct)) ||
    (manualCalcType === 'FIXED_AMOUNT' && Number(manualValue) > Number(discountLimits.own.maxFixed));

  useEffect(() => {
    discountsApi
      .getManualDiscountLimits()
      .then(setDiscountLimits)
      // The server still decides; the defaults only mean the pin may be asked for late.
      .catch(() => undefined);
  }, []);

  const [manualReasonCode, setManualReasonCode] = useState<string>('CUSTOMER_SATISFACTION');
  const [manualApprovalRequestId, setManualApprovalRequestId] = useState<string | undefined>(undefined);
  const [appliedManualDiscount, setAppliedManualDiscount] = useState<ManualDiscount | null>(null);

  // Quote & Totals
  const [appliedDiscountAmount, setAppliedDiscountAmount] = useState<string>('0');
  // Each cart line's automatic item discount, in percent, from the last quote ('0.00' for none).
  const [lineItemDiscounts, setLineItemDiscounts] = useState<string[]>([]);
  const [quotedTaxAmount, setQuotedTaxAmount] = useState<string>('0');
  const [quotedDeliveryFee, setQuotedDeliveryFee] = useState<string>('0');
  const [appliedDiscountName, setAppliedDiscountName] = useState<string | null>(null);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [approvalReason, setApprovalReason] = useState<string | null>(null);

  // Approval Modal
  const [approvalModalOpen, setApprovalModalOpen] = useState(false);

  // Success state
  const [placedOrder, setPlacedOrder] = useState<OrderHeader | null>(null);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  // Side by side, the two columns are as tall as the window is and scroll inside themselves;
  // stacked on a narrow screen, the page scrolls as before.
  const sideBySide = useMediaQuery((theme: Theme) => theme.breakpoints.up('md'));
  const [registerRef, registerHeight] = useFillViewport<HTMLDivElement>(sideBySide);
  const customerSelectRef = React.useRef<HTMLInputElement | null>(null);
  const deliveryRestoreRef = React.useRef<{ customerId?: string; addressId?: string; zoneId?: string }>({});

  // Re-reads the stops, prices and stock of the minute-by-minute check below, on demand.
  const sellingRefreshRef = React.useRef<(() => void) | null>(null);

  const fetchHeldOrders = useCallback(async (branchId?: string) => {
    try {
      setLoadingHeldOrders(true);
      const bId = branchId || selectedBranchId;
      const orders = await orderApi.getOrders({ branchId: bId || undefined, state: 'DRAFT' });
      setHeldOrders(orders);
      // A held order is priced only when it is placed, so its tax is quoted here for the drawer:
      // the amount shown is what the customer will pay.
      const totals = await Promise.all(
        orders.map(async (ho) => {
          if (!ho.items?.length) return [ho.id, '0'] as const;
          const quote = await discountsApi
            .quoteDiscounts({
              orderDraft: {
                branchId: ho.branch_id,
                customerId: ho.customer_id || undefined,
                orderType: ho.order_type,
                deliveryFee: ho.delivery_fee || '0',
                items: ho.items.map((item) => ({
                  productId: item.product_id,
                  variantId: item.variant_id || undefined,
                  unitPrice: item.unit_price || '0',
                  quantity: String(item.quantity || '1'),
                })),
              },
            })
            .catch(() => null);
          return [ho.id, quote?.grandTotal || ''] as const;
        })
      );
      setHeldTotals(Object.fromEntries(totals.filter(([, total]) => total)));
    } catch {
      // ignore
    } finally {
      setLoadingHeldOrders(false);
    }
  }, [selectedBranchId]);

  // The menu, read again. `quiet` is the read after the cloud came back (Reconnecting bar): it keeps
  // the category the cashier is on and shows no spinner, and a failed one leaves the screen as it is.
  const loadInitialData = async (quiet = false) => {
    try {
      if (!quiet) setLoadingInitialData(true);
      // Today's stops load with the stock counts below, for the selected branch.
      const [cList, pList] = await Promise.all([catalogApi.getCategories(), catalogApi.getProducts()]);
      // Categories taken off the menu hold no sellable products; showing them (and opening on
      // one) left the cashier looking at an empty grid.
      const liveCategories = cList.filter((c) => c.is_active !== false);
      setCategories(liveCategories);
      if (liveCategories.length > 0) {
        setActiveTab((current) =>
          quiet && liveCategories.some((c) => c.id === current) ? current : liveCategories[0].id
        );
      }
      // A product taken off the menu, or in a category taken off it, is not sold; the register
      // refuses it too.
      const offCategoryIds = new Set(cList.filter((c) => c.is_active === false).map((c) => c.id));
      setProducts(pList.filter((p) => p.is_active !== false && !offCategoryIds.has(p.category_id)));
      // The menu is here now: a "could not load" notice from before is out of date.
      setError((current) => (current === CATALOG_LOAD_FAILED ? null : current));
    } catch {
      if (!quiet) setError(CATALOG_LOAD_FAILED);
    } finally {
      if (!quiet) setLoadingInitialData(false);
    }
  };

  useEffect(() => {
    loadInitialData();
     
  }, []);

  // The Reconnecting bar was up and the cloud is back (agent mode): read what is on screen again,
  // quietly. The cart, the open order and the cashier's place are not touched. The open shift is
  // re-read in useRegisterShift, and the open and held orders here.
  useCloudBack(() => {
    // "Not sent. Try again when connected." has done its job once connected.
    setError((current) => (isNotSentMessage(current) ? null : current));
    loadInitialData(true);
    sellingRefreshRef.current?.();
    if (selectedBranchId) fetchHeldOrders(selectedBranchId);
  });

  // The note phrases change rarely, so they are fetched once with the till rather than each
  // time the dialog opens. An empty list is a legitimate answer: the dialog simply shows no
  // chips, and the cashier types.
  useEffect(() => {
    catalogApi
      .getNoteTemplates('ORDER')
      .then(setNoteTemplates)
      .catch(() => setNoteTemplates([]));
  }, []);

  // Selling windows open and close, and items get 86'd from other screens, while the register
  // sits open, so the grid checks each minute. Stops are this branch's plus chain-wide ones.
  useEffect(() => {
    const refresh = () => {
      catalogApi
        .getOffScheduleProducts(selectedBranchId || undefined)
        .then((list) => setOffSchedule(new Map(list.map((o) => [o.product_id, o.windows]))))
        // A read that fails (the cloud is away) leaves what the screen knows as it is.
        .catch(() => undefined);
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
        .catch(() => undefined);
    refresh();
    refreshStock();
    // The cloud came back: read the stops and stock again now, not at the next minute.
    sellingRefreshRef.current = () => {
      refresh();
      refreshStock();
    };
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
    const chosen = customerAddresses.find((address) => address.id === selectedDeliveryAddressId);
    // Where this address was last delivered from here: a returning customer needs no zone picked.
    const remembered = chosen?.last_zone_ids?.find((id) => deliveryZones.some((zone) => zone.id === id));
    if (remembered) {
      setSelectedDeliveryZoneId(remembered);
      return;
    }
    const postalCode = chosen?.postal_code?.trim();
    if (!postalCode) return;
    const matches = deliveryZones.filter((zone) => (zone.postal_prefixes || []).some((prefix) => postalCode.startsWith(prefix)));
    const longestPrefix = Math.max(...matches.flatMap((zone) => (zone.postal_prefixes || []).filter((prefix) => postalCode.startsWith(prefix)).map((prefix) => prefix.length)));
    const bestMatches = matches.filter((zone) => (zone.postal_prefixes || []).some((prefix) => prefix.length === longestPrefix && postalCode.startsWith(prefix)));
    if (bestMatches.length === 1) setSelectedDeliveryZoneId(bestMatches[0].id);
  }, [orderType, selectedDeliveryAddressId, customerAddresses, deliveryZones, selectedDeliveryZoneId]);

  /**
   * A tap on a tile, or on a cart line's Add-ons button (`lineIndex`). The tile rings the item
   * straight through, as HAMI's register does, unless it has sizes to pick, a required group,
   * or an optional group set to ask at the POS (Toast's "force show"). The line always opens
   * the dialog, with the line's choices ticked.
   */
  const openProductOptions = async (p: Product, lineIndex: number | null): Promise<boolean> => {
    // A new tap is a new attempt: the last one's "could not load" does not stay up.
    setError(null);
    setSelectedProduct(p);
    setCheckedOptionIds([]);
    setEditingLine(lineIndex);
    // A failed read is not "no sizes, no add-ons": ringing the dish up bare would only be
    // refused at submit, after the cart is built. Say so here; tapping the tile tries again.
    let vList: ProductVariant[];
    let groups: OptionGroup[];
    try {
      [vList, groups] = await Promise.all([
        catalogApi.getProductVariants(p.id),
        // A product offers only the add-on groups attached to it; the register refuses any other choice.
        catalogApi.getProductById(p.id).then((full) => (full.optionGroups || []) as OptionGroup[]),
      ]);
    } catch {
      setSelectedProduct(null);
      setError(t('pos.productLoadFailed', { name: p.name }));
      return false;
    }
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
      return false;
    }
    const offered = (groups || []).map((g) => ({
      ...g,
      items: (g.items || []).filter(
        (i) => !(g.excluded_item_ids || []).includes(i.id) && !stoppedAddons.has(i.id)
      ),
    }));
    // A group that needs more choices than are left on offer (the rest excluded or 86'd)
    // can never be filled; the register would refuse the line whatever the cashier picks.
    const unfillable = offered.find(
      (g) => (g.items || []).length < Math.max(g.min_selection || 0, g.is_required ? 1 : 0)
    );
    if (unfillable) {
      setSelectedProduct(null);
      setError(t('pos.groupUnfillable', { name: p.name, group: unfillable.name }));
      return false;
    }

    // Required groups first, so what must be picked is at the top of the dialog.
    const ordered = [...offered].sort((a, b) => Number(addonMin(b) > 0) - Number(addonMin(a) > 0));
    setProductVariants(onSale);
    setOptionGroups(ordered);
    // The catalogue's default choices start ticked (a combo's usual drink), up to what each
    // group allows, so the common order is one tap.
    const defaults = ordered.flatMap((g) =>
      (g.items || [])
        .filter((i) => i.is_default)
        .slice(0, g.max_selection && g.max_selection > 0 ? g.max_selection : undefined)
    );
    const line = lineIndex !== null ? cart[lineIndex] : null;
    const offeredIds = new Set(ordered.flatMap((g) => (g.items || []).map((i) => i.id)));
    setCheckedOptionIds(
      line ? line.selectedOptions.map((o) => o.id).filter((id) => offeredIds.has(id)) : defaults.map((i) => i.id)
    );

    const defaultVariant = onSale.find((v) => v.is_default) || onSale[0];
    const lineVariant = line?.selectedVariant && onSale.find((v) => v.id === line.selectedVariant!.id);
    setSelectedVariantId((lineVariant || defaultVariant)?.id || '');

    const asks = onSale.length > 1 || ordered.some((g) => addonMin(g) > 0 || g.prompt_at_pos !== false);
    if (line || asks) {
      setOptionDialogOpen(true);
    } else {
      // Rung straight through with the default add-ons; the line's Add-ons button changes them.
      addToCart(p, defaultVariant, defaults, onSale.length > 1 || ordered.length > 0);
      setSelectedProduct(null);
      return true;
    }
    return false;
  };

  // A tile tap reads the product before the line lands in the cart. F8 or F9 pressed in that
  // moment waits for the line rather than finding an empty cart, or the last order.
  const addsInFlight = React.useRef(0);
  const queuedKey = React.useRef<'F8' | 'F9' | null>(null);
  const [addLanded, setAddLanded] = useState(0);

  const handleOpenProductOptions = async (p: Product, lineIndex: number | null = null) => {
    addsInFlight.current += 1;
    let added = false;
    try {
      added = await openProductOptions(p, lineIndex);
    } finally {
      addsInFlight.current -= 1;
      if (!added) queuedKey.current = null;
      else if (queuedKey.current) setAddLanded((n) => n + 1);
    }
  };

  const addToCart = (product: Product, variant: ProductVariant | undefined, options: OptionItem[], hasChoices = false) => {
    if (placedOrder) setPlacedOrder(null);

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
          hasChoices,
        },
      ];
    });
  };

  // No line goes to the kitchen with a required group empty (a combo's drink, a burger's
  // bread) or a group overfilled; the register refuses the same.
  const unfilledSlot = optionGroups.find((g) => {
    const count = (g.items || []).filter((i) => checkedOptionIds.includes(i.id)).length;
    return count < addonMin(g) || (!!g.max_selection && count > g.max_selection);
  });

  const chosenOptionsNow = (): OptionItem[] =>
    optionGroups.flatMap((g) => (g.items || []).filter((i) => checkedOptionIds.includes(i.id)));

  // What one of the item costs as picked, shown on the dialog's button.
  const dialogUnitPrice = selectedProduct
    ? chosenOptionsNow().reduce(
        (sum, o) => MoneyUtil.add(sum, o.price_delta || '0', 2),
        priceOf(selectedProduct, productVariants.find((v) => v.id === selectedVariantId))
      )
    : '0';

  const closeOptionDialog = () => {
    setOptionDialogOpen(false);
    setSelectedProduct(null);
    setProductVariants([]);
    setSelectedVariantId('');
    setEditingLine(null);
  };

  const handleConfirmAddWithOptions = () => {
    if (!selectedProduct) return;

    const chosenVariant = productVariants.find((v) => v.id === selectedVariantId);
    const chosenOptions = chosenOptionsNow();
    const hasChoices = productVariants.length > 1 || optionGroups.length > 0;

    if (editingLine !== null) {
      // The line keeps its place and quantity; only its size and add-ons change.
      const unit = chosenOptions.reduce((sum, o) => MoneyUtil.add(sum, o.price_delta || '0', 2), priceOf(selectedProduct, chosenVariant));
      setCart((prev) =>
        prev.map((ci, i) =>
          i === editingLine
            ? {
                ...ci,
                selectedVariant: chosenVariant,
                selectedOptions: chosenOptions,
                lineSubtotal: MoneyUtil.multiply(unit, ci.quantity.toString(), 2),
                hasChoices,
              }
            : ci
        )
      );
    } else {
      addToCart(selectedProduct, chosenVariant, chosenOptions, hasChoices);
    }
    closeOptionDialog();
  };

  /** Tick or untick an add-on: a pick-one group swaps its choice rather than adding a second. */
  const toggleOption = (g: OptionGroup, itemId: string) => {
    const inGroup = new Set((g.items || []).map((i) => i.id));
    setCheckedOptionIds((prev) => {
      // A required pick-one choice (the bread) is changed, not cleared.
      if (prev.includes(itemId)) return isPickOne(g) && addonMin(g) > 0 ? prev : prev.filter((id) => id !== itemId);
      return isPickOne(g) ? [...prev.filter((id) => !inGroup.has(id)), itemId] : [...prev, itemId];
    });
  };

  const updateQuantity = (index: number, delta: number) => {
    if (placedOrder) setPlacedOrder(null);

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
    setAppliedDiscountName(null);
    setApprovalRequired(false);
    setApprovalReason(null);
    setOrderNotes('');
    setSelectedCustomer(null);
    setSelectedCustomerId('');
    setSelectedDeliveryAddressId('');
    setSelectedDeliveryZoneId('');
    setManualDeliveryFee(null);
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
      setError(t('pos.cartEmpty'));
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
        // Null goes back to the zone's fee on a draft that had a typed one.
        delivery_fee: orderType === 'DELIVERY' ? typedDeliveryFee : undefined,
        coupon_code: appliedCouponCode || undefined,
        notes: orderNotes.trim() || undefined,
        items: cart.map((ci) => ({
          product_id: ci.product.id,
          variant_id: ci.selectedVariant?.id || undefined,
          variant_name: ci.selectedVariant?.name || undefined,
          quantity: ci.quantity,
          options: ci.selectedOptions.map((o) => ({ option_item_id: o.id })),
        })),
      };

      // One key for this press: if the agent repeats the request after a lost answer, the cloud
      // answers the first one's draft instead of making a second (agent-protocol §19.11).
      const idempotencyKey = newIdempotencyKey();
      let draft: OrderHeader;
      if (activeDraftOrderId) {
        draft = await orderApi.updateDraft(activeDraftOrderId, orderPayload, { idempotencyKey });
      } else {
        draft = await orderApi.createOrder(orderPayload, { idempotencyKey });
      }

      toast.success(t('pos.cartBar.heldToast', { number: draft.order_number }));
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
      setSelectedCustomerId(fullOrder.customer_id || '');
      // The picker shows the customer's name; fetch it, falling back to what the order kept.
      setSelectedCustomer(null);
      if (fullOrder.customer_id) {
        const customerId = fullOrder.customer_id;
        customerApi
          .getCustomer(customerId)
          .then(setSelectedCustomer)
          .catch(() =>
            setSelectedCustomer({ id: customerId, first_name: fullOrder.customer_name || '', last_name: '', mobile: fullOrder.customer_mobile || '', code: '', is_active: true })
          );
      }
      setSelectedDeliveryAddressId(fullOrder.customer_address_id || '');
      setSelectedDeliveryZoneId(fullOrder.delivery_zone_id || '');
      setManualDeliveryFee(fullOrder.delivery_fee_manual ? MoneyUtil.format(fullOrder.delivery_fee_manual, 0) : null);
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
      setError(null);
      toast.success(t('pos.cartBar.resumedToast', { number: fullOrder.order_number }));
    } catch (err: any) {
      setError(t('pos.heldDrawer.resumeFailed'));
      showErrorToast(err, t('pos.heldDrawer.resumeFailed'));
    } finally {
      setResumingOrderId(null);
    }
  };

  // /app/pos?resume=<id> picks a held order up again; "Open at the till" on the Orders page
  // sends the cashier here. It waits for the menu so the lines find their products.
  const [searchParams, setSearchParams] = useSearchParams();
  const resumeId = searchParams.get('resume');

  // The Online tab: platform orders answered beside the cart. A toast or the header badge
  // sends the cashier here with ?panel=online&order=<id>.
  const online = useIncomingOrders();
  const [catalogView, setCatalogView] = useState<'menu' | 'online'>('menu');
  const [onlineHighlight, setOnlineHighlight] = useState<string | null>(null);
  const onlineAttention = (online?.waiting.length ?? 0) + (online?.issues.filter((c) => c.issue !== 'WITH_SUPPORT').length ?? 0);
  const panelParam = searchParams.get('panel');
  const panelOrder = searchParams.get('order');
  useEffect(() => {
    if (panelParam !== 'online') return;
    setCatalogView('online');
    setOnlineHighlight(panelOrder);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('panel');
        next.delete('order');
        return next;
      },
      { replace: true }
    );
  }, [panelParam, panelOrder, setSearchParams]);
  useEffect(() => {
    if (!resumeId || products.length === 0) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('resume');
        return next;
      },
      { replace: true }
    );
    handleResumeOrder({ id: resumeId } as OrderHeader);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId, products.length]);

  // Discard a Held Order. The backend refuses to cancel a draft with items on it
  // without a reason code (spec 6.1), so those go through the reason dialog; an
  // empty draft still discards in one click.
  const handleDiscardHeldOrder = async (order: OrderHeader) => {
    if (!order.items?.length) {
      await discardHeldOrder(order.id);
      return;
    }
    setDiscardTarget(order);
    setDiscardReasonCodeId('');
    if (discardReasonCodes.length === 0) {
      try {
        const codes = await settingsApi.getReasonCodes();
        setDiscardReasonCodes(codes.filter((c) => c.is_active));
      } catch (err: any) {
        showErrorToast(err, 'Failed to load reason codes');
      }
    }
  };

  const handleConfirmDiscard = async () => {
    if (!discardTarget || !discardReasonCodeId) {
      toast.error(t('orders.cancelDialog.reasonRequired'));
      return;
    }
    const discarded = await discardHeldOrder(discardTarget.id, discardReasonCodeId);
    if (discarded) setDiscardTarget(null);
  };

  const discardHeldOrder = async (orderId: string, reasonCodeId?: string): Promise<boolean> => {
    try {
      await orderApi.cancelOrder(orderId, reasonCodeId, 'Discarded from held drafts');
      if (activeDraftOrderId === orderId) {
        handleClearCart();
      } else if (selectedBranchId) {
        fetchHeldOrders(selectedBranchId);
      }
      toast.info(t('pos.heldDrawer.discarded'));
      setError(null);
      return true;
    } catch (err: any) {
      const msg = 'Failed to discard held draft';
      setError(msg);
      showErrorToast(err, msg);
      return false;
    }
  };

  // Cart financial math via decimal-safe MoneyUtil
  const cartSubtotal = cart.reduce((sum, item) => MoneyUtil.add(sum, item.lineSubtotal, 2), '0');
  const cartTax = quotedTaxAmount;
  const subtotalPlusTax = MoneyUtil.add(MoneyUtil.add(cartSubtotal, cartTax, 2), quotedDeliveryFee, 2);
  const cartTotalDue = MoneyUtil.greaterThan(subtotalPlusTax, appliedDiscountAmount)
    ? MoneyUtil.subtract(subtotalPlusTax, appliedDiscountAmount, 2)
    : '0';

  const zoneDeliveryFee = deliveryZones.find((zone) => zone.id === selectedDeliveryZoneId)?.fee || '0';
  const typedDeliveryFee = manualDeliveryFee !== null && manualDeliveryFee !== '' ? manualDeliveryFee : null;
  const deliveryFeeCharged = orderType === 'DELIVERY' ? (typedDeliveryFee ?? zoneDeliveryFee) : '0';

  // A typed price belongs to the delivery it was typed for. What a delivery was missing
  // (customer, address, zone) no longer applies to another order type either.
  useEffect(() => {
    if (orderType !== 'DELIVERY') setManualDeliveryFee(null);
    setError(null);
  }, [orderType]);

  // Live Auto-Quote
  const evaluateQuote = useCallback(async () => {
    if (cart.length === 0) {
      setAppliedDiscountAmount('0');
      setQuotedTaxAmount('0');
      setQuotedDeliveryFee('0');
      setAppliedDiscountName(null);
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
          deliveryFee: deliveryFeeCharged,
          items: cart.map((ci) => ({
            productId: ci.product.id,
            variantId: ci.selectedVariant?.id || undefined,
            // Add-ons are part of what the line sells for, so they are taxed with it.
            unitPrice: ci.selectedOptions
              .reduce((sum, o) => MoneyUtil.add(sum, o.price_delta || '0', 2), priceOf(ci.product, ci.selectedVariant).toString())
              .toString(),
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
      setLineItemDiscounts((quoteRes.items || []).map((line) => line.itemDiscountPercent || '0'));
      setQuotedTaxAmount(MoneyUtil.format(quoteRes.taxTotal || '0', 2));
      setQuotedDeliveryFee(MoneyUtil.format(quoteRes.deliveryFee || deliveryFeeCharged, 2));

      setApprovalRequired(!!quoteRes.approvalRequired);
      setApprovalReason(quoteRes.approvalReason || null);

      // The order's own discount; item discounts show on their lines instead.
      const applied = quoteRes.consideredDiscounts?.find((d) => d.status === 'APPLIED' && d.source !== 'ITEM');
      const rejected = quoteRes.consideredDiscounts?.find((d) => d.status === 'REJECTED');

      if (applied) {
        // The server names a coupon "Coupon (CODE)".
        const couponCode = /^Coupon \((.+)\)$/.exec(applied.name || '')?.[1];
        const appliedName = couponCode ? t('pos.discount.couponName', { code: couponCode }) : applied.name;
        const approvedBadge = appliedManualDiscount?.approvalRequestId ? ` (${t('pos.discount.managerApproved')})` : '';
        const msg = `${t('pos.discount.applied', { name: appliedName })}${approvedBadge}: -${MoneyUtil.formatCurrency(discAmount)} ${currency}`;
        // The cashier's own discount shows as its rate; its name is the same on every order.
        setAppliedDiscountName(
          applied.source !== 'MANUAL'
            ? appliedName
            : appliedManualDiscount?.calculation_type === 'PERCENTAGE'
              ? `${Number(appliedManualDiscount.value)}%`
              : null
        );
        setError(null);
        discountBeforeCoupon.current = null;
        if (appliedCouponCode) {
          toast.success(msg);
        }
      } else if (rejected) {
        setAppliedDiscountName(null);
        const reasonMsg = formatRejectionReason(t, rejected.rejectionReason);
        if (appliedCouponCode) {
          toast.error(reasonMsg);
          // A code that is refused leaves the cart with the discount it had before it was typed.
          const before = discountBeforeCoupon.current;
          discountBeforeCoupon.current = null;
          setAppliedCouponCode(before?.coupon || '');
          if (before?.manual) setAppliedManualDiscount(before.manual);
        }
      } else {
        setAppliedDiscountName(null);
      }
    } catch (err: any) {
      if (appliedCouponCode) {
        showErrorToast(err, t('pos.discount.rejected.OTHER'));
        setAppliedCouponCode('');
      }
    }
  }, [cart, selectedCustomerId, appliedCouponCode, appliedManualDiscount, selectedBranchId, orderType, deliveryFeeCharged, priceOf, currency, t]);

  useEffect(() => {
    evaluateQuote();
  }, [evaluateQuote]);

  const hasDiscount = Boolean(appliedCouponCode || appliedManualDiscount);
  // Also true for one the cashier didn't add: an item's own discount, or the customer's rate.
  const discountOn = hasDiscount || MoneyUtil.greaterThan(appliedDiscountAmount, '0');

  // Coupon Actions
  // The discount a new coupon replaces, put back if the server refuses the code.
  const discountBeforeCoupon = React.useRef<{ coupon: string; manual: typeof appliedManualDiscount } | null>(null);

  const handleApplyCoupon = () => {
    const trimmed = couponInput.trim().toUpperCase();
    if (!trimmed) {
      toast.error(t('pos.discount.couponCode'));
      return;
    }
    if (cart.length === 0) {
      toast.error(t('pos.cartEmpty'));
      return;
    }
    discountBeforeCoupon.current = { coupon: appliedCouponCode, manual: appliedManualDiscount };
    setAppliedManualDiscount(null);
    setAppliedCouponCode(trimmed);
    setManualDiscountModalOpen(false);
  };

  const handleClearCoupon = () => {
    setCouponInput('');
    setAppliedCouponCode('');
    setAppliedDiscountName(null);
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

    if (manualCalcType === 'PERCENTAGE' && Number(manualValue) > Number(discountLimits.ceiling.pct)) {
      const msg = `Percentage discount exceeds maximum policy ceiling of ${discountLimits.ceiling.pct}%`;
      setError(msg);
      toast.error(msg);
      return;
    }

    if (manualCalcType === 'FIXED_AMOUNT' && Number(manualValue) > Number(discountLimits.ceiling.maxFixed)) {
      const msg = `Fixed discount exceeds maximum policy ceiling of ${MoneyUtil.formatCurrency(discountLimits.ceiling.maxFixed)} ${currency}`;
      setError(msg);
      toast.error(msg);
      return;
    }

    if (overOwnLimit) {
      // Prompt Manager PIN authorization immediately
      setApprovalReason(
        `Manual discount ${manualCalcType === 'PERCENTAGE' ? `${manualValue}%` : `${MoneyUtil.formatCurrency(manualValue)} ${currency}`} exceeds your limit (${discountLimits.own.pct}% / ${MoneyUtil.formatCurrency(discountLimits.own.maxFixed)} ${currency}). Manager PIN authorization required.`
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
    setAppliedDiscountName(null);
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
    let submitted: OrderHeader | null = null;
    try {
      const orderPayload: any = {
        branch_id: selectedBranchId,
        order_type: orderType,
        customer_id: selectedCustomerId || undefined,
        delivery_address_id: orderType === 'DELIVERY' ? selectedDeliveryAddressId : undefined,
        delivery_zone_id: orderType === 'DELIVERY' ? selectedDeliveryZoneId : undefined,
        // Null goes back to the zone's fee on a draft that had a typed one.
        delivery_fee: orderType === 'DELIVERY' ? typedDeliveryFee : undefined,
        coupon_code: appliedCouponCode || undefined,
        notes: orderNotes.trim() || undefined,
        items: cart.map((ci) => ({
          product_id: ci.product.id,
          variant_id: ci.selectedVariant?.id || undefined,
          variant_name: ci.selectedVariant?.name || undefined,
          quantity: ci.quantity,
          options: ci.selectedOptions.map((o) => ({ option_item_id: o.id })),
        })),
      };

      // One key for this press, on every write of it: the order routes and the payment's intent keep
      // their keys apart by route (agent-protocol §19.11).
      const idempotencyKey = newIdempotencyKey();
      let draftId: string;
      if (activeDraftOrderId) {
        const updated = await orderApi.updateDraft(activeDraftOrderId, orderPayload, { idempotencyKey });
        draftId = updated.id;
      } else {
        const draft = await orderApi.createOrder(orderPayload, { idempotencyKey });
        draftId = draft.id;
      }

      const submitPayload = buildSubmitPayload();
      submitted = await orderApi.submitOrder(draftId, submitPayload, { idempotencyKey });

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

      let paidOrder: OrderHeader | null = null;
      if (preferredPos) {
        const payRes = await paymentApi.postPayment({
          order_id: submitted.id,
          payment_method_id: preferredPos.id,
          amount: submitted.due_amount || submitted.total_amount || '0',
          reference_number: undefined,
          idempotency_key: idempotencyKey,
        });
        paidOrder = payRes.order || null;
      }

      // Paid in full: the receipt has printed, and the register is ready for the next customer.
      // Anything less stays on screen in the pay form.
      if (paidOrder && MoneyUtil.isZero(paidOrder.due_amount || '0')) {
        setPlacedOrder(null);
      } else {
        setPlacedOrder(paidOrder || submitted);
        setCheckoutModalOpen(true);
      }
      toast.success(t('pos.orderSubmittedPaid', { number: submitted.call_number || submitted.order_number || '' }));
      handleClearCart();
      fetchHeldOrders(selectedBranchId);
      setError(null);
    } catch (err: any) {
      const msg = err.detail || err.message || 'Direct Terminal Pay failed';
      if (submitted) {
        // The order is placed; only the card did not go through. It is paid from the checkout,
        // never placed a second time.
        setPlacedOrder(submitted);
        setCheckoutModalOpen(true);
        handleClearCart();
        fetchHeldOrders(selectedBranchId);
      }
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
    orderNotes,
    selectedDeliveryAddressId,
    selectedDeliveryZoneId,
    typedDeliveryFee,
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
      setError(t('pos.cartEmpty'));
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
        // Null goes back to the zone's fee on a draft that had a typed one.
        delivery_fee: orderType === 'DELIVERY' ? typedDeliveryFee : undefined,
        coupon_code: appliedCouponCode || undefined,
        notes: orderNotes.trim() || undefined,
        items: cart.map((ci) => ({
          product_id: ci.product.id,
          variant_id: ci.selectedVariant?.id || undefined,
          variant_name: ci.selectedVariant?.name || undefined,
          quantity: ci.quantity,
          options: ci.selectedOptions.map((o) => ({ option_item_id: o.id })),
        })),
      };

      // One key for this press, on both writes of it (agent-protocol §19.11).
      const idempotencyKey = newIdempotencyKey();
      let draftId: string;
      if (activeDraftOrderId) {
        const updated = await orderApi.updateDraft(activeDraftOrderId, orderPayload, { idempotencyKey });
        draftId = updated.id;
      } else {
        const draft = await orderApi.createOrder(orderPayload, { idempotencyKey });
        draftId = draft.id;
      }

      const submitPayload = buildSubmitPayload();
      const submitted = await orderApi.submitOrder(draftId, submitPayload, { idempotencyKey });

      setPlacedOrder(submitted);
      setCheckoutModalOpen(true);
      toast.success(t('pos.orderSubmitted', { number: submitted.call_number || submitted.order_number || '' }));
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
    orderNotes,
    selectedDeliveryAddressId,
    selectedDeliveryZoneId,
    typedDeliveryFee,
    deliveryReady,
    activeDraftOrderId,
    buildSubmitPayload,
    fetchHeldOrders,
    handleClearCart,
    t,
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
      if ((e.key === 'F8' || e.key === 'F9') && addsInFlight.current > 0) {
        e.preventDefault();
        queuedKey.current = e.key;
        return;
      }

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

    // On document rather than window: a keydown reaches document first, so the register's
    // Ctrl+K (product search) runs before the header's, which then sees it was taken.
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
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

  // The F8 / F9 held while a tapped product was read, once its line is in the cart.
  useEffect(() => {
    const key = queuedKey.current;
    if (!key || cart.length === 0 || addsInFlight.current > 0) return;
    queuedKey.current = null;
    if (key === 'F8') handlePlaceOrder();
    else handleDirectTerminalPay();
  }, [cart, addLanded, handlePlaceOrder, handleDirectTerminalPay]);

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
      <ClosedBranchBanner />
      {loadingInitialData && <LinearProgress sx={{ mb: 2 }} />}
      {error && (
        <Alert severity="error" sx={{ mb: 2.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Selling, the register and its shift are a chip in the cart's header; the bar is kept
          for a shift whose business day has ended, which has to be closed from here. */}
      {/* With the till shut the Online tab is out of sight, so say what is waiting on it. */}
      {shiftBlocked && onlineAttention > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('online.waitingBehindShift', { count: onlineAttention })}
        </Alert>
      )}
      {shiftBlocked && !register.dayEnded && <PosShiftGate register={register} />}
      {register.dayEnded && <PosShiftBar register={register} />}

      {/* Hidden rather than unmounted while no shift is open, so a half-built cart survives
          a shift being opened in the middle of it. */}
      <Grid
        ref={registerRef}
        container
        spacing={2.5}
        sx={{ display: shiftBlocked ? 'none' : undefined, height: registerHeight }}
      >
        {/* Left Column: High-Density Product Catalog with Categories Rail */}
        <Grid size={{ xs: 12, md: 7, lg: 8 }} sx={{ height: { md: '100%' } }}>
          <Card
            sx={{
              borderRadius: 3,
              boxShadow: 2,
              display: 'flex',
              flexDirection: 'column',
              minHeight: { xs: 700, md: 0 },
              height: { md: '100%' },
              overflow: 'hidden',
              position: 'relative',
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
              {/* Online orders are answered here, beside the cart, not on another page. */}
              {online?.enabled && (
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={catalogView}
                  onChange={(_e, value) => value && setCatalogView(value)}
                  sx={{ flexShrink: 0 }}
                >
                  <ToggleButton value="menu" sx={{ px: 1.5 }}>
                    {t('online.tabMenu')}
                  </ToggleButton>
                  <ToggleButton value="online" sx={{ px: 1.5, gap: 1 }}>
                    {t('online.tabOnline')}
                    {onlineAttention > 0 && (
                      <Chip size="small" color="error" label={onlineAttention} sx={{ height: 20, fontWeight: 700 }} />
                    )}
                  </ToggleButton>
                </ToggleButtonGroup>
              )}
              <Box sx={{ display: catalogView === 'menu' ? 'flex' : 'none', alignItems: 'center', gap: 2, flexGrow: 1, minWidth: 0 }}>
              <TextField
                inputRef={searchInputRef}
                fullWidth
                size="small"
                placeholder={t('pos.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Enter rings up the first match, as tapping it would, sold-out checks and all.
                  if (e.key !== 'Enter' || !searchQuery.trim()) return;
                  e.preventDefault();
                  const first = document.querySelector<HTMLElement>('[data-product-tile]');
                  if (!first) return;
                  first.click();
                  setSearchQuery('');
                }}
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
                label={t('pos.itemsCount', { count: filteredProducts.length })}
                size="small"
                variant="outlined"
                color="primary"
                sx={{ fontWeight: 'bold', flexShrink: 0 }}
              />
              </Box>
            </Box>

            {catalogView === 'online' && (
              <Box sx={{ flexGrow: 1, minHeight: 0, overflowY: { xs: 'visible', md: 'auto' } }}>
                <OnlineBoard variant="panel" highlightId={onlineHighlight} />
              </Box>
            )}
            {catalogView === 'menu' && (
              <NewOrderPopup
                onOpen={(orderId) => {
                  setOnlineHighlight(orderId);
                  setCatalogView('online');
                }}
              />
            )}

            {/* Catalog Body: Category Rail + Product Cards Grid. Hidden, not unmounted, on the
                Online tab, so the category and scroll survive a trip to answer an order. */}
            <Box sx={{ display: catalogView === 'menu' ? 'flex' : 'none', flexGrow: 1, minHeight: 0, flexDirection: { xs: 'column', sm: 'row' } }}>
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
                  minHeight: 0,
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
              <CardContent sx={{ p: 2, flexGrow: 1, minWidth: 0, overflowY: 'auto', maxHeight: { xs: 'auto', sm: 720, md: 'none' } }}>
                {filteredProducts.length === 0 ? (
                  <Box sx={{ py: 8, textAlign: 'center' }}>
                    <Typography variant="body1" color="text.secondary">
                      {t('pos.noProducts')}
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
                          data-product-tile
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
                            </Box>
                            {/* No product code on the tile (PM, 2026-10-03); search still finds it.
                                The name keeps clear of the stop button now that it is the top line. */}
                            <Typography
                              variant="subtitle2"
                              sx={{
                                fontWeight: 'bold',
                                mb: 0.5,
                                paddingInlineEnd: '24px',
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
                            {MoneyUtil.formatCurrency(priceOf(p))} {currency}
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
        <Grid size={{ xs: 12, md: 5, lg: 4 }} sx={{ height: { md: '100%' } }}>
          <Card sx={{ borderRadius: 3, boxShadow: 3, display: 'flex', flexDirection: 'column', height: '100%', minHeight: { xs: 700, md: 0 } }}>
            {/* The lines scroll between the order's details above and the totals and pay buttons
                below; on a very short window the whole panel scrolls instead. */}
            <CardContent sx={{ p: 2, display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0, overflowY: { md: 'auto' } }}>
              {/* Header: Cart title + Quick Actions */}
              <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.5, minWidth: 0 }}>
                {/* No title: the panel is plainly the cart, and the words took the header's room. */}
                <Badge badgeContent={cart.reduce((s, i) => s + i.quantity, 0)} color="primary" sx={{ flexShrink: 0, marginInlineEnd: 0.5 }}>
                  <ShoppingCartIcon color="primary" />
                </Badge>
                {/* The chips take the room the buttons leave, and shorten first. */}
                <Stack direction="row" sx={{ flex: '1 1 0', minWidth: 32, gap: 0.75, alignItems: 'center', overflow: 'hidden' }}>
                  <PosShiftAccountLink register={register} />
                  {/* A resumed draft: holding or placing the cart updates that draft. */}
                  {activeDraftOrderId && (
                    <Tooltip title={t('pos.cartBar.draftCancel')}>
                      <Chip size="small" color="warning" label={t('pos.cartBar.draft')} onDelete={handleClearCart} sx={{ fontWeight: 600 }} />
                    </Tooltip>
                  )}
                </Stack>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0 }}>
                  {heldOrders.length > 0 && (
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
                      {t('pos.cartBar.heldButton')}
                    </Button>
                  </Tooltip>
                  )}
                  {cart.length > 0 && (
                    <Button
                      size="small"
                      color="error"
                      startIcon={<DeleteIcon fontSize="small" />}
                      onClick={handleClearCart}
                      sx={{ textTransform: 'none', py: 0.25, px: 1 }}
                    >
                      {t('pos.clearCart')}
                    </Button>
                  )}
                </Stack>
              </Stack>

              {/* Order Parameters (Segmented Order Type Switch + Customer) */}
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
                  <PosCustomerPicker
                    inputRef={customerSelectRef}
                    value={selectedCustomer}
                    onChange={pickCustomer}
                    search={(q) => customerApi.searchCustomers(q, 20)}
                    // Registering lives at the bottom of the picker's list (no separate button):
                    // whatever was typed carries over as the mobile or the name.
                    onRegister={(prefill) => {
                      setRegisterPrefill(prefill);
                      setQuickAddCustomerOpen(true);
                    }}
                    placeholder={orderType === 'DELIVERY' ? t('pos.deliveryContext.customerRequired') : t('pos.customerSearch.placeholder')}
                  />

                  <Tooltip title={t('pos.notes.title')}>
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

                </Stack>

                {orderType === 'DELIVERY' && (
                  <Stack spacing={1} sx={{ p: 1.25, border: 1, borderColor: 'primary.light', borderRadius: 1.5, bgcolor: 'background.neutral' }}>
                    {!selectedCustomerId ? (
                      <Alert severity="warning" sx={{ py: 0.25 }}>{t('pos.deliveryContext.customerRequired')}</Alert>
                    ) : (
                      <>
                        {/* The address has the row to itself: beside a button, its street was cut off. */}
                          <FormControl fullWidth size="small" disabled={deliveryOptionsLoading} error={Boolean(selectedCustomerId && !selectedDeliveryAddressId)}>
                            <InputLabel>{t('pos.deliveryContext.addressLabel')}</InputLabel>
                            <Select value={selectedDeliveryAddressId} label={t('pos.deliveryContext.addressLabel')} onChange={(e) => {
                                // The last entry adds an address; it is not one to select.
                                if (e.target.value === ADD_ADDRESS) { setAddAddressOpen(true); return; }
                                setSelectedDeliveryAddressId(e.target.value); setSelectedDeliveryZoneId(''); setManualDeliveryFee(null);
                              }}
                            >
                              {customerAddresses.map((address) => (
                                <MenuItem key={address.id} value={address.id} sx={{ whiteSpace: 'normal' }}>
                                  {address.title} — {address.address_text}
                                </MenuItem>
                              ))}
                              {customerAddresses.length > 0 && <Divider />}
                              <MenuItem value={ADD_ADDRESS} sx={{ color: 'primary.main', fontWeight: 600 }}>
                                + {t('pos.deliveryContext.addAddress')}
                              </MenuItem>
                            </Select>
                          </FormControl>
                        {customerAddresses.length === 0 && !deliveryOptionsLoading && <Alert severity="info" sx={{ py: 0.25 }}>{t('pos.deliveryContext.noAddresses')}</Alert>}
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <FormControl fullWidth size="small" disabled={deliveryOptionsLoading} error={Boolean(selectedCustomerId && !selectedDeliveryZoneId)} sx={{ minWidth: 0 }}>
                          <InputLabel>{t('pos.deliveryContext.zoneLabel')}</InputLabel>
                          <Select value={selectedDeliveryZoneId} label={t('pos.deliveryContext.zoneLabel')}
                            onChange={(e) => { setSelectedDeliveryZoneId(e.target.value); setManualDeliveryFee(null); }}
                            // Chosen, it shows its name and time: its price is in the box beside it.
                            renderValue={(id) => {
                              const zone = deliveryZones.find((z) => z.id === id);
                              return zone ? t('pos.deliveryContext.zoneShort', { name: zone.name, minutes: zone.estimated_minutes }) : '';
                            }}
                          >
                            {deliveryZones.map((zone) => (
                              <MenuItem key={zone.id} value={zone.id}>
                                {t('pos.deliveryContext.zoneOption', { currency: currencyLabel,
                                  name: zone.name,
                                  fee: MoneyUtil.formatCurrency(zone.fee),
                                  minutes: zone.estimated_minutes,
                                })}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        {/* The zone's fee, which the cashier may change for this order: a far
                            address more, a regular nothing. Emptied, it goes back to the zone's. */}
                        <TextField
                          size="small"
                          label={t('pos.deliveryContext.feeLabel', { currency: currencyLabel })}
                          disabled={!selectedDeliveryZoneId}
                          color={typedDeliveryFee !== null ? 'warning' : undefined}
                          focused={typedDeliveryFee !== null ? true : undefined}
                          value={!selectedDeliveryZoneId ? '' : toToman(manualDeliveryFee ?? zoneDeliveryFee).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                          onChange={(e) => {
                            const typed = fromToman(e.target.value.replace(/,/g, ''));
                            // Nothing below zero; a half-typed value never reaches the order.
                            setManualDeliveryFee(/^\d*$/.test(typed) ? typed : manualDeliveryFee);
                          }}
                          onBlur={() => {
                            if (manualDeliveryFee === '' || manualDeliveryFee === MoneyUtil.format(zoneDeliveryFee, 0)) setManualDeliveryFee(null);
                          }}
                          slotProps={{
                            htmlInput: { inputMode: 'numeric', dir: 'ltr' },
                            input: {
                              endAdornment: typedDeliveryFee !== null ? (
                                <InputAdornment position="end">
                                  <Tooltip title={t('pos.deliveryContext.feeReset')}>
                                    <IconButton size="small" aria-label={t('pos.deliveryContext.feeReset')} onClick={() => setManualDeliveryFee(null)} sx={{ p: 0.25 }}>
                                      <ClearIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                </InputAdornment>
                              ) : null,
                            },
                          }}
                          sx={{ width: 120, flexShrink: 0 }}
                        />
                        </Stack>
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
              <Box sx={{ flexGrow: 1, overflowY: 'auto', minHeight: { xs: 220, md: 96 }, maxHeight: { xs: 260, md: 'none' }, mb: 1.5, pr: 0.5 }}>
                {cart.length === 0 ? (
                  placedOrder ? (
                    // The order just placed, and the way back to its checkout. It sits in the
                    // empty cart, not in a banner that pushed the register down after each sale.
                    <Stack spacing={0.75} sx={{ py: 3, alignItems: 'center', textAlign: 'center' }}>
                      <CheckCircleIcon color="success" />
                      <Typography variant="subtitle2">
                        {t('pos.orderPlaced', 'Order placed')}
                        {placedOrder.call_number ? (
                          <>
                            {' · '}
                            {t('pos.callNumber', 'Number')}: <strong style={{ fontSize: '1.4em' }}>{placedOrder.call_number}</strong>
                          </>
                        ) : null}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        <bdi><code>{placedOrder.order_number}</code></bdi> · <bdi>{MoneyUtil.formatCurrency(placedOrder.total_amount)} {currency}</bdi>
                      </Typography>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Button size="small" variant="outlined" color="success" onClick={() => setCheckoutModalOpen(true)} sx={{ fontWeight: 'bold' }}>
                          {t('pos.cartBar.payNow')}
                        </Button>
                        <IconButton size="small" aria-label={t('common.close', 'Close')} onClick={() => setPlacedOrder(null)}>
                          <ClearIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    </Stack>
                  ) : (
                  <Box sx={{ py: 6, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      {t('pos.cartEmptyHint')}
                    </Typography>
                  </Box>
                  )
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
                              >
                                + {item.selectedOptions.map((o) => o.name).join('، ')}
                              </Typography>
                            )}
                            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mt: 0.25 }}>
                              <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                                {MoneyUtil.formatCurrency(item.lineSubtotal)} {currency}
                              </Typography>
                              {Number(lineItemDiscounts[idx] || 0) > 0 && (
                                <Chip
                                  size="small"
                                  color="error"
                                  variant="outlined"
                                  label={t('pos.itemDiscount', { percent: Number(lineItemDiscounts[idx]) })}
                                  sx={{ height: 18, fontSize: '0.65rem', fontWeight: 700 }}
                                />
                              )}
                              {/* Change a line's size and add-ons without ringing it up again.
                                  Icon only (PM, 2026-10-03); the label stays as the tooltip. */}
                              {(item.hasChoices || item.selectedOptions.length > 0 || !!item.selectedVariant) && (
                                <IconButton
                                  size="small"
                                  color="primary"
                                  title={t('pos.options.editLine')}
                                  aria-label={t('pos.options.editLine')}
                                  onClick={() => handleOpenProductOptions(item.product, idx)}
                                  sx={{ p: 0.25 }}
                                >
                                  <TuneIcon sx={{ fontSize: 16 }} />
                                </IconButton>
                              )}
                            </Stack>
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
              <Stack spacing={0.5} sx={{ mb: 1.5, mt: 'auto', flexShrink: 0 }}>
                {totalsOpen && (
                  <>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">{t('pos.totals.subtotal')}</Typography>
                      <Typography variant="body2">{t('pos.amountIrr', { currency: currencyLabel, amount: MoneyUtil.formatCurrency(cartSubtotal) })}</Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">{t('pos.totals.tax')}</Typography>
                      <Typography variant="body2">{t('pos.amountIrr', { currency: currencyLabel, amount: MoneyUtil.formatCurrency(cartTax) })}</Typography>
                    </Stack>
                    {/* The delivery box above already shows the fee; here it is only part of the breakdown. */}
                    {orderType === 'DELIVERY' && (
                      <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                        <Typography variant="body2" color="text.secondary">{t('pos.totals.delivery')}</Typography>
                        <Typography variant="body2">{t('pos.amountIrr', { currency: currencyLabel, amount: MoneyUtil.formatCurrency(quotedDeliveryFee) })}</Typography>
                      </Stack>
                    )}
                  </>
                )}
                {/* The discount line is always there: it is also the way to a discount or a coupon.
                    With none applied it names the action; applied, it names the discount, so the
                    cashier sees which one is on without opening it. */}
                <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  <Tooltip title={t('pos.cartBar.discount')}>
                    <Button
                      size="small"
                      color={discountOn ? 'error' : 'primary'}
                      startIcon={<LocalOfferIcon sx={{ fontSize: 16 }} />}
                      onClick={() => setManualDiscountModalOpen(true)}
                      aria-keyshortcuts="F6"
                      endIcon={appliedDiscountName && appliedManualDiscount?.approvalRequestId ? <VerifiedIcon sx={{ fontSize: 16 }} /> : undefined}
                      sx={{ py: 0, px: 0.75, minWidth: 0, marginInlineStart: -0.75, fontWeight: 600, fontSize: '0.8125rem', lineHeight: 1.6 }}
                    >
                      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {discountOn ? t('pos.totals.discount') : t('pos.totals.addDiscount')}
                        {appliedDiscountName ? ` ${appliedDiscountName}` : ''}
                      </Box>
                    </Button>
                  </Tooltip>
                  {MoneyUtil.greaterThan(appliedDiscountAmount, '0') ? (
                    <Typography variant="body2" color="error.main" sx={{ fontWeight: 'bold', flexShrink: 0 }}>
                      -{t('pos.amountIrr', { currency: currencyLabel, amount: MoneyUtil.formatCurrency(appliedDiscountAmount) })}
                    </Typography>
                  ) : null}
                </Stack>
                <Divider />
                {/* The total opens and folds the breakdown above it. */}
                <ButtonBase
                  onClick={() => setTotalsOpen((open) => !open)}
                  aria-expanded={totalsOpen}
                  aria-label={t('pos.totals.breakdown')}
                  sx={{ width: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', pt: 0.5, borderRadius: 1 }}
                >
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="h6" sx={{ fontWeight: 'bold' }}>{t('pos.totals.totalDue')}</Typography>
                    {totalsOpen ? <ExpandMoreIcon fontSize="small" color="action" /> : <ExpandLessIcon fontSize="small" color="action" />}
                  </Stack>
                  <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                    {t('pos.amountIrr', { currency: currencyLabel, amount: MoneyUtil.formatCurrency(cartTotalDue) })}
                  </Typography>
                </ButtonBase>
              </Stack>

              {/* Hold, place and pay in one row: stacked, they took two rows from the cart's lines. */}
              <Stack direction="row" spacing={1} sx={{ alignItems: 'stretch', flexShrink: 0 }}>
                <Button
                  variant="outlined"
                  color="warning"
                  disabled={cart.length === 0 || holdingOrder}
                  onClick={handleHoldOrder}
                  startIcon={holdingOrder ? <CircularProgress size={18} color="inherit" /> : <PauseIcon />}
                  aria-label={t('pos.cartBar.hold')}
                  title={t('pos.cartBar.hold')}
                  // On a till-sized screen the row has no room for the word beside Place and PC-POS,
                  // so Hold is its icon there and spells itself out on wider screens.
                  sx={{
                    fontWeight: 'bold',
                    flexShrink: 0,
                    px: 1.5,
                    minWidth: 0,
                    whiteSpace: 'nowrap',
                    '& .MuiButton-startIcon': { marginInline: { xs: 0, xl: '-4px 8px' } },
                  }}
                >
                  <Box component="span" sx={{ display: { xs: 'none', xl: 'inline' } }}>
                    {holdingOrder ? t('pos.cartBar.holding') : t('pos.cartBar.hold')}
                  </Box>
                </Button>
                <Button
                  variant="outlined"
                  color="inherit"
                  disabled={cart.length === 0}
                  onClick={handlePlaceOrder}
                  aria-keyshortcuts="F8"
                  sx={{ fontWeight: 'bold', flexShrink: 0, px: 1.25, whiteSpace: 'nowrap' }}
                >
                  {activeDraftOrderId ? t('pos.updateAndPlace') : t('pos.placeOrder')}
                </Button>
                {/* 1-Click Direct Terminal Pay (90% Standard in Iran) */}
                <Button
                  variant="contained"
                  color="primary"
                  size="large"
                  disabled={cart.length === 0 || terminalPayLoading}
                  onClick={handleDirectTerminalPay}
                  aria-keyshortcuts="F9"
                  startIcon={terminalPayLoading ? <CircularProgress size={20} color="inherit" /> : <PointOfSaleIcon sx={{ fontSize: 22 }} />}
                  sx={{
                    flexGrow: 1,
                    minWidth: 0,
                    fontWeight: 800,
                    py: 1.25,
                    fontSize: '1.02rem',
                    borderRadius: 1.5,
                    boxShadow: (theme) => theme.customShadows?.primary || 3,
                  }}
                >
                  {/* The spinner says it is being sent; the label stays short (PM, 2026-10-05). */}
                  PC-POS
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
        aria-keyshortcuts="Escape"
      >
        <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
          <LocalOfferIcon color="primary" />
          {t('pos.discount.title')}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Stack spacing={2}>
            {/* Coupon code: here rather than in the cart, where it held a row on every order. */}
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', pt: 1 }}>
              <VersionTag feature="pos.coupon" />
              <TextField
                size="small"
                placeholder={t('pos.discount.couponCode')}
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                // A new code replaces the last one rather than being typed onto its end.
                onFocus={(e) => e.target.select()}
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
                onClick={handleApplyCoupon}
                disabled={!couponInput.trim() || (appliedCouponCode === couponInput.trim())}
                sx={{ fontWeight: 'bold', flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                {appliedCouponCode && appliedCouponCode === couponInput.trim() ? t('pos.cartBar.couponApplied') : t('pos.cartBar.couponApply')}
              </Button>
            </Stack>

            <Divider />

            {/* Calculation Type Toggle */}
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
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
                  {t('pos.discount.percent')}
                </ToggleButton>
                <ToggleButton value="FIXED_AMOUNT" sx={{ fontWeight: 600, px: 1.5 }}>
                  {t('pos.discount.fixed', { currency })}
                </ToggleButton>
              </ToggleButtonGroup>

              <TextField
                size="small"
                type="number"
                placeholder={manualCalcType === 'PERCENTAGE' ? '10 %' : `50,000 ${currency}`}
                // An amount is typed in tomans and kept in rials; a percentage as it is.
                value={manualCalcType === 'FIXED_AMOUNT' ? toToman(manualValue) : manualValue}
                onChange={(e) => {
                  setManualValue(manualCalcType === 'FIXED_AMOUNT' ? fromToman(e.target.value) : e.target.value);
                  setError(null);
                }}
                fullWidth
              />
            </Stack>

            {/* Quick Preset Chips */}
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, display: 'block', fontWeight: 600 }}>
                {t('pos.discount.presets')}
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
                {manualCalcType === 'PERCENTAGE'
                  ? ['5', '10', '15', '20', '25', '30'].map((pct) => (
                      <Chip
                        key={pct}
                        label={`${pct}%`}
                        size="small"
                        variant={manualValue === pct ? 'filled' : 'outlined'}
                        color={Number(pct) > Number(discountLimits.own.pct) ? 'warning' : 'primary'}
                        onClick={() => {
                          handleSelectPreset(pct);
                          setError(null);
                        }}
                        sx={{ fontWeight: 600, cursor: 'pointer' }}
                      />
                    ))
                  : ['200000', '500000', '1000000', '2000000', '3000000'].map((amt) => (
                      <Chip
                        key={amt}
                        label={`${MoneyUtil.formatCurrency(amt)}`}
                        size="small"
                        variant={manualValue === amt ? 'filled' : 'outlined'}
                        color={Number(amt) > Number(discountLimits.own.maxFixed) ? 'warning' : 'primary'}
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
                    color: overOwnLimit
                        ? 'warning.main'
                        : 'success.main',
                  }}
                >
                  {overOwnLimit
                    ? t('pos.discount.needsPin')
                    : t('pos.discount.withinLimit')}
                </Typography>
              )}
            </Box>

            {/* Reason Selector */}
            <FormControl fullWidth size="small">
              <InputLabel>{t('pos.discount.reason.label')}</InputLabel>
              <Select
                value={manualReasonCode}
                label={t('pos.discount.reason.label')}
                onChange={(e) => setManualReasonCode(e.target.value)}
              >
                {DISCOUNT_REASONS.map((code) => (
                  <MenuItem key={code} value={code}>
                    {t(`pos.discount.reason.${code}`)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2.5, pt: 1 }}>
          {appliedManualDiscount && (
            <Button color="error" onClick={handleClearManualDiscount} sx={{ mr: 'auto' }}>
              {t('pos.discount.remove')}
            </Button>
          )}
          <Button onClick={() => setManualDiscountModalOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            color={overOwnLimit ? 'warning' : 'primary'}
            startIcon={overOwnLimit ? <LockOpenIcon /> : undefined}
            onClick={handleApplyManualDiscount}
            disabled={!manualValue || Number(manualValue) <= 0}
            sx={{ fontWeight: 'bold' }}
          >
            {overOwnLimit ? t('pos.discount.applyWithPin') : t('pos.discount.apply')}
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
              {t('pos.heldDrawer.title')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('pos.heldDrawer.subtitle')}
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
                      <Chip label={HELD_TYPE_KEYS[ho.order_type] ? t(HELD_TYPE_KEYS[ho.order_type]) : ho.order_type} size="small" variant="outlined" sx={{ fontWeight: 600, height: 20, fontSize: '0.7rem' }} />
                    </Stack>
                  </Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                    {MoneyUtil.formatCurrency(
                      heldTotals[ho.id] ||
                      (MoneyUtil.greaterThan(ho.total_amount || ho.grand_total || '0', '0')
                        ? (ho.total_amount || ho.grand_total || '0')
                        : (ho.items || []).reduce(
                            (sum, item) => MoneyUtil.add(
                              sum,
                              item.line_total || item.subtotal || MoneyUtil.multiply(item.unit_price || '0', item.quantity || '0'),
                            ),
                            '0',
                          ))
                    )} {currency}
                  </Typography>
                </Stack>

                <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
                  <AccessTimeIcon sx={{ fontSize: 14 }} />
                  {fTime(ho.placed_at || (ho as any).created_at)}
                  {ho.items?.length ? ` • ${t('pos.itemsCount', { count: ho.items.length })}` : ''}
                </Typography>

                <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', mt: 1 }}>
                  <Button
                    size="small"
                    color="error"
                    variant="text"
                    startIcon={<DeleteIcon fontSize="small" />}
                    onClick={() => handleDiscardHeldOrder(ho)}
                    sx={{ textTransform: 'none' }}
                  >
                    {t('pos.held.discard')}
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    disabled={Boolean(resumingOrderId)}
                    startIcon={resumingOrderId === ho.id ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon fontSize="small" />}
                    onClick={() => handleResumeOrder(ho)}
                    sx={{ textTransform: 'none', fontWeight: 'bold' }}
                  >
                    {resumingOrderId === ho.id ? t('pos.held.resuming') : t('pos.held.resume')}
                  </Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
      </Drawer>

      {/* Discard Held Order: reason code */}
      <Dialog open={Boolean(discardTarget)} onClose={() => setDiscardTarget(null)}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {t('orders.cancelDialog.title', { orderNumber: discardTarget?.order_number })}
        </DialogTitle>
        <DialogContent sx={{ minWidth: 360, pt: 2 }}>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>{t('orders.cancelDialog.reasonLabel')}</InputLabel>
            <Select
              label={t('orders.cancelDialog.reasonLabel')}
              value={discardReasonCodeId}
              onChange={(e) => setDiscardReasonCodeId(e.target.value)}
            >
              {discardReasonCodes.map((r) => (
                <MenuItem key={r.id} value={r.id}>
                  {r.name} ({r.code})
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDiscardTarget(null)}>{t('orders.cancelDialog.keepOrder')}</Button>
          <Button color="error" variant="contained" onClick={handleConfirmDiscard} sx={{ fontWeight: 'bold' }}>
            {t('orders.cancelDialog.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Size & add-on dialog: choice buttons, required groups first, the price on the button. */}
      <Dialog open={optionDialogOpen} onClose={closeOptionDialog} maxWidth="sm" fullWidth aria-keyshortcuts="Escape">
        <DialogTitle sx={{ fontWeight: 'bold' }}>{t('pos.options.title', { name: selectedProduct?.name })}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {productVariants.length > 0 && (
            <Box sx={{ mb: 2.5 }}>
              <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                  {t('pos.options.variant')}
                </Typography>
              </Stack>
              <Grid container spacing={1}>
                {productVariants.map((v) => {
                  const on = selectedVariantId === v.id;
                  return (
                    <Grid key={v.id} size={{ xs: 6, sm: 4 }}>
                      <ButtonBase
                        onClick={() => setSelectedVariantId(v.id)}
                        aria-pressed={on}
                        sx={{
                          width: '100%',
                          minHeight: 56,
                          p: 1.25,
                          borderRadius: 1.5,
                          border: 2,
                          borderColor: on ? 'primary.main' : 'divider',
                          bgcolor: on ? 'action.selected' : 'background.paper',
                          flexDirection: 'column',
                          alignItems: 'stretch',
                          textAlign: 'start',
                        }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                          {v.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {MoneyUtil.formatCurrency(selectedProduct ? priceOf(selectedProduct, v) : v.base_price)} {currency}
                        </Typography>
                      </ButtonBase>
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          )}

          {optionGroups.length > 0 && (
            <Stack spacing={2.5}>
              {optionGroups.map((g) => {
                const picked = (g.items || []).filter((i) => checkedOptionIds.includes(i.id)).length;
                const missing = picked < addonMin(g);
                return (
                  <Box key={g.id}>
                    <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                        {g.name}
                      </Typography>
                      <Chip
                        size="small"
                        color={addonMin(g) > 0 ? (missing ? 'warning' : 'success') : 'default'}
                        variant={addonMin(g) > 0 ? 'filled' : 'outlined'}
                        label={addonRuleLabel(t, g)}
                      />
                    </Stack>
                    <Grid container spacing={1}>
                      {(g.items || []).map((item) => {
                        const on = checkedOptionIds.includes(item.id);
                        const priced = MoneyUtil.greaterThan(item.price_delta || '0', '0');
                        return (
                          <Grid key={item.id} size={{ xs: 6, sm: 4 }}>
                            <ButtonBase
                              onClick={() => toggleOption(g, item.id)}
                              role={isPickOne(g) ? 'radio' : 'checkbox'}
                              aria-checked={on}
                              sx={{
                                width: '100%',
                                minHeight: 52,
                                p: 1.25,
                                borderRadius: 1.5,
                                border: 2,
                                borderColor: on ? 'primary.main' : missing ? 'warning.light' : 'divider',
                                bgcolor: on ? 'action.selected' : 'background.paper',
                                justifyContent: 'space-between',
                                gap: 1,
                                textAlign: 'start',
                              }}
                            >
                              <Box sx={{ minWidth: 0 }}>
                                <Typography variant="body2" sx={{ fontWeight: on ? 'bold' : 500 }}>
                                  {item.name}
                                </Typography>
                                {/* A free choice ("no onions") shows no price; "+0" read as a charge. */}
                                {priced && (
                                  <Typography variant="caption" color="text.secondary">
                                    +{MoneyUtil.formatCurrency(item.price_delta)} {currency}
                                  </Typography>
                                )}
                              </Box>
                              {on && <CheckIcon fontSize="small" color="primary" />}
                            </ButtonBase>
                          </Grid>
                        );
                      })}
                    </Grid>
                  </Box>
                );
              })}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          {unfilledSlot && (
            <Typography variant="caption" color="warning.main" sx={{ mr: 'auto' }}>
              {t('pos.comboChooseSlot', { slot: unfilledSlot.name })}
            </Typography>
          )}
          <Button onClick={closeOptionDialog}>{t('pos.options.cancel')}</Button>
          <Button variant="contained" onClick={handleConfirmAddWithOptions} disabled={!!unfilledSlot} sx={{ fontWeight: 'bold', px: 3 }}>
            {t(editingLine !== null ? 'pos.options.updateLine' : 'pos.options.addWithPrice', {
              price: `${MoneyUtil.formatCurrency(dialogUnitPrice)} ${currency}`,
            })}
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

      {/* Register a customer: name, mobile, optional details and addresses with a map pin */}
      <CustomerRegisterDialog
        open={quickAddCustomerOpen}
        onClose={() => setQuickAddCustomerOpen(false)}
        onCreated={handleCustomerRegistered}
        createCustomer={customerApi.createCustomer}
        startWithAddress={orderType === 'DELIVERY'}
        initialMobile={registerPrefill.mobile}
        initialName={registerPrefill.name}
      />

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
          {t('pos.notes.title')}
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t('pos.notes.help')}
          </Typography>
          <TextField
            multiline
            rows={3}
            fullWidth
            size="small"
            autoFocus
            label={t('pos.notes.label')}
            placeholder={t('pos.notes.placeholder')}
            value={tempNotesInput}
            onChange={(e) => setTempNotesInput(e.target.value)}
            sx={{ mb: 2 }}
          />

          {noteTemplates.length > 0 && (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.75, display: 'block', fontWeight: 600 }}>
                {t('pos.quickTags', 'Quick Tags')}:
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', gap: 0.75 }}>
                {noteTemplates.map((template) => (
                  <Chip
                    key={template.id}
                    label={template.text}
                    size="small"
                    variant={tempNotesInput.includes(template.text) ? 'filled' : 'outlined'}
                    color="primary"
                    onClick={() => {
                      setTempNotesInput((prev) =>
                        prev
                          ? prev.includes(template.text)
                            ? prev
                            : `${prev}, ${template.text}`
                          : template.text
                      );
                    }}
                    sx={{ fontWeight: 600, cursor: 'pointer' }}
                  />
                ))}
              </Stack>
            </>
          )}
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
              {t('pos.notes.clear')}
            </Button>
          )}
          <Button onClick={() => setNotesModalOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => {
              setOrderNotes(tempNotesInput.trim());
              setNotesModalOpen(false);
            }}
            sx={{ fontWeight: 'bold' }}
          >
            {t('pos.notes.save')}
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
        // A paid order leaves the register at once (after the change is handed back): the receipt
        // has printed, and the next customer is waiting.
        onPaymentComplete={() => {
          setCheckoutModalOpen(false);
          setPlacedOrder(null);
          toast.success(t('pos.orderSettled'));
        }}
      />
    </Box>
  );
}
