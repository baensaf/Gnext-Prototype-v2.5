import { OrderHeader } from '../../../entities/OrderHeader.entity';
import { ChannelAdapter, OnlinePlatform } from './channel-adapter';
import { SnappfoodAdapter, SnappfoodAdapterDeps } from './snappfood.adapter';

export * from './channel-adapter';

export type ChannelDeps = SnappfoodAdapterDeps;

/** Which platform an order came from; null for one rung up in the store, kiosk or website. */
export function platformOf(order: Pick<OrderHeader, 'channel' | 'order_number'>): OnlinePlatform | null {
  if (order.channel !== 'AGGREGATOR') return null;
  // Snappfood is the only platform so far; its orders are numbered SNP-<its code>.
  return order.order_number?.startsWith('SNP-') ? 'SNAPPFOOD' : null;
}

/** Every platform the store can be connected to, for screens that list them all. */
export const ONLINE_PLATFORMS: OnlinePlatform[] = ['SNAPPFOOD'];

export function channelForPlatform(platform: OnlinePlatform, deps: ChannelDeps): ChannelAdapter {
  switch (platform) {
    case 'SNAPPFOOD':
      return new SnappfoodAdapter(deps);
  }
}

/** The adapter that speaks for this order's platform, or null when no platform sent it. */
export function channelFor(order: OrderHeader, deps: ChannelDeps): ChannelAdapter | null {
  const platform = platformOf(order);
  return platform ? channelForPlatform(platform, deps) : null;
}
