import { Inject, Injectable, NotFoundException, BadRequestException, Optional, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { AgentSyncOrder } from '../../entities/AgentSyncOrder.entity';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { OrderStateEvent } from '../../entities/OrderStateEvent.entity';
import { sameSnappfoodLines } from '../../common/utils/snappfood-order.util';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Product } from '../../entities/Product.entity';
import { Branch, SELLING_BRANCH_TYPES } from '../../entities/Branch.entity';
import { OperationalAlert } from '../../entities/OperationalAlert.entity';
import { IncomingOrderPolicyService } from '../order/incoming-order-policy.service';
import { AuditWriter } from '../audit/audit-writer.service';
import { MoneyUtil } from '../../common/utils/money.util';
import { loadBusinessClock } from '../../common/utils/business-clock';
import { Payment } from '../../entities/Payment.entity';
import { PaymentAllocation } from '../../entities/PaymentAllocation.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { CustomerPhone } from '../../entities/CustomerPhone.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { CustomerService, normalizePhone } from '../customer/customer.service';

/** Snappfood quotes every amount in Toman. The store keeps its books in Rial, ten to the Toman. */
export function tomanToRial(toman: any): string {
  return MoneyUtil.multiply(MoneyUtil.format(toman || 0, 4), '10', 4);
}

/** Paid to Snappfood before it reached the store: online, or from the customer's Snappfood credit. */
function snappfoodPaidOnline(payload: any): boolean {
  return ['ONLINE', 'CREDIT'].includes(String(payload.orderPaymentTypeCode || 'ONLINE').toUpperCase());
}

interface SnappfoodLine {
  product_name: string;
  product_id?: string;
  notes?: string;
  quantity: string;
  unit_price: string;
  line_total: string;
  tax: string;
}

/** What a Snappfood webhook call answers: the order it opened or moved, or why it did neither. */
export interface SnappfoodWebhookResult {
  simulated: boolean;
  correlationId: string;
  success: boolean;
  duplicate: boolean;
  order?: OrderHeader | null;
  message?: string;
  log_id: string;
}

