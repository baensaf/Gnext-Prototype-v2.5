import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from '../../entities/Category.entity';
import { Product } from '../../entities/Product.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { ProductOptionGroup } from '../../entities/ProductOptionGroup.entity';
import { Branch } from '../../entities/Branch.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { pickSettingValue } from '../../common/utils/setting-scope.util';
import { acceptanceFor, resolveIncomingOrderPolicy } from '../../common/utils/incoming-order-policy.util';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { OrderItemOption } from '../../entities/OrderItemOption.entity';
import { Payment } from '../../entities/Payment.entity';
import { Customer } from '../../entities/Customer.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { MoneyUtil } from '../../common/utils/money.util';
import { BusinessDateUtil } from '../../common/utils/business-date.util';
import { normalizePhone } from '../customer/customer.service';
import { KdsService } from '../kds/kds.service';
import { PrintQueueService } from '../printing/print-queue.service';

/** Tenders a kiosk's card terminal can take. The seeded card method is CARD_POS. */
const KIOSK_CARD_KINDS = ['CARD_POS', 'NETWORK_POS', 'CARD', 'MOBILE_POS'];

@Injectable()
export class KioskService {
  constructor(
    @InjectRepository(Category) private readonly categoryRepo: Repository<Category>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(OptionGroup) private readonly optionGroupRepo: Repository<OptionGroup>,
    @InjectRepository(OptionItem) private readonly optionItemRepo: Repository<OptionItem>,
    @InjectRepository(ProductOptionGroup) private readonly productOptionGroupRepo: Repository<ProductOptionGroup>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    @InjectRepository(TenantSetting) private readonly settingRepo: Repository<TenantSetting>,
    @InjectRepository(PaymentMethod) private readonly paymentMethodRepo: Repository<PaymentMethod>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(OrderItem) private readonly orderItemRepo: Repository<OrderItem>,
    @InjectRepository(OrderItemOption) private readonly orderItemOptionRepo: Repository<OrderItemOption>,
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    private readonly auditWriter: AuditWriter,
    @Optional() private readonly kdsService?: KdsService,
    @Optional() private readonly printQueueService?: PrintQueueService,
  ) {}

  async getBootstrapContext(tenantId: string, branchId?: string, terminalId?: string) {
    let branch = null;
    if (branchId) {
      branch = await this.branchRepo.findOne({ where: { id: branchId, tenant_id: tenantId } });
    } else {
      const branches = await this.branchRepo.find({ where: { tenant_id: tenantId, is_active: true } });
      branch = branches[0] || null;
    }

    const categories = await this.categoryRepo.find({
      where: { tenant_id: tenantId, is_active: true },
      order: { sort_order: 'ASC', name: 'ASC' },
    });

    const products = await this.productRepo.find({
      where: { tenant_id: tenantId, is_active: true },
      order: { name: 'ASC' },
    });

    const optionGroups = await this.optionGroupRepo.find({
      where: { tenant_id: tenantId },
    });

    const optionItems = await this.optionItemRepo.find({
      where: { tenant_id: tenantId },
    });

    const productOptionGroups = await this.productOptionGroupRepo.find();

    const paymentMethods = await this.paymentMethodRepo.find({
      where: { tenant_id: tenantId, is_active: true },
      order: { sort_order: 'ASC' },
    });

    const identityPolicyRows = await this.settingRepo.find({
      where: { tenant_id: tenantId, key: 'KIOSK_CUSTOMER_IDENTITY_POLICY' },
    });
    // Resolved against the branch this kiosk is standing in, so a site that asks for a
    // phone number can differ from one that does not.
    const identityPolicyValue = pickSettingValue(identityPolicyRows, branch?.id);

    const customerIdentityPolicy =
      identityPolicyValue !== undefined ? String(identityPolicyValue) : 'OPTIONAL';

    const catalogProducts = products.map((p) => {
      const pLinks = productOptionGroups.filter((pog) => pog.product_id === p.id);
      const groups = pLinks.map((link) => {
        const og = optionGroups.find((g) => g.id === link.option_group_id);
        const items = optionItems
          // Items this product leaves out of the group are not offered on it.
          .filter((i) => i.option_group_id === link.option_group_id && !(link.excluded_item_ids || []).includes(i.id))
          .map((i) => ({ ...i, price: i.price_delta }));
        return {
          ...og,
          items,
        };
      }).filter((g) => g.id);

      return {
        ...p,
        option_groups: groups,
      };
    });

    return {
      channel: 'KIOSK',
      terminal_id: terminalId || null,
      branch: branch
        ? { id: branch.id, code: branch.code, name: branch.name, currency_code: branch.currency_code || 'USD' }
        : null,
      customer_identity_policy: customerIdentityPolicy,
      simulatedCapabilities: {
        simulated_card_terminal: true,
        simulated_receipt_printer: true,
      },
      categories,
      products: catalogProducts,
      payment_methods: paymentMethods.map((pm) => ({
        id: pm.id,
        code: pm.code,
        name: pm.name,
        kind: pm.kind,
      })),
    };
  }

