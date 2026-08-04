import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from '../../entities/Payment.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { Tenant } from '../../entities/Tenant.entity';
import { Branch } from '../../entities/Branch.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { CustomerService } from '../customer/customer.service';
import { AuditWriter } from '../audit/audit-writer.service';

import { SettlementAccount } from '../../entities/SettlementAccount.entity';
import { PaymentDevice } from '../../entities/PaymentDevice.entity';
import { PaymentAllocation } from '../../entities/PaymentAllocation.entity';
import { PaymentAttempt } from '../../entities/PaymentAttempt.entity';

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(PaymentMethod) private readonly methodRepo: Repository<PaymentMethod>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    @InjectRepository(SettlementAccount) private readonly accountRepo: Repository<SettlementAccount>,
    @InjectRepository(PaymentDevice) private readonly deviceRepo: Repository<PaymentDevice>,
    @InjectRepository(PaymentAllocation) private readonly allocRepo: Repository<PaymentAllocation>,
    @InjectRepository(PaymentAttempt) private readonly attemptRepo: Repository<PaymentAttempt>,
    private readonly customerService: CustomerService,
    private readonly auditWriter: AuditWriter,
  ) {}

  async getOrderPayments(tenantId: string, orderId: string) {
    return await this.paymentRepo.find({
      where: { tenant_id: tenantId, order_id: orderId },
      order: { recorded_at: 'ASC' },
    });
  }

  async postPayment(
    tenantId: string,
    data: {
      order_id: string;
      payment_method_id: string;
      amount: string;
      reference_number?: string;
      notes?: string;
    },
    correlationId: string,
  ) {
    const order = await this.orderRepo.findOne({
      where: { id: data.order_id, tenant_id: tenantId },
    });
    if (!order) throw new NotFoundException('Order not found');

    const method = await this.methodRepo.findOne({
      where: { id: data.payment_method_id, tenant_id: tenantId },
    });
    if (!method || !method.is_active) {
      throw new BadRequestException('Invalid or disabled payment method');
    }

    const payAmountFormatted = MoneyUtil.format(data.amount);
    if (MoneyUtil.lessThan(payAmountFormatted, '0.0001')) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    // Customer Credit Account Debit integration
    if (method.code === 'PM-CUSTOMER-CREDIT') {
      if (!order.customer_id) {
        throw new BadRequestException('Customer credit payment requires a customer assigned to the order');
      }
      await this.customerService.postCreditTransaction(
        tenantId,
        order.customer_id,
        {
          transaction_type: 'DEBIT',
          amount: payAmountFormatted,
          note: `Payment for Order #${order.order_number}`,
          reference_id: order.id,
        },
        correlationId,
      );
    }

    const newPaidAmount = MoneyUtil.add(order.paid_amount, payAmountFormatted);
    let newDueAmount = MoneyUtil.subtract(order.total_amount, newPaidAmount);

    if (MoneyUtil.lessThan(newDueAmount, '0')) {
      newDueAmount = '0.0000';
    }

    order.paid_amount = newPaidAmount;
    order.due_amount = newDueAmount;
    await this.orderRepo.save(order);

    const payment = this.paymentRepo.create({
      tenant_id: tenantId,
      order_id: order.id,
      payment_method_id: method.id,
      amount: payAmountFormatted,
      status: 'COMPLETED',
      reference_number: data.reference_number || null,
      notes: data.notes || null,
    });

    const savedPayment = await this.paymentRepo.save(payment);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PAYMENT_RECORDED',
      entityType: 'Payment',
      entityId: savedPayment.id,
      correlationId,
      afterData: { payment: savedPayment, newPaidAmount, newDueAmount },
    });

    return { payment: savedPayment, order };
  }

  async getReceipt(tenantId: string, orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, tenant_id: tenantId },
      relations: ['items', 'items.options'],
    });
    if (!order) throw new NotFoundException('Order not found');

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const branch = await this.branchRepo.findOne({ where: { id: order.branch_id } });
    const payments = await this.getOrderPayments(tenantId, orderId);
    const methods = await this.methodRepo.find({ where: { tenant_id: tenantId } });

    const methodMap = new Map(methods.map((m) => [m.id, m]));

    const tenders = payments.map((p) => {
      const m = methodMap.get(p.payment_method_id);
      return {
        payment_method_code: m ? m.code : 'UNKNOWN',
        payment_method_name: m ? m.name : 'Unknown Method',
        amount: p.amount,
        reference_number: p.reference_number,
        recorded_at: p.recorded_at,
      };
    });

    return {
      receipt_header: {
        tenant_name: tenant ? tenant.name : 'Gnext Store',
        branch_name: branch ? branch.name : 'Main Branch',
        branch_address: branch ? branch.address : 'Tehran, Iran',
        branch_phone: branch ? branch.phone : '+982188000001',
        order_number: order.order_number,
        order_type: order.order_type,
        table_number: order.table_number,
        placed_at: order.placed_at,
      },
      items: order.items.map((item) => ({
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        subtotal: item.subtotal,
        tax_amount: item.tax_amount,
        total_amount: item.total_amount,
        options: item.options ? item.options.map((o) => ({ name: o.option_item_name, price_delta: o.price_delta })) : [],
      })),
      totals: {
        subtotal_amount: order.subtotal_amount,
        tax_amount: order.tax_amount,
        discount_amount: order.discount_amount,
        total_amount: order.total_amount,
        paid_amount: order.paid_amount,
        due_amount: order.due_amount,
      },
      tenders,
      receipt_footer: {
        bilingual_note_fa: 'از خرید شما متشکریم! با آرزوی روزی خوش.',
        bilingual_note_en: 'Thank you for dining with us! Have a great day.',
      },
    };
  }

  // Devices & Settlement Accounts Management
  async getAccounts(tenantId: string) {
    return await this.accountRepo.find({ where: { tenant_id: tenantId }, order: { name: 'ASC' } });
  }

  async createAccount(tenantId: string, data: { code: string; name: string; bank_name?: string; account_number?: string; iban?: string }, correlationId: string) {
    const acc = this.accountRepo.create({
      tenant_id: tenantId,
      code: data.code.toUpperCase(),
      name: data.name,
      bank_name: data.bank_name || null,
      account_number: data.account_number || null,
      iban: data.iban || null,
      is_active: true,
    });
    const saved = await this.accountRepo.save(acc);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'SETTLEMENT_ACCOUNT_CREATED',
      correlationId,
      afterData: saved,
    });
    return saved;
  }

  async getDevices(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    return await this.deviceRepo.find({ where, order: { name: 'ASC' } });
  }

  async createDevice(
    tenantId: string,
    data: { code: string; name: string; serial_number?: string; device_type?: string; branch_id?: string; terminal_id?: string; settlement_account_id?: string },
    correlationId: string,
  ) {
    const device = this.deviceRepo.create({
      tenant_id: tenantId,
      code: data.code.toUpperCase(),
      name: data.name,
      serial_number: data.serial_number || null,
      device_type: data.device_type || 'POS_TERMINAL',
      branch_id: data.branch_id || null,
      terminal_id: data.terminal_id || null,
      settlement_account_id: data.settlement_account_id || null,
      is_active: true,
    });
    const saved = await this.deviceRepo.save(device);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PAYMENT_DEVICE_CREATED',
      correlationId,
      afterData: saved,
    });
    return saved;
  }

  // Split / Multi-Tender Payment
  async postSplitPayment(
    tenantId: string,
    data: {
      order_id: string;
      tenders: Array<{
        payment_method_id: string;
        amount: string;
        device_id?: string;
        settlement_account_id?: string;
        is_mobile_pos?: boolean;
        reference_number?: string;
        notes?: string;
      }>;
    },
    correlationId: string,
  ) {
    const order = await this.orderRepo.findOne({ where: { id: data.order_id, tenant_id: tenantId } });
    if (!order) throw new NotFoundException('Order not found');

    const createdPayments = [];

    for (const tender of data.tenders) {
      const method = await this.methodRepo.findOne({ where: { id: tender.payment_method_id, tenant_id: tenantId } });
      if (!method || !method.is_active) throw new BadRequestException('Invalid payment method');

      const amountFormatted = MoneyUtil.format(tender.amount);
      if (MoneyUtil.lessThan(amountFormatted, '0.0001')) continue;

      // Rule: Mobile POS classification must never be recorded as physical cash
      const isMobilePos = tender.is_mobile_pos || method.code === 'PM-MOBILE-POS';
      if (isMobilePos && method.code === 'PM-CASH') {
        throw new BadRequestException('Mobile POS payments must be recorded as card/POS payments, not cash.');
      }

      // Customer Credit Debit integration
      if (method.code === 'PM-CUSTOMER-CREDIT') {
        if (!order.customer_id) throw new BadRequestException('Customer credit payment requires assigned customer');
        await this.customerService.postCreditTransaction(
          tenantId,
          order.customer_id,
          {
            transaction_type: 'DEBIT',
            amount: amountFormatted,
            note: `Split payment for Order #${order.order_number}`,
            reference_id: order.id,
          },
          correlationId,
        );
      }

      const payment = this.paymentRepo.create({
        tenant_id: tenantId,
        order_id: order.id,
        payment_method_id: method.id,
        amount: amountFormatted,
        status: 'COMPLETED',
        device_id: tender.device_id || null,
        settlement_account_id: tender.settlement_account_id || null,
        is_mobile_pos: isMobilePos,
        is_reversed: false,
        reference_number: tender.reference_number || null,
        notes: tender.notes || null,
      });

      const savedPayment = await this.paymentRepo.save(payment);

      const allocation = this.allocRepo.create({
        tenant_id: tenantId,
        payment_id: savedPayment.id,
        order_id: order.id,
        amount_allocated: amountFormatted,
        status: 'ALLOCATED',
      });
      await this.allocRepo.save(allocation);

      // Record simulated payment attempt
      const attempt = this.attemptRepo.create({
        tenant_id: tenantId,
        payment_id: savedPayment.id,
        attempt_number: 1,
        device_id: tender.device_id || null,
        amount: amountFormatted,
        status: 'SUCCESS',
      });
      await this.attemptRepo.save(attempt);

      createdPayments.push(savedPayment);

      const newPaidAmount = MoneyUtil.add(order.paid_amount, amountFormatted);
      let newDueAmount = MoneyUtil.subtract(order.total_amount, newPaidAmount);
      if (MoneyUtil.lessThan(newDueAmount, '0')) newDueAmount = '0.0000';

      order.paid_amount = newPaidAmount;
      order.due_amount = newDueAmount;
      await this.orderRepo.save(order);
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'SPLIT_PAYMENT_RECORDED',
      correlationId,
      details: { orderId: order.id, tenderCount: createdPayments.length },
    });

    return { payments: createdPayments, order };
  }

  // Retry Failed Terminal Attempt
  async retryPaymentAttempt(tenantId: string, paymentId: string, deviceId: string | undefined, correlationId: string) {
    const payment = await this.paymentRepo.findOne({ where: { id: paymentId, tenant_id: tenantId } });
    if (!payment) throw new NotFoundException('Payment not found');

    const previousAttempts = await this.attemptRepo.find({ where: { tenant_id: tenantId, payment_id: paymentId } });
    const attemptNumber = previousAttempts.length + 1;

    const attempt = this.attemptRepo.create({
      tenant_id: tenantId,
      payment_id: paymentId,
      attempt_number: attemptNumber,
      device_id: deviceId || payment.device_id || null,
      amount: payment.amount,
      status: 'SUCCESS',
      raw_response: { sim_message: 'Simulated terminal callback retry succeeded' },
    });

    const savedAttempt = await this.attemptRepo.save(attempt);
    payment.status = 'COMPLETED';
    await this.paymentRepo.save(payment);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PAYMENT_ATTEMPT_RETRIED',
      correlationId,
      details: { paymentId, attemptNumber },
    });

    return savedAttempt;
  }

  // Immutable Payment Reversal
  async reversePayment(tenantId: string, paymentId: string, reason: string, correlationId: string) {
    const payment = await this.paymentRepo.findOne({ where: { id: paymentId, tenant_id: tenantId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.is_reversed) throw new BadRequestException('Payment has already been reversed');

    const order = await this.orderRepo.findOne({ where: { id: payment.order_id, tenant_id: tenantId } });
    if (!order) throw new NotFoundException('Order not found');

    payment.is_reversed = true;
    payment.status = 'REFUNDED';
    await this.paymentRepo.save(payment);

    // Negative reversal entry
    const reversalPayment = this.paymentRepo.create({
      tenant_id: tenantId,
      order_id: order.id,
      payment_method_id: payment.payment_method_id,
      amount: `-${payment.amount}`,
      status: 'COMPLETED',
      device_id: payment.device_id,
      settlement_account_id: payment.settlement_account_id,
      is_mobile_pos: payment.is_mobile_pos,
      is_reversed: true,
      notes: `Reversal of payment #${payment.id}: ${reason}`,
    });
    const savedReversal = await this.paymentRepo.save(reversalPayment);

    // Update order amounts
    const newPaidAmount = MoneyUtil.subtract(order.paid_amount, payment.amount);
    let newDueAmount = MoneyUtil.subtract(order.total_amount, newPaidAmount);
    if (MoneyUtil.lessThan(newDueAmount, '0')) newDueAmount = '0.0000';

    order.paid_amount = MoneyUtil.format(Math.max(0, parseFloat(newPaidAmount)).toString());
    order.due_amount = newDueAmount;
    await this.orderRepo.save(order);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PAYMENT_REVERSED',
      correlationId,
      details: { paymentId, reversalId: savedReversal.id, reason },
    });

    return { reversal: savedReversal, order };
  }

  // Payment Correction (Immutable Reversal + Replacement)
  async correctPayment(tenantId: string, paymentId: string, newTender: any, correlationId: string) {
    const reversalResult = await this.reversePayment(tenantId, paymentId, 'Payment Correction Reversal', correlationId);
    const newPaymentResult = await this.postSplitPayment(tenantId, { order_id: reversalResult.order.id, tenders: [newTender] }, correlationId);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PAYMENT_CORRECTED',
      correlationId,
      details: { originalPaymentId: paymentId },
    });

    return { reversal: reversalResult.reversal, new_payments: newPaymentResult.payments, order: newPaymentResult.order };
  }
}