@Injectable()
export class SimulationService {
  constructor(
    @InjectRepository(IntegrationLog) private readonly logRepo: Repository<IntegrationLog>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(OrderItem) private readonly orderItemRepo: Repository<OrderItem>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    @InjectRepository(OperationalAlert) private readonly alertRepo: Repository<OperationalAlert>,
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentAllocation) private readonly allocationRepo: Repository<PaymentAllocation>,
    @InjectRepository(PaymentMethod) private readonly paymentMethodRepo: Repository<PaymentMethod>,
    @InjectRepository(CustomerPhone) private readonly customerPhoneRepo: Repository<CustomerPhone>,
    @InjectRepository(CustomerAddress) private readonly customerAddressRepo: Repository<CustomerAddress>,
    @InjectRepository(AgentSyncOrder) private readonly syncRepo: Repository<AgentSyncOrder>,
    @InjectRepository(OrderStateEvent) private readonly stateEventRepo: Repository<OrderStateEvent>,
    private readonly customerService: CustomerService,
    private readonly auditWriter: AuditWriter,
    // The acceptance policy lives with orders, and orders tell Snappfood about their
    // answers, so the two modules reach each other through forwardRef.
    @Optional()
    @Inject(forwardRef(() => IncomingOrderPolicyService))
    private readonly incomingPolicy?: IncomingOrderPolicyService,
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
  ): Promise<SnappfoodWebhookResult> {
    const corrId = correlationId || `corr-snapp-${Date.now()}`;
    // Snappfood's own webhook has no event id. It sends the whole order again, under the same
    // code, whenever the order's status changes, so the code and status name each message.
    const orderCode = payload.code || payload.order_code;
    const statusCode = Number(payload.statusCode ?? 56); // 56 = new order
    const idempotencyKey = payload.event_id || `${orderCode || 'no-code'}:${statusCode}`;

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

    // An event id seen before is a replay. Without one, the order the store already has decides.
    if (payload.event_id) {
      const existingLog = await this.logRepo.findOne({
        where: { tenant_id: tenantId, provider: 'SNAPPFOOD', idempotency_key: idempotencyKey, status: 'SUCCESS' },
      });
      if (existingLog) {
        return this.recordDuplicate(tenantId, payload, signature, idempotencyKey, corrId);
      }
    }

    const known = orderCode
      ? await this.orderRepo.findOne({ where: { tenant_id: tenantId, order_number: `SNP-${orderCode}` } })
      : null;
    // The till took this order while the cloud was away (§17.7): Snappfood's record joins it.
    if (known?.aggregator_match === 'TILL_ONLY' && (statusCode === 56 || statusCode === 54)) {
      return this.matchTillOrder(tenantId, known, statusCode, payload, 'WEBHOOK', signature, idempotencyKey, corrId);
    }
    if (known) {
      return this.applySnappfoodStatus(tenantId, known, statusCode, payload, signature, idempotencyKey, corrId);
    }

    // Only a new order (56) opens one. Any other status is about an order this store never got.
    if (statusCode !== 56) {
      const ignoredLog = await this.logRepo.save(
        this.logRepo.create({
          tenant_id: tenantId,
          provider: 'SNAPPFOOD',
          event_type: `STATUS_${statusCode}_UNKNOWN_ORDER`,
          hmac_signature: signature || 'simulated-valid-hmac',
          idempotency_key: idempotencyKey,
          is_duplicate: false,
          status: 'SUCCESS',
          request_payload: payload,
          response_payload: { message: `No order ${orderCode} to apply status ${statusCode} to` },
        }),
      );
      return { simulated: true, correlationId: corrId, success: true, duplicate: false, order: null, log_id: ignoredLog.id };
    }

    // Process & Map Order deterministically without Math.random()
    const branchId = await this.resolveWebhookBranch(tenantId, payload);

    const orderNum = `SNP-${orderCode || payload.event_id || '1001'}`;
    const lines = this.snappfoodLines(payload);

    const orderHeader = this.orderRepo.create({
      tenant_id: tenantId,
      branch_id: branchId,
      order_number: orderNum,
      order_type: 'AGGREGATOR',
      channel: 'AGGREGATOR',
      // Not SUBMITTED: the kitchen display fires every submitted order, and this one
      // must wait until the store accepts it.
      state: 'PENDING_ACCEPTANCE',
      status: 'PENDING_ACCEPTANCE',
      fulfillment_status: 'PENDING',
      notes: this.describeSnappfoodOrder(payload),
      ...this.snappfoodTotals(payload, lines).totals,
      ...this.snappfoodTiming(payload),
    });
    await this.linkSnappfoodCustomer(tenantId, orderHeader, payload, corrId);

    let savedHeader = await this.orderRepo.save(orderHeader);
    await this.writeSnappfoodLines(tenantId, savedHeader.id, lines, 1);
    await this.applySnappfoodMoney(tenantId, savedHeader, payload, lines);
    savedHeader = await this.orderRepo.save(savedHeader);

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

    // History only. The Notification Center mirrors the arrival; the Incoming Orders queue
    // is where the order is answered.
    await this.alertRepo.save(
      this.alertRepo.create({
        tenant_id: tenantId,
        branch_id: branchId,
        type: 'INCOMING_ORDER',
        severity: 'INFO',
        title: `New Snappfood order ${savedHeader.order_number}`,
        message: `${payload.fullName || 'A customer'}: ${MoneyUtil.formatCurrency(savedHeader.grand_total)} IRR waiting for acceptance`,
        acknowledged: false,
      }),
    );

    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: 'SNAPPFOOD_WEBHOOK_PROCESSED',
      correlationId: corrId,
      afterData: { order_id: savedHeader.id, idempotencyKey },
    });

    // A channel the branch lets straight through is accepted here, by the same accept a
    // cashier uses. Otherwise the order waits in the Incoming Orders queue.
    const accepted = this.incomingPolicy
      ? await this.incomingPolicy.applyOnArrival(tenantId, savedHeader.id, corrId)
      : null;

    return {
      simulated: true,
      correlationId: corrId,
      success: true,
      duplicate: false,
      order: accepted ?? savedHeader,
      log_id: logEntry.id,
    };
  }

  /**
   * The order's notes, as the cashier reads them before accepting: who, where, how it
   * travels and how it was paid. An aggregator order has no customer or address columns
   * yet, so this is where Snappfood's details live.
   */
  private describeSnappfoodOrder(payload: any): string {
    const note = payload.comment || payload.vendor_notes;
    return [
      `Snappfood order ${payload.order_code || payload.code || ''}`.trim(),
      payload.fullName && `Customer: ${payload.fullName}`,
      payload.phone && `Phone: ${payload.phone}`,
      payload.deliverAddress && `Address: ${payload.deliverAddress}`,
      payload.expeditionType && `Delivery: ${payload.expeditionType}`,
      payload.orderPaymentTypeCode && `Payment: ${payload.orderPaymentTypeCode}`,
      note && `Note: ${note}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  /**
   * Snappfood's timing for the order: its preparation time, the minutes it lets this vendor
   * add (vendorMaxPreparationTime) and how the order travels. Together they cap the time the
   * store may promise when it accepts.
   */
  private snappfoodTiming(payload: any) {
    const minutes = (value: any) =>
      value === null || value === undefined || value === '' || isNaN(Number(value)) ? null : Math.round(Number(value));
    return {
      aggregator_prep_minutes: minutes(payload.preparationTime),
      aggregator_max_extra_minutes: minutes(payload.vendorMaxPreparationTime ?? payload.vendorMaxPreprationTime),
      aggregator_expedition: payload.expeditionType ? String(payload.expeditionType).slice(0, 20) : null,
    };
  }

  /**
   * A message about an order the store already has. Only two statuses move it: Snappfood
   * cancelling (54), and the order coming back as new (56) after the store handed it to
   * Snappfood support, by rejecting it or by reporting a problem after accepting it. Every
   * other status reports a step the store took itself, or one it waits out (71, the customer
   * owes more).
   */
  private async applySnappfoodStatus(
    tenantId: string,
    order: OrderHeader,
    statusCode: number,
    payload: any,
    signature: string | undefined,
    idempotencyKey: string,
    corrId: string,
  ): Promise<SnappfoodWebhookResult> {
    if (statusCode === 56) {
      const handedBack =
        order.state === 'REJECTED' || (!!order.aggregator_issue_at && !['CANCELLED', 'COMPLETED'].includes(order.state));
      if (!handedBack) {
        return this.recordDuplicate(tenantId, payload, signature, idempotencyKey, corrId);
      }
      await this.resendSnappfoodOrder(tenantId, order, payload);
    } else if (statusCode === 54 && !['CANCELLED', 'COMPLETED'].includes(order.state)) {
      // A rejected order that Snappfood then cancels is refunded too, so its payment goes.
      if (order.state !== 'REJECTED') this.markCancelled(order);
      await this.reverseSnappfoodPayments(tenantId, order);
      await this.orderRepo.save(order);
    }

    const log = await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: `STATUS_${statusCode}`,
        hmac_signature: signature || 'simulated-valid-hmac',
        idempotency_key: idempotencyKey,
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: payload,
        response_payload: { order_id: order.id, state: order.state },
      }),
    );

    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: `SNAPPFOOD_STATUS_${statusCode}`,
      correlationId: corrId,
      afterData: { order_id: order.id, state: order.state },
    });

    // A re-sent order is answered like a new one, so the branch's policy applies again.
    const accepted =
      statusCode === 56 && this.incomingPolicy
        ? await this.incomingPolicy.applyOnArrival(tenantId, order.id, corrId)
        : null;

    return { simulated: true, correlationId: corrId, success: true, duplicate: false, order: accepted ?? order, log_id: log.id };
  }

  /**
   * Snappfood support sends back an order the store handed it, under the same code. Changed
   * lines void the old ones rather than delete them, and the new ones follow. An accepted order
   * sent back unchanged, say after the store asked for more time, keeps its lines, so the
   * kitchen's tickets stand. Either way the order waits again, its time limit counted from
   * now, for the store to accept it with a new time.
   */
  private async resendSnappfoodOrder(tenantId: string, order: OrderHeader, payload: any) {
    const lines = this.snappfoodLines(payload);
    const unchanged = order.state !== 'REJECTED' && (await this.hasSameLines(tenantId, order.id, lines));
    if (!unchanged) {
      const earlier = await this.orderItemRepo.count({ where: { tenant_id: tenantId, order_id: order.id } });
      await this.orderItemRepo.update({ tenant_id: tenantId, order_id: order.id, state: 'ACTIVE' }, { state: 'VOID' });
      await this.writeSnappfoodLines(tenantId, order.id, lines, earlier + 1);
    }
    await this.applySnappfoodMoney(tenantId, order, payload, lines);
    await this.linkSnappfoodCustomer(tenantId, order, payload, `resend-${order.id}`);

    order.notes = this.describeSnappfoodOrder(payload);
    order.placed_at = new Date();
    Object.assign(order, this.snappfoodTiming(payload));
    order.accepted_at = null;
    order.promised_minutes = null;
    order.aggregator_issue_at = null;
    order.aggregator_issue = null;
    this.markAwaitingAcceptance(order);
    await this.orderRepo.save(order);

    await this.alertRepo.save(
      this.alertRepo.create({
        tenant_id: tenantId,
        branch_id: order.branch_id,
        type: 'INCOMING_ORDER',
        severity: 'INFO',
        title: unchanged
          ? `Snappfood sent order ${order.order_number} back to accept with a new time`
          : `Snappfood sent order ${order.order_number} again, changed`,
        message: `${payload.fullName || 'A customer'}: ${MoneyUtil.formatCurrency(order.grand_total)} IRR waiting for acceptance`,
        acknowledged: false,
      }),
    );
  }

  /** Whether Snappfood's lines are the order's active lines: same dishes, quantities and prices. */
  private async hasSameLines(tenantId: string, orderId: string, lines: SnappfoodLine[]): Promise<boolean> {
    const current = await this.orderItemRepo.find({ where: { tenant_id: tenantId, order_id: orderId, state: 'ACTIVE' } });
    const key = (name: any, quantity: any, price: any) => `${name}|${Number(quantity)}|${Number(price)}`;
    const had = current.map((item) => key(item.product_name, item.quantity, item.unit_price)).sort();
    const sent = lines.map((line) => key(line.product_name, line.quantity, line.unit_price)).sort();
    return had.length === sent.length && had.every((entry, index) => entry === sent[index]);
  }

  /**
   * The simulator plays Snappfood support answering an order the store handed back: 54 cancels
   * it, 56 sends it back. Support sends the order as Snappfood last sent it, so the webhook
   * carries the same customer, timing and lines.
   */
  async sendSupportDecision(tenantId: string, orderCode: string, statusCode: number, correlationId?: string) {
    if (statusCode !== 54 && statusCode !== 56) {
      throw new BadRequestException('Snappfood support answers with 54 (cancel) or 56 (send back)');
    }
    const last = await this.logRepo
      .createQueryBuilder('log')
      .where('log.tenant_id = :tenantId', { tenantId })
      .andWhere('log.provider = :provider', { provider: 'SNAPPFOOD' })
      .andWhere('log.event_type IN (:...types)', { types: ['ORDER_CREATED', 'STATUS_56'] })
      .andWhere(`log.request_payload ->> 'code' = :orderCode`, { orderCode })
      .orderBy('log.created_at', 'DESC')
      .getOne();
    if (!last?.request_payload) {
      throw new NotFoundException(`No Snappfood order ${orderCode} to answer`);
    }

    const payload: any = { ...last.request_payload, statusCode };
    // Snappfood's status messages carry no event id, and the original's would read as a replay.
    delete payload.event_id;
    return this.handleSnappfoodWebhook(tenantId, JSON.stringify(payload), payload, undefined, undefined, undefined, correlationId);
  }

  private async recordDuplicate(
    tenantId: string,
    payload: any,
    signature: string | undefined,
    idempotencyKey: string,
    corrId: string,
  ): Promise<SnappfoodWebhookResult> {
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

  /**
   * The order's lines, in Rial. Snappfood sends `products`, each with a title; older payloads
   * send `items` with a product_name. Prices arrive in Toman, and each line keeps the VAT rate
   * Snappfood charged on it (the product's, else the order's).
   */
  private snappfoodLines(payload: any): SnappfoodLine[] {
    const raw: any[] =
      payload.items ||
      (Array.isArray(payload.products) && payload.products.length
        ? payload.products.map((p: any) => ({ product_name: p.title, product_id: p.product_id, quantity: p.quantity, price: p.price, vat: p.vat }))
        : [{ product_name: 'Snappfood Combo Meal', quantity: 1, price: 15.0 }]);
    return raw.map((line) => {
      const quantity = MoneyUtil.format(line.quantity || 1, 4);
      const unitPrice = tomanToRial(line.price ?? 15);
      const lineTotal = MoneyUtil.multiply(unitPrice, quantity, 4);
      const vat = MoneyUtil.format(line.vat ?? payload.vat ?? 0, 4);
      return {
        product_name: line.product_name || line.title || 'Snappfood Item',
        product_id: line.product_id,
        notes: line.notes,
        quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
        tax: MoneyUtil.multiply(lineTotal, vat, 4),
      };
    });
  }

  /**
   * The order's money, as Snappfood charged it, in Rial. Snappfood's `price` is what the
   * customer was billed (dishes, packing, delivery and VAT, less discounts) and its `tax` is the
   * VAT on it; the store records those rather than pricing the order again, so the order
   * reconciles against Snappfood's settlement statement. Whatever the parts don't explain is the
   * discount. A customer who paid online has paid; one paying cash owes it all.
   */
  private snappfoodTotals(payload: any, lines: SnappfoodLine[]) {
    const has = (value: any) => value !== undefined && value !== null && value !== '';
    const subtotal = MoneyUtil.sum(lines.map((l) => l.line_total));
    const tax = has(payload.tax) ? tomanToRial(payload.tax) : MoneyUtil.sum(lines.map((l) => l.tax));
    const delivery = tomanToRial(payload.deliveryPrice || 0);
    const packaging = tomanToRial(payload.packingPrice || 0);
    const beforeDiscount = MoneyUtil.sum([subtotal, tax, delivery, packaging]);
    const total = has(payload.price) ? tomanToRial(payload.price) : beforeDiscount;
    const gap = MoneyUtil.subtract(beforeDiscount, total, 4);
    const discount = MoneyUtil.greaterThan(gap, '0') ? gap : '0.0000';

    const onlinePaid = snappfoodPaidOnline(payload)
      ? tomanToRial(has(payload.paidPrice) ? payload.paidPrice : payload.price ?? 0)
      : '0.0000';
    const totals = {
      currency_code: 'IRR',
      subtotal,
      subtotal_amount: subtotal,
      tax_total: tax,
      tax_amount: tax,
      delivery_fee: delivery,
      packaging_total: packaging,
      discount_total: discount,
      discount_amount: discount,
      grand_total: total,
      total_amount: total,
      // Set by the payment itself, once one is recorded.
      paid_total: '0.0000',
      paid_amount: '0.0000',
      outstanding_total: total,
      due_amount: total,
    };
    return { totals, onlinePaid };
  }

  private async writeSnappfoodLines(tenantId: string, orderId: string, lines: SnappfoodLine[], firstLineNumber: number) {
    for (let index = 0; index < lines.length; index++) {
      const item = lines[index];
      const orderItem = this.orderItemRepo.create({
        tenant_id: tenantId,
        order_id: orderId,
        line_number: firstLineNumber + index,
        product_id: item.product_id || '00000000-0000-0000-0000-000000000001',
        product_name: item.product_name,
        unit_price: item.unit_price,
        quantity: item.quantity,
        base_total: item.line_total,
        subtotal: item.line_total,
        modifier_total: '0.0000',
        discount_total: '0.0000',
        discount_amount: '0.0000',
        tax_total: item.tax,
        tax_amount: item.tax,
        packaging_total: '0.0000',
        line_total: item.line_total,
        total_amount: MoneyUtil.add(item.line_total, item.tax, 4),
        special_instructions: item.notes || null,
        state: 'ACTIVE',
      });
      await this.orderItemRepo.save(orderItem);
    }
  }

  /**
   * Applies Snappfood's totals to the order and records what the customer paid Snappfood
   * online as an ONLINE payment, so it shows in payments by method. A re-sent order whose total
   * changed reverses the earlier payment first. Without an active ONLINE method the order is
   * left owing and the branch is told, rather than marked paid with no payment behind it.
   */
  private async applySnappfoodMoney(tenantId: string, order: OrderHeader, payload: any, lines: SnappfoodLine[]) {
    const { totals, onlinePaid } = this.snappfoodTotals(payload, lines);
    Object.assign(order, totals);

    const earlier = await this.paymentRepo.find({
      where: { tenant_id: tenantId, order_id: order.id, reference: order.order_number, status: 'SUCCEEDED' },
    });
    const earlierTotal = MoneyUtil.sum(earlier.map((p) => p.amount));
    if (earlier.length && MoneyUtil.equals(earlierTotal, onlinePaid)) {
      this.settleOrderTotals(order, earlierTotal);
      return;
    }
    await this.reverseSnappfoodPayments(tenantId, order);

    if (!MoneyUtil.greaterThan(onlinePaid, '0')) {
      this.settleOrderTotals(order, '0');
      return;
    }
    const method = await this.paymentMethodRepo.findOne({ where: { tenant_id: tenantId, kind: 'ONLINE', is_active: true } });
    if (!method) {
      this.settleOrderTotals(order, '0');
      await this.alertRepo.save(
        this.alertRepo.create({
          tenant_id: tenantId,
          branch_id: order.branch_id,
          type: 'INCOMING_ORDER',
          severity: 'WARNING',
          title: `Snappfood order ${order.order_number} was paid online, but no ONLINE payment method is active`,
          message: 'The order shows as owing until an ONLINE payment method is set up and the payment is recorded.',
          acknowledged: false,
        }),
      );
      return;
    }

    const count = await this.paymentRepo.count({ where: { tenant_id: tenantId, order_id: order.id } });
    const payment = await this.paymentRepo.save(
      this.paymentRepo.create({
        tenant_id: tenantId,
        order_id: order.id,
        payment_number: `PAY-${order.order_number}-${count + 1}`.slice(0, 40),
        method_id: method.id,
        method_kind: method.kind,
        status: 'SUCCEEDED',
        amount: onlinePaid,
        currency_code: 'IRR',
        reference: order.order_number,
        business_date: order.business_date || (await loadBusinessClock(this.paymentRepo.manager, tenantId, order.branch_id)).today(),
        idempotency_key: `snappfood:${order.id}:${count + 1}`,
        posted_at: new Date(),
      }),
    );
    await this.allocationRepo.save(
      this.allocationRepo.create({ tenant_id: tenantId, payment_id: payment.id, order_id: order.id, amount: onlinePaid, currency_code: 'IRR' }),
    );
    this.settleOrderTotals(order, onlinePaid);
  }

  /** Snappfood refunds a cancelled order's online payment, so the store's record of it goes too. */
  private async reverseSnappfoodPayments(tenantId: string, order: OrderHeader) {
    const earlier = await this.paymentRepo.find({
      where: { tenant_id: tenantId, order_id: order.id, reference: order.order_number, status: 'SUCCEEDED' },
    });
    for (const payment of earlier) {
      payment.status = 'REVERSED';
      await this.paymentRepo.save(payment);
    }
    if (earlier.length) this.settleOrderTotals(order, '0');
  }

  private settleOrderTotals(order: OrderHeader, paid: string) {
    const owed = MoneyUtil.subtract(order.grand_total || '0', paid, 4);
    order.paid_total = MoneyUtil.format(paid, 4);
    order.paid_amount = order.paid_total;
    order.outstanding_total = MoneyUtil.greaterThan(owed, '0') ? owed : '0.0000';
    order.due_amount = order.outstanding_total;
  }

  /**
   * The Snappfood customer as a customer record: found by phone, or registered, with the
   * delivery address added to them when it is new. The order then links to both, so the
   * customer's history and the courier's address come from the record, not the notes.
   */
  private async linkSnappfoodCustomer(tenantId: string, order: OrderHeader, payload: any, corrId: string) {
    const phone = normalizePhone(payload.phone || '');
    if (!phone) return;

    const known = await this.customerPhoneRepo.findOne({ where: { tenant_id: tenantId, normalized_phone: phone } });
    let customerId = known?.customer_id;
    if (!customerId) {
      const [first, ...rest] = String(payload.fullName || '').trim().split(/\s+/);
      const created: any = await this.customerService.createCustomer(
        tenantId,
        {
          first_name: payload.firstName || first || 'Snappfood',
          last_name: payload.lastName || rest.join(' ') || 'Customer',
          mobile: phone,
        },
        corrId,
      );
      customerId = created.id;
    }
    order.customer_id = customerId!;

    const text = String(payload.deliverAddress || '').trim();
    if (!text) return;
    const addresses = await this.customerAddressRepo.find({ where: { tenant_id: tenantId, customer_id: customerId } });
    const address =
      addresses.find((a) => a.address_text?.trim() === text) ||
      (await this.customerAddressRepo.save(
        this.customerAddressRepo.create({
          tenant_id: tenantId,
          customer_id: customerId,
          title: 'Snappfood',
          address_text: text,
          latitude: payload.latitude != null ? String(payload.latitude) : null,
          longitude: payload.longitude != null ? String(payload.longitude) : null,
          is_default: addresses.length === 0,
        } as any),
      ));
    order.customer_address_id = (address as any).id;
  }

  /**
   * The branch an incoming order belongs to. Snappfood registers a webhook per branch, so
   * an order addressed to a branch this tenant doesn't have is refused rather than filed
   * under some other branch. With no branch named (the simulator), it goes to the first
   * restaurant; an office or commissary never takes customer orders.
   */
  private async resolveWebhookBranch(tenantId: string, payload: any): Promise<string> {
    const branches = await this.branchRepo.find({
      where: { tenant_id: tenantId, is_active: true },
      order: { created_at: 'ASC' },
    });

    if (payload.branch_id || payload.branch_code) {
      const addressed = branches.find((b) =>
        payload.branch_id ? b.id === payload.branch_id : b.code === payload.branch_code,
      );
      if (!addressed) {
        throw new NotFoundException(`No active branch ${payload.branch_code || payload.branch_id} to receive this Snappfood order`);
      }
      return addressed.id;
    }

    const restaurant = branches.find((b) => SELLING_BRANCH_TYPES.includes(b.branch_type)) || branches[0];
    if (!restaurant) {
      throw new NotFoundException('This tenant has no branch to receive Snappfood orders');
    }
    return restaurant.id;
  }

  async generateSnappfoodOrder(tenantId: string, data: any, correlationId?: string) {
    const seed = data?.seed || Math.floor(1000 + Math.random() * 9000).toString();

    // With no basket given, order what the restaurant actually sells, at its prices. The fixed
    // basket of two 500-Toman test pizzas landed at a burger chain as a 19,100 Rial order.
    const menuBasket = data?.items || data?.products || data?.price ? null : await this.menuBasket(tenantId);
    const basketToman = menuBasket
      ? menuBasket.reduce((sum, p) => sum + p.price * p.quantity, 0)
      : null;
    const basketTax = menuBasket
      ? Math.round(menuBasket.reduce((sum, p) => sum + p.price * p.quantity * p.vat, 0))
      : null;
    const deliveryToman = data?.deliveryPrice ?? (menuBasket ? 60000 : 500);
    const packingToman = data?.packingPrice ?? (menuBasket ? 20000 : 200);
    const billedToman = basketToman !== null ? basketToman + basketTax! + deliveryToman + packingToman : 1910;
    const eventId = data?.event_id || data?.code || `snapp-evt-${seed}`;
    const orderCode = data?.order_code || data?.code || `SF-${seed}`;
    
    // v4.3.0 compliant payload construction
    const payload = {
      code: orderCode,
      event_id: eventId,
      order_code: orderCode,
      // The branch whose webhook the simulator is calling. Unset means the first restaurant.
      branch_id: data?.branch_id || undefined,
      branch_code: data?.branch_code || undefined,
      userCode: data?.userCode || 'usr-668v86',
      userAddressCode: data?.userAddressCode || 'addr-45oonn',
      fullName: data?.fullName || data?.customer_name || 'حمید بیانک',
      firstName: data?.firstName || 'حمید',
      lastName: data?.lastName || 'بیانک',
      phone: data?.phone || data?.customer_phone || '+989991111111',
      price: data?.price || billedToman,
      paidPrice: data?.paidPrice || data?.price || billedToman,
      otherDiscounts: data?.otherDiscounts || 0,
      comment: data?.notes || data?.comment || 'اردر تست رستوران - تحویل فوری',
      vendor_notes: data?.notes || data?.vendor_notes || data?.comment || 'اردر تست رستوران - تحویل فوری',
      statusCode: data?.statusCode || 56, // 56 = New order
      deliverAddress: data?.deliverAddress || data?.address || 'تهران، زعفرانیه، ولیعصر، پلاک ۲',
      orderDate: data?.orderDate || Date.now(),
      latitude: data?.latitude || 35.804123,
      longitude: data?.longitude || 51.419917,
      deliveryPrice: deliveryToman,
      packingPrice: packingToman,
      deliveryTime: data?.deliveryTime || 48,
      preparationTime: data?.preparationTime || 15,
      taxCoeff: data?.taxCoeff || 10,
      tax: data?.tax || basketTax || 110,
      vat: data?.vat || (menuBasket ? menuBasket[0].vat : 0.10),
      expeditionType: data?.expeditionType || 'DELIVERY', // DELIVERY, ZF_EXPRESS, MIARE, PICKUP, PICK_MAN
      discountType: data?.discountType || '',
      discountValue: data?.discountValue || 0,
      newOrderDate: data?.newOrderDate || new Date().toISOString().replace('T', ' ').substring(0, 19),
      orderCoupon: data?.orderCoupon || null,
      orderPaymentTypeCode: data?.orderPaymentTypeCode || 'ONLINE', // ONLINE, CREDIT, CASH
      preOrderTime: data?.preOrderTime || null,
      vendorMaxPreparationTime: data?.vendorMaxPreparationTime || 15,
      vendorCode: data?.vendorCode || '0q54rd',
      bikerName: data?.bikerName || 'علی تهرانی',
      bikerStatusV2: data?.bikerStatusV2 || 'REQUESTED', // REQUESTED, ASSIGNED, CANCELED, ACK, AT_RESTAURANT, PICKED, DELIVERED
      products: data?.items || data?.products || menuBasket || [
        {
          id: 101,
          vmsFoodId: 101,
          title: 'پیتزای تستی ۱',
          quantity: 1,
          price: 500,
          originPrice: 500,
          originprice: 500,
          productDiscountSFShare: 0,
          productDiscountVendorShare: 0,
          discount: 0,
          vat: 0.10,
          barcode: 'BAR-101',
          toppings: [],
        },
        {
          id: 102,
          vmsFoodId: 102,
          title: 'پیتزای تستی ۲',
          quantity: 1,
          price: 600,
          originPrice: 600,
          originprice: 600,
          productDiscountSFShare: 0,
          productDiscountVendorShare: 0,
          discount: 0,
          vat: 0.10,
          barcode: 'BAR-102',
          toppings: [],
        },
      ],
      couponDiscountSfShareAmount: data?.couponDiscountSfShareAmount || 0,
      couponDiscountVendorShareAmount: data?.couponDiscountVendorShareAmount || 0,
    };

    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', 'snappfood-secret-key-123').update(rawBody).digest('hex');

    return await this.handleSnappfoodWebhook(tenantId, rawBody, payload, signature, undefined, 'snappfood-secret-key-123', correlationId);
  }

  /** One to three of the tenant's active, priced products, as Snappfood lines in Toman. */
  private async menuBasket(tenantId: string) {
    const products = (await this.productRepo.find({ where: { tenant_id: tenantId, is_active: true } })).filter((p) =>
      MoneyUtil.greaterThan(p.base_price || '0', '0'),
    );
    if (!products.length) return null;
    const picks = [...products].sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 3));
    return picks.map((p, i) => {
      const price = Number(MoneyUtil.divide(p.base_price, '10', 0));
      return {
        id: 900 + i,
        vmsFoodId: 900 + i,
        title: p.name,
        product_id: p.id,
        quantity: 1 + (i === 0 && Math.random() < 0.3 ? 1 : 0),
        price,
        originPrice: price,
        originprice: price,
        productDiscountSFShare: 0,
        productDiscountVendorShare: 0,
        discount: 0,
        vat: Number(p.tax_rate || 0),
        barcode: p.code,
        toppings: [],
      };
    });
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
    data: { order_id?: string; orderId?: string; action: 'ACK' | 'PICK' | 'ACCEPT' | 'PREPARING' | 'REJECT' | 'MODIFY' | 'DELIVERED' | 'CANCEL' | 'CANCELLED' | 'RECOVER'; reason?: string; scenarioId?: string },
    correlationId?: string,
  ) {
    const orderId = data.order_id || data.orderId;
    const order = orderId ? await this.orderRepo.findOne({ where: { id: orderId, tenant_id: tenantId } }) : null;

    const action = data.action;
    let newStatusCode = 56;
    if (order) {
      // Ack and pick only tell Snappfood the store has seen the order; it still waits
      // for acceptance, so neither moves it.
      if (action === 'ACK') {
        newStatusCode = 61; // 61 = Received by store after Ack
      } else if (action === 'PICK') {
        newStatusCode = 713; // 713 = Picked / viewed by store
      } else if (action === 'ACCEPT' || action === 'PREPARING') {
        this.markAccepted(order);
        newStatusCode = 42; // 42 = Accepted
      } else if (action === 'DELIVERED') {
        order.fulfillment_status = 'DELIVERED';
        order.state = 'COMPLETED';
        order.status = 'COMPLETED';
        newStatusCode = 42;
      } else if (action === 'REJECT') {
        this.markRejected(order);
        newStatusCode = 51; // 51 = Rejected by store
      } else if (action === 'CANCEL' || action === 'CANCELLED') {
        this.markCancelled(order);
        await this.reverseSnappfoodPayments(tenantId, order);
        newStatusCode = 54; // 54 = Cancelled
      } else if (action === 'MODIFY') {
        this.markAwaitingAcceptance(order);
        newStatusCode = 71; // 71 = Extra payment required
      } else if (action === 'RECOVER') {
        this.markAwaitingAcceptance(order);
        newStatusCode = 56;
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
        request_payload: { ...data, statusCode: newStatusCode },
        response_payload: { order_id: orderId, new_status: order ? order.status : 'PROCESSED', statusCode: newStatusCode },
      }),
    );

    const corrId = correlationId || `corr-snapp-action-${Date.now()}`;
    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: `SNAPPFOOD_ACTION_${action}`,
      correlationId: corrId,
      afterData: order || { action, statusCode: newStatusCode },
    });

    return {
      simulated: true,
      correlationId: corrId,
      success: true,
      action,
      statusCode: newStatusCode,
      order,
      log_id: savedLog.id,
    };
  }

  // --- Snappfood Restaurant Integration Annex v4.3.0 Endpoints ---

  async issueOAuthToken(body: any) {
    if (body?.grant_type !== 'password') {
      throw new BadRequestException({ status: 3001, title: 'invalid_grant', detail: 'Grant type must be password' });
    }
    if (body?.client_id === 'invalid' || body?.password === 'wrong') {
      throw new BadRequestException({ status: 3002, title: 'unauthorized_client', detail: 'Invalid Client Credentials' });
    }

    return {
      access_token: `sf_oauth2_token_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: body?.scope || 'automation',
    };
  }

  async getProductsCatalog(tenantId: string, vendorCode?: string) {
    return {
      status: true,
      data: {
        vendorCode: vendorCode || '0q54rd',
        products: [
          {
            productId: 1280,
            title: 'پیتزا۲',
            description: 'تست۱',
            position: 1,
            vat: 9,
            productCode: 'BAdQ7OdV1y',
            isActive: true,
            isReviewed: true,
            capacity: 10,
            stock: null,
            productType: [],
            price: 500,
            containerPrice: 200,
            disabled: false,
            disabledUntil: null,
            schedules: [],
            images: [],
            toppings: [
              {
                vmsFoodId: 1270,
                title: 'پنیر گودا',
                description: null,
                active: false,
                toppingGroupId: 206329,
                price: 8000,
                disabled: false,
                disabledUntil: null,
              },
            ],
            menuCategory: {
              vmsCategoryId: 153,
              categoryCode: 'qz4Pkjy2lkD',
              title: 'تست۱',
              isActive: true,
              isDeleted: false,
              isReviewed: true,
              visibility: true,
            },
          },
        ],
      },
    };
  }

  async syncCategory(tenantId: string, body: any) {
    const log = await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'CATEGORY_SYNC',
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: body,
        response_payload: { status: 200, message: 'Category synced successfully with Snappfood code' },
      }),
    );
    return { status: 200, message: 'Category ID successfully synced', log_id: log.id };
  }

  async syncProduct(tenantId: string, body: any) {
    const log = await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'PRODUCT_SYNC',
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: body,
        response_payload: { status: 200, message: 'Product synced successfully with Snappfood code' },
      }),
    );
    return { status: 200, message: 'Product ID successfully synced', log_id: log.id };
  }

  async createOrUpdateMenu(tenantId: string, body: any) {
    await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'MENU_CREATE_UPDATE',
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: body,
        response_payload: { status: 204, message: 'Successfully Updated Product Status' },
      }),
    );
    return { status: 204, message: 'Successfully Updated Menu' };
  }

  async createOrUpdateProduct(tenantId: string, body: any) {
    await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'PRODUCT_CREATE_UPDATE',
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: body,
        response_payload: { status: 204, message: 'Successfully Updated Product' },
      }),
    );
    return { status: 204, message: 'Successfully Updated Product' };
  }

  async toggleProduct(tenantId: string, body: any) {
    await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'TOGGLE_PRODUCT',
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: body,
        response_payload: { status: 204, message: 'Successfully Updated Product Status' },
      }),
    );
    return { status: 204, message: 'Successfully Updated Product Status' };
  }

  async toggleMenu(tenantId: string, body: any) {
    await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'TOGGLE_MENU',
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: body,
        response_payload: { status: 204, message: 'Successfully Updated Menu Status' },
      }),
    );
    return { status: 204, message: 'Successfully Updated Menu Status' };
  }

  async getToppingGroups(tenantId: string) {
    return {
      toppingGroups: [
        {
          id: 929,
          title: 'پنیر',
          minLimit: 0,
          maxLimit: 1,
          position: 1,
          toppings: [
            { id: 103, title: 'پنیر چدار', price: 1000 },
            { id: 104, title: 'پنیر موزارلا', price: 1000 },
          ],
        },
      ],
      productToppings: [
        { productVariationId: 30796, toppingId: 103 },
        { productVariationId: 30780, toppingId: 104 },
      ],
    };
  }

  async createToppingGroup(tenantId: string, body: any) {
    await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'CREATE_TOPPING',
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: body,
        response_payload: { status: 204, message: 'Successfully created toppings' },
      }),
    );
    return { status: 204, message: 'Successfully created toppings' };
  }

  async linkToppingsToProduct(tenantId: string, body: any) {
    await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'PRODUCT_TOPPING_LINK',
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: body,
        response_payload: { status: 204, message: 'Successfully added toppings to products' },
      }),
    );
    return { status: 204, message: 'Successfully added toppings to products' };
  }

  async updateProductDetails(tenantId: string, body: any) {
    await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'UPDATE_PRODUCT_DETAILS',
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: body,
        response_payload: { status: 200, message: 'Successfully updated' },
      }),
    );
    return { status: 200, message: 'Successfully updated' };
  }

  async assignProductImage(tenantId: string, productId: string, body: any) {
    await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'ASSIGN_PRODUCT_IMAGE',
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: { productId, body },
        response_payload: { status: 200, message: 'Successfully Updated Product Status' },
      }),
    );
    return { status: 200, message: 'Successfully Updated Product Status' };
  }

  async deleteProductImage(tenantId: string, imageCode: string) {
    await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'DELETE_PRODUCT_IMAGE',
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: { imageCode },
        response_payload: { status: 200, message: 'Successfully Updated Product Status' },
      }),
    );
    return { status: 200, message: 'Successfully Updated Product Status' };
  }

  async getVendorStatus(tenantId: string, vendorCode?: string) {
    return {
      status: true,
      data: {
        status: 'ACTIVE',
        vendorTitle: 'فقط برای تست',
        vendorCode: vendorCode || 'xxx',
      },
    };
  }

  async getVendorDeliveries(tenantId: string, vendorCode?: string) {
    return {
      status: true,
      data: [
        {
          id: 2013674,
          vendor: {
            title: 'پیتزا پرپروک (سعادت آباد)',
            code: vendorCode || '0y57dp',
          },
          districtId: null,
          deliveryFee: 19000,
          isActivated: true,
          isDeleted: false,
          newPolygon: {
            type: 'polygon',
            coordinates: [
              {
                lat: 35.790865,
                long: 51.377316,
              },
            ],
          },
        },
      ],
    };
  }

  /**
   * Snappfood's record of an order the till took while the cloud was away (protocol §17.7),
   * brought by the webhook or the pull. Snappfood owns the lines and the money, so its lines
   * replace the till's when they differ (the till's are voided, not deleted), and its money and
   * customer are applied as for any Snappfood order; its cancel (54) cancels. The branch has
   * already made the order, so nothing goes to the incoming-order queue, the kitchen or the
   * printers. A difference is flagged on the till's upload for head office to look at.
   */
  async matchTillOrder(
    tenantId: string,
    order: OrderHeader,
    statusCode: number,
    payload: any,
    via: 'WEBHOOK' | 'PULL',
    signature?: string,
    idempotencyKey?: string,
    corrId = `corr-snapp-match-${Date.now()}`,
  ): Promise<SnappfoodWebhookResult> {
    const lines = this.snappfoodLines(payload);
    const current = await this.orderItemRepo.find({ where: { tenant_id: tenantId, order_id: order.id, state: 'ACTIVE' } });
    const same = sameSnappfoodLines(
      current.map((i) => ({ product_id: i.product_id, product_name: i.product_name, quantity: i.quantity })),
      lines.map((l) => ({ product_id: l.product_id ?? null, product_name: l.product_name, quantity: l.quantity })),
    );
    if (!same) {
      const earlier = await this.orderItemRepo.count({ where: { tenant_id: tenantId, order_id: order.id } });
      await this.orderItemRepo.update({ tenant_id: tenantId, order_id: order.id, state: 'ACTIVE' }, { state: 'VOID' });
      await this.writeSnappfoodLines(tenantId, order.id, lines, earlier + 1);
    }
    const fromState = order.state;
    await this.applySnappfoodMoney(tenantId, order, payload, lines);
    await this.linkSnappfoodCustomer(tenantId, order, payload, corrId);
    order.notes = this.describeSnappfoodOrder(payload);
    const { aggregator_prep_minutes, aggregator_max_extra_minutes } = this.snappfoodTiming(payload);
    Object.assign(order, { aggregator_prep_minutes, aggregator_max_extra_minutes });
    const flags = same ? [] : ['SNAPPFOOD_DIFFERS'];
    if (statusCode === 54 && !['CANCELLED', 'COMPLETED'].includes(order.state)) {
      this.markCancelled(order);
      await this.reverseSnappfoodPayments(tenantId, order);
    }
    order.aggregator_match = 'MATCHED';
    order.aggregator_match_at = new Date();
    await this.orderRepo.save(order);

    await this.stateEventRepo.save(
      this.stateEventRepo.create({
        tenant_id: tenantId,
        order_id: order.id,
        from_state: fromState,
        to_state: order.state,
        action: 'SNAPPFOOD_MATCHED',
        reason_text: same ? null : "Snappfood's lines replaced the ones typed on the till",
        occurred_at: new Date(),
        snapshot: { via, status_code: statusCode, flags },
      } as Partial<OrderStateEvent>),
    );
    // The till's upload is the order's id (§12.4); its flags are what head office reviews.
    if (flags.length) {
      const row = await this.syncRepo.findOne({ where: { id: order.id, tenant_id: tenantId } });
      if (row) {
        row.flags = [...new Set([...(row.flags || []), ...flags])];
        row.reviewed_at = null;
        row.reviewed_by = null;
        await this.syncRepo.save(row);
      }
    }

    const log = await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: via === 'PULL' ? 'ORDER_PULLED_MATCHED' : 'ORDER_MATCHED',
        hmac_signature: signature || 'simulated-valid-hmac',
        idempotency_key: idempotencyKey || `${payload.code || payload.order_code}:${statusCode}`,
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: payload,
        response_payload: { order_id: order.id, state: order.state, flags },
      }),
    );
    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: 'SNAPPFOOD_TILL_ORDER_MATCHED',
      entityType: 'Order',
      entityId: order.id,
      branchId: order.branch_id,
      correlationId: corrId,
      afterData: { order_id: order.id, via, status_code: statusCode, flags },
    });
    return { simulated: true, correlationId: corrId, success: true, duplicate: false, order, log_id: log.id };
  }

  // The order state each Snappfood lifecycle step leaves behind. `status` is the legacy
  // twin of `state` that the kitchen display still reads.
  private markAwaitingAcceptance(order: OrderHeader) {
    order.fulfillment_status = 'PENDING';
    order.state = 'PENDING_ACCEPTANCE';
    order.status = 'PENDING_ACCEPTANCE';
  }

  private markAccepted(order: OrderHeader) {
    order.fulfillment_status = 'PREPARING';
    order.state = 'CONFIRMED';
    order.status = 'KITCHEN_PREPARING';
  }

  private markCancelled(order: OrderHeader) {
    order.fulfillment_status = 'CANCELLED';
    order.state = 'CANCELLED';
    order.status = 'CANCELLED';
  }

  // The store said no (51). Snappfood cancelling on the customer's side (54) stays CANCELLED.
  private markRejected(order: OrderHeader) {
    order.fulfillment_status = 'CANCELLED';
    order.state = 'REJECTED';
    order.status = 'REJECTED';
  }

  // Ack (61) says the store has received the order. It does not accept it.
  async ackOrder(tenantId: string, orderCode: string) {
    await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'ORDER_ACK',
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: { orderCode, statusCode: 61 },
        response_payload: { status: 204, message: 'Successfully acked' },
      }),
    );
    return { status: 204, message: 'Successfully acked', statusCode: 61 };
  }

  // Pick (713) says the store has opened the order. Like ack, it does not accept it.
  async pickOrder(tenantId: string, orderCode: string) {
    await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'ORDER_PICK',
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: { orderCode, statusCode: 713 },
        response_payload: { status: 204, message: 'Successfully picked' },
      }),
    );
    return { status: 204, message: 'Successfully picked', statusCode: 713 };
  }

  // Snappfood's accept endpoint (42): enforce its limits and log the call. It leaves the
  // local order alone; the store's own accept (OrderService) has already moved it.
  async notifyAccepted(tenantId: string, orderCode: string, body: any) {
    const deliveryTime = body?.deliveryTime || 0;
    const delta = body?.delta || 0;

    if (deliveryTime > 70) {
      throw new BadRequestException({ status: 2110, title: 'time_exceeded', detail: 'MAX deliveryTime is 70 minutes' });
    }
    if (delta > 5000) {
      throw new BadRequestException({ status: 2112, title: 'delta_exceeded', detail: 'Delta surpasses limits' });
    }

    await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'ORDER_ACCEPT',
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: { orderCode, ...body, statusCode: 42 },
        response_payload: { status: 204, message: 'Successfully accepted' },
      }),
    );
    return { status: 204, message: 'Successfully accepted', statusCode: 42 };
  }

  // The simulator's accept button plays both sides: Snappfood hears it and the order moves.
  async acceptOrder(tenantId: string, orderCode: string, body: any) {
    const res = await this.notifyAccepted(tenantId, orderCode, body);
    const order = await this.orderRepo.findOne({ where: { tenant_id: tenantId, order_number: `SNP-${orderCode}` } });
    if (order) {
      this.markAccepted(order);
      await this.orderRepo.save(order);
    }
    return res;
  }

  // Snappfood's reject endpoint (51). Like notifyAccepted, it leaves the local order alone.
  async notifyRejected(tenantId: string, orderCode: string, body: any) {
    await this.logRepo.save(
      this.logRepo.create({
        tenant_id: tenantId,
        provider: 'SNAPPFOOD',
        event_type: 'ORDER_REJECT',
        is_duplicate: false,
        status: 'SUCCESS',
        request_payload: { orderCode, ...body, statusCode: 51 },
        response_payload: { status: 204, message: 'Successfully rejected' },
      }),
    );
    return { status: 204, message: 'Successfully rejected', statusCode: 51 };
  }

  async rejectOrder(tenantId: string, orderCode: string, body: any) {
    const res = await this.notifyRejected(tenantId, orderCode, body);
    const order = await this.orderRepo.findOne({ where: { tenant_id: tenantId, order_number: `SNP-${orderCode}` } });
    if (order) {
      this.markRejected(order);
      await this.orderRepo.save(order);
    }
    return res;
  }

  async getDeclineReasons() {
    return [
      { id: 113, title: 'رستوران پیک ندارد', level: 1 },
      { id: 153, title: 'تاخیر در زمان ارسال', level: 1 },
      { id: 154, title: 'تغییر هزینه پیک', level: 2 },
    ];
  }

  async getLatestOrders(tenantId: string, body: any) {
    const logs = await this.logRepo.find({
      where: { tenant_id: tenantId, provider: 'SNAPPFOOD', event_type: 'ORDER_CREATED' },
      order: { created_at: 'DESC' },
      take: 20,
    });
    return logs.map((l) => l.request_payload);
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
