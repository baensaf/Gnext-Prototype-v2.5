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
import { BusinessDateUtil } from '../../common/utils/business-date.util';
import { isAggregatorOrder } from '../../common/utils/snappfood-order.util';
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
import { AgentPaymentsService, AGENT_TERMINAL_DRIVERS } from './agent-payments.service';
import { bookSucceededPayment } from './payment-settlement';
import { AgentConfigService } from '../agent-gateway/agent-config.service';
import { parseDeviceConnection } from '../../common/utils/device-connection.util';

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
    private readonly agentPayments: AgentPaymentsService,
    private readonly agentConfig: AgentConfigService,
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

      // Snappfood collects for its orders, so the till takes no money for one.
      if (isAggregatorOrder(order)) {
        throw new ConflictException({
          code: 'SNAPPFOOD_ORDER_LOCKED',
          message: `Order ${order.order_number} is paid through Snappfood; the till takes no payment for it`,
        });
      }

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

      // Vet the credit tender before the intent exists. Capture re-checks under a row lock
      // and remains the authority; without this, an over-limit or blocked account only
      // surfaces at capture, leaving a PENDING intent that blocks every other tender on the
      // order until someone voids it.
      if (method.kind === 'CUSTOMER_CREDIT') {
        if (!order.customer_id) {
          throw new BadRequestException('Customer credit payment requires an assigned customer on the order');
        }
        await this.creditService.assertCustomerPurchaseAllowed(
          tenantId,
          order.customer_id,
          order.currency_code || 'IRR',
          amountFormatted,
          undefined,
          em,
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
      // The drawer at the register taking the money, which is not always the one the order
      // was rung up on. Cash is refused here, before the intent exists, when there is no
      // such drawer — a PENDING cash intent that can never capture blocks every other
      // tender on the order. Card and credit only note the shift they happened in.
      const openShift =
        method.kind === 'CASH'
          ? await this.shiftService.requireDrawer(tenantId, order.branch_id, order.terminal_id)
          : await this.shiftService.resolveDrawer(tenantId, order.branch_id, order.terminal_id);
      const currentShiftId: string | null = openShift?.id ?? null;

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
        business_date: order.business_date || BusinessDateUtil.today(),
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
    // Set when the charge went to the branch agent: its command is sent once this commits.
    let agentBranchId: string | null = null;
    const result = await this.dataSource.transaction(async (em) => {
      const payment = await em.findOne(Payment, {
        where: { id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException(`Payment ${id} not found`);

      if (payment.status === 'SUCCEEDED') return payment; // Idempotent success

      if (payment.status !== 'PENDING' && payment.status !== 'PROCESSING' && payment.status !== 'FAILED') {
        throw new BadRequestException(`Payment ${id} is in status ${payment.status} and cannot be processed`);
      }
      // Whatever the tender, never start over while a card terminal may still be charging.
      await this.agentPayments.assertNoChargeInFlight(em, payment);

      payment.status = 'PROCESSING';
      await em.save(Payment, payment);

      const order = await em.findOne(OrderHeader, {
        where: { id: payment.order_id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException(`Order ${payment.order_id} not found`);

      const methodKind = payment.method_kind;

      if (methodKind === 'CASH') {
        // Into the drawer the intent was raised at; rows from before intents carried one
        // fall back to finding it the same way.
        const shift = payment.shift_id
          ? await this.shiftService.requireOpenShiftById(tenantId, payment.shift_id, em)
          : await this.shiftService.requireDrawer(tenantId, order.branch_id, order.terminal_id);
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
        // A card tender at a branch whose terminal the agent drives goes to the real terminal.
        const terminal = await this.agentPayments.terminalFor(em, payment, order);
        if (terminal) {
          agentBranchId = order.branch_id;
          return await this.agentPayments.startCharge(em, payment, order, terminal, { userId, correlationId });
        }

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
        return await bookSucceededPayment(em, this.auditWriter, payment, order, { userId, correlationId });
      }

      return await em.save(Payment, payment);
    });

    if (agentBranchId) await this.agentPayments.flush(tenantId, agentBranchId);
    return result;
  }

  /** "Check with terminal" for a card charge the terminal never confirmed. */
  async checkTerminal(tenantId: string, id: string, userId?: string, correlationId?: string) {
    return await this.agentPayments.queryTerminal(tenantId, id, { userId, correlationId });
  }

  async resolveTerminal(
    tenantId: string,
    id: string,
    dto: { outcome: 'APPROVED' | 'NOT_CHARGED'; rrn?: string; reason: string },
    userId?: string,
    correlationId?: string,
  ) {
    return await this.agentPayments.resolveByHand(tenantId, id, dto, { userId, correlationId });
  }

  /** How the branch agent reaches a card terminal, and which driver talks to it. */
  async setDeviceAgent(
    tenantId: string,
    id: string,
    dto: { agentConnection?: Record<string, any> | null; agentDriver?: string | null },
    userId?: string,
  ) {
    const device = await this.deviceRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!device) throw new NotFoundException(`Payment device ${id} not found`);
    const connection = parseDeviceConnection(dto.agentConnection, ['tcp', 'serial']);
    const driver = connection ? String(dto.agentDriver || '').trim().toLowerCase() : null;
    if (connection && !AGENT_TERMINAL_DRIVERS.includes(driver!)) {
      throw new BadRequestException(`Terminal driver must be one of: ${AGENT_TERMINAL_DRIVERS.join(', ')}.`);
    }
    if (connection && !device.branch_id) {
      throw new BadRequestException('Assign the terminal to a branch before connecting it to the branch agent.');
    }
    const before = { agent_connection: device.agent_connection ?? null, agent_driver: device.agent_driver ?? null };
    device.agent_connection = connection;
    device.agent_driver = driver;
    const saved = await this.deviceRepo.save(device);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: userId,
      action: 'PAYMENT_DEVICE_AGENT_SET',
      entityType: 'PaymentDevice',
      entityId: saved.id,
      branchId: saved.branch_id ?? undefined,
      beforeData: before,
      afterData: { agent_connection: saved.agent_connection, agent_driver: saved.agent_driver },
    });
    if (saved.branch_id) await this.agentConfig.pushToBranch(tenantId, saved.branch_id).catch(() => undefined);
    return saved;
  }

  // Voids an abandoned PENDING/FAILED payment intent so a new attempt can be made on the
  // order. No money has moved for these statuses (that only happens on SUCCEEDED in
  // processPayment above), so this is a plain status flip with no ledger reconciliation.
  async voidPayment(tenantId: string, id: string, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const payment = await em.findOne(Payment, {
        where: { id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException(`Payment ${id} not found`);

      if (payment.status !== 'PENDING' && payment.status !== 'FAILED') {
        throw new BadRequestException(`Only PENDING or FAILED payments can be voided. Current status: ${payment.status}`);
      }

      payment.status = 'CANCELLED';
      const saved = await em.save(Payment, payment);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'PAYMENT_VOIDED',
        entityType: 'Payment',
        entityId: saved.id,
        correlationId: correlationId || 'system',
        afterData: saved,
      });

      return saved;
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

        // Cash going back out is recorded against the drawer it comes from: the register doing
        // the reversal, else the drawer the payment went into while that is still open. This
        // used to run only when the order named a terminal, which the POS never sent — so a
        // reversed cash sale stayed in the drawer's expected cash and read as a shortage at
        // close. If no drawer is open the reversal still stands; the money was not counted.
        if (payment.method_kind === 'CASH') {
          let shift = await this.shiftService.resolveDrawer(tenantId, order.branch_id, order.terminal_id);
          if (!shift && payment.shift_id) {
            shift = await this.shiftService.requireOpenShiftById(tenantId, payment.shift_id, em).catch(() => null);
          }
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
        }
      }

      // Credit was debited when the payment succeeded, so it has to be handed back here —
      // otherwise the order un-pays but the customer stays in debt for it.
      if (payment.method_kind === 'CUSTOMER_CREDIT') {
        await this.creditService.reversePurchase(
          tenantId,
          payment.id,
          `Reversal of payment #${payment.payment_number}: ${dto.reason}`,
          userId,
          correlationId,
          em,
        );
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
