import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { CashierShift, ShiftState } from '../../entities/CashierShift.entity';
import { CashMovement, CashMovementType } from '../../entities/CashMovement.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { Payment } from '../../entities/Payment.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { Branch } from '../../entities/Branch.entity';
import { Refund } from '../../entities/Refund.entity';
import { AdminUser } from '../../entities/AdminUser.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { MoneyUtil } from '../../common/utils/money.util';
import { loadBusinessClock } from '../../common/utils/business-clock';
import { currentTillTerminalId } from '../../common/utils/till-context';
import { nextNumber } from '../../common/utils/sequence.util';
import { ShiftPolicy, resolveShiftPolicy } from './shift-policy';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { pickSettingValue } from '../../common/utils/setting-scope.util';
import { ShiftOpenDto, ShiftCloseDto } from './dtos/shift.dto';
import {
  OPEN_ORDER_STATES,
  FINISHED_ORDER_STATES,
  OpenOrderIssue,
  DayCloseOpenOrder,
  openOrderIssue,
  openOrderView,
  ordersWithCourier,
} from './open-orders';

/**
 * What stops a shift closing: an order still owing money (cash on delivery out with a courier,
 * or delivered and not yet settled, owes money like any other), or one nobody accepted. A paid
 * order the kitchen has not marked handed over is not the cashier's to settle — the day close
 * completes it.
 */
const TILL_OPEN_ORDER_ISSUES: OpenOrderIssue[] = ['UNPAID', 'AWAITING_ACCEPTANCE'];

/** Orders that never became a sale: never sent, waiting to be accepted, cancelled or turned down. */
const UNSOLD_ORDER_STATES: string[] = ['DRAFT', 'PENDING_ACCEPTANCE', 'CANCELLED', 'REJECTED'];

/** What one register did in a shift, for the cashier to read on screen. */
export interface ShiftSalesSummary {
  shiftId: string;
  shiftNumber: string;
  registerName: string | null;
  openedBy: string | null;
  openedAt: Date;
  closedAt: Date | null;
  closed: boolean;
  orderCount: number;
  cancelledCount: number;
  salesTotal: string;
  discountTotal: string;
  deliveryFeeTotal: string;
  unpaidTotal: string;
  byType: Array<{ type: string; count: number; total: string }>;
  /** Money taken at this register, by kind of payment. */
  tenders: Array<{ kind: string; count: number; amount: string }>;
  refundCount: number;
  refundTotal: string;
  /** Refunds by how the money went back: cash from this drawer, back to the card... */
  refunds: Array<{ kind: string; count: number; amount: string }>;
  cash: {
    openingFloat: string;
    cashSales: string;
    cashRefunds: string;
    paidIn: string;
    paidOut: string;
    expectedCash: string;
    actualCash: string | null;
    shortOver: string | null;
    leftInDrawer: string | null;
    handedOver: string | null;
  };
}

/** A cash payment begun at a drawer and never taken or cancelled. */
export interface PendingCashPayment {
  id: string;
  paymentNumber: string;
  orderId: string;
  orderNumber: string | null;
  amount: string;
  status: string;
  initiatedAt: Date;
}

/** What stands in the way of closing a shift, for the End shift page and for the close itself. */
export interface ShiftCloseCheck {
  shiftId: string;
  branchId: string;
  businessDate: string;
  /**
   * Orders that block the close: this till's unpaid ones, and any order at the branch still
   * waiting to be accepted. Empty means nothing is in the way.
   */
  openOrders: DayCloseOpenOrder[];
  /** Cash payments on this drawer that must be finished or cancelled before it closes. */
  pendingCash: PendingCashPayment[];
}

