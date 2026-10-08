import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { CashierShift } from '../../entities/CashierShift.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { loadBusinessClock } from '../../common/utils/business-clock';
import { pickSettingRow } from '../../common/utils/setting-scope.util';
import { MoneyUtil } from '../../common/utils/money.util';
import { IncomingOrderPolicy } from '../../common/utils/incoming-order-policy.util';
import { OrderService } from './order.service';
import { IncomingOrderPolicyService } from './incoming-order-policy.service';
import {
  ChannelAdapter,
  ChannelCapabilities,
  Fulfilment,
  ONLINE_PLATFORMS,
  OnlinePlatform,
  OnlineRejectReason,
  OnlineReportReason,
  platformOf,
} from './channels';

/** Where an order sits on the till's Online panel. */
export type OnlineLane = 'NEW' | 'PREPARING' | 'READY' | 'ISSUE';

/** Why an order is in the Issues lane. */
export type OnlineIssue = 'PLATFORM_CANCELLED' | 'TIMED_OUT' | 'WITH_SUPPORT';

export type OnlineCard = {
  id: string;
  orderNumber: string;
  /** What staff read out: the platform's code. */
  displayCode: string;
  callNumber: number | null;
  platform: OnlinePlatform;
  lane: OnlineLane;
  issue: OnlineIssue | null;
  issueText: string | null;
  state: string;
  fulfilment: Fulfilment;
  /** Owed at handover (a cash order the customer pays the store for); '0.0000' when paid. */
  collectAmount: string;
  total: string;
  currency: string;
  items: { name: string; quantity: number }[];
  customerName: string | null;
  customerPhone: string | null;
  address: string | null;
  note: string | null;
  placedAt: string;
  /** When the time limit answers the order for the store; set on the New lane only. */
  answerBy: string | null;
  acceptedAt: string | null;
  promisedAt: string | null;
  late: boolean;
  riderName: string | null;
  riderStatus: string | null;
  /** Our courier's delivery, for an order the store delivers itself. */
  deliveryState: string | null;
  maxPromiseMinutes: number;
  rejectReasons: OnlineRejectReason[];
  reportReasons: OnlineReportReason[];
  /** When the platform stops taking a report; null when it cannot be reported now. */
  reportUntil: string | null;
};

export type OnlinePlatformStatus = {
  platform: OnlinePlatform;
  capabilities: ChannelCapabilities;
  /** Paused until then; null while taking orders. */
  pausedUntil: string | null;
};

export type OnlineBoard = {
  cards: OnlineCard[];
  policy: IncomingOrderPolicy;
  /** Accepting needs a shift open at the branch on today's business day. */
  shiftOpen: boolean;
  doneToday: number;
  platforms: OnlinePlatformStatus[];
};

/** Open states an accepted platform order passes through while the store still has it. */
const PREPARING_STATES = ['SUBMITTED', 'CONFIRMED', 'PREPARING'];

/** Branch setting holding each platform's pause: { SNAPPFOOD: { until: ISO } }. */
export const CHANNEL_PAUSE_KEY = 'CHANNEL_PAUSE';

/** Lines Snappfood's webhook writes into the order's notes ("Customer: ..."). */
function noteField(notes: string | null | undefined, label: string): string | null {
  const line = (notes || '').split('\n').find((l) => l.startsWith(`${label}: `));
  return line ? line.slice(label.length + 2).trim() || null : null;
}

/**
 * The till's Online panel: every order a delivery platform sent this branch that still needs
 * the store, in lanes, with what each platform lets the cashier do with it. The lanes are
 * worked out here so every screen that shows them (the POS panel, the full-page board) agrees.
 */
@Injectable()
export class OnlineOrdersService {
  constructor(
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(OrderItem) private readonly itemRepo: Repository<OrderItem>,
    @InjectRepository(TenantSetting) private readonly settingRepo: Repository<TenantSetting>,
    private readonly dataSource: DataSource,
    @Inject(forwardRef(() => OrderService)) private readonly orderService: OrderService,
    private readonly incomingPolicy: IncomingOrderPolicyService,
  ) {}

