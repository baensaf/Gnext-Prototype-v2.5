import type { OrderHeader, IncomingOrderPolicy } from './orderApi';

import { httpClient } from './httpClient';

// ----------------------------------------------------------------------

// The till's Online panel: orders from delivery platforms (Snappfood now, Talabat next), in
// the same words for every platform. The server works out each order's lane and what its
// platform allows, so the panel never asks which platform an order came from.

export type OnlinePlatform = 'SNAPPFOOD';
export type OnlineLane = 'NEW' | 'ACCEPTED' | 'ISSUE';
export type OnlineIssue = 'PLATFORM_CANCELLED' | 'TIMED_OUT' | 'WITH_SUPPORT';
/** Who carries the food: the platform's rider, one of our couriers, or the customer. */
export type Fulfilment = 'PLATFORM_RIDER' | 'OWN_COURIER' | 'PICKUP';
export type OnlineRejectReason = 'TOO_BUSY' | 'ITEM_UNAVAILABLE' | 'NO_COURIER' | 'DELIVERY_FEE' | 'CLOSED' | 'OTHER';
export type OnlineReportReason = 'MORE_TIME' | 'ITEM_UNAVAILABLE' | 'NO_COURIER' | 'DELIVERY_FEE';

export interface OnlineCard {
  id: string;
  orderNumber: string;
  displayCode: string;
  callNumber: number | null;
  platform: OnlinePlatform;
  lane: OnlineLane;
  issue: OnlineIssue | null;
  issueText: string | null;
  state: string;
  fulfilment: Fulfilment;
  /** Owed at handover; '0.0000' when the platform collected it. */
  collectAmount: string;
  total: string;
  currency: string;
  items: { name: string; quantity: number }[];
  customerName: string | null;
  customerPhone: string | null;
  address: string | null;
  note: string | null;
  placedAt: string;
  /** When the branch's time limit answers it for the store (New lane only). */
  answerBy: string | null;
  acceptedAt: string | null;
  promisedAt: string | null;
  late: boolean;
  riderName: string | null;
  riderStatus: string | null;
  deliveryState: string | null;
  maxPromiseMinutes: number;
  rejectReasons: OnlineRejectReason[];
  /** Empty when the order cannot be reported now. */
  reportReasons: OnlineReportReason[];
  reportUntil: string | null;
}

export interface ChannelCapabilities {
  report: boolean;
  reportWindowMinutes: number | null;
  adjustTime: boolean;
  notifiesHandover: boolean;
  riderStatus: boolean;
  pause: boolean;
}

export interface OnlinePlatformStatus {
  platform: OnlinePlatform;
  capabilities: ChannelCapabilities;
  pausedUntil: string | null;
}

export interface OnlineBoard {
  cards: OnlineCard[];
  policy: IncomingOrderPolicy;
  shiftOpen: boolean;
  doneToday: number;
  platforms: OnlinePlatformStatus[];
}

export const onlineOrdersApi = {
  board: async (branchId: string): Promise<OnlineBoard> => {
    const res = await httpClient.get('/api/v1/orders/online-board', { params: { branchId } });
    return res.data;
  },

  /** Accept with the minutes promised; the kitchen gets it and the platform is told. */
  accept: async (id: string, prepMinutes: number): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/accept`, { prepMinutes });
    return res.data;
  },

  reject: async (id: string, reason: OnlineRejectReason, comment?: string): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/reject`, { reason, comment: comment || undefined });
    return res.data;
  },

  /** A cashier opened a waiting order; the platform likes to hear it (Snappfood: pick). */
  opened: async (id: string): Promise<void> => {
    await httpClient.post(`/api/v1/orders/${id}/online/opened`);
  },

  handedOver: async (id: string): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/online/handed-over`);
    return res.data;
  },

  report: async (
    id: string,
    report: { reason: OnlineReportReason; extraMinutes?: number; comment?: string }
  ): Promise<OrderHeader> => {
    const res = await httpClient.post(`/api/v1/orders/${id}/online/report`, {
      ...report,
      comment: report.comment || undefined,
    });
    return res.data;
  },

  alertSeen: async (id: string): Promise<void> => {
    await httpClient.post(`/api/v1/orders/${id}/online/alert-seen`);
  },

  /** minutes > 0 pauses for that long, TODAY until the day ends, 0 takes orders again. */
  pause: async (branchId: string, platform: OnlinePlatform, minutes: number | 'TODAY'): Promise<OnlinePlatformStatus[]> => {
    const res = await httpClient.post('/api/v1/orders/online-pause', { branchId, platform, minutes });
    return res.data;
  },
};
