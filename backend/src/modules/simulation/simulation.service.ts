import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Product } from '../../entities/Product.entity';
import { Branch } from '../../entities/Branch.entity';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class SimulationService {
  constructor(
    @InjectRepository(IntegrationLog) private readonly logRepo: Repository<IntegrationLog>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(OrderItem) private readonly orderItemRepo: Repository<OrderItem>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    private readonly auditWriter: AuditWriter,
  ) {}

  verifyHmacSignature(rawBody: string, signature: string, secret: string = 'snappfood-secret-key-123'): boolean {
    if (!signature) return false;
    const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const bufComputed = Buffer.from(computed);
    const bufSignature = Buffer.from(signature);
    if (bufComputed.length !== bufSignature.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufComputed, bufSignature);
  }

  async handleSnappfoodWebhook(
    tenantId: string,
    rawBody: string,
    payload: any,
    signature?: string,
    secret: string = 'snappfood-secret-key-123',
    correlationId?: string,
  ) {
    const idempotencyKey = payload.event_id || payload.order_id || `snapp-${payload.id || Date.now()}`;

    // Verify HMAC if signature provided
    if (signature) {
      const isValid = this.verifyHmacSignature(rawBody, signature, secret);
      if (!isValid) {
        await this.logRepo.save(
          this.logRepo.create({
            tenant_id: tenantId,
            provider: 'SNAPPFOOD',
            event_type: 'WEBHOOK_RECEIVED',
            hmac_signature: signature,
            idempotency_key: idempotencyKey,
            is_duplicate: false,
            status: 'REJECTED',
            request_payload: payload,
            error_message: 'Invalid HMAC signature',
          }),
        );
        throw new BadRequestException('Invalid Snappfood HMAC signature');
      }
    }

    // Check Duplicate Idempotency Key
    const existingLog = await this.logRepo.findOne({
      where: { tenant_id: tenantId, provider: 'SNAPPFOOD', idempotency_key: idempotencyKey, status: 'SUCCESS' },
    });

    if (existingLog) {
      const duplicateLog = await this.logRepo.save(
        this.logRepo.create({
          tenant_id: tenantId,
          provider: 'SNAPPFOOD',
          event_type: 'DUPLICATE_REJECTED',
          hmac_signature: signature || 'simulated-valid-hmac',
          idempotency_key: idempotencyKey,
          is_duplicate: true,
          status: 'SUCCESS',
          request_payload: payload,
          response_payload: { message: 'Duplicate webhook event ignored (exactly-once)' },
        }),
      );

      return {
        success: true,
        duplicate: true,
        message: 'Duplicate Snappfood webhook event ignored (exactly-once enforced)',
        log_id: duplicateLog.id,
      };
    }

    // Process & Map Order
    const branches = await this.branchRepo.find({ where: { tenant_id: tenantId } });
    const branchId = payload.branch_id || (branches[0] ? branches[0].id : 'branch-1');

    const orderNum = `SNP-${payload.order_code || Date.now().toString().slice(-6)}`;
    const itemsInput = payload.items || [
      { product_name: 'Snappfood Combo Meal', quantity: 1, price: 15.0 },
    ];

    let subtotal = 0;
    for (const item of itemsInput) {
      subtotal += parseFloat(item.price || '15.0') * (item.quantity || 1);
    }
    const taxAmount = subtotal * 0.09;
    const totalAmount = subtotal + taxAmount;

    const orderHeader = this.orderRepo.create({
      tenant_id: tenantId,
      branch_id: branchId,
      order_number: orderNum,
      order_type: 'AGGREGATOR',
      status: 'SUBMITTED',
      fulfillment_status: 'PENDING',
      notes: `Snappfood Order [Code: ${payload.order_code || 'SNP-001'}]. Vendor Notes: ${payload.vendor_notes || 'None'}`,
      subtotal_amount: subtotal.toFixed(4),
      tax_amount: taxAmount.toFixed(4),
      discount_amount: '0.0000',
      total_amount: totalAmount.toFixed(4),
      paid_amount: totalAmount.toFixed(4),
      due_amount: '0.0000',
    });

    const savedHeader = await this.orderRepo.save(orderHeader);

    for (const item of itemsInput) {
      const lineTotal = parseFloat(item.price || '15.0') * (item.quantity || 1);
      const orderItem = this.orderItemRepo.create({
        tenant_id: tenantId,
        order_id: savedHeader.id,
        product_id: item.product_id || 'snapp-prod-1',
        product_name: item.product_name || 'Snappfood Item',
        unit_price: parseFloat(item.price || '15.0').toFixed(4),
        quantity: (item.quantity || 1).toFixed(4),
        subtotal: lineTotal.toFixed(4),
        tax_amount: (lineTotal * 0.09).toFixed(4),
        discount_amount: '0.0000',
        total_amount: (lineTotal * 1.09).toFixed(4),
        special_instructions: item.notes || null,
      });
      await this.orderItemRepo.save(orderItem);
    }

    const logEntry = await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'ORDER_CREATED',
        hmac_signature: signature || 'simulated-valid-hmac',
        idempotency_key: idempotencyKey,
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: payload,
        response_payload: { order_id: savedHeader.id, order_number: savedHeader.order_number },
      }),
    );

    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: 'SNAPPFOOD_WEBHOOK_PROCESSED',
      correlationId: correlationId || 'corr-snapp-webhook',
      afterData: { order_id: savedHeader.id, idempotencyKey },
    });

    return {
      success: true,
      duplicate: false,
      order: savedHeader,
      log_id: logEntry.id,
    };
  }

  async generateSnappfoodOrder(tenantId: string, data: any, correlationId?: string) {
    const eventId = `snapp-evt-${Date.now()}`;
    const payload = {
      event_id: eventId,
      order_code: `SF-${Math.floor(1000 + Math.random() * 9000)}`,
      branch_id: data?.branch_id,
      customer: {
        name: data?.customer_name || 'Snappfood Customer',
        phone: data?.customer_phone || '09120001122',
      },
      vendor_notes: data?.notes || 'Please include extra cutlery',
      items: data?.items || [
        { product_name: 'Special Cheelo Kabab', quantity: 2, price: 18.5 },
        { product_name: 'Doogh Bottle', quantity: 2, price: 2.5 },
      ],
    };

    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', 'snappfood-secret-key-123').update(rawBody).digest('hex');

    return await this.handleSnappfoodWebhook(tenantId, rawBody, payload, signature, 'snappfood-secret-key-123', correlationId);
  }

  async triggerSnappfoodAction(
    tenantId: string,
    data: { order_id: string; action: 'ACCEPT' | 'PREPARING' | 'DELIVERED' | 'CANCELLED'; reason?: string },
    correlationId?: string,
  ) {
    const order = await this.orderRepo.findOne({ where: { id: data.order_id, tenant_id: tenantId } });
    if (!order) throw new NotFoundException('Order not found');

    if (data.action === 'ACCEPT' || data.action === 'PREPARING') {
      order.fulfillment_status = 'PREPARING';
      order.status = 'KITCHEN_PREPARING';
    } else if (data.action === 'DELIVERED') {
      order.fulfillment_status = 'DELIVERED';
      order.status = 'COMPLETED';
    } else if (data.action === 'CANCELLED') {
      order.fulfillment_status = 'CANCELLED';
      order.status = 'CANCELLED';
    }

    const saved = await this.orderRepo.save(order);

    await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: `ACTION_${data.action}`,
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: data,
        response_payload: { order_id: saved.id, new_status: saved.status },
      }),
    );

    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: `SNAPPFOOD_ACTION_${data.action}`,
      correlationId: correlationId || 'corr-snapp-action',
      afterData: saved,
    });

    return saved;
  }

  async executeTaraCommand(
    tenantId: string,
    data: { command: 'INSPECT_ELIGIBILITY' | 'RESERVE_CREDIT' | 'SETTLE_TRANSACTION' | 'CANCEL_RESERVATION'; customer_national_id?: string; amount?: number; reservation_id?: string },
    correlationId?: string,
  ) {
    const amount = data.amount || 100.0;
    const resId = data.reservation_id || `TARA-RES-${Date.now().toString().slice(-6)}`;

    let responsePayload: any = {};
    if (data.command === 'INSPECT_ELIGIBILITY') {
      responsePayload = { eligible: true, max_credit: 5000.0, national_id: data.customer_national_id || '0012345678' };
    } else if (data.command === 'RESERVE_CREDIT') {
      responsePayload = { reservation_id: resId, reserved_amount: amount, status: 'CREDIT_RESERVED', expires_in_seconds: 600 };
    } else if (data.command === 'SETTLE_TRANSACTION') {
      responsePayload = { transaction_id: `TARA-TX-${Date.now().toString().slice(-6)}`, reservation_id: resId, status: 'SETTLED_SUCCESS' };
    } else {
      responsePayload = { reservation_id: resId, status: 'RESERVATION_CANCELLED' };
    }

    const logEntry = await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'TARA_PAY',
        event_type: `TARA_${data.command}`,
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: data,
        response_payload: responsePayload,
      }),
    );

    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: `TARA_COMMAND_${data.command}`,
      correlationId: correlationId || 'corr-tara',
      afterData: responsePayload,
    });

    return { success: true, ...responsePayload, log_id: logEntry.id };
  }

  async getScenarios() {
    return [
      {
        id: 'snappfood-std',
        provider: 'SNAPPFOOD',
        title: 'Snappfood Standard Aggregator Order',
        description: 'Simulates incoming Snappfood webhook with valid HMAC signature & items mapping.',
      },
      {
        id: 'snappfood-dup',
        provider: 'SNAPPFOOD',
        title: 'Snappfood Webhook Duplicate Replay Attack',
        description: 'Simulates duplicate webhook payload to verify exactly-once idempotency suppression.',
      },
      {
        id: 'tara-bnpl',
        provider: 'TARA_PAY',
        title: 'Tara BNPL Credit Reservation & Settlement',
        description: 'Simulates Tara BNPL eligibility check, credit reservation, and settlement.',
      },
      {
        id: 'printer-outage',
        provider: 'PRINTER',
        title: 'Kitchen Printer Outage & Spooler Fallback',
        description: 'Simulates print route fallback when primary kitchen printer encounters out-of-paper error.',
      },
    ];
  }

  async getLogs(tenantId: string, provider?: string, status?: string) {
    const where: any = { tenant_id: tenantId };
    if (provider) where.provider = provider;
    if (status) where.status = status;

    return await this.logRepo.find({ where, order: { created_at: 'DESC' }, take: 100 });
  }
}