  async board(tenantId: string, branchId: string, now: Date = new Date()): Promise<OnlineBoard> {
    const clock = await loadBusinessClock(this.dataSource.manager, tenantId, branchId);
    const today = clock.today(now);
    const dayStart = clock.startOf(today);

    const [open, alerts, doneToday, policy, shiftOpen, platforms] = await Promise.all([
      this.orderRepo.find({
        where: { tenant_id: tenantId, branch_id: branchId, channel: 'AGGREGATOR', state: In(['PENDING_ACCEPTANCE', ...PREPARING_STATES, 'READY']) },
        order: { placed_at: 'ASC' },
      }),
      // An alert stays until someone marks it seen, but not past the day it was raised.
      this.orderRepo.find({
        where: {
          tenant_id: tenantId,
          branch_id: branchId,
          channel: 'AGGREGATOR',
          online_alert: Not(IsNull()),
          online_alert_seen_at: IsNull(),
          online_alert_at: MoreThanOrEqual(dayStart),
        },
        order: { online_alert_at: 'ASC' },
      }),
      this.orderRepo.count({
        where: { tenant_id: tenantId, branch_id: branchId, channel: 'AGGREGATOR', state: 'COMPLETED', business_date: today as any },
      }),
      this.incomingPolicy.policyFor(tenantId, branchId),
      this.isShiftOpen(tenantId, branchId, today),
      this.platformStatuses(tenantId, branchId, now),
    ]);

    const orders = [...alerts, ...open.filter((o) => !alerts.some((a) => a.id === o.id))];
    const items = orders.length
      ? await this.itemRepo.find({ where: { tenant_id: tenantId, order_id: In(orders.map((o) => o.id)), state: 'ACTIVE' } })
      : [];
    const deliveries: { order_id: string; state: string }[] = orders.length
      ? await this.dataSource.query(`SELECT order_id, state FROM delivery WHERE tenant_id = $1 AND order_id = ANY($2)`, [
          tenantId,
          orders.map((o) => o.id),
        ])
      : [];

    const cards: OnlineCard[] = [];
    for (const order of orders) {
      const channel = this.channelOf(order);
      if (!channel) continue;
      cards.push(
        this.card(
          order,
          channel,
          items.filter((i) => i.order_id === order.id),
          deliveries.find((d) => d.order_id === order.id)?.state ?? null,
          policy,
          now,
        ),
      );
    }

    return { cards, policy, shiftOpen, doneToday, platforms };
  }

  private card(
    order: OrderHeader,
    channel: ChannelAdapter,
    items: OrderItem[],
    deliveryState: string | null,
    policy: IncomingOrderPolicy,
    now: Date,
  ): OnlineCard {
    const promisedAt =
      order.accepted_at && order.promised_minutes
        ? new Date(new Date(order.accepted_at).getTime() + order.promised_minutes * 60000)
        : null;
    const open = order.state === 'PENDING_ACCEPTANCE' || PREPARING_STATES.includes(order.state) || order.state === 'READY';

    let issue: OnlineIssue | null = null;
    if (order.online_alert && !order.online_alert_seen_at) issue = order.online_alert as OnlineIssue;
    else if (order.aggregator_issue_at && open) issue = 'WITH_SUPPORT';

    let lane: OnlineLane;
    if (issue) lane = 'ISSUE';
    else if (order.state === 'PENDING_ACCEPTANCE') lane = 'NEW';
    else if (order.state === 'READY') lane = 'READY';
    else lane = 'PREPARING';

    const windowMinutes = channel.capabilities.reportWindowMinutes;
    const reportEnds =
      channel.capabilities.report && order.accepted_at && !order.aggregator_issue_at && open && order.state !== 'PENDING_ACCEPTANCE'
        ? windowMinutes === null
          ? null
          : new Date(new Date(order.accepted_at).getTime() + windowMinutes * 60000)
        : null;
    const canReportNow = channel.capabilities.report && !!order.accepted_at && !order.aggregator_issue_at && open && (windowMinutes === null || (reportEnds !== null && reportEnds > now));

    return {
      id: order.id,
      orderNumber: order.order_number,
      displayCode: channel.externalCode(order),
      callNumber: order.call_number ?? null,
      platform: channel.platform,
      lane,
      issue,
      issueText: issue === 'WITH_SUPPORT' ? order.aggregator_issue : null,
      state: order.state,
      fulfilment: channel.fulfilment(order),
      collectAmount: MoneyUtil.greaterThan(order.outstanding_total || '0', '0') ? MoneyUtil.format(order.outstanding_total, 4) : '0.0000',
      total: MoneyUtil.format(order.grand_total || order.total_amount || '0', 4),
      currency: order.currency_code || 'IRR',
      items: items
        .sort((a, b) => (a.line_number ?? 0) - (b.line_number ?? 0))
        .map((i) => ({ name: i.product_name, quantity: Number(i.quantity) })),
      customerName: noteField(order.notes, 'Customer'),
      customerPhone: noteField(order.notes, 'Phone'),
      address: channel.fulfilment(order) === 'OWN_COURIER' ? noteField(order.notes, 'Address') : null,
      note: noteField(order.notes, 'Note'),
      placedAt: new Date(order.placed_at).toISOString(),
      answerBy:
        order.state === 'PENDING_ACCEPTANCE'
          ? new Date(new Date(order.placed_at).getTime() + policy.timeoutMinutes * 60000).toISOString()
          : null,
      acceptedAt: order.accepted_at ? new Date(order.accepted_at).toISOString() : null,
      promisedAt: promisedAt ? promisedAt.toISOString() : null,
      late: !!promisedAt && open && order.state !== 'PENDING_ACCEPTANCE' && promisedAt < now,
      riderName: order.aggregator_rider_name ?? null,
      riderStatus: order.aggregator_rider_status ?? null,
      deliveryState,
      maxPromiseMinutes: channel.maxPromiseMinutes(order),
      rejectReasons: channel.rejectReasons(),
      reportReasons: canReportNow ? channel.reportReasons() : [],
      reportUntil: canReportNow && reportEnds ? reportEnds.toISOString() : null,
    };
  }

