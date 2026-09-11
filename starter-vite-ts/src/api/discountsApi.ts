import { httpClient } from './httpClient';

/** A one-time coupon. It carries its own terms; there are no campaigns behind it. */
export interface Coupon {
  id: string;
  code: string;
  percentage: string;
  minimum_subtotal?: string | null;
  maximum_discount_amount?: string | null;
  max_uses?: number;
  uses_count?: number;
  effective_from?: string;
  effective_to?: string;
  is_active: boolean;
}

export interface ManualDiscount {
  calculation_type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: string;
  reasonCode?: string;
  approvalRequestId?: string;
}

export interface ConsideredDiscount {
  /** Who granted it: the cashier, a coupon code, or the customer's own rate. */
  source: 'MANUAL' | 'COUPON' | 'CUSTOMER';
  name: string;
  couponId?: string;
  couponCode?: string;
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

export interface CouponValidationResult {
  isValid: boolean;
  coupon: { id?: string; code: string };
  discount: {
    name: string;
    calculation_type: string;
    value: string;
  };
  calculatedAmount: string;
}

export const discountsApi = {
  getCoupons: async (): Promise<Coupon[]> => {
    const res = await httpClient.get('/api/v1/coupons');
    return res.data;
  },
  validateCoupon: async (couponCode: string, orderTotal: string): Promise<CouponValidationResult> => {
    const res = await httpClient.post('/api/v1/coupons/validate', { couponCode, orderTotal });
    return res.data;
  },

  quoteDiscounts: async (data: {
    orderDraft: any;
    manualDiscount?: ManualDiscount;
    couponCode?: string;
  }): Promise<DiscountQuoteResult> => {
    const res = await httpClient.post('/api/v1/discount-quotes', data);
    return res.data;
  },
};
