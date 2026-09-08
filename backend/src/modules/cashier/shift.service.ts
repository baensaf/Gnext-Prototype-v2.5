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
import { AuditWriter } from '../audit/audit-writer.service';
import { MoneyUtil } from '../../common/utils/money.util';
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
    private readonly auditWriter: AuditWriter,
    private readonly dataSource: DataSource,
  ) {}

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
    const shift = await qb.getOne();
    if (!shift) {
      throw new NotFoundException({
        statusCode: 404,
        error: 'NO_OPEN_SHIFT',
        message: 'No active open shift found for the specified terminal',
      });
    }
    return shift;
  }

  async openShift(tenantId: string, dto: ShiftOpenDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const terminal = await em.findOne(Terminal, {
        where: { id: dto.terminalId, tenant_id: tenantId },
      });
      if (!terminal) throw new NotFoundException(`Terminal ${dto.terminalId} not found`);

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
      const dateStr = dto.businessDate || now.toISOString().slice(0, 10);
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

  async closeShift(tenantId: string, shiftId: string, dto: ShiftCloseDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const shift = await em.findOne(CashierShift, {
        where: { id: shiftId, tenant_id: tenantId },
        relations: ['movements'],
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

      // Nonzero discrepancy check
      if (MoneyUtil.notEqual(shortOver, '0.0000')) {
        if (!dto.reasonCodeId && !dto.reason) {
          throw new BadRequestException('Cash discrepancy (short/over) requires a reason');
        }
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
        expectedCash = MoneyUtil.add(expectedCash, m.amount);
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
}
