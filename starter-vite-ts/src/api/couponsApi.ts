import { httpClient } from './httpClient';

/** What a code gives: a percent off the order, or one of a product free. */
export type CouponReward = 'PERCENT' | 'FREE_ITEM';

/** Why a code does not work on an order (the till says it in words). */
export type CouponRefusal = 'UNKNOWN' | 'USED' | 'OFF' | 'NOT_YET' | 'EXPIRED' | 'BELOW_MINIMUM' | 'ITEM_MISSING';

/** A batch of one-time codes made for one campaign (V2). Amounts are rials. */
export interface CouponBatch {
  id: string;
  name: string;
  reward_type: CouponReward;
  percent: string | null;
  max_discount: string | null;
  reward_product_id: string | null;
  min_subtotal: string | null;
  /** First and last business day, YYYY-MM-DD; open-ended when null. */
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  code_count: number;
  used_count: number;
  created_at: string;
}

export interface CouponCode {
  code: string;
  used_at: string | null;
  used_order_number: string | null;
  used_branch_name: string | null;
}

export type CouponBatchInput = {
  name: string;
  reward_type: CouponReward;
  percent?: string | null;
  max_discount?: string | null;
  reward_product_id?: string | null;
  min_subtotal?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  count: number;
};

export const couponsApi = {
  getBatches: async (): Promise<CouponBatch[]> => (await httpClient.get('/api/v1/coupon-batches')).data,
  createBatch: async (data: CouponBatchInput): Promise<CouponBatch> => (await httpClient.post('/api/v1/coupon-batches', data)).data,
  getCodes: async (batchId: string): Promise<{ batch: CouponBatch; codes: CouponCode[] }> =>
    (await httpClient.get(`/api/v1/coupon-batches/${batchId}/codes`)).data,
  setActive: async (batchId: string, isActive: boolean): Promise<CouponBatch> =>
    (await httpClient.patch(`/api/v1/coupon-batches/${batchId}`, { is_active: isActive })).data,
};
