import { httpClient } from './httpClient';

export interface ManualDiscount {
  calculation_type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: string;
  reasonCode?: string;
  approvalRequestId?: string;
}

export interface ConsideredDiscount {
  /** Who granted it: an automatic item discount, the cashier, a coupon, or the person's personal discount group. */
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
  /** CUSTOMER: the person's group and what is left of it this month, or why it was not given. */
  personal?: {
    groupId: string;
    groupName: string;
    refusal?: PersonalRefusal;
    /** How much of this order it covers; `partial` when a cap stopped it short of the order. */
    covered?: string;
    partial?: boolean;
    /** Left after this order; null where the group has no limit. */
    usesLeft: number | null;
    monthLeft: string | null;
  };
}

/** Why the till did not fill a person's discount in: not their branch, or the month is spent. */
export type PersonalRefusal = 'OTHER_BRANCH' | 'USES_SPENT' | 'MONTH_SPENT';

/** A personal discount group head office sets (Iran Burger's staff scheme has nine). */
export interface PersonalDiscountGroup {
  id?: string;
  name: string;
  percent: string;
  /** How much of their orders it covers in a calendar month; null is no limit. Rial. */
  monthly_cap: string | null;
  /** Orders a month that may carry it; null is no limit. */
  uses_per_month: number | null;
  /** How much of one order it covers; the rest is full price. Null is no limit. Rial. */
  per_visit_cap: string | null;
  /** True: any branch. False: only the branch the person works at. */
  any_branch: boolean;
  /** People in the group. */
  members?: number;
}

/** A person's group, the branch they work at, and what is left this month. */
export interface PersonalDiscountSummary {
  assignment: { id: string; branch_id: string | null; group_id: string; note: string | null };
  group: PersonalDiscountGroup & { id: string };
  usage: { uses: number; covered: string; monthStart: string };
  usesLeft: number | null;
  monthLeft: string | null;
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
  getPersonalGroups: async (): Promise<PersonalDiscountGroup[]> => {
    const res = await httpClient.get('/api/v1/personal-discount-groups');
    return res.data;
  },
  /** Head office saves the whole list, in order; a group left out is removed. */
  savePersonalGroups: async (groups: PersonalDiscountGroup[]): Promise<PersonalDiscountGroup[]> => {
    const res = await httpClient.put('/api/v1/personal-discount-groups', { groups });
    return res.data;
  },
  getPersonalDiscount: async (customerId: string): Promise<PersonalDiscountSummary | null> => {
    const res = await httpClient.get('/api/v1/customer-discounts/personal', { params: { customer_id: customerId } });
    return res.data || null;
  },
  /** Puts a person in a group at the branch they work at; no group takes them out. */
  setPersonalDiscount: async (data: { customer_id: string; group_id: string | null; branch_id?: string; note?: string | null }) => {
    const res = await httpClient.put('/api/v1/customer-discounts/personal', data);
    return res.data;
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
