import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefundRequest } from '../../entities/RefundRequest.entity';
import { RefundItem } from '../../entities/RefundItem.entity';
import { RefundAllocation } from '../../entities/RefundAllocation.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { CustomerService } from '../customer/customer.service';
import { ApprovalService } from '../approval/approval.service';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class RefundService {
  constructor(
    @InjectRepository(RefundRequest) private readonly requestRepo: Repository<RefundRequest>,
    @InjectRepository(RefundItem) private readonly itemRepo: Repository<RefundItem>,
    @InjectRepository(RefundAllocation) private readonly allocRepo: Repository<RefundAllocation>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(OrderItem) private readonly orderItemRepo: Repository<OrderItem>,
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentMethod) private readonly methodRepo: Repository<PaymentMethod>,
    private readonly customerService: CustomerService,
    private readonly approvalService: ApprovalService,
    private readonly auditWriter: AuditWriter,
  ) {}

  async getRefunds(tenantId: string, orderId?: string) {
    const where: any = { tenant_id: tenantId };
    if (orderId) where.order_id = orderId;
    return await this.requestRepo.find({ where, order: { created_at: 'DESC' } });
  }

  async getRefundById(tenantId: string, id: string) {
    const req = await this.requestRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!req) throw new NotFoundException('Refund request not found');
    const items = await this.itemRepo.find({ where: { tenant_id: tenantId, refund_request_id: id } });
    const allocations = await this.allocRepo.find({ where: { tenant_id: tenantId, refund_request_id: id } });
    return { ...req, items, allocations };
  }

  async createRefund(
    tenantId: string,
    requesterUserId: string,
    data: {
      order_id: string;
      refund_type: 'FULL' | 'PARTIAL' | 'ITEM_LEVEL';
      items?: Array<{ order_item_id: string; quantity: number }>;
      custom_amount?: string;
      reason_code_id?: string;
      note?: string;
      pin?: string;
      alternative_payment_method_id?: string;
    },
    correlationId: string,
  ) {
    const order = await this.orderRepo.findOne({
      where: { id: data.order_id, tenant_id: tenantId },
      relations: ['items'],
    });
    if (!order) throw new NotFoundException('Order not found');

    if (MoneyUtil.lessThan(order.paid_amount, '0.0001')) {
      throw new BadRequestException('Cannot refund an unpaid order');
    }

    let calculatedRefundTotal = '0.0000';
    const itemsToRefund: Array<{ order_item_id: string; qty: number; amt: string }> = [];

    if (data.refund_type === 'FULL') {
      calculatedRefundTotal = order.paid_amount;
    } else if (data.refund_type === 'PARTIAL') {
      if (!data.custom_amount) throw new BadRequestException('Partial refund requires custom_amount');
      calculatedRefundTotal = MoneyUtil.format(data.custom_amount);
      if (MoneyUtil.greaterThan(calculatedRefundTotal, order.paid_amount)) {
        throw new BadRequestException('Refund amount cannot exceed total paid amount');
      }
    } else if (data.refund_type === 'ITEM_LEVEL') {
      if (!data.items || data.items.length === 0) throw new BadRequestException('Item-level refund requires item list');
      const itemMap = new Map(order.items.map((i) => [i.id, i]));
      for (const reqItem of data.items) {
        const item = itemMap.get(reqItem.order_item_id);
        if (!item) continue;
        const itemQty = parseInt(item.quantity, 10);
        const qty = Math.min(reqItem.quantity, itemQty);
        const amt = MoneyUtil.multiply(item.unit_price, qty.toString());
        calculatedRefundTotal = MoneyUtil.add(calculatedRefundTotal, amt);
        itemsToRefund.push({ order_item_id: item.id, qty, amt });
      }
    }

    // Check payments made on order
    const payments = await this.paymentRepo.find({ where: { tenant_id: tenantId, order_id: order.id, is_reversed: false } });

    // Same-tender default vs Alternative tender override check
    if (data.alternative_payment_method_id) {
      if (!data.pin) throw new BadRequestException('Alternative tender refund requires Manager PIN authorization');
      await this.approvalService.verifyManagerPin(tenantId, requesterUserId, data.pin, 'REFUND_ALTERNATIVE_TENDER');
    }

    const count = await this.requestRepo.count({ where: { tenant_id: tenantId } });
    const code = `REF-${(count + 1001).toString()}`;

    const refundReq = this.requestRepo.create({
      tenant_id: tenantId,
      code,
      order_id: order.id,
      requester_user_id: requesterUserId,
      status: 'APPROVED',
      refund_type: data.refund_type,
      reason_code_id: data.reason_code_id || null,
      total_refund_amount: calculatedRefundTotal,
      note: data.note || null,
    });
    const savedReq = await this.requestRepo.save(refundReq);

    // Save refund items
    for (const it of itemsToRefund) {
      const refundItem = this.itemRepo.create({
        tenant_id: tenantId,
        refund_request_id: savedReq.id,
        order_item_id: it.order_item_id,
        quantity_refunded: it.qty,
        amount: it.amt,
      });
      await this.itemRepo.save(refundItem);
    }

    // Post negative payment reversal allocations
    let remainingToRefund = calculatedRefundTotal;
    for (const p of payments) {
      if (MoneyUtil.lessThan(remainingToRefund, '0.0001')) break;
      const refundAllocAmt = MoneyUtil.lessThan(remainingToRefund, p.amount) ? remainingToRefund : p.amount;

      const methodId = data.alternative_payment_method_id || p.payment_method_id;
      const method = await this.methodRepo.findOne({ where: { id: methodId, tenant_id: tenantId } });

      const refundAlloc = this.allocRepo.create({
        tenant_id: tenantId,
        refund_request_id: savedReq.id,
        original_payment_id: p.id,
        payment_method_id: methodId,
        amount_refunded: refundAllocAmt,
      });
      await this.allocRepo.save(refundAlloc);

      // Create negative payment entry
      const negPayment = this.paymentRepo.create({
        tenant_id: tenantId,
        order_id: order.id,
        payment_method_id: methodId,
        amount: `-${refundAllocAmt}`,
        status: 'COMPLETED',
        notes: `Refund #${savedReq.code}`,
        is_reversed: false,
      });
      await this.paymentRepo.save(negPayment);

      // Customer credit balance restoration
      if (method && method.code === 'PM-CUSTOMER-CREDIT' && order.customer_id) {
        await this.customerService.postCreditTransaction(
          tenantId,
          order.customer_id,
          {
            transaction_type: 'CREDIT',
            amount: refundAllocAmt,
            note: `Refund restoration for Order #${order.order_number}`,
            reference_id: order.id,
          },
          correlationId,
        );
      }

      remainingToRefund = MoneyUtil.subtract(remainingToRefund, refundAllocAmt);
    }

    // Update order balances
    const newPaid = MoneyUtil.subtract(order.paid_amount, calculatedRefundTotal);
    let newDue = MoneyUtil.subtract(order.total_amount, newPaid);
    if (MoneyUtil.lessThan(newDue, '0')) newDue = '0.0000';

    order.paid_amount = MoneyUtil.format(Math.max(0, parseFloat(newPaid)).toString());
    order.due_amount = newDue;
    if (MoneyUtil.lessThan(newPaid, '0.0001') && order.status !== 'CANCELLED') {
      order.status = 'REFUNDED';
    }
    await this.orderRepo.save(order);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'REFUND_RECORDED',
      entityType: 'RefundRequest',
      entityId: savedReq.id,
      correlationId,
      afterData: { savedReq, order },
    });

    return { refund_request: savedReq, order };
  }

  async cancelPaidOrder(tenantId: string, requesterUserId: string, orderId: string, reason: string, pin?: string, correlationId?: string) {
    const order = await this.orderRepo.findOne({ where: { id: orderId, tenant_id: tenantId } });
    if (!order) throw new NotFoundException('Order not found');

    if (order.status === 'CANCELLED') {
      throw new BadRequestException('Order is already cancelled');
    }

    // Post-kitchen/preparation window authorization requirement
    if (['IN_PREPARATION', 'READY', 'DELIVERED', 'COMPLETED'].includes(order.status)) {
      if (!pin) throw new BadRequestException('Paid order cancellation after kitchen preparation requires Manager PIN authorization');
      await this.approvalService.verifyManagerPin(tenantId, requesterUserId, pin, 'CANCEL_PAID_ORDER_POST_PREPARATION');
    }

    // Perform full refund if paid
    if (MoneyUtil.greaterThan(order.paid_amount, '0.0001')) {
      await this.createRefund(
        tenantId,
        requesterUserId,
        {
          order_id: order.id,
          refund_type: 'FULL',
          note: `Order cancellation: ${reason}`,
          pin,
        },
        correlationId || 'corr-cancel',
      );
    }

    order.status = 'CANCELLED';
    const savedOrder = await this.orderRepo.save(order);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PAID_ORDER_CANCELLED',
      entityType: 'OrderHeader',
      entityId: order.id,
      correlationId,
      details: { orderId: order.id, reason },
    });

    return savedOrder;
  }
}