  private channelOf(order: OrderHeader): ChannelAdapter | null {
    return this.orderService.channelOf(order);
  }

  private async isShiftOpen(tenantId: string, branchId: string, today: string): Promise<boolean> {
    const open = await this.dataSource.manager.find(CashierShift, {
      where: [
        { tenant_id: tenantId, branch_id: branchId, state: 'OPEN' },
        { tenant_id: tenantId, branch_id: branchId, state: 'CLOSING_REVIEW' },
      ],
    });
    return open.some((shift) => !shift.business_date || String(shift.business_date).slice(0, 10) >= today);
  }

  private async pauseRow(tenantId: string, branchId: string): Promise<TenantSetting | null> {
    const rows = await this.settingRepo.find({ where: { tenant_id: tenantId, key: CHANNEL_PAUSE_KEY } });
    return rows.find((r) => r.branch_id === branchId) ?? null;
  }

  private async platformStatuses(tenantId: string, branchId: string, now: Date): Promise<OnlinePlatformStatus[]> {
    const rows = await this.settingRepo.find({ where: { tenant_id: tenantId, key: CHANNEL_PAUSE_KEY } });
    const value = pickSettingRow(rows, branchId)?.value || {};
    return ONLINE_PLATFORMS.map((platform) => {
      const until = value[platform]?.until ? new Date(value[platform].until) : null;
      return {
        platform,
        capabilities: this.orderService.platformChannel(platform).capabilities,
        pausedUntil: until && until > now ? until.toISOString() : null,
      };
    });
  }

  /** The order the call is about, which must be a platform order at this branch. */
  private async platformOrder(tenantId: string, id: string): Promise<{ order: OrderHeader; channel: ChannelAdapter }> {
    const order = await this.orderRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    const channel = this.channelOf(order);
    if (!channel) {
      throw new BadRequestException({ code: 'NOT_A_PLATFORM_ORDER', message: `Order ${order.order_number} did not come from a delivery platform` });
    }
    return { order, channel };
  }

  /** A cashier opened a waiting order. Snappfood asks to hear it (pick); nothing else changes. */
  async opened(tenantId: string, id: string) {
    const { order, channel } = await this.platformOrder(tenantId, id);
    if (order.state !== 'PENDING_ACCEPTANCE') return { ok: true };
    try {
      await channel.opened(tenantId, order);
    } catch {
      // Only a courtesy to the platform; the order is answered either way.
    }
    return { ok: true };
  }

  /** The cashier has seen an alert (a platform cancel, a lost order); it leaves the panel. */
  async seeAlert(tenantId: string, id: string) {
    const { order } = await this.platformOrder(tenantId, id);
    if (!order.online_alert) return order;
    order.online_alert_seen_at = new Date();
    return this.orderRepo.save(order);
  }

  /**
   * Stops (minutes > 0, or until the end of the business day) or restarts (minutes 0) one
   * platform's orders at the branch. The adapter tells the platform; the pause is kept per
   * branch so the panel shows it and it lifts by itself.
   */
  async pause(tenantId: string, branchId: string, platform: OnlinePlatform, minutes: number | 'TODAY', userId?: string) {
    if (!ONLINE_PLATFORMS.includes(platform)) {
      throw new BadRequestException({ code: 'UNKNOWN_PLATFORM', message: `No platform ${platform}` });
    }
    const channel = this.orderService.platformChannel(platform);
    if (!channel.capabilities.pause) {
      throw new ConflictException({ code: 'PAUSE_NOT_SUPPORTED', message: `${platform} cannot be paused from the till` });
    }
    let until: Date | null = null;
    if (minutes === 'TODAY') {
      const clock = await loadBusinessClock(this.dataSource.manager, tenantId, branchId);
      until = clock.endOf(clock.today());
    } else if (minutes > 0) {
      until = new Date(Date.now() + minutes * 60000);
    }

    await channel.pause(tenantId, branchId, until);

    const row = (await this.pauseRow(tenantId, branchId)) ?? this.settingRepo.create({ tenant_id: tenantId, branch_id: branchId, key: CHANNEL_PAUSE_KEY, value: {}, created_by: userId });
    row.value = { ...(row.value || {}), [platform]: until ? { until: until.toISOString(), by: userId ?? null } : null };
    row.updated_by = userId as string;
    await this.settingRepo.save(row);
    return this.platformStatuses(tenantId, branchId, new Date());
  }
}
