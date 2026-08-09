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

  verifyHmacSignature(rawBody: string, signature: string, secret: string = 'snappfood-secret-key-123', timestamp?: string): boolean {
    if (!signature) return false;

    // Check timestamp skew (5 minutes = 300,000 ms)
    if (timestamp) {
      let timestampMs = 0;
      if (!isNaN(Number(timestamp))) {
        timestampMs = Number(timestamp);
      } else {
        timestampMs = new Date(timestamp).getTime();
      }
      if (!isNaN(timestampMs)) {
        const skew = Math.abs(Date.now() - timestampMs);
        if (skew > 300 * 1000) {
          throw new BadRequestException('WEBHOOK_TIMESTAMP_INVALID: Webhook timestamp skew exceeds 5-minute limit');
        }
      }
    }

    const payloadToSign = timestamp ? `${timestamp}.${rawBody}` : rawBody;
    const computed = crypto.createHmac('sha256', secret).update(payloadToSign).digest('hex');
    const rawComputed = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    const bufComputed = Buffer.from(computed);
    const bufRawComputed = Buffer.from(rawComputed);
    const bufSignature = Buffer.from(signature);

    if (bufSignature.length === bufComputed.length && crypto.timingSafeEqual(bufComputed, bufSignature)) {
      return true;
    }
    if (bufSignature.length === bufRawComputed.length && crypto.timingSafeEqual(bufRawComputed, bufSignature)) {
      return true;
    }
    return false;
  }

  async handleSnappfoodWebhook(
    tenantId: string,
    rawBody: string,
    payload: any,
    signature?: string,
    timestamp?: string,
    secret: string = 'snappfood-secret-key-123',
    correlationId?: string,
  ) {
    const corrId = correlationId || `corr-snapp-${Date.now()}`;
    const idempotencyKey = payload.event_id || payload.order_id || `snapp-${payload.id || '1001'}`;

    // Verify HMAC and timestamp skew if signature provided
    if (signature) {
      const isValid = this.verifyHmacSignature(rawBody, signature, secret, timestamp);
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
            error_message: 'Invalid Snappfood HMAC signature',
          }),
        );
        throw new BadRequestException('WEBHOOK_SIGNATURE_INVALID: Invalid Snappfood HMAC signature');
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
        simulated: true,
        correlationId: corrId,
        success: true,
        duplicate: true,
        message: 'Duplicate Snappfood webhook event ignored (exactly-once enforced)',
        log_id: duplicateLog.id,
      };
    }

    // Process & Map Order deterministically without Math.random()
    const branches = await this.branchRepo.find({ where: { tenant_id: tenantId } });
    const branchId = payload.branch_id || (branches[0] ? branches[0].id : 'branch-1');

    const orderNum = `SNP-${payload.order_code || payload.event_id || '1001'}`;
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
      correlationId: corrId,
      afterData: { order_id: savedHeader.id, idempotencyKey },
    });

    return {
      simulated: true,
      correlationId: corrId,
      success: true,
      duplicate: false,
      order: savedHeader,
      log_id: logEntry.id,
    };
  }

  async generateSnappfoodOrder(tenantId: string, data: any, correlationId?: string) {
    const seed = data?.seed || '1001';
    const eventId = `snapp-evt-${seed}`;
    const payload = {
      event_id: eventId,
      order_code: `SF-${seed}`,
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

    return await this.handleSnappfoodWebhook(tenantId, rawBody, payload, signature, undefined, 'snappfood-secret-key-123', correlationId);
  }

  async triggerSnappfoodDuplicate(tenantId: string, logId?: string, correlationId?: string) {
    const log = logId ? await this.logRepo.findOne({ where: { id: logId, tenant_id: tenantId } }) : null;
    const idempotencyKey = log ? log.idempotency_key : `snapp-evt-1001`;

    const duplicateLog = await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'DUPLICATE_REJECTED',
        hmac_signature: log?.hmac_signature || 'simulated-valid-hmac',
        idempotency_key: idempotencyKey,
        is_duplicate: true,
        status: 'SUCCESS',
        request_payload: log?.request_payload || { event_id: idempotencyKey },
        response_payload: { message: 'Duplicate webhook receipt generated (simulated)' },
      }),
    );

    return {
      simulated: true,
      correlationId: correlationId || `corr-snapp-dup-${Date.now()}`,
      success: true,
      duplicate: true,
      message: 'Duplicate webhook receipt replayed successfully',
      log_id: duplicateLog.id,
    };
  }

  async triggerSnappfoodAction(
    tenantId: string,
    data: { order_id?: string; orderId?: string; action: 'PICK' | 'ACCEPT' | 'PREPARING' | 'REJECT' | 'MODIFY' | 'DELIVERED' | 'CANCEL' | 'CANCELLED' | 'RECOVER'; reason?: string; scenarioId?: string },
    correlationId?: string,
  ) {
    const orderId = data.order_id || data.orderId;
    const order = orderId ? await this.orderRepo.findOne({ where: { id: orderId, tenant_id: tenantId } }) : null;

    const action = data.action;
    if (order) {
      if (action === 'ACCEPT' || action === 'PREPARING' || action === 'PICK') {
        order.fulfillment_status = 'PREPARING';
        order.status = 'KITCHEN_PREPARING';
      } else if (action === 'DELIVERED') {
        order.fulfillment_status = 'DELIVERED';
        order.status = 'COMPLETED';
      } else if (action === 'CANCEL' || action === 'CANCELLED' || action === 'REJECT') {
        order.fulfillment_status = 'CANCELLED';
        order.status = 'CANCELLED';
      } else if (action === 'RECOVER') {
        order.fulfillment_status = 'PENDING';
        order.status = 'SUBMITTED';
      }
      await this.orderRepo.save(order);
    }

    const savedLog = await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: `ACTION_${action}`,
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: data,
        response_payload: { order_id: orderId, new_status: order ? order.status : 'PROCESSED' },
      }),
    );

    const corrId = correlationId || `corr-snapp-action-${Date.now()}`;
    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: `SNAPPFOOD_ACTION_${action}`,
      correlationId: corrId,
      afterData: order || { action },
    });

    return {
      simulated: true,
      correlationId: corrId,
      success: true,
      action,
      order,
      log_id: savedLog.id,
    };
  }

  async triggerCatalogSync(tenantId: string, data: { branchId?: string; direction?: 'PUSH' | 'RECOVER'; entityTypes?: string[]; scenarioId?: string }, correlationId?: string) {
    const corrId = correlationId || `corr-cat-sync-${Date.now()}`;
    const log = await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: `CATALOG_SYNC_${data.direction || 'PUSH'}`,
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: data,
        response_payload: { status: 'SYNC_QUEUED', synced_entities: data.entityTypes || ['PRODUCTS', 'CATEGORIES'] },
      }),
    );

    return {
      simulated: true,
      correlationId: corrId,
      success: true,
      direction: data.direction || 'PUSH',
      synced_entities: data.entityTypes || ['PRODUCTS', 'CATEGORIES'],
      log_id: log.id,
    };
  }

  async executeTaraCommand(
    tenantId: string,
    data: {
      command?: 'INSPECT_ELIGIBILITY' | 'RESERVE_CREDIT' | 'SETTLE_TRANSACTION' | 'CANCEL_RESERVATION';
      operation?: 'VALIDATE' | 'CREATE' | 'CONFIRM' | 'REVERSE' | 'REFUND' | 'SETTLE' | 'RECONCILE';
      customer_national_id?: string;
      amount?: number;
      reservation_id?: string;
      scenarioId?: string;
    },
    correlationId?: string,
  ) {
    const corrId = correlationId || `corr-tara-${Date.now()}`;
    const op = data.operation || data.command || 'VALIDATE';
    const amount = data.amount || 100.0;
    const resId = data.reservation_id || `TARA-RES-1001`;

    if (data.scenarioId === 'tara-declined' || data.scenarioId === 'failure') {
      const failLog = await this.logRepo.save(
        this.logRepo.create({
          tenant_id: tenantId,
          provider: 'TARA_PAY',
          event_type: `TARA_${op}_FAILED`,
          is_duplicate: false,
          status: 'FAILED',
          request_payload: data,
          error_message: 'Tara BNPL credit reservation declined due to insufficient limit',
        }),
      );

      return {
        simulated: true,
        correlationId: corrId,
        success: false,
        status: 'FAILED',
        error_code: 'INSUFFICIENT_CREDIT',
        message: 'Tara BNPL credit reservation declined due to insufficient limit',
        log_id: failLog.id,
      };
    }

    let responsePayload: any = {};
    if (op === 'VALIDATE' || op === 'INSPECT_ELIGIBILITY') {
      responsePayload = { eligible: true, max_credit: 5000.0, national_id: data.customer_national_id || '0012345678' };
    } else if (op === 'CREATE' || op === 'RESERVE_CREDIT') {
      responsePayload = { reservation_id: resId, reserved_amount: amount, status: 'CREDIT_RESERVED', expires_in_seconds: 600 };
    } else if (op === 'CONFIRM' || op === 'SETTLE' || op === 'SETTLE_TRANSACTION') {
      responsePayload = { transaction_id: `TARA-TX-1001`, reservation_id: resId, status: 'SETTLED_SUCCESS' };
    } else if (op === 'REVERSE' || op === 'CANCEL_RESERVATION') {
      responsePayload = { reservation_id: resId, status: 'RESERVATION_CANCELLED' };
    } else if (op === 'REFUND') {
      responsePayload = { refund_id: `TARA-REF-1001`, reservation_id: resId, status: 'REFUNDED' };
    } else {
      responsePayload = { reconciliation_id: `TARA-REC-1001`, status: 'RECONCILED' };
    }

    const logEntry = await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'TARA_PAY',
        event_type: `TARA_${op}`,
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: data,
        response_payload: responsePayload,
      }),
    );

    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: `TARA_COMMAND_${op}`,
      correlationId: corrId,
      afterData: responsePayload,
    });

    return { simulated: true, correlationId: corrId, success: true, ...responsePayload, log_id: logEntry.id };
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
        id: 'tara-declined',
        provider: 'TARA_PAY',
        title: 'Tara BNPL Credit Declined',
        description: 'Simulates Tara BNPL transaction failure due to insufficient credit.',
      },
      {
        id: 'printer-outage',
        provider: 'PRINTER',
        title: 'Kitchen Printer Outage & Spooler Fallback',
        description: 'Simulates print route fallback when primary kitchen printer encounters out-of-paper error.',
      },
    ];
  }

  async createScenario(tenantId: string, data: any) {
    return {
      id: `scen-${Date.now()}`,
      provider: data.provider || 'CUSTOM',
      title: data.title || 'Custom Scenario',
      description: data.description || 'Custom simulation scenario',
    };
  }

  async updateScenario(tenantId: string, id: string, data: any) {
    return { id, ...data };
  }

  async deleteScenario(tenantId: string, id: string) {
    return { success: true, id };
  }

  async getLogs(tenantId: string, provider?: string, status?: string) {
    const where: any = { tenant_id: tenantId };
    if (provider) where.provider = provider;
    if (status) where.status = status;

    return await this.logRepo.find({ where, order: { created_at: 'DESC' }, take: 100 });
  }

  async getLogDetail(tenantId: string, id: string) {
    const log = await this.logRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!log) throw new NotFoundException('Simulation log not found');
    return log;
  }
}
