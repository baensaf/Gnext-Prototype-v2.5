import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from '../../entities/Category.entity';
import { Product } from '../../entities/Product.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { ProductOptionGroup } from '../../entities/ProductOptionGroup.entity';
import { Branch } from '../../entities/Branch.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { OrderItemOption } from '../../entities/OrderItemOption.entity';
import { Payment } from '../../entities/Payment.entity';
import { Customer } from '../../entities/Customer.entity';
import { AuditWriter } from '../audit/audit-writer.service';

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

    const identityPolicySetting = await this.settingRepo.findOne({
      where: { tenant_id: tenantId, key: 'KIOSK_CUSTOMER_IDENTITY_POLICY' },
    });

    const customerIdentityPolicy = identityPolicySetting ? String(identityPolicySetting.value) : 'OPTIONAL';

    const catalogProducts = products.map((p) => {
      const pLinks = productOptionGroups.filter((pog) => pog.product_id === p.id);
      const groups = pLinks.map((link) => {
        const og = optionGroups.find((g) => g.id === link.option_group_id);
        const items = optionItems
          .filter((i) => i.option_group_id === link.option_group_id)
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

    const identityPolicySetting = await this.settingRepo.findOne({
      where: { tenant_id: tenantId, key: 'KIOSK_CUSTOMER_IDENTITY_POLICY' },
    });
    const policy = identityPolicySetting ? String(identityPolicySetting.value) : 'OPTIONAL';

    if (policy === 'REQUIRED' && (!data.customer_phone || data.customer_phone.trim() === '')) {
      throw new ForbiddenException('Customer phone number is required by kiosk policy');
    }

    let customerId = null;
    if (data.customer_phone && data.customer_phone.trim() !== '') {
      let customer = await this.customerRepo.findOne({
        where: { tenant_id: tenantId, mobile: data.customer_phone.trim() },
      });
      if (!customer) {
        customer = this.customerRepo.create({
          tenant_id: tenantId,
          code: `CUST-${Date.now().toString().slice(-6)}`,
          first_name: data.customer_name || 'Kiosk',
          last_name: 'Guest',
          mobile: data.customer_phone.trim(),
          is_active: true,
        });
        customer = await this.customerRepo.save(customer);
      }
      customerId = customer.id;
    }

    const orderNum = `KOS-${Date.now().toString().slice(-6)}`;
    let subtotal = 0;

    const orderHeader = this.orderRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id,
      terminal_id: data.terminal_id || null,
      order_number: orderNum,
      order_type: data.order_type || 'TAKEAWAY',
      status: 'SUBMITTED',
      fulfillment_status: 'PENDING',
      customer_id: customerId,
      notes: data.notes || 'Kiosk Self-Service Order',
      subtotal_amount: '0.0000',
      tax_amount: '0.0000',
      discount_amount: '0.0000',
      total_amount: '0.0000',
      paid_amount: '0.0000',
      due_amount: '0.0000',
    });

    const savedHeader = await this.orderRepo.save(orderHeader);
    const orderItems: OrderItem[] = [];

    for (const itemInput of data.items) {
      const product = await this.productRepo.findOne({ where: { id: itemInput.product_id, tenant_id: tenantId } });
      if (!product) throw new NotFoundException(`Product ${itemInput.product_id} not found`);

      const basePrice = parseFloat(product.base_price || '0');
      let itemOptionsPrice = 0;
      const optionsToSave = [];

      if (itemInput.options && itemInput.options.length > 0) {
        for (const opt of itemInput.options) {
          const optionItem = await this.optionItemRepo.findOne({ where: { id: opt.option_item_id } });
          const optPrice = optionItem ? parseFloat(optionItem.price_delta || '0') : (opt.additional_price || 0);
          itemOptionsPrice += optPrice;

          optionsToSave.push({
            option_group_id: opt.option_group_id,
            option_item_id: opt.option_item_id,
            option_group_name: 'Option Group',
            option_item_name: optionItem ? optionItem.name : 'Option Item',
            price_delta: optPrice.toFixed(4),
          });
        }
      }

      const unitPrice = basePrice + itemOptionsPrice;
      const lineTotal = unitPrice * itemInput.quantity;
      subtotal += lineTotal;

      const orderItem = this.orderItemRepo.create({
        tenant_id: tenantId,
        order_id: savedHeader.id,
        product_id: product.id,
        product_name: product.name,
        unit_price: unitPrice.toFixed(4),
        quantity: itemInput.quantity.toFixed(4),
        subtotal: lineTotal.toFixed(4),
        tax_amount: (lineTotal * 0.09).toFixed(4),
        discount_amount: '0.0000',
        total_amount: (lineTotal * 1.09).toFixed(4),
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

    const taxAmount = subtotal * 0.09;
    const totalAmount = subtotal + taxAmount;

    savedHeader.subtotal_amount = subtotal.toFixed(4);
    savedHeader.tax_amount = taxAmount.toFixed(4);
    savedHeader.total_amount = totalAmount.toFixed(4);
    savedHeader.due_amount = totalAmount.toFixed(4);

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
    },
    correlationId?: string,
  ) {
    const order = await this.orderRepo.findOne({ where: { id: data.order_id, tenant_id: tenantId } });
    if (!order) throw new NotFoundException('Order not found');

    const totalToPay = data.amount || parseFloat(order.total_amount || '0');

    let paymentMethod = null;
    if (data.payment_method_id) {
      paymentMethod = await this.paymentMethodRepo.findOne({ where: { id: data.payment_method_id } });
    }
    if (!paymentMethod) {
      const pmList = await this.paymentMethodRepo.find({ where: { tenant_id: tenantId, is_active: true } });
      paymentMethod = pmList.find((p) => p.kind === 'NETWORK_POS' || p.kind === 'CARD') || pmList[0];
    }

    const refNum = `POS-KOS-${Date.now().toString().slice(-6)}`;

    const payment = this.paymentRepo.create({
      tenant_id: tenantId,
      order_id: order.id,
      payment_method_id: paymentMethod ? paymentMethod.id : 'default-pm',
      amount: totalToPay.toFixed(4),
      status: 'COMPLETED',
      reference_number: refNum,
      is_mobile_pos: false,
      recorded_at: new Date(),
    });

    const savedPayment = await this.paymentRepo.save(payment);

    const currentPaid = parseFloat(order.paid_amount || '0') + totalToPay;
    const currentDue = Math.max(0, parseFloat(order.total_amount || '0') - currentPaid);

    order.paid_amount = currentPaid.toFixed(4);
    order.due_amount = currentDue.toFixed(4);
    if (currentDue <= 0.01) {
      order.status = 'READY';
      order.fulfillment_status = 'PREPARING';
    }

    const updatedOrder = await this.orderRepo.save(order);

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
        header: 'GNEXT KIOSK SELF-SERVICE RECEIPT',
        order_number: updatedOrder.order_number,
        order_type: updatedOrder.order_type,
        date: new Date(),
        reference_number: refNum,
        total_paid: totalToPay.toFixed(2),
        payment_method: paymentMethod ? paymentMethod.name : 'Card Terminal',
        status: 'PAID & SENT TO KITCHEN',
      },
    };
  }
}
