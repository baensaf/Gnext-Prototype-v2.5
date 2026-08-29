import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { Payment, PaymentStatus } from '../../entities/Payment.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { PaymentAllocation } from '../../entities/PaymentAllocation.entity';
import { PaymentAttempt } from '../../entities/PaymentAttempt.entity';
import { PaymentDevice } from '../../entities/PaymentDevice.entity';
import { SettlementAccount } from '../../entities/SettlementAccount.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { ShiftService } from '../cashier/shift.service';
import { CreditService } from '../customer/credit.service';
import { AuditWriter } from '../audit/audit-writer.service';
import {
  PaymentCreateDto,
  PaymentProcessDto,
  PaymentCorrectionDto,
  PaymentDeviceCreateDto,
  SettlementAccountCreateDto,
} from './dtos/payment.dto';
import * as crypto from 'crypto';

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(PaymentMethod) private readonly methodRepo: Repository<PaymentMethod>,
    @InjectRepository(PaymentAllocation) private readonly allocRepo: Repository<PaymentAllocation>,
    @InjectRepository(PaymentAttempt) private readonly attemptRepo: Repository<PaymentAttempt>,
    @InjectRepository(PaymentDevice) private readonly deviceRepo: Repository<PaymentDevice>,
    @InjectRepository(SettlementAccount) private readonly accountRepo: Repository<SettlementAccount>,
    private readonly shiftService: ShiftService,
    private readonly creditService: CreditService,
    private readonly auditWriter: AuditWriter,
    private readonly dataSource: DataSource,
  ) {}

  private async generatePaymentNumber(tenantId: string, em: EntityManager): Promise<string> {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `PAY-${todayStr}-`;
    const count = await em
      .createQueryBuilder(Payment, 'p')
      .where('p.tenant_id = :tenantId', { tenantId })
      .andWhere('p.payment_number LIKE :prefix', { prefix: `${prefix}%` })
      .getCount();
    const seq = (count + 1).toString().padStart(4, '0');
    return `${prefix}${seq}`;
  }

  async getOrderPayments(tenantId: string, orderId: string) {
    return await this.paymentRepo.find({
      where: { tenant_id: tenantId, order_id: orderId },
      relations: ['allocations', 'attempts'],
      order: { initiated_at: 'ASC' },
    });
  }

  async getPaymentById(tenantId: string, id: string) {
    const payment = await this.paymentRepo.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['allocations', 'attempts'],
    });
    if (!payment) throw new NotFoundException(`Payment ${id} not found`);
    return payment;
  }

  async createPaymentIntent(tenantId: string, dto: PaymentCreateDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const order = await em.findOne(OrderHeader, {
        where: { id: dto.orderId, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException(`Order ${dto.orderId} not found`);

      if (order.state === 'CANCELLED') {
        throw new BadRequestException(`Cannot initiate payment for CANCELLED order ${order.id}`);
      }

      // Check active payment intent blocker (only 1 PENDING/PROCESSING intent per order)
      const activeIntent = await em.findOne(Payment, {
        where: [
          { tenant_id: tenantId, order_id: order.id, status: 'PENDING' },
          { tenant_id: tenantId, order_id: order.id, status: 'PROCESSING' },
        ],
      });
      if (activeIntent) {
        throw new ConflictException(
          `An active payment intent (${activeIntent.payment_number} - ${activeIntent.status}) already exists for order ${order.id}`,
        );
      }

      // Check idempotency key deduplication
      if (dto.idempotencyKey) {
        const existing = await em.findOne(Payment, {
          where: { tenant_id: tenantId, idempotency_key: dto.idempotencyKey },
        });
        if (existing) return existing;
      }

      const method = await em.findOne(PaymentMethod, {
        where: { id: dto.methodId, tenant_id: tenantId },
      });
      if (!method || !method.is_active) {
        throw new BadRequestException(`Payment method ${dto.methodId} is invalid or disabled`);
      }

      const amountFormatted = MoneyUtil.format(dto.amount);
      if (MoneyUtil.lessThanOrEqual(amountFormatted, '0.0000')) {
        throw new BadRequestException('Payment amount must be greater than zero');
      }

      if (MoneyUtil.greaterThan(amountFormatted, order.outstanding_total)) {
        throw new BadRequestException(
          `Payment amount (${amountFormatted}) exceeds order collectible outstanding (${order.outstanding_total})`,
        );
      }

      // Mobile POS device metadata validation
      if (method.kind === 'MOBILE_POS' || method.kind === 'MOBILE') {
        if (!dto.deviceId) {
          throw new BadRequestException('Mobile POS payment requires deviceId metadata');
        }
        const device = await em.findOne(PaymentDevice, { where: { id: dto.deviceId, tenant_id: tenantId } });
        if (!device) throw new NotFoundException(`Payment device ${dto.deviceId} not found`);
      }

      const paymentNumber = await this.generatePaymentNumber(tenantId, em);
      let currentShiftId: string | null = null;
      try {
        const shift = await this.shiftService.getCurrentShift(tenantId, order.terminal_id);
        currentShiftId = shift?.id || null;
      } catch (e) {
        // Shift not required for non-cash if not opened
      }

      const payment = em.create(Payment, {
        tenant_id: tenantId,
        order_id: order.id,
        payment_number: paymentNumber,
        method_id: method.id,
        method_kind: method.kind || 'CASH',
        status: 'PENDING',
        amount: amountFormatted,
        currency_code: order.currency_code || 'IRR',
        device_id: dto.deviceId || null,
        settlement_account_id: dto.settlementAccountId || (method as any).settlement_account_id || null,
        reference: dto.reference || null,
        receipt_number: dto.receiptNumber || null,
        shift_id: currentShiftId,
        business_date: order.business_date || new Date().toISOString().slice(0, 10),
        idempotency_key: dto.idempotencyKey || null,
      });

      const savedPayment = await em.save(Payment, payment);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'PAYMENT_INTENT_CREATED',
        entityType: 'Payment',
        entityId: savedPayment.id,
        correlationId: correlationId || 'system',
        afterData: savedPayment,
      });

      return savedPayment;
    });
  }

  async processPayment(tenantId: string, id: string, dto: PaymentProcessDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const payment = await em.findOne(Payment, {
        where: { id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException(`Payment ${id} not found`);

      if (payment.status === 'SUCCEEDED') return payment; // Idempotent success

      if (payment.status !== 'PENDING' && payment.status !== 'PROCESSING' && payment.status !== 'FAILED') {
        throw new BadRequestException(`Payment ${id} is in status ${payment.status} and cannot be processed`);
      }

      payment.status = 'PROCESSING';
      await em.save(Payment, payment);

      const order = await em.findOne(OrderHeader, {
        where: { id: payment.order_id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException(`Order ${payment.order_id} not found`);

      const methodKind = payment.method_kind;

      if (methodKind === 'CASH') {
        const shift = await this.shiftService.getCurrentShift(tenantId, order.terminal_id);
        await this.shiftService.recordCashPaymentMovement(tenantId, shift.id, payment.id, payment.amount, userId || undefined, em);
        payment.status = 'SUCCEEDED';
      } else if (methodKind === 'CUSTOMER_CREDIT') {
        if (!order.customer_id) {
          throw new BadRequestException('Customer credit payment requires an assigned customer on the order');
        }
        const acc = await this.creditService.getAccountByCustomer(tenantId, order.customer_id, payment.currency_code);
        if (!acc) throw new NotFoundException(`No credit account found for customer ${order.customer_id}`);

        await this.creditService.postPurchase(
          tenantId,
          acc.id,
          { orderId: order.id, amount: payment.amount, paymentId: payment.id, businessDate: payment.business_date },
          userId || undefined,
          em,
        );
        payment.status = 'SUCCEEDED';
      } else {
        // External POS / Simulated adapter scenario check
        const scenario = dto.scenarioId || 'SUCCESS';
        const attemptNo = (payment.attempts?.length || 0) + 1;

        if (scenario === 'FAIL' || scenario === 'DECLINED' || scenario === 'TIMEOUT') {
          payment.status = 'FAILED';
          payment.failure_code = scenario;
          payment.failure_message = `Payment attempt ${attemptNo} failed with scenario ${scenario}`;

          const attempt = em.create(PaymentAttempt, {
            tenant_id: tenantId,
            payment_id: payment.id,
            attempt_no: attemptNo,
            adapter: 'SIMULATED_POS',
            scenario_id: scenario,
            status: 'FAILED',
            error_code: scenario,
            finished_at: new Date(),
          });
          await em.save(PaymentAttempt, attempt);
          const savedFailed = await em.save(Payment, payment);

          await this.auditWriter.write({
            tenantId,
            actorType: userId ? 'ADMIN' : 'SYSTEM',
            actorId: userId,
            action: 'PAYMENT_FAILED',
            entityType: 'Payment',
            entityId: payment.id,
            correlationId: correlationId || 'system',
          });

          return savedFailed;
        }

        // Scenario SUCCESS
        const attempt = em.create(PaymentAttempt, {
          tenant_id: tenantId,
          payment_id: payment.id,
          attempt_no: attemptNo,
          adapter: 'SIMULATED_POS',
          scenario_id: 'SUCCESS',
          status: 'SUCCEEDED',
          external_reference: dto.externalReference || `POS-REF-${Date.now()}`,
          finished_at: new Date(),
        });
        await em.save(PaymentAttempt, attempt);

        if (dto.externalReference) payment.reference = dto.externalReference;
        if (dto.receiptNumber) payment.receipt_number = dto.receiptNumber;
        payment.status = 'SUCCEEDED';
      }

      if (payment.status === 'SUCCEEDED') {
        payment.posted_at = new Date();

        // Create PaymentAllocation
        const alloc = em.create(PaymentAllocation, {
          tenant_id: tenantId,
          payment_id: payment.id,
          order_id: order.id,
          amount: payment.amount,
          currency_code: payment.currency_code,
        });
        await em.save(PaymentAllocation, alloc);

        // Update Order totals
        order.paid_total = MoneyUtil.add(order.paid_total, payment.amount);
        let newOutstanding = MoneyUtil.subtract(order.grand_total, order.paid_total);
        if (MoneyUtil.lessThan(newOutstanding, '0.0000')) newOutstanding = '0.0000';
        order.outstanding_total = newOutstanding;
        order.paid_amount = order.paid_total;
        order.due_amount = order.outstanding_total;

        await em.save(OrderHeader, order);

        const savedPayment = await em.save(Payment, payment);

        await this.auditWriter.write({
          tenantId,
          actorType: userId ? 'ADMIN' : 'SYSTEM',
          actorId: userId,
          action: 'PAYMENT_SUCCEEDED',
          entityType: 'Payment',
          entityId: savedPayment.id,
          correlationId: correlationId || 'system',
          afterData: savedPayment,
        });

        return savedPayment;
      }

      return await em.save(Payment, payment);
    });
  }

  async reversePayment(tenantId: string, id: string, dto: { reason: string; approvalRequestId?: string }, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const payment = await em.findOne(Payment, {
        where: { id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException(`Payment ${id} not found`);

      if (payment.status !== 'SUCCEEDED') {
        throw new BadRequestException(`Only SUCCEEDED payments can be reversed. Current status: ${payment.status}`);
      }

      payment.status = 'REVERSED';
      await em.save(Payment, payment);

      const order = await em.findOne(OrderHeader, {
        where: { id: payment.order_id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });

      if (order) {
        order.paid_total = MoneyUtil.subtract(order.paid_total, payment.amount);
        if (MoneyUtil.lessThan(order.paid_total, '0.0000')) order.paid_total = '0.0000';
        order.outstanding_total = MoneyUtil.subtract(order.grand_total, order.paid_total);
        order.paid_amount = order.paid_total;
        order.due_amount = order.outstanding_total;
        await em.save(OrderHeader, order);

        // If payment was cash and shift is active, record a CASH_REFUND / movement
        if (payment.method_kind === 'CASH' && order.terminal_id) {
          try {
            const shift = await this.shiftService.getCurrentShift(tenantId, order.terminal_id);
            if (shift) {
              await this.shiftService.recordCashRefundMovement(
                tenantId,
                shift.id,
                payment.id,
                payment.amount,
                userId,
                em,
              );
            }
          } catch {
            // If no active shift, continue without blocking reversal
          }
        }
      }

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'PAYMENT_REVERSED',
        entityType: 'Payment',
        entityId: id,
        correlationId: correlationId || 'system',
      });

      return payment;
    });
  }

  async correctPayment(tenantId: string, id: string, dto: PaymentCorrectionDto, userId?: string, correlationId?: string) {
    const correctionGroupId = crypto.randomUUID();

    // 1. Reverse original payment
    const original = await this.reversePayment(tenantId, id, { reason: dto.reason }, userId, correlationId);
    original.correction_group_id = correctionGroupId;
    await this.paymentRepo.save(original);

    // 2. Post replacement payment intent
    const replacementAmount = dto.replacementAmount || original.amount;
    const replacementIntent = await this.createPaymentIntent(
      tenantId,
      {
        orderId: original.order_id,
        methodId: dto.replacementMethodId,
        amount: replacementAmount,
      },
      userId,
      correlationId,
    );

    replacementIntent.original_payment_id = original.id;
    replacementIntent.correction_group_id = correctionGroupId;
    await this.paymentRepo.save(replacementIntent);

    // 3. Process replacement payment
    const processedReplacement = await this.processPayment(
      tenantId,
      replacementIntent.id,
      { scenarioId: 'SUCCESS' },
      userId,
      correlationId,
    );

    return {
      originalPayment: original,
      replacementPayment: processedReplacement,
      correctionGroupId,
    };
  }

  // Devices & Settlement Accounts Management
  async getDevices(tenantId: string, branchId?: string) {
    const qb = this.deviceRepo.createQueryBuilder('d').where('d.tenant_id = :tenantId', { tenantId });
    if (branchId) qb.andWhere('d.branch_id = :branchId', { branchId });
    return await qb.getMany();
  }

  async createDevice(tenantId: string, dto: PaymentDeviceCreateDto) {
    const device = this.deviceRepo.create({
      tenant_id: tenantId,
      branch_id: dto.branchId || null,
      code: dto.code,
      name: dto.name,
      kind: dto.kind,
      ownership: dto.ownership || 'COMPANY',
      settlement_account_id: dto.settlementAccountId || null,
      device_identifier: dto.deviceIdentifier || null,
      is_active: true,
    });
    return await this.deviceRepo.save(device);
  }

  async getSettlementAccounts(tenantId: string) {
    return await this.accountRepo.find({ where: { tenant_id: tenantId, is_active: true } });
  }

  async createSettlementAccount(tenantId: string, dto: SettlementAccountCreateDto) {
    const acc = this.accountRepo.create({
      tenant_id: tenantId,
      code: dto.code,
      name: dto.name,
      account_type: dto.accountType,
      masked_identifier: dto.maskedIdentifier || null,
      currency_code: dto.currencyCode || 'IRR',
      is_company_owned: dto.isCompanyOwned !== undefined ? dto.isCompanyOwned : true,
      is_active: true,
    });
    return await this.accountRepo.save(acc);
  }
}
