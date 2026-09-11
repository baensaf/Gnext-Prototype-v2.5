import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Product } from '../../entities/Product.entity';
import { Branch, SELLING_BRANCH_TYPES } from '../../entities/Branch.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { MoneyUtil } from '../../common/utils/money.util';

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
    const branchId = await this.resolveWebhookBranch(tenantId, payload);

    const orderNum = `SNP-${payload.order_code || payload.event_id || '1001'}`;
    const itemsInput = payload.items || [
      { product_name: 'Snappfood Combo Meal', quantity: 1, price: 15.0 },
    ];

    let subtotalStr = '0.0000';
    for (const item of itemsInput) {
      const priceStr = MoneyUtil.format(item.price || '15.0', 4);
      const qtyStr = MoneyUtil.format(item.quantity || 1, 4);
      const lineTotalStr = MoneyUtil.multiply(priceStr, qtyStr, 4);
      subtotalStr = MoneyUtil.add(subtotalStr, lineTotalStr, 4);
    }
    const taxAmountStr = MoneyUtil.multiply(subtotalStr, '0.09', 4);
    const totalAmountStr = MoneyUtil.add(subtotalStr, taxAmountStr, 4);

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
      notes: `Snappfood Order [Code: ${payload.order_code || 'SNP-001'}]. Vendor Notes: ${payload.vendor_notes || payload.comment || 'None'}`,
      subtotal: subtotalStr,
      subtotal_amount: subtotalStr,
      tax_total: taxAmountStr,
      tax_amount: taxAmountStr,
      discount_total: '0.0000',
      discount_amount: '0.0000',
      grand_total: totalAmountStr,
      total_amount: totalAmountStr,
      paid_total: totalAmountStr,
      paid_amount: totalAmountStr,
      outstanding_total: '0.0000',
      due_amount: '0.0000',
    });

    const savedHeader = await this.orderRepo.save(orderHeader);

    for (const item of itemsInput) {
      const priceStr = MoneyUtil.format(item.price || '15.0', 4);
      const qtyStr = MoneyUtil.format(item.quantity || 1, 4);
      const lineTotalStr = MoneyUtil.multiply(priceStr, qtyStr, 4);

      const orderItem = this.orderItemRepo.create({
        tenant_id: tenantId,
        order_id: savedHeader.id,
        line_number: 1,
        product_id: item.product_id || '00000000-0000-0000-0000-000000000001',
        product_name: item.product_name || 'Snappfood Item',
        unit_price: priceStr,
        quantity: qtyStr,
        base_total: lineTotalStr,
        subtotal: lineTotalStr,
        modifier_total: '0.0000',
        discount_total: '0.0000',
        discount_amount: '0.0000',
        tax_total: MoneyUtil.multiply(lineTotalStr, '0.09', 4),
        tax_amount: MoneyUtil.multiply(lineTotalStr, '0.09', 4),
        packaging_total: '0.0000',
        line_total: lineTotalStr,
        total_amount: MoneyUtil.multiply(lineTotalStr, '1.09', 4),
        special_instructions: item.notes || null,
        state: 'ACTIVE',
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
    const eventId = data?.event_id || data?.code || `snapp-evt-${seed}`;
    const orderCode = data?.order_code || data?.code || `SF-${seed}`;
    
    // v4.3.0 compliant payload construction
    const payload = {
      code: orderCode,
      event_id: eventId,
      order_code: orderCode,
      userCode: data?.userCode || 'usr-668v86',
      userAddressCode: data?.userAddressCode || 'addr-45oonn',
      fullName: data?.fullName || data?.customer_name || 'حمید بیانک',
      firstName: data?.firstName || 'حمید',
      lastName: data?.lastName || 'بیانک',
      phone: data?.phone || data?.customer_phone || '+989991111111',
      price: data?.price || 1910,
      paidPrice: data?.paidPrice || data?.price || 1910,
      otherDiscounts: data?.otherDiscounts || 0,
      comment: data?.notes || data?.comment || 'اردر تست رستوران - تحویل فوری',
      vendor_notes: data?.notes || data?.vendor_notes || data?.comment || 'اردر تست رستوران - تحویل فوری',
      statusCode: data?.statusCode || 56, // 56 = New order
      deliverAddress: data?.deliverAddress || data?.address || 'تهران، زعفرانیه، ولیعصر، پلاک ۲',
      orderDate: data?.orderDate || Date.now(),
      latitude: data?.latitude || 35.804123,
      longitude: data?.longitude || 51.419917,
      deliveryPrice: data?.deliveryPrice || 500,
      packingPrice: data?.packingPrice || 200,
      deliveryTime: data?.deliveryTime || 48,
      preparationTime: data?.preparationTime || 15,
      taxCoeff: data?.taxCoeff || 10,
      tax: data?.tax || 110,
      vat: data?.vat || 0.10,
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
      products: data?.items || data?.products || [
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
        this.markCancelled(order);
        newStatusCode = 51; // 51 = Rejected by store
      } else if (action === 'CANCEL' || action === 'CANCELLED') {
        this.markCancelled(order);
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

  async acceptOrder(tenantId: string, orderCode: string, body: any) {
    const deliveryTime = body?.deliveryTime || 0;
    const riderPickupTime = body?.riderPickupTime || 0;
    const delta = body?.delta || 0;

    if (deliveryTime > 70) {
      throw new BadRequestException({ status: 2110, title: 'time_exceeded', detail: 'MAX deliveryTime is 70 minutes' });
    }
    if (delta > 5000) {
      throw new BadRequestException({ status: 2112, title: 'delta_exceeded', detail: 'Delta surpasses limits' });
    }

    const order = await this.orderRepo.findOne({ where: { tenant_id: tenantId, order_number: `SNP-${orderCode}` } });
    if (order) {
      this.markAccepted(order);
      await this.orderRepo.save(order);
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

  async rejectOrder(tenantId: string, orderCode: string, body: any) {
    const order = await this.orderRepo.findOne({ where: { tenant_id: tenantId, order_number: `SNP-${orderCode}` } });
    if (order) {
      this.markCancelled(order);
      await this.orderRepo.save(order);
    }

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