  async createKioskOrder(
    tenantId: string,
    data: {
      branch_id: string;
      terminal_id?: string;
      order_type: 'DINE_IN' | 'TAKEAWAY';
      customer_name?: string;
      customer_phone?: string;
      idempotency_key?: string;
      items: Array<{
        product_id: string;
        quantity: number;
        unit_price?: number;
        notes?: string;
        options?: Array<{
          option_group_id: string;
          option_item_id: string;
          additional_price?: number;
        }>;
      }>;
      notes?: string;
    },
    correlationId?: string,
  ) {
    if (!data.items || data.items.length === 0) {
      throw new BadRequestException('Kiosk order must contain at least one item');
    }

    // Idempotency check: if an order with same idempotency key exists, return it
    if (data.idempotency_key && data.idempotency_key.trim() !== '') {
      const existing = await this.orderRepo.findOne({
        where: [
          { tenant_id: tenantId, channel: 'KIOSK', order_number: data.idempotency_key },
          { tenant_id: tenantId, channel: 'KIOSK', notes: `IDEM:${data.idempotency_key}` },
        ],
        relations: ['items', 'items.options'],
      });
      if (existing) return existing;
    }

    // Resolved against the branch this kiosk is standing in, exactly as the config
    // endpoint above does. Asking for one row and taking whichever came back meant the
    // screen could promise an optional phone number and the submit then refuse the order,
    // or the reverse — the two paths were reading different branches' rules.
    const identityPolicyRows = await this.settingRepo.find({
      where: { tenant_id: tenantId, key: 'KIOSK_CUSTOMER_IDENTITY_POLICY' },
    });
    const identityPolicyValue = pickSettingValue(identityPolicyRows, data.branch_id);
    const policy = identityPolicyValue !== undefined ? String(identityPolicyValue) : 'OPTIONAL';

    if (policy === 'REQUIRED' && (!data.customer_phone || data.customer_phone.trim() === '')) {
      throw new ForbiddenException('Customer phone number is required by kiosk policy');
    }

    let customerId = null;
    if (data.customer_phone && data.customer_phone.trim() !== '') {
      const rawPhone = data.customer_phone.trim();
      const normPhone = normalizePhone(rawPhone) || rawPhone;
      let customer = await this.customerRepo.findOne({
        where: [
          { tenant_id: tenantId, mobile: rawPhone },
          { tenant_id: tenantId, mobile: normPhone },
          { tenant_id: tenantId, code: normPhone },
        ],
      });
      if (!customer) {
        customer = this.customerRepo.create({
          tenant_id: tenantId,
          code: normPhone,
          first_name: data.customer_name || 'Kiosk',
          last_name: 'Guest',
          mobile: normPhone,
          is_active: true,
        });
        customer = await this.customerRepo.save(customer);
      }
      customerId = customer.id;
    }

    // A branch may make kiosk orders wait for staff like Snappfood ones. By default they go
    // straight into the kitchen queue, as they always have.
    const workflowRows = await this.settingRepo.find({
      where: { tenant_id: tenantId, key: 'ORDER_WORKFLOW' },
    });
    const incomingPolicy = resolveIncomingOrderPolicy(pickSettingValue(workflowRows, data.branch_id));
    const initialState = acceptanceFor(incomingPolicy, 'KIOSK') === 'MANUAL' ? 'PENDING_ACCEPTANCE' : 'SUBMITTED';

    const orderNum = `KOS-${Date.now().toString().slice(-6)}`;
    let subtotal = 0;

    const orderHeader = this.orderRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id,
      terminal_id: data.terminal_id || null,
      order_number: orderNum,
      channel: 'KIOSK',
      order_type: data.order_type || 'TAKEAWAY',
      state: initialState as any,
      status: initialState,
      fulfillment_status: 'PENDING',
      customer_id: customerId,
      notes: data.idempotency_key ? `IDEM:${data.idempotency_key}` : (data.notes || 'Kiosk Self-Service Order'),
      subtotal: '0.0000',
      subtotal_amount: '0.0000',
      tax_total: '0.0000',
      tax_amount: '0.0000',
      discount_total: '0.0000',
      discount_amount: '0.0000',
      grand_total: '0.0000',
      total_amount: '0.0000',
      paid_total: '0.0000',
      paid_amount: '0.0000',
      outstanding_total: '0.0000',
      due_amount: '0.0000',
    });

    const savedHeader = await this.orderRepo.save(orderHeader);
    const orderItems: OrderItem[] = [];
    let subtotalStr = '0.0000';

    for (const itemInput of data.items) {
      const product = await this.productRepo.findOne({ where: { id: itemInput.product_id, tenant_id: tenantId } });
      if (!product) throw new NotFoundException(`Product ${itemInput.product_id} not found`);

      // Authoritative pricing: Ignore any client-supplied unit_price or additional_price
      const basePriceStr = product.base_price || '0.0000';
      let itemOptionsPriceStr = '0.0000';
      const optionsToSave = [];

      if (itemInput.options && itemInput.options.length > 0) {
        for (const opt of itemInput.options) {
          const optionItem = await this.optionItemRepo.findOne({ where: { id: opt.option_item_id } });
          const optPriceStr = optionItem ? MoneyUtil.format(optionItem.price_delta || '0', 4) : '0.0000';
          itemOptionsPriceStr = MoneyUtil.add(itemOptionsPriceStr, optPriceStr, 4);

          optionsToSave.push({
            option_group_id: opt.option_group_id,
            option_item_id: opt.option_item_id,
            option_group_name: 'Option Group',
            option_item_name: optionItem ? optionItem.name : 'Option Item',
            price_delta: optPriceStr,
          });
        }
      }

      const unitPriceStr = MoneyUtil.add(basePriceStr, itemOptionsPriceStr, 4);
      const lineTotalStr = MoneyUtil.multiply(unitPriceStr, itemInput.quantity, 4);
      subtotalStr = MoneyUtil.add(subtotalStr, lineTotalStr, 4);

      const orderItem = this.orderItemRepo.create({
        tenant_id: tenantId,
        order_id: savedHeader.id,
        product_id: product.id,
        product_name: product.name,
        unit_price: unitPriceStr,
        quantity: MoneyUtil.format(itemInput.quantity, 4),
        subtotal: lineTotalStr,
        tax_amount: MoneyUtil.multiply(lineTotalStr, '0.09', 4),
        discount_amount: '0.0000',
        total_amount: MoneyUtil.multiply(lineTotalStr, '1.09', 4),
        special_instructions: itemInput.notes || null,
      });

      const savedItem = await this.orderItemRepo.save(orderItem);

      for (const optData of optionsToSave) {
        const itemOption = this.orderItemOptionRepo.create({
          tenant_id: tenantId,
          order_item_id: savedItem.id,
          ...optData,
        });
        await this.orderItemOptionRepo.save(itemOption);
      }

      orderItems.push(savedItem);
    }

    const taxAmountStr = MoneyUtil.multiply(subtotalStr, '0.09', 4);
    const totalAmountStr = MoneyUtil.add(subtotalStr, taxAmountStr, 4);

    savedHeader.subtotal = subtotalStr;
    savedHeader.subtotal_amount = subtotalStr;
    savedHeader.tax_total = taxAmountStr;
    savedHeader.tax_amount = taxAmountStr;
    savedHeader.discount_total = '0.0000';
    savedHeader.discount_amount = '0.0000';
    savedHeader.grand_total = totalAmountStr;
    savedHeader.total_amount = totalAmountStr;
    savedHeader.outstanding_total = totalAmountStr;
    savedHeader.due_amount = totalAmountStr;
    savedHeader.paid_total = '0.0000';
    savedHeader.paid_amount = '0.0000';

    const finalOrder = await this.orderRepo.save(savedHeader);

    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: 'KIOSK_ORDER_CREATED',
      correlationId: correlationId || 'corr-kiosk-order',
      afterData: { order_id: finalOrder.id, order_number: finalOrder.order_number, total: finalOrder.total_amount },
    });

    return { ...finalOrder, items: orderItems };
  }

  async processKioskPayment(
    tenantId: string,
    data: {
      order_id: string;
      payment_method_id?: string;
      amount?: number;
      terminal_id?: string;
      idempotency_key?: string;
    },
    correlationId?: string,
  ) {
    const order = await this.orderRepo.findOne({ where: { id: data.order_id, tenant_id: tenantId } });
    if (!order) throw new NotFoundException('Order not found');

    const waitsForStaff = order.state === 'PENDING_ACCEPTANCE';
    const receiptStatus = waitsForStaff ? 'PAID & WAITING FOR STAFF' : 'PAID & SENT TO KITCHEN';

    // Idempotency check: if order is already paid, return existing payment & receipt
    if (MoneyUtil.lessThanOrEqual(order.outstanding_total ?? order.due_amount ?? '0', '0.01')) {
      const existingPayment = await this.paymentRepo.findOne({
        where: { tenant_id: tenantId, order_id: order.id },
        order: { initiated_at: 'DESC' },
      });

      return {
        success: true,
        payment: existingPayment,
        order,
        receipt: {
          header: 'GNEXT KIOSK SELF-SERVICE RECEIPT (SIMULATED CARD TERMINAL)',
          order_number: order.order_number,
          order_type: order.order_type,
          date: new Date(),
          reference_number: existingPayment ? existingPayment.reference : `POS-KOS-${order.id.slice(-6)}`,
          total_paid: MoneyUtil.format(order.total_amount || '0', 2),
          payment_method: 'Simulated Card Terminal',
          status: receiptStatus,
          hardware_status: 'SIMULATED NETWORK POS OK',
        },
      };
    }

    const totalToPayStr = MoneyUtil.format(order.outstanding_total || order.due_amount || order.total_amount || '0', 4);

    let paymentMethod = null;
    if (data.payment_method_id) {
      paymentMethod = await this.paymentMethodRepo.findOne({ where: { id: data.payment_method_id, tenant_id: tenantId } });
    }
    if (!paymentMethod) {
      // A kiosk only has a card terminal. Falling back to the first active method used to
      // book every kiosk sale as CASH, because the seeded card method is kind CARD_POS and
      // this looked only for NETWORK_POS or CARD.
      const pmList = await this.paymentMethodRepo.find({ where: { tenant_id: tenantId, is_active: true } });
      paymentMethod = pmList.find((p) => KIOSK_CARD_KINDS.includes(p.kind));
    }
    if (!paymentMethod) {
      throw new BadRequestException('No active card payment method is set up for the kiosk terminal');
    }

    const refNum = `POS-KOS-${Date.now()}`;

    const payment = this.paymentRepo.create({
      tenant_id: tenantId,
      order_id: order.id,
      payment_number: `PAY-KOS-${Date.now()}`,
      method_id: paymentMethod.id,
      method_kind: paymentMethod.kind,
      amount: totalToPayStr,
      status: 'SUCCEEDED',
      reference: refNum,
      business_date: BusinessDateUtil.today(),
      idempotency_key: data.idempotency_key || null,
    });

    const savedPayment = await this.paymentRepo.save(payment);

    const currentPaidStr = MoneyUtil.add(order.paid_total || order.paid_amount || '0', totalToPayStr, 4);
    const rawDueStr = MoneyUtil.subtract(order.grand_total || order.total_amount || '0', currentPaidStr, 4);
    const currentDueStr = MoneyUtil.lessThan(rawDueStr, '0') ? '0.0000' : rawDueStr;

    // paid_total and outstanding_total are what the rest of the system reads; writing only
    // the legacy paid_amount/due_amount left every kiosk order looking unpaid.
    order.paid_total = currentPaidStr;
    order.paid_amount = currentPaidStr;
    order.outstanding_total = currentDueStr;
    order.due_amount = currentDueStr;
    // A paid kiosk order is confirmed and still has to be cooked. It used to jump to READY,
    // which the kitchen never picks up, so no ticket was ever made. An order the branch
    // wants accepted by staff stays waiting; accepting it sends it to the kitchen then.
    if (!waitsForStaff) {
      order.state = 'CONFIRMED' as any;
      order.status = 'CONFIRMED';
      order.submitted_at = order.submitted_at || new Date();
    }

    const updatedOrder = await this.orderRepo.save(order);

    if (!waitsForStaff) {
      try {
        await this.kdsService?.generateTicketsForOrder(tenantId, order.id, correlationId);
      } catch {
        // A kitchen-screen failure must not undo a payment the guest has already made.
      }
      try {
        await this.printQueueService?.enqueueOrderPrintJobs(tenantId, order.id, 'CUSTOMER_RECEIPT', false);
        await this.printQueueService?.enqueueOrderPrintJobs(tenantId, order.id, 'KITCHEN_TICKET', false);
      } catch {
        // Printing is a side effect of the sale, as it is at the register.
      }
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: 'KIOSK_PAYMENT_PROCESSED',
      correlationId: correlationId || 'corr-kiosk-pay',
      afterData: { payment_id: savedPayment.id, reference_number: refNum, order_id: order.id },
    });

    return {
      success: true,
      payment: savedPayment,
      order: updatedOrder,
      receipt: {
        header: 'GNEXT KIOSK SELF-SERVICE RECEIPT (SIMULATED CARD TERMINAL)',
        order_number: updatedOrder.order_number,
        order_type: updatedOrder.order_type,
        date: new Date(),
        reference_number: refNum,
        total_paid: MoneyUtil.format(totalToPayStr, 2),
        payment_method: paymentMethod.name,
        status: receiptStatus,
        hardware_status: 'SIMULATED NETWORK POS OK',
      },
    };
  }
}
