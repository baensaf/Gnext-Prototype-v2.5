import { OrderHeader } from '../../../entities/OrderHeader.entity';
import type { SimulationService } from '../../simulation/simulation.service';
import type { SnappfoodLiveService } from '../../snappfood/snappfood-live.service';
import type { SnappfoodConnection } from '../../../entities/SnappfoodConnection.entity';
import {
  SNAPPFOOD_DELAY_REASON_ID,
  SNAPPFOOD_REPORT_WINDOW_MINUTES,
  acceptNotice,
  maxPromiseMinutes,
} from '../../../common/utils/snappfood-order.util';
import {
  ChannelAdapter,
  ChannelCapabilities,
  Fulfilment,
  OnlineRejectReason,
  OnlineReportReason,
  ReportNotice,
} from './channel-adapter';

/** Snappfood's decline reasons (annex 4.3.0, decline_reason) for the store's words. */
const SNAPPFOOD_REASON_IDS: Partial<Record<OnlineRejectReason | OnlineReportReason, number>> = {
  TOO_BUSY: SNAPPFOOD_DELAY_REASON_ID,
  MORE_TIME: SNAPPFOOD_DELAY_REASON_ID,
  NO_COURIER: 113,
  DELIVERY_FEE: 154,
  // 139 carries nonExistentProducts, and Snappfood switches those items off for the vendor.
  ITEM_UNAVAILABLE: 139,
};

export type SnappfoodAdapterDeps = {
  simulation?: SimulationService;
  /** The real Snappfood, for a branch connected to it; every other branch uses the simulator. */
  live?: SnappfoodLiveService;
  /** The branch's menus (categories) on Snappfood, which a pause switches off and back on. */
  menuIds?: (tenantId: string, branchId: string) => Promise<string[]>;
};

/**
 * Snappfood, per its technical annex 4.3.0. Snappfood owns the lines and the money. After
 * accepting, the only thing a store can send is a reject ("needs a call"), within an hour, and
 * Snappfood support then cancels the order or sends it back. It hears nothing about ready or
 * handover; its rider's progress comes in on the webhook when the vendor has it switched on.
 * A branch connected to Snappfood (staging or production) makes the order calls there; every
 * other branch talks to the simulator, which logs each call as Snappfood would receive it.
 * A pause stays with the simulator for now: it switches menus off by our ids, which only
 * mean something on Snappfood once the menu is synced there.
 */
export class SnappfoodAdapter implements ChannelAdapter {
  readonly platform = 'SNAPPFOOD' as const;

  readonly capabilities: ChannelCapabilities = {
    report: true,
    reportWindowMinutes: SNAPPFOOD_REPORT_WINDOW_MINUTES,
    adjustTime: false,
    notifiesHandover: false,
    riderStatus: true,
    // No pause call in the annex: every menu goes off with menu_toggle, and back on after.
    pause: true,
  };

  constructor(private readonly deps: SnappfoodAdapterDeps) {}

  externalCode(order: OrderHeader): string {
    return order.order_number?.startsWith('SNP-') ? order.order_number.slice('SNP-'.length) : order.order_number;
  }

  fulfilment(order: OrderHeader): Fulfilment {
    // An order from before the expedition was kept is treated as own delivery, as elsewhere.
    if (!order.aggregator_expedition || order.aggregator_expedition === 'DELIVERY') return 'OWN_COURIER';
    if (order.aggregator_expedition === 'PICKUP') return 'PICKUP';
    return 'PLATFORM_RIDER';
  }

  maxPromiseMinutes(order: OrderHeader): number {
    return maxPromiseMinutes(order);
  }

  rejectReasons(): OnlineRejectReason[] {
    return ['TOO_BUSY', 'ITEM_UNAVAILABLE', 'NO_COURIER', 'DELIVERY_FEE'];
  }

  reportReasons(): OnlineReportReason[] {
    return ['MORE_TIME', 'ITEM_UNAVAILABLE', 'NO_COURIER', 'DELIVERY_FEE'];
  }

  /** The branch's live Snappfood account, or null while it talks to the simulator. */
  private async live(tenantId: string, order: OrderHeader): Promise<SnappfoodConnection | null> {
    return (await this.deps.live?.connectionFor(tenantId, order.branch_id)) ?? null;
  }

  async received(tenantId: string, order: OrderHeader) {
    const live = await this.live(tenantId, order);
    if (live) return this.deps.live!.ack(live, this.externalCode(order));
    await this.deps.simulation?.ackOrder(tenantId, this.externalCode(order));
  }

  async opened(tenantId: string, order: OrderHeader) {
    const live = await this.live(tenantId, order);
    if (live) return this.deps.live!.pick(live, this.externalCode(order));
    await this.deps.simulation?.pickOrder(tenantId, this.externalCode(order));
  }

  async accepted(tenantId: string, order: OrderHeader, minutes: number) {
    const live = await this.live(tenantId, order);
    if (live) return this.deps.live!.accept(live, this.externalCode(order), acceptNotice(order, minutes));
    await this.deps.simulation?.notifyAccepted(tenantId, this.externalCode(order), acceptNotice(order, minutes));
  }

  async rejected(tenantId: string, order: OrderHeader, reason: OnlineRejectReason, comment?: string) {
    await this.reject(tenantId, order, { reasonId: SNAPPFOOD_REASON_IDS[reason], comment });
  }

  async rejectedUnanswered(tenantId: string, order: OrderHeader, comment: string) {
    // None of Snappfood's reasons says nobody answered; a delay in sending is the nearest.
    await this.reject(tenantId, order, { reasonId: SNAPPFOOD_DELAY_REASON_ID, comment });
  }

  private async reject(tenantId: string, order: OrderHeader, body: { reasonId?: number; comment?: string }) {
    const live = await this.live(tenantId, order);
    if (live) return this.deps.live!.reject(live, this.externalCode(order), body);
    await this.deps.simulation?.notifyRejected(tenantId, this.externalCode(order), body);
  }

  async reported(tenantId: string, order: OrderHeader, notice: ReportNotice): Promise<string> {
    const reasonId = SNAPPFOOD_REASON_IDS[notice.reason];
    const comment = [notice.extraMinutes && `Needs ${notice.extraMinutes} more minutes`, notice.comment?.trim()]
      .filter(Boolean)
      .join('. ');
    await this.reject(tenantId, order, { reasonId, comment });
    const live = await this.live(tenantId, order);
    const reasons = live
      ? await this.deps.live!.declineReasons(live).catch(() => [])
      : ((await this.deps.simulation?.getDeclineReasons()) ?? []);
    const title = reasons.find((r) => r.id === reasonId)?.title;
    return [`${reasonId}${title ? ` ${title}` : ''}`, comment].filter(Boolean).join(': ').slice(0, 255);
  }

  async handedOver() {
    // Snappfood has no call for it; its rider's PICKED comes in on the webhook instead.
  }

  async pause(tenantId: string, branchId: string, until: Date | null) {
    const ids = (await this.deps.menuIds?.(tenantId, branchId)) ?? [];
    await this.deps.simulation?.toggleMenu(tenantId, {
      branchId,
      menus: ids.map((id) => ({ id, active: until === null })),
      ...(until ? { until: until.toISOString() } : {}),
    });
  }
}
