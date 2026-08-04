import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CashDrawerShift } from '../../entities/CashDrawerShift.entity';
import { CashDrawerTransaction } from '../../entities/CashDrawerTransaction.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class CashDrawerService {
  constructor(
    @InjectRepository(CashDrawerShift) private readonly shiftRepo: Repository<CashDrawerShift>,
    @InjectRepository(CashDrawerTransaction) private readonly txRepo: Repository<CashDrawerTransaction>,
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentMethod) private readonly methodRepo: Repository<PaymentMethod>,
    private readonly auditWriter: AuditWriter,
  ) {}

  async getActiveShift(tenantId: string, branchId?: string, terminalId?: string) {
    const qb = this.shiftRepo.createQueryBuilder('s')
      .where('s.tenant_id = :tenantId', { tenantId })
      .andWhere('s.status = :status', { status: 'OPEN' })
      .orderBy('s.opened_at', 'DESC');

    if (branchId) qb.andWhere('s.branch_id = :branchId', { branchId });
    if (terminalId) qb.andWhere('s.terminal_id = :terminalId', { terminalId });

    const shift = await qb.getOne();
    if (!shift) return null;

    const transactions = await this.txRepo.find({
      where: { tenant_id: tenantId, shift_id: shift.id },
      order: { recorded_at: 'ASC' },
    });

    const summary = await this.calculateShiftSummary(tenantId, shift, transactions);

    return { shift, transactions, summary };
  }

  async openShift(
    tenantId: string,
    data: { branch_id: string; terminal_id: string; user_id: string; opening_float: string; notes?: string },
    correlationId: string,
  ) {
    const existing = await this.shiftRepo.findOne({
      where: { tenant_id: tenantId, branch_id: data.branch_id, terminal_id: data.terminal_id, status: 'OPEN' },
    });
    if (existing) {
      throw new ConflictException(`An active open shift (${existing.shift_number}) already exists for this terminal`);
    }

    const shiftNumber = `SHIFT-${Date.now().toString().slice(-6)}`;
    const floatFormatted = MoneyUtil.format(data.opening_float || '0');

    const shift = this.shiftRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id,
      terminal_id: data.terminal_id,
      user_id: data.user_id,
      shift_number: shiftNumber,
      opening_float: floatFormatted,
      expected_cash: floatFormatted,
      status: 'OPEN',
      notes: data.notes || null,
    });

    const saved = await this.shiftRepo.save(shift);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'SHIFT_OPENED',
      entityType: 'CashDrawerShift',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async postTransaction(
    tenantId: string,
    shiftId: string,
    data: { transaction_type: string; amount: string; reason_code_id?: string; note?: string },
    correlationId: string,
  ) {
    const shift = await this.shiftRepo.findOne({ where: { id: shiftId, tenant_id: tenantId } });
    if (!shift || shift.status !== 'OPEN') {
      throw new BadRequestException('Shift is not active or open');
    }

    if ((data.transaction_type === 'PAY_OUT' || data.transaction_type === 'SAFE_DROP') && !data.reason_code_id) {
      throw new BadRequestException(`Reason code is mandatory for ${data.transaction_type} operations`);
    }

    const tx = this.txRepo.create({
      tenant_id: tenantId,
      shift_id: shift.id,
      transaction_type: data.transaction_type,
      amount: MoneyUtil.format(data.amount),
      reason_code_id: data.reason_code_id || null,
      note: data.note || null,
    });

    const savedTx = await this.txRepo.save(tx);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'CASH_DRAWER_TRANSACTION_POSTED',
      entityType: 'CashDrawerTransaction',
      entityId: savedTx.id,
      correlationId,
      afterData: savedTx,
    });

    return savedTx;
  }

  async closeShift(
    tenantId: string,
    shiftId: string,
    data: { actual_cash: string; notes?: string },
    correlationId: string,
  ) {
    const shift = await this.shiftRepo.findOne({ where: { id: shiftId, tenant_id: tenantId } });
    if (!shift || shift.status !== 'OPEN') {
      throw new BadRequestException('Shift is not active or already closed');
    }

    const transactions = await this.txRepo.find({ where: { tenant_id: tenantId, shift_id: shift.id } });
    const summary = await this.calculateShiftSummary(tenantId, shift, transactions);

    const actualCashFormatted = MoneyUtil.format(data.actual_cash);
    const overShort = MoneyUtil.subtract(actualCashFormatted, summary.expected_cash);

    shift.actual_cash = actualCashFormatted;
    shift.expected_cash = summary.expected_cash;
    shift.over_short_amount = overShort;
    shift.closed_at = new Date();
    shift.status = 'CLOSED';
    if (data.notes) shift.notes = data.notes;

    const saved = await this.shiftRepo.save(shift);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'SHIFT_CLOSED',
      entityType: 'CashDrawerShift',
      entityId: saved.id,
      correlationId,
      afterData: { shift: saved, summary, overShort },
    });

    return { shift: saved, summary, overShort };
  }

  private async calculateShiftSummary(tenantId: string, shift: CashDrawerShift, transactions: CashDrawerTransaction[]) {
    // Find Cash payment method ID
    const cashMethod = await this.methodRepo.findOne({ where: { tenant_id: tenantId, code: 'PM-CASH' } });

    let cashSalesSum = '0.0000';
    if (cashMethod) {
      const qb = this.paymentRepo.createQueryBuilder('p')
        .where('p.tenant_id = :tenantId', { tenantId })
        .andWhere('p.payment_method_id = :methodId', { methodId: cashMethod.id })
        .andWhere('p.status = :status', { status: 'COMPLETED' })
        .andWhere('p.recorded_at >= :openedAt', { openedAt: shift.opened_at });

      if (shift.closed_at) {
        qb.andWhere('p.recorded_at <= :closedAt', { closedAt: shift.closed_at });
      }

      const payments = await qb.getMany();
      payments.forEach((p) => {
        cashSalesSum = MoneyUtil.add(cashSalesSum, p.amount);
      });
    }

    let payInSum = '0.0000';
    let payOutSum = '0.0000';
    let safeDropSum = '0.0000';

    transactions.forEach((tx) => {
      if (tx.transaction_type === 'PAY_IN') {
        payInSum = MoneyUtil.add(payInSum, tx.amount);
      } else if (tx.transaction_type === 'PAY_OUT') {
        payOutSum = MoneyUtil.add(payOutSum, tx.amount);
      } else if (tx.transaction_type === 'SAFE_DROP') {
        safeDropSum = MoneyUtil.add(safeDropSum, tx.amount);
      }
    });

    // expected_cash = float + cashSales + payIn - payOut - safeDrop
    const expectedCash = MoneyUtil.subtract(
      MoneyUtil.add(MoneyUtil.add(shift.opening_float, cashSalesSum), payInSum),
      MoneyUtil.add(payOutSum, safeDropSum),
    );

    return {
      opening_float: shift.opening_float,
      cash_sales: cashSalesSum,
      pay_in: payInSum,
      pay_out: payOutSum,
      safe_drop: safeDropSum,
      expected_cash: expectedCash,
    };
  }
}
