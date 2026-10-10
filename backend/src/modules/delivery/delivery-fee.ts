import { MoneyUtil } from '../../common/utils/money.util';

/**
 * The fee a delivery is snapshotted with: the zone's listed fee, or the price the cashier typed
 * for this order when that is more (a far address). A price typed lower, or free, is the
 * branch's gift to the customer and leaves the listed fee on the delivery.
 */
export function courierDeliveryFee(zoneFee: string | null | undefined, typedFee: string | null | undefined): string {
  const listed = zoneFee || '0.0000';
  return typedFee !== null && typedFee !== undefined && MoneyUtil.greaterThan(typedFee, listed) ? typedFee : listed;
}
