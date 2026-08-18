import { httpClient } from './httpClient';

export interface DiscountScope {
  id: string;
  campaign_id: string;
  scope_type: 'BRANCH' | 'CUSTOMER' | 'CUSTOMER_TAG' | 'CUSTOMER_SEGMENT' | 'PRODUCT' | 'CATEGORY' | 'CHANNEL' | 'ORDER_TYPE';
  scope_id?: string;
  is_exclusion: boolean;
}

export interface DiscountCampaign {
  id: string;
  code: string;
  name: string;
  discount_type: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_ITEM' | 'FREE_DELIVERY';
  percentage?: string;
  amount?: string;
  currency_code?: string;
  priority: number;
  stacking_group?: string;
  is_stackable: boolean;
  coupon_required: boolean;
  usage_limit_total?: number;
  usage_limit_per_customer?: number;
  usage_count: number;
  effective_from?: string;
  effective_to?: string;
  minimum_subtotal?: string;
  maximum_discount_amount?: string;
  reward_product_id?: string;
  reward_quantity?: string;
  funding_source: string;
  is_active: boolean;
  scopes?: DiscountScope[];
}

export interface Discount {
  id: string;
  code: string;
  name: string;
  kind?: 'MANUAL' | 'AUTOMATIC_RULE' | 'COUPON';
  calculation_type?: 'PERCENTAGE' | 'FIXED_AMOUNT';
  discount_type?: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_ITEM' | 'FREE_DELIVERY';
  value?: string;
  percentage?: string;
  amount?: string;
  min_order_total?: string;
  minimum_subtotal?: string;
  max_discount_amount?: string;
  maximum_discount_amount?: string;
  requires_reason?: boolean;
  requires_manager_approval?: boolean;
  applies_to_scope?: 'ORDER' | 'ITEM';
  is_active: boolean;
  priority?: number;
  scopes?: DiscountScope[];
}

export interface Coupon {
  id: string;
  campaign_id?: string;
  discount_id?: string;
  code: string;
  max_uses?: number;
  max_redemptions?: number;
  uses_count?: number;
  current_redemptions?: number;
  effective_from?: string;
  starts_at?: string;
  effective_to?: string;
  expires_at?: string;
  is_active: boolean;
}

export interface ManualDiscount {
  calculation_type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: string;
  reasonCode?: string;
  approvalRequestId?: string;
}

export interface ConsideredDiscount {
  campaignId?: string;
  campaignCode?: string;
  campaignName: string;
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
  coupon: { id: string; code: string };
  discount: {
    id: string;
    code: string;
    name: string;
    calculation_type: string;
    value: string;
    requires_reason: boolean;
    requires_manager_approval: boolean;
  };
  calculatedAmount: string;
}

export const discountsApi = {
  getDiscounts: async (): Promise<DiscountCampaign[]> => {
    const res = await httpClient.get('/api/v1/discounts');
    return res.data;
  },
  getDiscountById: async (id: string): Promise<DiscountCampaign> => {
    const res = await httpClient.get(`/api/v1/discounts/${id}`);
    return res.data;
  },
  createDiscount: async (data: Partial<DiscountCampaign>): Promise<DiscountCampaign> => {
    const res = await httpClient.post('/api/v1/discounts', data);
    return res.data;
  },
  updateDiscount: async (id: string, data: Partial<DiscountCampaign>): Promise<DiscountCampaign> => {
    const res = await httpClient.patch(`/api/v1/discounts/${id}`, data);
    return res.data;
  },
  archiveDiscount: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/discounts/${id}`);
  },

  addScope: async (campaignId: string, data: Partial<DiscountScope>): Promise<DiscountScope> => {
    const res = await httpClient.post(`/api/v1/discounts/${campaignId}/scopes`, data);
    return res.data;
  },
  removeScope: async (campaignId: string, scopeId: string): Promise<void> => {
    await httpClient.delete(`/api/v1/discounts/${campaignId}/scopes/${scopeId}`);
  },

  getCoupons: async (): Promise<Coupon[]> => {
    const res = await httpClient.get('/api/v1/coupons');
    return res.data;
  },
  createCoupon: async (data: Partial<Coupon>): Promise<Coupon> => {
    const res = await httpClient.post('/api/v1/coupons', data);
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
