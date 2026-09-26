import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { OperationalAlert } from '../../entities/OperationalAlert.entity';
import { pickSettingValue } from '../../common/utils/setting-scope.util';
import {
  IncomingOrderPolicy,
  acceptanceFor,
  resolveIncomingOrderPolicy,
} from '../../common/utils/incoming-order-policy.util';
import { isAggregatorOrder, maxPromiseMinutes } from '../../common/utils/snappfood-order.util';
import { OrderService } from './order.service';

/** The branch's default prep time, brought within Snappfood's limit for one of its orders. */
function prepMinutesFor(order: OrderHeader, policy: IncomingOrderPolicy): number {
  return isAggregatorOrder(order) ? Math.min(policy.defaultPrepMinutes, maxPromiseMinutes(order)) : policy.defaultPrepMinutes;
}

/** The accept was refused because no shift is open at the branch. */
function isNoOpenShift(err: unknown): boolean {
  return err instanceof ConflictException && (err.getResponse() as { code?: string })?.code === 'NO_OPEN_SHIFT';
}

/** How often the time limit is checked, so an order can overrun its limit by up to this much. */
const SWEEP_MS = 15000;

/**
 * Applies a branch's incoming-order policy: accepting on arrival for channels it lets
 * straight through, and answering orders nobody picked up in time. Accepting and rejecting
 * go through OrderService, so an automatic answer does exactly what a cashier's does.
 */
@Injectable()
export class IncomingOrderPolicyService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IncomingOrderPolicyService.name);
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(TenantSetting) private readonly settingRepo: Repository<TenantSetting>,
    @InjectRepository(OperationalAlert) private readonly alertRepo: Repository<OperationalAlert>,
    @Inject(forwardRef(() => OrderService)) private readonly orderService: OrderService,
  ) {}

  async policyFor(tenantId: string, branchId?: string | null): Promise<IncomingOrderPolicy> {
    const rows = await this.settingRepo.find({ where: { tenant_id: tenantId, key: 'ORDER_WORKFLOW' } });
    return resolveIncomingOrderPolicy(pickSettingValue(rows, branchId));
  }

  /**
   * Called as an incoming order lands. When the branch lets its channel straight through,
   * the order is accepted here and returned; otherwise it waits for staff and this is null.
   */
  async applyOnArrival(tenantId: string, orderId: string, correlationId?: string): Promise<OrderHeader | null> {
    const order = await this.orderRepo.findOne({ where: { id: orderId, tenant_id: tenantId } });
    if (!order || order.state !== 'PENDING_ACCEPTANCE') return null;

    const policy = await this.policyFor(tenantId, order.branch_id);
    if (acceptanceFor(policy, order.channel) !== 'AUTO') return null;

    try {
      return await this.orderService.acceptIncomingOrder(
        tenantId,
        orderId,
        { prepMinutes: prepMinutesFor(order, policy) },
        undefined,
        correlationId,
      );
    } catch (err) {
      // With no shift open it waits in the queue like any other, until a shift opens or the
      // time limit answers it.
      if (isNoOpenShift(err)) return null;
      throw err;
    }
  }

  /**
   * Answers every waiting order past its branch's time limit, the way the branch chose:
   * reject (the default) or accept. Each one raises a warning for that branch, so a manager
   * learns the counter missed it. Returns how many were answered.
   */
  async expireOverdue(now: Date = new Date()): Promise<number> {
    const waiting = await this.orderRepo.find({ where: { state: 'PENDING_ACCEPTANCE' } });
    const policies = new Map<string, Promise<IncomingOrderPolicy>>();
    let answered = 0;

    for (const order of waiting) {
      const key = `${order.tenant_id}:${order.branch_id}`;
      if (!policies.has(key)) policies.set(key, this.policyFor(order.tenant_id, order.branch_id));
      const policy = await policies.get(key)!;

      const deadline = new Date(order.placed_at).getTime() + policy.timeoutMinutes * 60000;
      if (now.getTime() < deadline) continue;

      let accepted = false;
      try {
        if (policy.timeoutAction === 'ACCEPT') {
          try {
            await this.orderService.acceptIncomingOrder(order.tenant_id, order.id, { prepMinutes: prepMinutesFor(order, policy) });
            accepted = true;
          } catch (err) {
            // Nobody is on shift to cook it, so it is turned down instead.
            if (!isNoOpenShift(err)) throw err;
          }
        }
        if (!accepted) {
          await this.orderService.rejectUnanswered(order.tenant_id, order.id, policy.timeoutMinutes);
        }
      } catch (err) {
        // A conflict means a cashier answered it while the sweep ran, and theirs stands.
        if (!(err instanceof ConflictException)) {
          this.logger.error(`Could not answer overdue order ${order.order_number}: ${(err as Error)?.message}`);
        }
        continue;
      }

      answered += 1;
      const fromSnappfood = order.order_number?.startsWith('SNP-');
      await this.alertRepo.save(
        this.alertRepo.create({
          tenant_id: order.tenant_id,
          branch_id: order.branch_id,
          type: 'INCOMING_ORDER_EXPIRED',
          severity: 'WARNING',
          title: `Order ${order.order_number} was not answered within ${policy.timeoutMinutes} min`,
          message: accepted
            ? 'Accepted automatically and sent to the kitchen.'
            : `${policy.timeoutAction === 'ACCEPT' ? 'No shift was open, so it was rejected' : 'Rejected automatically'}${fromSnappfood ? '; Snappfood was told' : ''}.`,
          acknowledged: false,
        }),
      );
    }

    return answered;
  }

  onApplicationBootstrap() {
    // Tests call expireOverdue themselves, and a live timer would keep Jest from exiting.
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.expireOverdue();
    } catch (err) {
      this.logger.error(`Incoming order sweep failed: ${(err as Error)?.message}`);
    } finally {
      this.sweeping = false;
    }
  }
}
