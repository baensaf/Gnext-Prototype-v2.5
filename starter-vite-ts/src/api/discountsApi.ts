import { httpClient } from './httpClient';

export interface ManualDiscount {
  calculation_type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: string;
  reasonCode?: string;
  approvalRequestId?: string;
}

export interface ConsideredDiscount {
  /** Who granted it: an automatic item discount, the cashier, or the customer's friends-and-family rate. */
  source: 'ITEM' | 'MANUAL' | 'CUSTOMER' | 'COUPON';
  /** COUPON refused: why (UNKNOWN, USED, OFF, NOT_YET, EXPIRED, BELOW_MINIMUM, ITEM_MISSING). */
  couponRefusal?: string;
  productId?: string;
  percent?: string;
  name: string;
  discountType: string;
  status: 'APPLIED' | 'REJECTED';
  rejectionReason?: string;
  amount: string;
}

export interface DiscountQuoteResult {
  quoteVersion: string;
  currencyCode: string;
  items: {
    productId: string;
    variantId?: string;
    unitPrice: string;
    quantity: string;
    subtotal: string;
    discountTotal: string;
    grandTotal: string;
    /** The automatic item discount on the line, in percent ('0.00' for none). */
    itemDiscountPercent?: string;
    itemDiscountTotal?: string;
  }[];
  subtotal: string;
  deliveryFee: string;
  discountTotal: string;
  taxTotal: string;
  grandTotal: string;
  consideredDiscounts: ConsideredDiscount[];
  warnings: string[];
  approvalRequired?: boolean;
  approvalReason?: string;
}

/** What the signed-in account may discount without a pin, and the ceiling nobody passes. */
export interface ManualDiscountLimits {
  role: string;
  own: { pct: string; maxFixed: string };
  ceiling: { pct: string; maxFixed: string };
}

/** Where an item discount runs: in store (the till and the kiosk), on Snappfood, or both. */
export type ItemDiscountChannel = 'IN_STORE' | 'SNAPPFOOD' | 'BOTH';

/** A dated percent off chosen products, applied by itself at the till and the kiosk (V1). */
export interface ItemDiscount {
  id: string;
  product_ids: string[];
  product_names: Array<string | null>;
  /** Off pauses it. */
  is_active: boolean;
  percent: string;
  /** First and last business day, YYYY-MM-DD; no last day runs until removed. */
  starts_on: string;
  ends_on: string | null;
  note: string | null;
  /** Every price list (and branches with no group); otherwise only `price_group_ids`. */
  all_groups: boolean;
  price_group_ids: string[];
  applies_to: ItemDiscountChannel;
}

export type ItemDiscountInput = Pick<ItemDiscount, 'product_ids' | 'is_active' | 'starts_on' | 'ends_on' | 'note' | 'all_groups' | 'price_group_ids' | 'applies_to'> & {
  percent: string;
};

export const discountsApi = {
  getItemDiscounts: async (): Promise<ItemDiscount[]> => {
    const res = await httpClient.get('/api/v1/item-discounts');
    return res.data;
  },
  createItemDiscount: async (data: ItemDiscountInput): Promise<ItemDiscount> => {
    const res = await httpClient.post('/api/v1/item-discounts', data);
    return res.data;
  },
  updateItemDiscount: async (id: string, data: Partial<ItemDiscountInput>): Promise<ItemDiscount> => {
    const res = await httpClient.patch('/api/v1/item-discounts/' + id, data);
    return res.data;
  },
  deleteItemDiscount: async (id: string): Promise<void> => {
    await httpClient.delete('/api/v1/item-discounts/' + id);
  },
  getManualDiscountLimits: async (): Promise<ManualDiscountLimits> => {
    const res = await httpClient.get('/api/v1/discount-limits');
    return res.data;
  },
  quoteDiscounts: async (data: {
    orderDraft: any;
    manualDiscount?: ManualDiscount;
  }): Promise<DiscountQuoteResult> => {
    const res = await httpClient.post('/api/v1/discount-quotes', data);
    return res.data;
  },
};
