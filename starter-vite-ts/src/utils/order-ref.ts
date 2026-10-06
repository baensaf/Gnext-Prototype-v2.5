import { useAuthStore } from 'src/store/useAuthStore';
import { isManagerOrAbove } from 'src/config/role-access';

/**
 * Whether this person sees an order's code (ORD-…) beside its call number. A cashier works
 * with the call number the guest hears; managers and head office look orders up by code.
 */
export function useShowsOrderCode(): boolean {
  const role = useAuthStore((state) => state.user?.role);
  const isHeadOffice = useAuthStore((state) => state.user?.isHeadOffice);
  return isManagerOrAbove(role) || isHeadOffice === true;
}

/** How an order is named on screen: its call number, or its code when it has none or the reader wants it. */
export const orderRefOf = (
  order: { call_number?: number | string | null; order_number?: string | null } | null | undefined,
  showCode: boolean
): string => {
  if (!order) return '';
  if (!showCode && order.call_number != null && order.call_number !== '') return String(order.call_number);
  return order.order_number || '';
};
