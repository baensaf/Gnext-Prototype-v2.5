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
  /** CUSTOMER: the customer's group discount and what is left of it this month, or why it was not given. */
  personal?: {
    discountId: string;
    name: string;
    refusal?: GroupDiscountRefusal;
    /** How much of this order it covers; `partial` when a cap stopped it short of the order. */
    covered?: string;
    partial?: boolean;
    /** Left after this order; null where the discount has no limit. */
    usesLeft: number | null;
    monthLeft: string | null;
  };
}

/** Why the till did not fill a group discount in: not their branch, or the month is spent. */
export type GroupDiscountRefusal = 'OTHER_BRANCH' | 'USES_SPENT' | 'MONTH_SPENT';

/** A group of customers head office keeps (staff, owners, regulars); a customer can be in several. */
export interface CustomerGroup {
  id?: string;
  name: string;
  /** Branch managers may add and remove their own branch's people. */
  branch_can_assign: boolean;
  /** MANUAL today; automatic groups come later. */
  kind?: string;
  members?: number;
}

/** A percent off for the customers in the groups it picks, with optional monthly limits. */
export interface GroupDiscount {
  id?: string;
  name: string;
  percent: string;
  group_ids: string[];
  /** Only at the branch the person belongs to in the group. */
  own_branch_only: boolean;
  /** How much of their orders it covers in a calendar month; null is no limit. Rial. */
  monthly_cap: string | null;
  /** Orders a month that may carry it; null is no limit. */
  uses_per_month: number | null;
  /** How much of one order it covers; the rest is full price. Null is no limit. Rial. */
  per_visit_cap: string | null;
}

/** One customer's groups and the group discounts they get, with this month's use. */
export interface CustomerGroupSummary {
  memberships: { group_id: string; name: string; branch_can_assign: boolean; branch_id: string | null; note: string | null }[];
  discounts: (GroupDiscount & {
    id: string;
    usage: { uses: number; covered: string; monthStart: string };
    usesLeft: number | null;
    monthLeft: string | null;
    /** The branches the customer belongs to in the groups this discount covers. */
    branches: (string | null)[];
  })[];
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
  getCustomerGroups: async (): Promise<CustomerGroup[]> => {
    const res = await httpClient.get('/api/v1/customer-groups');
    return res.data;
  },
  /** Head office saves the whole list, in order; a group left out is removed with its members. */
  saveCustomerGroups: async (groups: CustomerGroup[]): Promise<CustomerGroup[]> => {
    const res = await httpClient.put('/api/v1/customer-groups', { groups });
    return res.data;
  },
  getGroupDiscounts: async (): Promise<GroupDiscount[]> => {
    const res = await httpClient.get('/api/v1/group-discounts');
    return res.data;
  },
  /** Head office saves the whole list, in order; one left out is removed. */
  saveGroupDiscounts: async (discounts: GroupDiscount[]): Promise<GroupDiscount[]> => {
    const res = await httpClient.put('/api/v1/group-discounts', { discounts });
    return res.data;
  },
  getCustomerGroupSummary: async (customerId: string): Promise<CustomerGroupSummary> => {
    const res = await httpClient.get(`/api/v1/customer-groups/of/${customerId}`);
    return res.data;
  },
  /** Adds customers to a group; a branch account's always go in at its own branch. */
  addGroupMembers: async (groupId: string, data: { customer_ids: string[]; branch_id?: string | null; note?: string | null }) => {
    const res = await httpClient.post(`/api/v1/customer-groups/${groupId}/members`, data);
    return res.data as { added: number; already: number };
  },
  removeGroupMember: async (groupId: string, customerId: string) => {
    const res = await httpClient.delete(`/api/v1/customer-groups/${groupId}/members/${customerId}`);
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
