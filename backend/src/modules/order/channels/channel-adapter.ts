import { OrderHeader } from '../../../entities/OrderHeader.entity';

/**
 * One delivery platform behind the till's Online panel. The order service and the panel only
 * know the words in this file; each platform's adapter turns them into its own calls and says
 * which of them it can make, so the panel hides a button rather than asking which platform it is.
 * Snappfood is the first; Talabat (V6) is the next one to slot in here.
 */

export type OnlinePlatform = 'SNAPPFOOD';

/** Who carries the food: the platform's rider, one of our couriers, or the customer. */
export type Fulfilment = 'PLATFORM_RIDER' | 'OWN_COURIER' | 'PICKUP';

/**
 * Why the store turns an order down, in the store's words. Each adapter maps the ones its
 * platform has a code for and leaves the rest out.
 */
export const ONLINE_REJECT_REASONS = ['TOO_BUSY', 'ITEM_UNAVAILABLE', 'NO_COURIER', 'DELIVERY_FEE', 'CLOSED', 'OTHER'] as const;
export type OnlineRejectReason = (typeof ONLINE_REJECT_REASONS)[number];

/** What the store can tell the platform about an order it has already accepted. */
export const ONLINE_REPORT_REASONS = ['MORE_TIME', 'ITEM_UNAVAILABLE', 'NO_COURIER', 'DELIVERY_FEE'] as const;
export type OnlineReportReason = (typeof ONLINE_REPORT_REASONS)[number];

export type ChannelCapabilities = {
  /** After accepting, the store can hand the order to the platform (more time, cannot make it). */
  report: boolean;
  /** Minutes after accepting during which the platform takes a report; null for no limit. */
  reportWindowMinutes: number | null;
  /** The platform has a call to change the promised time directly. */
  adjustTime: boolean;
  /** The platform hears when the order leaves the store. */
  notifiesHandover: boolean;
  /** The platform sends its rider's name and progress. */
  riderStatus: boolean;
  /** The store can stop taking orders from the platform for a while. */
  pause: boolean;
};

export type ReportNotice = { reason: OnlineReportReason; extraMinutes?: number; comment?: string };

export interface ChannelAdapter {
  readonly platform: OnlinePlatform;
  readonly capabilities: ChannelCapabilities;
  /** The platform's code for the order, which its calls take and staff read out. */
  externalCode(order: OrderHeader): string;
  fulfilment(order: OrderHeader): Fulfilment;
  /** The most minutes the store may promise when accepting this order. */
  maxPromiseMinutes(order: OrderHeader): number;
  rejectReasons(): OnlineRejectReason[];
  reportReasons(): OnlineReportReason[];

  /** The order reached the store (Snappfood: ack). */
  received(tenantId: string, order: OrderHeader): Promise<void>;
  /** A cashier opened the order (Snappfood: pick). */
  opened(tenantId: string, order: OrderHeader): Promise<void>;
  accepted(tenantId: string, order: OrderHeader, minutes: number): Promise<void>;
  rejected(tenantId: string, order: OrderHeader, reason: OnlineRejectReason, comment?: string): Promise<void>;
  /** A reject the platform needs a code for that the store's list has no word for (the time limit). */
  rejectedUnanswered(tenantId: string, order: OrderHeader, comment: string): Promise<void>;
  /** Returns the text kept on the order while the platform deals with it. */
  reported(tenantId: string, order: OrderHeader, notice: ReportNotice): Promise<string>;
  handedOver(tenantId: string, order: OrderHeader): Promise<void>;
  /** Stop (until a time) or restart (null) taking orders for one branch. */
  pause(tenantId: string, branchId: string, until: Date | null): Promise<void>;
}

/** Thrown by an adapter when the platform refuses what the store asked; the message is for staff. */
export class ChannelRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
