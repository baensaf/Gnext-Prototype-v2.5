import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { CashierShift, ShiftState } from '../../entities/CashierShift.entity';
import { CashMovement, CashMovementType } from '../../entities/CashMovement.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { Payment } from '../../entities/Payment.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { Branch, SELLING_BRANCH_TYPES } from '../../entities/Branch.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { MoneyUtil } from '../../common/utils/money.util';
import { BusinessDateUtil } from '../../common/utils/business-date.util';
import { currentTillTerminalId } from '../../common/utils/till-context';
import { isApprover } from '../../common/utils/user-scope.util';
import { ApprovalService } from '../approval/approval.service';
import { ShiftPolicy, resolveShiftPolicy } from './shift-policy';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { pickSettingValue } from '../../common/utils/setting-scope.util';
import {
  ShiftOpenDto,
  CashMovementDto,
  ShiftBeginCloseDto,
  ShiftReturnToOpenDto,
  ShiftCloseDto,
} from './dtos/shift.dto';

@Injectable()
export class ShiftService {
  constructor(
    @InjectRepository(CashierShift) private readonly shiftRepo: Repository<CashierShift>,
    @InjectRepository(CashMovement) private readonly movementRepo: Repository<CashMovement>,
    @InjectRepository(Terminal) private readonly terminalRepo: Repository<Terminal>,
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    private readonly auditWriter: AuditWriter,
    private readonly dataSource: DataSource,
    private readonly approvalService: ApprovalService,
  ) {}

  /**
   * The drawer rules in force at a branch: its own override when it has one, else head
   * office's, else the defaults. Read at the till and at the count, not only by the
   * settings screen, or an override would show there and change nothing.
   */
  async policyFor(tenantId: string, branchId?: string | null): Promise<ShiftPolicy> {
    const rows = await this.dataSource
      .getRepository(TenantSetting)
      .find({ where: { tenant_id: tenantId, key: 'SHIFT_POLICY' } });
    return resolveShiftPolicy(pickSettingValue(rows, branchId));
  }

  /**
   * What someone counting down a drawer may see of it before they have counted.
   *
   * Showing the expected cash beforehand invites typing it in, and the count then proves
   * nothing — the old dialog even filled it in. So while a shift is open, a caller who is not
   * an approver gets the float and their own pay-ins and pay-outs, but not the sales, the
   * refunds or the total the drawer should hold. `blind` tells the screen which it has.
   */
  async redactForBlindCount<T extends Record<string, any> | null>(
    tenantId: string,
    payload: T,
    viewer: { role?: string | null },
  ): Promise<T> {
    if (!payload || isApprover(viewer.role)) return payload;
    const state = payload.state || payload.status;
    if (state === 'CLOSED') return payload;
    const branchId = payload.branch_id || payload.branchId;
    if (!(await this.policyFor(tenantId, branchId)).blindClose) return payload;

    const visible = new Set(['OPENING_FLOAT', 'PAID_IN', 'PAID_OUT']);
    const copy: Record<string, any> = { ...payload, blind: true };
    if (Array.isArray(copy.movements)) copy.movements = copy.movements.filter((m: any) => visible.has(m.type));
    for (const key of ['expectedCash', 'cashSales', 'cashRefunds', 'shortOver', 'expected_cash', 'short_over', 'over_short_amount']) {
      if (key in copy) copy[key] = null;
    }
    return copy as T;
  }

  async getShifts(tenantId: string, query: any) {
    const qb = this.shiftRepo
      .createQueryBuilder('s')
      .where('s.tenant_id = :tenantId', { tenantId });

    if (query.branch) qb.andWhere('s.branch_id = :branch', { branch: query.branch });
    if (query.terminal) qb.andWhere('s.terminal_id = :terminal', { terminal: query.terminal });
    if (query.state) qb.andWhere('s.state = :state', { state: query.state });
    if (query.businessDate) qb.andWhere('s.business_date = :businessDate', { businessDate: query.businessDate });
    if (query.currency) qb.andWhere('s.currency_code = :currency', { currency: query.currency });

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
      .andWhere('s.state IN (:...states)', { states: ['OPEN', 'CLOSING_REVIEW'] });

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
      return await this.getCurrentShift(tenantId, terminalId, terminal.branch_id);
    }

