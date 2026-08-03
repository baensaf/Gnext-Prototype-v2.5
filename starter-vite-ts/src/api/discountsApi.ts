import { httpClient } from './httpClient';

export interface Discount {
  id: string;
  code: string;
  name: string;
  kind: 'MANUAL' | 'AUTOMATIC_RULE' | 'COUPON';
  calculation_type: 'PERCENTAGE' | 'FIXED_AMOUNT';
  value: string;
  min_order_total: string;
  max_discount_amount?: string;
  requires_reason: boolean;
  requires_manager_approval: boolean;
  applies_to_scope: 'ORDER' | 'ITEM';
  is_active: boolean;
}

export interface Coupon {
  id: string;
  discount_id: string;
  code: string;
  max_redemptions?: number;
  current_redemptions: number;
  starts_at?: string;
  expires_at?: string;
  is_active: boolean;
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
  getDiscounts: async (): Promise<Discount[]> => {
    const res = await httpClient.get('/api/v1/discounts');
    return res.data;
  },
  createDiscount: async (data: Partial<Discount>): Promise<Discount> => {
    const res = await httpClient.post('/api/v1/discounts', data);
    return res.data;
  },
  updateDiscount: async (id: string, data: Partial<Discount>): Promise<Discount> => {
    const res = await httpClient.patch(`/api/v1/discounts/${id}`, data);
    return res.data;
  },
  archiveDiscount: async (id: string): Promise<void> => {
    await httpClient.delete(`/api/v1/discounts/${id}`);
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
};
