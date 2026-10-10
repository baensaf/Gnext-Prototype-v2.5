import { httpClient } from './httpClient';

export interface ManualDiscount {
  calculation_type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: string;
  reasonCode?: string;
  approvalRequestId?: string;
}

export interface ConsideredDiscount {
  /** Who granted it: an automatic item discount, the cashier, or the customer's own rate. */
  source: 'ITEM' | 'MANUAL' | 'CUSTOMER';
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

/** A dated percent off one product, applied by itself on the till (V1). */
export interface ItemDiscount {
  id: string;
  product_id: string;
  product_name: string | null;
  percent: string;
  /** First and last business day, YYYY-MM-DD; no last day runs until removed. */
  starts_on: string;
  ends_on: string | null;
  note: string | null;
}

export type ItemDiscountInput = Pick<ItemDiscount, 'product_id' | 'starts_on' | 'ends_on' | 'note'> & { percent: string };

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