    if (!branchId) return null;
    const open = await this.shiftRepo.find({
      where: [
        { tenant_id: tenantId, branch_id: branchId, state: 'OPEN' },
        { tenant_id: tenantId, branch_id: branchId, state: 'CLOSING_REVIEW' },
      ],
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
    return open[0] ?? null;
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
    if (!shift || (shift.state !== 'OPEN' && shift.state !== 'CLOSING_REVIEW')) {
      throw new ConflictException({
        code: 'NO_OPEN_SHIFT',
        title: 'Drawer Closed',
        detail: 'The drawer this payment was started at has been closed since. Start the payment again.',
      });
    }
    return shift;
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

      const currencyCode = dto.currencyCode || 'IRR';

      // Check if an open/closing_review shift already exists on terminal/currency
      const existing = await em.findOne(CashierShift, {
        where: [
          { tenant_id: tenantId, terminal_id: dto.terminalId, currency_code: currencyCode, state: 'OPEN' },
          { tenant_id: tenantId, terminal_id: dto.terminalId, currency_code: currencyCode, state: 'CLOSING_REVIEW' },
        ],
      });

      if (existing) {
        throw new ConflictException(`Terminal ${dto.terminalId} already has an active shift (${existing.shift_number})`);
      }

      const now = new Date();
      // The operating day where the till stands, not the UTC one: in Tehran a drawer opened
      // between midnight and 03:30 was stamped to the day before, and counted in its close.
      const dateStr = dto.businessDate || BusinessDateUtil.today(now);
      const shiftNum = `SHF-${dateStr.replace(/-/g, '')}-${Math.floor(Math.random() * 9000) + 1000}`;
      const openingCash = MoneyUtil.format(dto.openingCash || dto.openingFloat || '0.0000');

      const shift = em.create(CashierShift, {
        tenant_id: tenantId,
        branch_id: terminal.branch_id,
        terminal_id: terminal.id,
        opened_by: userId || null,
        user_id: userId || null,
        shift_number: shiftNum,
        state: 'OPEN',
        status: 'OPEN',
        currency_code: currencyCode,
        business_date: dateStr,
        opening_cash: openingCash,
        opening_float: openingCash,
        expected_cash: openingCash,
      });

      const savedShift = await em.save(CashierShift, shift);

      // Create OPENING_FLOAT cash movement
      const openMove = em.create(CashMovement, {
        tenant_id: tenantId,
        shift_id: savedShift.id,
        type: 'OPENING_FLOAT',
        amount: openingCash,
        currency_code: currencyCode,
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

  async recordMovement(tenantId: string, shiftId: string, dto: CashMovementDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const shift = await em.findOne(CashierShift, { where: { id: shiftId, tenant_id: tenantId } });
      if (!shift) throw new NotFoundException(`Shift ${shiftId} not found`);
      if (shift.state !== 'OPEN') {
        throw new BadRequestException(`Cannot record cash movement on shift in state ${shift.state}`);
      }

      if (MoneyUtil.lessThanOrEqual(dto.amount, '0.0000')) {
        throw new BadRequestException('Cash movement amount must be positive');
      }

      const signedAmount = dto.type === 'PAID_OUT' ? `-${MoneyUtil.format(dto.amount)}` : MoneyUtil.format(dto.amount);

      const move = em.create(CashMovement, {
        tenant_id: tenantId,
        shift_id: shift.id,
        type: dto.type,
        amount: signedAmount,
        currency_code: shift.currency_code,
        reason_code_id: dto.reasonCodeId || null,
        reason_text: dto.reason || dto.reasonText || null,
        reference: dto.reference || null,
        posted_by: userId || null,
      });
      const savedMove = await em.save(CashMovement, move);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: `CASH_MOVEMENT_${dto.type}`,
        entityType: 'CashMovement',
        entityId: savedMove.id,
        correlationId,
        afterData: savedMove,
      });

      return savedMove;
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

  async beginClose(tenantId: string, shiftId: string, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const shift = await em.findOne(CashierShift, {
        where: { id: shiftId, tenant_id: tenantId },
        relations: ['movements'],
      });
      if (!shift) throw new NotFoundException(`Shift ${shiftId} not found`);
      if (shift.state !== 'OPEN') {
        throw new BadRequestException(`Shift is in state ${shift.state}; only OPEN shifts can begin close`);
      }

      // Generate immutable preview version
      const previewVer = `prev-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      shift.state = 'CLOSING_REVIEW';
      shift.status = 'CLOSING_REVIEW';
      shift.preview_version = previewVer;
      await em.save(CashierShift, shift);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'SHIFT_BEGIN_CLOSE',
        entityType: 'CashierShift',
        entityId: shiftId,
        correlationId,
      });

      return await this.getShiftStatement(tenantId, shiftId, em);
    });
  }

  async returnToOpen(tenantId: string, shiftId: string, dto: ShiftReturnToOpenDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const shift = await em.findOne(CashierShift, { where: { id: shiftId, tenant_id: tenantId } });
      if (!shift) throw new NotFoundException(`Shift ${shiftId} not found`);
      if (shift.state !== 'CLOSING_REVIEW') {
        throw new BadRequestException(`Shift is in state ${shift.state}; only CLOSING_REVIEW shifts can return to open`);
      }

      shift.state = 'OPEN';
      shift.status = 'OPEN';
      shift.preview_version = null as any;
      await em.save(CashierShift, shift);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'SHIFT_RETURN_TO_OPEN',
        entityType: 'CashierShift',
        entityId: shiftId,
        correlationId,
      });

      return shift;
    });
  }

  /**
   * Counting a drawer down.
   *
   * The count is taken blind (see `redactForBlindCount`), so the first the closer learns of
   * a difference is this call refusing with `SHIFT_COUNT_NEEDS_SIGNOFF`, which carries the
   * figures: any difference needs a reason, and one beyond the branch's tolerance needs an
   * approver's pin as well — the same `verifyApproverPin` a refund goes through. An approver
   * closing a drawer carries that authority already. The refused count is audited, so a
   * recount after seeing the difference leaves a trail.
   */
  async closeShift(
    tenantId: string,
    shiftId: string,
    dto: ShiftCloseDto,
    userId?: string,
    correlationId?: string,
    closer?: { role?: string | null },
  ) {
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

      // Check stale preview version if provided
      if (dto.previewVersion && shift.preview_version && dto.previewVersion !== shift.preview_version) {
        throw new ConflictException({
          statusCode: 409,
          error: 'STALE_PREVIEW',
          message: 'Shift closing preview is stale; please re-fetch statement preview',
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

      const policy = await this.policyFor(tenantId, shift.branch_id);
      const hasDifference = MoneyUtil.notEqual(shortOver, '0.0000');
      const beyondTolerance = MoneyUtil.greaterThan(MoneyUtil.abs(shortOver), MoneyUtil.format(policy.varianceTolerance));
      const needsReason = hasDifference && !dto.reasonCodeId && !dto.reason;
      const needsApproval = beyondTolerance && !isApprover(closer?.role);

      if (needsReason || (needsApproval && !dto.pin)) {
        await this.auditWriter.write({
          tenantId,
          actorType: userId ? 'ADMIN' : 'SYSTEM',
          actorId: userId,
          action: 'SHIFT_COUNT_SUBMITTED',
          entityType: 'CashierShift',
          entityId: shiftId,
          correlationId,
          details: { actualCash, expectedCash, shortOver },
        });
        throw new BadRequestException({
          code: 'SHIFT_COUNT_NEEDS_SIGNOFF',
          title: 'Drawer Does Not Balance',
          detail: needsApproval
            ? 'The count is further out than this branch allows. Give a reason and a manager PIN to close.'
            : 'The count differs from what the drawer should hold. Give a reason to close.',
          context: {
            expectedCash,
            actualCash,
            shortOver,
            varianceTolerance: MoneyUtil.format(policy.varianceTolerance),
            needsReason: hasDifference,
            needsApproval,
          },
        });
      }

      let approverId: string | null = null;
      if (needsApproval) {
        const approval = await this.approvalService.verifyApproverPin(
          tenantId,
          dto.pin || '',
          'SHIFT_CLOSE_VARIANCE',
          userId || '',
          shift.branch_id,
        );
        approverId = approval.approver_user_id;
      } else if (beyondTolerance) {
        approverId = userId || null;
      }

      // If discrepancy exists, record CLOSE_ADJUSTMENT movement
      if (MoneyUtil.notEqual(shortOver, '0.0000')) {
        const adjMove = em.create(CashMovement, {
          tenant_id: tenantId,
          shift_id: shift.id,
          type: 'CLOSE_ADJUSTMENT',
          amount: shortOver,
          currency_code: shift.currency_code,
          reason_code_id: dto.reasonCodeId || null,
          reason_text: dto.reason || null,
          posted_by: userId || null,
          reference: 'Shift Close Adjustment',
        });
        await em.save(CashMovement, adjMove);
      }

      shift.expected_cash = expectedCash;
      shift.actual_cash = actualCash;
      shift.short_over = shortOver;
      shift.over_short_amount = shortOver;
      shift.closing_note = dto.reason || null;
      shift.approval_request_id = dto.approvalRequestId || null;
      shift.state = 'CLOSED';
      shift.status = 'CLOSED';
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
        details: approverId ? { varianceApprovedBy: approverId, shortOver } : undefined,
      });

      return await this.getShiftStatement(tenantId, shiftId, em);
    });
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
        currencyCode: shift.currency_code,
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
        previewVersion: shift.preview_version || null,
        orderCount: orders.length,
        movements,
      };
    };

    if (entityManager) return await execute(entityManager);
    return await this.dataSource.transaction(execute);
  }

  // --- CHAIN ROLL-UP (READ ONLY) ---

  /**
   * What head office can see of the tills without standing at any one of them: one row per
   * branch for a single operating day, and nothing to click.
   *
   * Counting, paying in and closing all stay on the branch's own screen — this only reads.
   * The number that earns the page is `stale_open`: a drawer still open on a day that has
   * already ended is invisible from inside the branch that left it open, and is exactly
   * what a chain operator is scanning for.
   */
  async getShiftRollup(tenantId: string, businessDate?: string) {
    const date = businessDate || BusinessDateUtil.today();
    const today = BusinessDateUtil.today();

    const branches = await this.branchRepo.find({ where: { tenant_id: tenantId } });
    const sellingBranches = branches
      .filter((b) => SELLING_BRANCH_TYPES.includes(b.branch_type))
      .filter((b) => b.is_active);

    const shifts = await this.shiftRepo.find({ where: { tenant_id: tenantId, business_date: date } });
    // Asked separately because these are by definition NOT on the day being reported: a
    // till opened on Tuesday and never closed does not appear in Wednesday's rows, which
    // is the whole reason nobody notices it.
    const stale = await this.shiftRepo
      .createQueryBuilder('s')
      .where('s.tenant_id = :tenantId', { tenantId })
      .andWhere('s.business_date < :today', { today })
      .andWhere("(s.state <> 'CLOSED' AND s.status <> 'CLOSED')")
      .getMany();

    type Bucket = {
      open: number;
      closing_review: number;
      closed: number;
      stale_open: number;
      expected_cash: string;
      counted_cash: string;
      variance: string;
      /** The single worst drawer, not the net: two tills 100 apart net to nothing. */
      worst_variance: string;
      last_closed_at: string | null;
    };
    const emptyBucket = (): Bucket => ({
      open: 0,
      closing_review: 0,
      closed: 0,
      stale_open: 0,
      expected_cash: '0.00',
      counted_cash: '0.00',
      variance: '0.00',
      worst_variance: '0.00',
      last_closed_at: null,
    });

    // Seeded from the branch list so a shop that never opened a till today is a row of
    // zeroes rather than an absence. "No shift opened all day" is a finding, not a blank.
    const buckets = new Map<string, Bucket>();
    for (const b of sellingBranches) buckets.set(b.id, emptyBucket());

    for (const s of shifts) {
      if (!buckets.has(s.branch_id)) buckets.set(s.branch_id, emptyBucket());
      const bucket = buckets.get(s.branch_id)!;
      const state = String(s.state || s.status || '').toUpperCase();

      if (state === 'CLOSED') {
        bucket.closed += 1;
        const closedAt = s.closed_at ? new Date(s.closed_at).toISOString() : null;
        if (closedAt && (!bucket.last_closed_at || closedAt > bucket.last_closed_at)) {
          bucket.last_closed_at = closedAt;
        }
      } else if (state === 'CLOSING_REVIEW') {
        bucket.closing_review += 1;
      } else {
        bucket.open += 1;
      }

      bucket.expected_cash = MoneyUtil.add(bucket.expected_cash, MoneyUtil.format(s.expected_cash || '0', 2), 2);
      bucket.counted_cash = MoneyUtil.add(bucket.counted_cash, MoneyUtil.format(s.actual_cash || '0', 2), 2);

      // short_over is only meaningful once a drawer has been counted; an open till has a
      // null there, and treating that as a zero variance would report every branch clean
      // until close of business.
      if (s.actual_cash !== null && s.actual_cash !== undefined) {
        const shortOver = MoneyUtil.format(s.short_over ?? s.over_short_amount ?? '0', 2);
        bucket.variance = MoneyUtil.add(bucket.variance, shortOver, 2);
        if (MoneyUtil.greaterThan(MoneyUtil.abs(shortOver, 2), MoneyUtil.abs(bucket.worst_variance, 2))) {
          bucket.worst_variance = shortOver;
        }
      }
    }

    for (const s of stale) {
      if (!buckets.has(s.branch_id)) buckets.set(s.branch_id, emptyBucket());
      buckets.get(s.branch_id)!.stale_open += 1;
    }

    const byId = new Map(branches.map((b) => [b.id, b]));
    const rows = Array.from(buckets.entries())
      .map(([id, b]) => {
        const branch = byId.get(id);
        return {
          branch_id: id,
          branch: branch ? branch.name : id,
          branch_code: branch ? branch.code : '—',
          ...b,
        };
      })
      // Worst first, same reasoning as the fleet roll-up: a till left open from a previous
      // day beats a large variance, because it is still counting up.
      .sort(
        (a, z) =>
          z.stale_open - a.stale_open ||
          (MoneyUtil.greaterThan(MoneyUtil.abs(z.worst_variance, 2), MoneyUtil.abs(a.worst_variance, 2)) ? 1 : -1) ||
          a.branch.localeCompare(z.branch),
      );

    return {
      business_date: date,
      generated_at: new Date().toISOString(),
      rows,
      totals: {
        branch_count: rows.length,
        branches_not_trading: rows.filter((r) => r.open + r.closing_review + r.closed === 0).length,
        open: rows.reduce((sum, r) => sum + r.open, 0),
        closing_review: rows.reduce((sum, r) => sum + r.closing_review, 0),
        closed: rows.reduce((sum, r) => sum + r.closed, 0),
        stale_open: rows.reduce((sum, r) => sum + r.stale_open, 0),
        expected_cash: MoneyUtil.sum(rows.map((r) => r.expected_cash), 2),
        counted_cash: MoneyUtil.sum(rows.map((r) => r.counted_cash), 2),
        variance: MoneyUtil.sum(rows.map((r) => r.variance), 2),
      },
    };
  }
}
