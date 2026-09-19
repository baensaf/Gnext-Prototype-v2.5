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
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { CatalogService } from '../catalog/catalog.service';
import { PriceListService } from '../catalog/price-lists.service';
import { inStorePrice } from '../../common/utils/price-list.util';
import { checkOptionChoices } from '../catalog/option-choices.util';

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
    @InjectRepository(ProductVariant) private readonly variantRepo: Repository<ProductVariant>,
    private readonly auditWriter: AuditWriter,
    private readonly catalogService: CatalogService,
    private readonly priceLists: PriceListService,
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

    const productOptionGroups = await this.productOptionGroupRepo.find({ where: { tenant_id: tenantId } });

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

    // What is off at this branch right now: 86'd, outside its selling window or sold out.
    const off = await this.catalogService.getUnavailableNow(tenantId, branch?.id);
    const variants = await this.variantRepo.find({
      where: { tenant_id: tenantId, is_active: true },
      order: { sort_order: 'ASC', code: 'ASC' },
    });

    // The price this branch charges (its price list's, else base), so the screen shows what
    // the order will cost.
    const listed = await this.priceLists.pricesForBranch(tenantId, branch?.id);

    const catalogProducts = products.map((p) => {
      const pLinks = productOptionGroups.filter((pog) => pog.product_id === p.id);
      const groups = pLinks.map((link) => {
        const og = optionGroups.find((g) => g.id === link.option_group_id);
        const items = optionItems
          // Items this product leaves out of the group, and add-ons off today, are not offered.
          .filter((i) => i.option_group_id === link.option_group_id && !(link.excluded_item_ids || []).includes(i.id))
          .filter((i) => !off.optionItems.has(i.id) && !(i.product_id && off.products.has(i.product_id)))
          .map((i) => ({ ...i, price: i.price_delta }));
        return {
          ...og,
          items,
        };
      }).filter((g) => g.id);

      const own = variants.filter((v) => v.product_id === p.id);
      const onSale = own.filter((v) => !off.products.has(p.id) && !off.variants.has(v.id));
      return {
        ...p,
        price: inStorePrice(listed, p, null),
        option_groups: groups,
        variants: onSale.map((v) => ({ ...v, price: inStorePrice(listed, p, v) })),
        // Stays on the screen greyed out, so a guest sees it exists but is off today.
        is_available: !off.products.has(p.id) && (own.length === 0 || onSale.length > 0),
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

  /**
   * The basket, checked and priced from the catalog. A client-sent price is ignored: the line
   * costs its size's price (else the product's) plus each add-on's. Refuses anything the
   * register would refuse — an item off sale or sold out, a missing size, an add-on that is
   * not offered or a required choice left empty. The selling rules (stops, windows, stock)
   * run in `createKioskOrder`, inside the transaction that saves the order.
   */
  private async priceKioskLines(
    tenantId: string,
    branchId: string,
    items: Array<{ product_id: string; variant_id?: string; quantity: number; notes?: string; options?: Array<{ option_item_id: string }> }>,
  ) {
    const refuse = (code: string, message: string) => new BadRequestException({ statusCode: 400, code, message });
    const lines = [];
    for (const input of items) {
      const product = await this.productRepo.findOne({ where: { id: input.product_id, tenant_id: tenantId } });
      if (!product) throw new NotFoundException(`Product ${input.product_id} not found`);
      if (product.is_active === false) throw refuse('PRODUCT_INACTIVE', `${product.name} is not on the menu`);

      const quantity = Number(input.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) throw refuse('INVALID_QUANTITY', 'A quantity is a whole number, 1 or more');

      const sizes = (await this.variantRepo.find({ where: { tenant_id: tenantId, product_id: product.id, is_active: true } })) || [];
      let variant: ProductVariant | null = null;
      if (input.variant_id) {
        variant = sizes.find((v) => v.id === input.variant_id) || null;
        if (!variant) throw refuse('VARIANT_NOT_FOUND', `That size of ${product.name} is not available`);
      } else if (sizes.length > 0) {
        throw refuse('VARIANT_REQUIRED', `Pick a size or type of ${product.name}`);
      }

      const optionItems: OptionItem[] = [];
      for (const opt of input.options || []) {
        const item = await this.optionItemRepo.findOne({ where: { id: opt.option_item_id, tenant_id: tenantId } });
        if (!item) throw refuse('OPTION_NOT_FOUND', `An add-on on ${product.name} is no longer offered`);
        optionItems.push(item);
      }
      const links = (await this.productOptionGroupRepo.find({ where: { tenant_id: tenantId, product_id: product.id } })) || [];
      const groups = links.length
        ? ((await this.optionGroupRepo.find({ where: { tenant_id: tenantId } })) || []).filter((g) => links.some((l) => l.option_group_id === g.id))
        : [];
      const groupNames = checkOptionChoices(product, links, groups, optionItems);

      const unitPrice = await this.priceLists.resolveInStorePrice(tenantId, branchId, product, variant);
      const quantityStr = MoneyUtil.format(quantity, 4);
      const delta = optionItems.reduce((sum, i) => MoneyUtil.add(sum, i.price_delta || '0', 4), '0.0000');
      lines.push({
        product,
        variant,
        quantity: quantityStr,
        count: quantity,
        unitPrice,
        baseTotal: MoneyUtil.multiply(unitPrice, quantityStr, 4),
        modifierTotal: MoneyUtil.multiply(delta, quantityStr, 4),
        notes: input.notes,
        optionItems,
        options: optionItems.map((i) => ({
          option_item_id: i.id,
          option_group_name: groupNames.get(i.option_group_id) || '',
          option_item_name: i.name,
          price_delta: MoneyUtil.format(i.price_delta || '0', 4),
        })),
      });
    }

    return lines;
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
        variant_id?: string;
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

    // Everything the guest picked is checked, and priced from the catalog, before anything is
    // saved: the same rules as the register, so a stopped, sold-out or incomplete item cannot
    // reach the kitchen from the kiosk either.
    const lines = await this.priceKioskLines(tenantId, data.branch_id, data.items);

    // Checked again, and saved, in one transaction: the day's stock counts stay locked until
    // the order is in, so two kiosks (or a kiosk and a register) cannot both sell the last unit.
    const { finalOrder, orderItems } = await this.orderRepo.manager.transaction(async (em) => {
      await this.catalogService.assertBasketSellable(
        tenantId,
        data.branch_id,
        lines.map((l) => ({ product: l.product, variantId: l.variant?.id || null, quantity: l.count, optionItems: l.optionItems })),
        new Date(),
        em,
      );
      const orderRepo = em.getRepository(OrderHeader);
      const orderItemRepo = em.getRepository(OrderItem);
      const orderItemOptionRepo = em.getRepository(OrderItemOption);
      const customerRepo = em.getRepository(Customer);

      let customerId = null;
      if (data.customer_phone && data.customer_phone.trim() !== '') {
        const rawPhone = data.customer_phone.trim();
        const normPhone = normalizePhone(rawPhone) || rawPhone;
        let customer = await customerRepo.findOne({
          where: [
            { tenant_id: tenantId, mobile: rawPhone },
            { tenant_id: tenantId, mobile: normPhone },
            { tenant_id: tenantId, code: normPhone },
          ],
        });
        if (!customer) {
          customer = customerRepo.create({
            tenant_id: tenantId,
            code: normPhone,
            first_name: data.customer_name || 'Kiosk',
            last_name: 'Guest',
            mobile: normPhone,
            is_active: true,
          });
          customer = await customerRepo.save(customer);
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

      const orderHeader = orderRepo.create({
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

      const savedHeader = await orderRepo.save(orderHeader);
      const orderItems: OrderItem[] = [];
      let subtotalStr = '0.0000';

      let taxAmountStr = '0.0000';
      let lineNumber = 1;

      for (const line of lines) {
        const lineTotalStr = MoneyUtil.add(line.baseTotal, line.modifierTotal, 4);
        // VAT at the product's own rate, as on the register.
        const lineTaxStr = MoneyUtil.multiply(lineTotalStr, line.product.tax_rate || '0.0000', 4);
        subtotalStr = MoneyUtil.add(subtotalStr, lineTotalStr, 4);
        taxAmountStr = MoneyUtil.add(taxAmountStr, lineTaxStr, 4);

        const orderItem = orderItemRepo.create({
          tenant_id: tenantId,
          order_id: savedHeader.id,
          line_number: lineNumber++,
          product_id: line.product.id,
          product_code: line.product.code,
          product_name: line.product.name,
          variant_id: line.variant?.id || null,
          variant_name: line.variant?.name || null,
          unit_price: line.unitPrice,
          quantity: line.quantity,
          base_total: line.baseTotal,
          modifier_total: line.modifierTotal,
          subtotal: lineTotalStr,
          line_total: lineTotalStr,
          tax_amount: lineTaxStr,
          discount_amount: '0.0000',
          total_amount: MoneyUtil.add(lineTotalStr, lineTaxStr, 4),
          notes: line.notes || null,
          special_instructions: line.notes || null,
        });

        const savedItem = await orderItemRepo.save(orderItem);

        for (const optData of line.options) {
          const itemOption = orderItemOptionRepo.create({
            tenant_id: tenantId,
            order_item_id: savedItem.id,
            ...optData,
          });
          await orderItemOptionRepo.save(itemOption);
        }

        orderItems.push(savedItem);
      }

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

      const finalOrder = await orderRepo.save(savedHeader);
      return { finalOrder, orderItems };
    });

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
