import type { CartItem, CarriedCart } from 'src/pages/pos/order';

import i18n from 'src/locales/i18n';

import { toast } from 'src/components/snackbar';

import { tillApi } from './agent-client';

// ----------------------------------------------------------------------

/**
 * The cart the register had when the till switched, made ready for the other side
 * (agent-protocol.md §16.6). Toward the agent, what does not exist offline comes off the cart
 * and each line is checked there: a line the agent refuses stays, marked, for the cashier to
 * take off. Toward the cloud the cart goes as it is; the cloud checks it when it is placed.
 */
export async function carryTo(kind: 'agent' | 'till', from: CarriedCart | null): Promise<CarriedCart | null> {
  if (!from || from.cart.length === 0) return null;
  const cart = from.cart.map<CartItem>((ci) => ({ ...ci, refused: undefined }));

  if (kind === 'till') {
    toast.info(i18n.t('pos.carry.toCloud'));
    return { ...from, cart };
  }

  let { orderType } = from;
  if (orderType === 'DELIVERY') {
    orderType = 'TAKEAWAY';
    toast.warning(i18n.t('pos.carry.deliveryToTakeaway'));
  }
  // The agent names the first line it refuses; ask again without it until it takes the rest.
  for (let tries = 0; tries < cart.length; tries += 1) {
    const open = cart.map((ci, index) => ({ ci, index })).filter(({ ci }) => !ci.refused);
    if (open.length === 0) break;
    try {
      await tillApi.price(
        open.map(({ ci }) => ({
          product_id: ci.product.id,
          variant_id: ci.selectedVariant?.id || '',
          quantity: ci.quantity,
          options: ci.selectedOptions.map((o) => o.id),
          notes: '',
        }))
      );
      break;
    } catch (err: any) {
      const refused = typeof err?.line === 'number' ? open[err.line] : undefined;
      if (err?.code !== 'NOT_AVAILABLE' || !refused) break;
      cart[refused.index] = { ...refused.ci, refused: err.detail || i18n.t('pos.offline.unavailable') };
    }
  }
  toast.info(i18n.t('pos.carry.toAgent'));
  return { ...from, cart, orderType, uncertainDraftId: from.uncertainDraftId };
}
