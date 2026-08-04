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

@Injectable()
export class PaymentService {
  constructor(
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(PaymentMethod) private readonly methodRepo: Repository<PaymentMethod>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
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
}