@Injectable()
export class ShiftService {
  constructor(
    @InjectRepository(CashierShift) private readonly shiftRepo: Repository<CashierShift>,
    @InjectRepository(CashMovement) private readonly movementRepo: Repository<CashMovement>,
    @InjectRepository(Terminal) private readonly terminalRepo: Repository<Terminal>,
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    private readonly auditWriter: AuditWriter,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * The drawer rules in force at a branch: its own override when it has one, else head
   * office's, else the defaults. Read at the till, not only by the settings screen, or an
   * override would show there and change nothing.
   */
  async policyFor(tenantId: string, branchId?: string | null): Promise<ShiftPolicy> {
    const rows = await this.dataSource
      .getRepository(TenantSetting)
      .find({ where: { tenant_id: tenantId, key: 'SHIFT_POLICY' } });
    return resolveShiftPolicy(pickSettingValue(rows, branchId));
  }

  async getShifts(tenantId: string, query: any) {
    const qb = this.shiftRepo
      .createQueryBuilder('s')
      .where('s.tenant_id = :tenantId', { tenantId });

    if (query.branch) qb.andWhere('s.branch_id = :branch', { branch: query.branch });
    if (query.terminal) qb.andWhere('s.terminal_id = :terminal', { terminal: query.terminal });
    if (query.state) qb.andWhere('s.state = :state', { state: query.state });
    if (query.businessDate) qb.andWhere('s.business_date = :businessDate', { businessDate: query.businessDate });

    qb.orderBy('s.opened_at', 'DESC');
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '50', 10);
    qb.skip((page - 1) * limit).take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit };
  }

  async getShiftById(tenantId: string, id: string) {
    const shift = await this.shiftRepo.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['movements'],
    });
    if (!shift) throw new NotFoundException(`Shift ${id} not found`);
    return shift;
  }

  /**
   * Resolves the shift that cash for a given terminal/branch belongs to.
   *
   * branchId matters: orders can carry a null terminal_id, and without a branch filter
   * this returns the most recently opened shift anywhere in the tenant. Cash then posts
   * to another branch's drawer and that branch's day close is over by the amount while
   * the real one is short.
   */
  async getCurrentShift(tenantId: string, terminalId?: string | null, branchId?: string | null) {
    const qb = this.shiftRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.movements', 'm')
      .where('s.tenant_id = :tenantId', { tenantId })
      .andWhere("s.state = 'OPEN'");

    if (terminalId) {
      qb.andWhere('s.terminal_id = :terminalId', { terminalId });
    }
    if (branchId) {
      qb.andWhere('s.branch_id = :branchId', { branchId });
    }

    qb.orderBy('s.opened_at', 'DESC');
    // No open shift is a normal state, not a missing resource: most of the day a terminal
    // has no drawer open, and the screen that asks says so and offers to open one. This
    // used to throw a 404, which put a red line in the console on every visit and made the
    // ordinary case look like a fault. Callers that genuinely need a drawer - anything
    // moving cash - use requireCurrentShift below.
    return await qb.getOne();
  }

  /**
   * The open shift, or a refusal naming the actual problem. Cash cannot move with the till
   * shut, and a caller taking a payment should not be handed a 404 about a shift it never
   * asked for.
   */
  async requireCurrentShift(tenantId: string, terminalId?: string | null, branchId?: string | null) {
    const shift = await this.getCurrentShift(tenantId, terminalId, branchId);
    if (!shift) {
      throw new ConflictException({
        code: 'NO_OPEN_SHIFT',
        title: 'No Cash Drawer Open',
        detail: 'Cash cannot be taken or returned while no shift is open at this terminal. Open a shift first.',
      });
    }
    return shift;
  }

  /**
   * The drawer cash is changing hands at right now.
   *
   * The register is the one the request came from (see till-context.ts) or, failing that,
   * the one the order was rung up on. It has to stand in the order's branch: a device set up
   * at Central Plaza taking a Downtown order's cash would count it in Central Plaza's drawer.
   *
   * With no register at all — a device nobody set up — the branch's open drawer is used only
   * when there is exactly one. With two open, "the newest" was the rule, and it put one
   * till's takings into the other till's count.
   *
   * `strict` is for cash: an unknown or out-of-branch register is refused rather than
   * shrugged off. Card and credit only record which shift they happened in, so they take a
   * null instead of failing the sale.
   */
  async resolveDrawer(
    tenantId: string,
    branchId: string | null | undefined,
    orderTerminalId?: string | null,
    options: { strict?: boolean } = {},
  ): Promise<CashierShift | null> {
    const strict = options.strict ?? false;
    const terminalId = currentTillTerminalId() || orderTerminalId || null;

    if (terminalId) {
      const terminal = await this.terminalRepo.findOne({ where: { id: terminalId, tenant_id: tenantId } });
      if (!terminal) {
        if (!strict) return null;
        throw new BadRequestException({
          code: 'UNKNOWN_REGISTER',
          title: 'Unknown Register',
          detail: 'This device is set up as a register that no longer exists. Set it up again.',
        });
      }
      if (branchId && terminal.branch_id !== branchId) {
        if (!strict) return null;
        throw new BadRequestException({
          code: 'REGISTER_OTHER_BRANCH',
          title: 'Register In Another Branch',
          detail: "This device is a register at another branch. Cash taken here would be counted in that branch's drawer.",
        });
      }
      return await this.onBusinessDay(await this.getCurrentShift(tenantId, terminalId, terminal.branch_id), strict);
    }

    if (!branchId) return null;
    const open = await this.shiftRepo.find({
      where: { tenant_id: tenantId, branch_id: branchId, state: 'OPEN' },
      order: { opened_at: 'DESC' },
    });
    if (open.length > 1) {
      if (!strict) return null;
      throw new ConflictException({
        code: 'REGISTER_UNKNOWN',
        title: 'Which Drawer?',
        detail: `${open.length} drawers are open at this branch. Set this device up as one of the registers so the cash is counted in the right one.`,
      });
    }
    return await this.onBusinessDay(open[0] ?? null, strict);
  }

  /**
   * A drawer left open past its business day's cutoff is not the drawer for a new sale. Cash
   * is refused with the reason; card and credit, which only note their shift, note none.
   */
  private async onBusinessDay(shift: CashierShift | null, strict: boolean): Promise<CashierShift | null> {
    if (!shift) return null;
    if (strict) {
      await this.assertShiftOnBusinessDay(shift);
      return shift;
    }
    return (await this.shiftBusinessDayEnded(shift)) ? null : shift;
  }

  /** The drawer for cash, or a refusal naming why there is none. */
  async requireDrawer(tenantId: string, branchId: string | null | undefined, orderTerminalId?: string | null) {
    const shift = await this.resolveDrawer(tenantId, branchId, orderTerminalId, { strict: true });
    if (!shift) {
      throw new ConflictException({
        code: 'NO_OPEN_SHIFT',
        title: 'No Cash Drawer Open',
        detail: 'Cash cannot be taken or returned while no shift is open at this register. Open a shift first.',
      });
    }
    return shift;
  }

  /**
   * A payment started against one drawer settles into that drawer, not whichever is open
   * when it is captured — unless it has been counted down in between.
   */
  async requireOpenShiftById(tenantId: string, shiftId: string, entityManager?: EntityManager) {
    const shift = await (entityManager ?? this.shiftRepo.manager).findOne(CashierShift, {
      where: { id: shiftId, tenant_id: tenantId },
    });
    if (!shift || shift.state !== 'OPEN') {
      throw new ConflictException({
        code: 'NO_OPEN_SHIFT',
        title: 'Drawer Closed',
        detail: 'The drawer this payment was started at has been closed since. Start the payment again.',
      });
    }
    await this.assertShiftOnBusinessDay(shift, entityManager);
    return shift;
  }

  /**
   * Whether a shift's business day has already ended at its branch. After the cutoff an old
   * shift can only be counted and closed: every sale belongs to the new day, and a drawer
   * holds one day's money, so the cashier opens a new shift to keep selling.
   */
  async shiftBusinessDayEnded(
    shift: Pick<CashierShift, 'tenant_id' | 'branch_id' | 'business_date'>,
    em?: EntityManager,
    now: Date = new Date(),
  ): Promise<{ today: string; cutoff: string } | null> {
    if (!shift?.business_date) return null;
    const clock = await loadBusinessClock(em ?? this.dataSource?.manager, shift.tenant_id, shift.branch_id);
    const today = clock.today(now);
    return String(shift.business_date).slice(0, 10) < today ? { today, cutoff: clock.policy.cutoff } : null;
  }

  /** Refuses a sale on a shift whose business day has ended. */
  async assertShiftOnBusinessDay(shift: CashierShift, em?: EntityManager) {
    const ended = await this.shiftBusinessDayEnded(shift, em);
    if (!ended) return;
    throw new ConflictException({
      code: 'SHIFT_BUSINESS_DAY_ENDED',
      title: 'Business Day Ended',
      detail:
        `Shift ${shift.shift_number || ''} belongs to business day ${shift.business_date}, which ended at ${ended.cutoff}. ` +
        'Count and close it, then open a new shift to keep selling.',
      context: { shiftId: shift.id, shiftBusinessDate: shift.business_date, businessDate: ended.today, cutoff: ended.cutoff },
    });
  }

  /**
   * The branch comes from the terminal, never from the caller: a drawer sits in one shop.
   * `callerBranchId` is the account's own branch, when it has one — a Downtown cashier
   * naming Central Plaza's terminal would otherwise open a till in a shop they are not in.
   */
  async openShift(
    tenantId: string,
    dto: ShiftOpenDto,
    userId?: string,
    correlationId?: string,
    callerBranchId?: string | null,
  ) {
    return await this.dataSource.transaction(async (em) => {
      const terminal = await em.findOne(Terminal, {
        where: { id: dto.terminalId, tenant_id: tenantId },
      });
      if (!terminal) throw new NotFoundException(`Terminal ${dto.terminalId} not found`);
      if (callerBranchId && terminal.branch_id !== callerBranchId) {
        throw new ForbiddenException({
          code: 'OTHER_BRANCH',
          title: 'Belongs To Another Branch',
          detail: 'This terminal belongs to a branch other than your own.',
        });
      }
      // A kiosk or a kitchen screen has no drawer to count.
      if (terminal.is_active === false || (terminal.terminal_type && terminal.terminal_type !== 'CASHIER')) {
        throw new BadRequestException(`Terminal ${terminal.code || terminal.id} is not an active cash register`);
      }
      // No drawer opens at an archived branch. The lock is shared with archiving, so a shift
      // opened while the branch is being archived waits for it, then finds it archived.
      const branch = await em.findOne(Branch, {
        where: { id: terminal.branch_id, tenant_id: tenantId },
        withDeleted: true,
        lock: { mode: 'pessimistic_read' },
      });
      if (branch && (branch.deleted_at || branch.is_active === false)) {
        throw new BadRequestException({
          code: 'BRANCH_ARCHIVED',
          title: 'Branch Archived',
          detail: 'This branch is archived; no shift can be opened there.',
        });
      }

      const existing = await em.findOne(CashierShift, {
        where: { tenant_id: tenantId, terminal_id: dto.terminalId, state: 'OPEN' },
      });

      if (existing) {
        throw new ConflictException(`Terminal ${dto.terminalId} already has an active shift (${existing.shift_number})`);
      }

      const now = new Date();
      // The business day where the till stands: its branch's clock and cutoff, so a drawer
      // opened at 02:00 belongs to the night's trade, not to a day that has not opened yet.
      // Nobody has to close the day first; a shift simply opens on the current day.
      const dateStr = (await loadBusinessClock(em, tenantId, terminal.branch_id)).today(now);
      if (dto.businessDate && dto.businessDate !== dateStr) {
        throw new BadRequestException({
          code: 'NOT_THE_BUSINESS_DAY',
          title: 'Not Today',
          detail: `A shift opens on the current business day, ${dateStr}, not ${dto.businessDate}.`,
        });
      }
      const shiftNum = await nextNumber(em, tenantId, `SHF-${dateStr.replace(/-/g, '')}`);
      const openingCash = MoneyUtil.format(dto.openingCash || dto.openingFloat || '0.0000');

      const shift = em.create(CashierShift, {
        tenant_id: tenantId,
        branch_id: terminal.branch_id,
        terminal_id: terminal.id,
        opened_by: userId || null,
        shift_number: shiftNum,
        state: 'OPEN',
        business_date: dateStr,
        opening_cash: openingCash,
        expected_cash: openingCash,
      });

      const savedShift = await em.save(CashierShift, shift);

      // Create OPENING_FLOAT cash movement
      const openMove = em.create(CashMovement, {
        tenant_id: tenantId,
        shift_id: savedShift.id,
        type: 'OPENING_FLOAT',
        amount: openingCash,
        posted_by: userId || null,
        reference: 'Opening Float',
      });
      await em.save(CashMovement, openMove);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'SHIFT_OPENED',
        entityType: 'CashierShift',
        entityId: savedShift.id,
        correlationId,
        afterData: savedShift,
      });

      return await em.findOne(CashierShift, {
        where: { id: savedShift.id },
        relations: ['movements'],
      });
    });
  }

  async recordCashPaymentMovement(
    tenantId: string,
    shiftId: string,
    paymentId: string,
    amount: string,
    userId?: string,
    entityManager?: EntityManager,
  ) {
    const execute = async (em: EntityManager) => {
      const move = em.create(CashMovement, {
        tenant_id: tenantId,
        shift_id: shiftId,
        type: 'CASH_PAYMENT',
        amount: MoneyUtil.format(amount),
        payment_id: paymentId,
        posted_by: userId || null,
        reference: `Cash Payment ${paymentId}`,
      });
      return await em.save(CashMovement, move);
    };

    if (entityManager) return await execute(entityManager);
    return await this.dataSource.transaction(execute);
  }

  async recordCashRefundMovement(
    tenantId: string,
    shiftId: string,
    refundId: string,
    amount: string,
    userId?: string,
    entityManager?: EntityManager,
  ) {
    const execute = async (em: EntityManager) => {
      const formatted = MoneyUtil.format(amount);
      const signedAmount = formatted.startsWith('-') ? formatted : `-${formatted}`;
      const move = em.create(CashMovement, {
        tenant_id: tenantId,
        shift_id: shiftId,
        type: 'CASH_REFUND',
        amount: signedAmount,
        refund_id: refundId,
        posted_by: userId || null,
        reference: `Cash Refund ${refundId}`,
      });
      return await em.save(CashMovement, move);
    };

    if (entityManager) return await execute(entityManager);
    return await this.dataSource.transaction(execute);
  }

  /**
   * Counting a drawer down, in one step: the cashier gives the cash they counted and the shift
   * closes. The expected cash is worked out from the drawer's movements and the difference is
   * stored as a number, nothing more; no reason, no manager. What the till leaves behind is
   * checked first and blocks the close, with no override: cash payments begun and never
   * finished, orders still owing money, and orders waiting to be accepted.
   */
  async closeShift(tenantId: string, shiftId: string, dto: ShiftCloseDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      // Loaded without its movements on purpose. `movements` cascades, so saving a shift
      // that carries the list read here treats the CLOSE_ADJUSTMENT written below as removed
      // from it and nulls its shift_id — every close with a difference failed on the
      // not-null constraint. The movements are read separately for the arithmetic.
      const shift = await em.findOne(CashierShift, {
        where: { id: shiftId, tenant_id: tenantId },
      });
      if (!shift) throw new NotFoundException(`Shift ${shiftId} not found`);

      if (shift.state === 'CLOSED') {
        throw new BadRequestException('Shift is already closed');
      }

      const leftBehind = await this.closeCheckFor(em, tenantId, shift);
      if (leftBehind.pendingCash.length > 0) {
        // Its intent names this drawer, and taking it later needs this drawer open: closed, the
        // payment could never go through and it would hold up every other tender on the order.
        throw new BadRequestException({
          code: 'SHIFT_HAS_PENDING_CASH',
          title: 'Cash Payment Not Finished',
          detail: `${leftBehind.pendingCash.length} cash payment(s) on this drawer were started and never finished. Take or cancel them before closing.`,
          context: { pendingCash: leftBehind.pendingCash },
        });
      }
      if (leftBehind.openOrders.length > 0) {
        // Money still to come in, or a customer's order nobody has answered. The cashier settles
        // each one first; no manager can wave this through.
        throw new ConflictException({
          code: 'SHIFT_HAS_OPEN_ORDERS',
          title: 'Orders Not Settled',
          detail: `${leftBehind.openOrders.length} order(s) are unpaid or waiting to be accepted. Settle them before closing the shift.`,
          context: { openOrders: leftBehind.openOrders },
        });
      }

      // Calculate expected cash strictly from persisted CashMovement rows
      const movements = await em.find(CashMovement, { where: { shift_id: shiftId } });
      let expectedCash = '0.0000';
      for (const m of movements) {
        expectedCash = MoneyUtil.add(expectedCash, m.amount);
      }

      const actualCash = MoneyUtil.format(dto.actualCash);
      const shortOver = MoneyUtil.subtract(actualCash, expectedCash);

      // Of what was counted, what stays as the next shift's float; the rest is handed over.
      const leftInDrawer = MoneyUtil.format(dto.leftInDrawer || '0');
      if (MoneyUtil.lessThan(leftInDrawer, '0') || MoneyUtil.greaterThan(leftInDrawer, actualCash)) {
        throw new BadRequestException({
          code: 'LEFT_IN_DRAWER_OUT_OF_RANGE',
          title: 'More Left Than Counted',
          detail: 'What stays in the drawer cannot be more than the cash counted.',
        });
      }

      // If discrepancy exists, record CLOSE_ADJUSTMENT movement
      if (MoneyUtil.notEqual(shortOver, '0.0000')) {
        const adjMove = em.create(CashMovement, {
          tenant_id: tenantId,
          shift_id: shift.id,
          type: 'CLOSE_ADJUSTMENT',
          amount: shortOver,
          posted_by: userId || null,
          reference: 'Shift Close Adjustment',
        });
        await em.save(CashMovement, adjMove);
      }

      shift.expected_cash = expectedCash;
      shift.actual_cash = actualCash;
      shift.left_in_drawer = leftInDrawer;
      shift.short_over = shortOver;
      shift.state = 'CLOSED';
      shift.closed_at = new Date();
      shift.closed_by = userId || null;

      const savedShift = await em.save(CashierShift, shift);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'SHIFT_CLOSED',
        entityType: 'CashierShift',
        entityId: shiftId,
        correlationId,
        afterData: savedShift,
      });

      return await this.getShiftStatement(tenantId, shiftId, em);
    });
  }

  /** What stands in the way of closing this shift; the End shift page reads it before the count. */
  async getCloseCheck(tenantId: string, shiftId: string): Promise<ShiftCloseCheck> {
    const em = this.dataSource.manager;
    const shift = await em.findOne(CashierShift, { where: { id: shiftId, tenant_id: tenantId } });
    if (!shift) throw new NotFoundException(`Shift ${shiftId} not found`);
    return await this.closeCheckFor(em, tenantId, shift);
  }

  /**
   * A till's orders are the ones it rang up: stamped with this shift, or with this register by
   * an earlier shift that left them. Orders no register took — Snappfood carries no terminal —
   * are the branch's, so one still waiting to be accepted blocks every shift of the branch:
   * whoever is at the till is the one who can answer it.
   */
  private async closeCheckFor(em: EntityManager, tenantId: string, shift: CashierShift): Promise<ShiftCloseCheck> {
    const orders = await em
      .createQueryBuilder(OrderHeader, 'o')
      .where('o.tenant_id = :tenantId', { tenantId })
      .andWhere('o.branch_id = :branchId', { branchId: shift.branch_id })
      .andWhere(
        '(((o.shift_id = :shiftId OR o.terminal_id = :terminalId) AND o.state IN (:...openStates)) OR o.state = :pendingState)',
        {
          shiftId: shift.id,
          terminalId: shift.terminal_id,
          openStates: OPEN_ORDER_STATES,
          pendingState: 'PENDING_ACCEPTANCE',
        },
      )
      .andWhere('o.status NOT IN (:...finishedStates)', { finishedStates: FINISHED_ORDER_STATES })
      .orderBy('o.placed_at', 'ASC')
      .getMany();
    const blocking = orders.filter((order) => {
      const issue = openOrderIssue(order);
      return issue && TILL_OPEN_ORDER_ISSUES.includes(issue);
    });
    // Unpaid delivery orders are cash with a courier; the page says so rather than "unpaid".
    const withCourier = await ordersWithCourier(em, tenantId, blocking);
    const openOrders: DayCloseOpenOrder[] = blocking.map((order) => ({
      ...openOrderView(order, openOrderIssue(order)!),
      ...(withCourier.has(order.id) ? { awaitingCourier: true } : {}),
    }));

    const pendingCash: PendingCashPayment[] = await em.query(
      `SELECT p.id, p.payment_number AS "paymentNumber", p.order_id AS "orderId", o.order_number AS "orderNumber",
              p.amount, p.status, p.initiated_at AS "initiatedAt"
         FROM payment p
         LEFT JOIN order_header o ON o.id = p.order_id
        WHERE p.tenant_id = $1 AND p.shift_id = $2 AND p.method_kind = 'CASH' AND p.status IN ('PENDING', 'PROCESSING')
        ORDER BY p.initiated_at`,
      [tenantId, shift.id],
    );

    return {
      shiftId: shift.id,
      branchId: shift.branch_id,
      businessDate: shift.business_date,
      openOrders,
      pendingCash,
    };
  }

  async getShiftStatement(tenantId: string, shiftId: string, entityManager?: EntityManager) {
    const execute = async (em: EntityManager) => {
      const shift = await em.findOne(CashierShift, { where: { id: shiftId, tenant_id: tenantId } });
      if (!shift) throw new NotFoundException(`Shift ${shiftId} not found`);

      const movements = await em.find(CashMovement, { where: { shift_id: shiftId } });

      let openingFloat = '0.0000';
      let cashSales = '0.0000';
      let cashRefunds = '0.0000';
      let paidIn = '0.0000';
      let paidOut = '0.0000';
      let expectedCash = '0.0000';

      for (const m of movements) {
        // The close adjustment books the difference found at the count. Adding it in made a
        // closed drawer's "expected" equal to what was counted, so every statement balanced.
        if (m.type !== 'CLOSE_ADJUSTMENT') expectedCash = MoneyUtil.add(expectedCash, m.amount);
        switch (m.type) {
          case 'OPENING_FLOAT':
            openingFloat = MoneyUtil.add(openingFloat, m.amount);
            break;
          case 'CASH_PAYMENT':
            cashSales = MoneyUtil.add(cashSales, m.amount);
            break;
          case 'CASH_REFUND':
            cashRefunds = MoneyUtil.add(cashRefunds, MoneyUtil.abs(m.amount));
            break;
          case 'PAID_IN':
            paidIn = MoneyUtil.add(paidIn, m.amount);
            break;
          case 'PAID_OUT':
            paidOut = MoneyUtil.add(paidOut, MoneyUtil.abs(m.amount));
            break;
        }
      }

      const orders = await em.find(OrderHeader, { where: { shift_id: shiftId } });

      return {
        shiftId: shift.id,
        shiftNumber: shift.shift_number,
        branchId: shift.branch_id,
        terminalId: shift.terminal_id,
        state: shift.state,
        businessDate: shift.business_date,
        openedAt: shift.opened_at,
        closedAt: shift.closed_at,
        openingFloat,
        cashSales,
        cashRefunds,
        paidIn,
        paidOut,
        expectedCash,
        actualCash: shift.actual_cash || null,
        shortOver: shift.short_over || '0.0000',
        // What the close kept for the next shift, and what it handed over (safe or central cash).
        leftInDrawer: shift.left_in_drawer ?? null,
        handedOver: shift.actual_cash ? MoneyUtil.subtract(shift.actual_cash, shift.left_in_drawer || '0') : null,
        orderCount: orders.length,
        movements,
      };
    };

    if (entityManager) return await execute(entityManager);
    return await this.dataSource.transaction(execute);
  }

  /**
   * What one register sold in a shift, for the cashier's shift summary: its orders by type, the
   * money it took by kind of payment, its refunds and its drawer.
   *
   * The cashier sees every figure, open shift or closed, and checks the card ones against the
   * card terminal's slip before closing.
   */
  async getSalesSummary(tenantId: string, shiftId: string): Promise<ShiftSalesSummary> {
    const em = this.dataSource.manager;
    const statement = await this.getShiftStatement(tenantId, shiftId, em);
    const shift = await this.shiftRepo.findOne({ where: { id: shiftId, tenant_id: tenantId } });
    if (!shift) throw new NotFoundException(`Shift ${shiftId} not found`);
    const closed = statement.state === 'CLOSED';

    const orders = await this.orderRepo.find({ where: { tenant_id: tenantId, shift_id: shiftId } });
    const sold = orders.filter((o) => !UNSOLD_ORDER_STATES.includes(o.state));
    let salesTotal = '0.0000';
    let discountTotal = '0.0000';
    let deliveryFeeTotal = '0.0000';
    let unpaidTotal = '0.0000';
    const byType = new Map<string, { type: string; count: number; total: string }>();
    for (const o of sold) {
      salesTotal = MoneyUtil.add(salesTotal, o.grand_total || '0');
      discountTotal = MoneyUtil.add(discountTotal, o.discount_total || '0');
      deliveryFeeTotal = MoneyUtil.add(deliveryFeeTotal, o.delivery_fee || '0');
      if (MoneyUtil.greaterThan(o.outstanding_total || '0', '0')) unpaidTotal = MoneyUtil.add(unpaidTotal, o.outstanding_total);
      const bucket = byType.get(o.order_type) ?? { type: o.order_type, count: 0, total: '0.0000' };
      bucket.count += 1;
      bucket.total = MoneyUtil.add(bucket.total, o.grand_total || '0');
      byType.set(o.order_type, bucket);
    }

    // A payment refunded later was still taken here; the refund is counted under refunds.
    const payments = await this.paymentRepo.find({
      where: { tenant_id: tenantId, shift_id: shiftId, status: In(['SUCCEEDED', 'COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED']) },
    });
    const tenders = new Map<string, { kind: string; count: number; amount: string }>();
    for (const p of payments) {
      const kind = p.method_kind || 'OTHER';
      const bucket = tenders.get(kind) ?? { kind, count: 0, amount: '0.0000' };
      bucket.count += 1;
      bucket.amount = MoneyUtil.add(bucket.amount, p.amount || '0');
      tenders.set(kind, bucket);
    }

    const refunds = await em.find(Refund, { where: { tenant_id: tenantId, shift_id: shiftId, status: 'SUCCEEDED' } });
    const refundTotal = refunds.reduce((sum, r) => MoneyUtil.add(sum, r.amount || '0'), '0.0000');
    const refundsBy = new Map<string, { kind: string; count: number; amount: string }>();
    for (const r of refunds) {
      const kind = r.method_kind || 'OTHER';
      const bucket = refundsBy.get(kind) ?? { kind, count: 0, amount: '0.0000' };
      bucket.count += 1;
      bucket.amount = MoneyUtil.add(bucket.amount, r.amount || '0');
      refundsBy.set(kind, bucket);
    }

    const [terminal, cashier] = await Promise.all([
      shift.terminal_id ? this.terminalRepo.findOne({ where: { id: shift.terminal_id, tenant_id: tenantId } }) : null,
      shift.opened_by ? em.findOne(AdminUser, { where: { id: shift.opened_by, tenant_id: tenantId } }) : null,
    ]);

    return {
      shiftId: shift.id,
      shiftNumber: shift.shift_number,
      registerName: terminal ? `${terminal.name} (${terminal.code})` : null,
      closed,
      openedBy: cashier?.display_name || cashier?.username || null,
      openedAt: shift.opened_at,
      closedAt: shift.closed_at || null,
      orderCount: sold.length,
      cancelledCount: orders.filter((o) => o.state === 'CANCELLED').length,
      salesTotal,
      discountTotal,
      deliveryFeeTotal,
      unpaidTotal,
      byType: [...byType.values()].map((b) => ({ ...b, total: b.total })),
      tenders: [...tenders.values()],
      refundCount: refunds.length,
      refundTotal,
      refunds: [...refundsBy.values()],
      cash: {
        openingFloat: statement.openingFloat,
        cashSales: statement.cashSales,
        cashRefunds: statement.cashRefunds,
        paidIn: statement.paidIn,
        paidOut: statement.paidOut,
        expectedCash: statement.expectedCash,
        actualCash: closed ? statement.actualCash : null,
        shortOver: closed ? statement.shortOver : null,
        leftInDrawer: closed ? statement.leftInDrawer : null,
        handedOver: closed ? statement.handedOver : null,
      },
    };
  }

  /**
   * The float a new shift on this register starts with: what the last close left in its drawer,
   * or the branch's policy when no close on it has said.
   */
  async nextOpeningFloat(tenantId: string, terminalId: string): Promise<{ amount: string; source: 'LEFT_IN_DRAWER' | 'POLICY' }> {
    const last = await this.shiftRepo.findOne({
      where: { tenant_id: tenantId, terminal_id: terminalId, state: 'CLOSED' },
      order: { closed_at: 'DESC' },
    });
    if (last && last.left_in_drawer !== null && last.left_in_drawer !== undefined) {
      return { amount: MoneyUtil.format(last.left_in_drawer), source: 'LEFT_IN_DRAWER' };
    }
    const terminal = await this.terminalRepo.findOne({ where: { id: terminalId, tenant_id: tenantId } });
    const policy = await this.policyFor(tenantId, terminal?.branch_id ?? last?.branch_id ?? null);
    return { amount: MoneyUtil.format(policy.defaultOpeningFloat), source: 'POLICY' };
  }
}
