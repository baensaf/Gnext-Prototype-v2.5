import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { OrderItemOption } from '../../entities/OrderItemOption.entity';
import { Product } from '../../entities/Product.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { CatalogService } from '../catalog/catalog.service';
import { DiscountsService } from '../discounts/discounts.service';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(OrderHeader) private readonly headerRepo: Repository<OrderHeader>,
    @InjectRepository(OrderItem) private readonly itemRepo: Repository<OrderItem>,
    @InjectRepository(OrderItemOption) private readonly optionRepo: Repository<OrderItemOption>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(OptionItem) private readonly optionItemRepo: Repository<OptionItem>,
    @InjectRepository(OptionGroup) private readonly optionGroupRepo: Repository<OptionGroup>,
    private readonly catalogService: CatalogService,
    private readonly discountsService: DiscountsService,
    private readonly auditWriter: AuditWriter,
  ) {}

  async getOrders(tenantId: string, branchId?: string, status?: string) {
    const qb = this.headerRepo.createQueryBuilder('o')
      .leftJoinAndSelect('o.items', 'items')
      .leftJoinAndSelect('items.options', 'options')
      .where('o.tenant_id = :tenantId', { tenantId })
      .orderBy('o.placed_at', 'DESC');

    if (branchId) {
      qb.andWhere('o.branch_id = :branchId', { branchId });
    }
    if (status) {
      qb.andWhere('o.status = :status', { status });
    }

    return await qb.getMany();
  }

  async getOrderById(tenantId: string, id: string) {
    const order = await this.headerRepo.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['items', 'items.options'],
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async createOrder(
    tenantId: string,
    data: {
      branch_id: string;
      terminal_id?: string;
      order_type?: string;
      customer_id?: string;
      customer_address_id?: string;
      price_group_id?: string;
      discount_id?: string;
      coupon_code?: string;
      table_number?: string;
      notes?: string;
      items: Array<{
        product_id: string;
        quantity: number | string;
        special_instructions?: string;
        options?: Array<{ option_item_id: string }>;
      }>;
    },
    correlationId: string,
  ) {
    if (!data.items || data.items.length === 0) {
      throw new BadRequestException('Order must contain at least one line item');
    }

    const orderNumber = `ORD-${Date.now().toString().slice(-6)}`;
    let calculatedSubtotalSum = '0.0000';
    let calculatedTaxSum = '0.0000';

    const orderItems: OrderItem[] = [];

    for (const itemData of data.items) {
      const product = await this.productRepo.findOne({ where: { id: itemData.product_id, tenant_id: tenantId } });
      if (!product || !product.is_active) {
        throw new BadRequestException(`Product ${itemData.product_id} is invalid or inactive`);
      }

      // Calculate effective price using price group override if applicable
      const effectivePricing = await this.catalogService.getEffectivePrice(
        tenantId,
        product.id,
        data.price_group_id,
      );
      const unitPrice = effectivePricing.effective_price;

      // Sum option price deltas
      let optionsDeltaSum = '0.0000';
      const itemOptions: OrderItemOption[] = [];

      if (itemData.options && itemData.options.length > 0) {
        for (const optData of itemData.options) {
          const optItem = await this.optionItemRepo.findOne({ where: { id: optData.option_item_id, tenant_id: tenantId } });
          if (optItem) {
            const optGroup = await this.optionGroupRepo.findOne({ where: { id: optItem.option_group_id } });
            optionsDeltaSum = MoneyUtil.add(optionsDeltaSum, optItem.price_delta);

            const itemOption = this.optionRepo.create({
              tenant_id: tenantId,
              option_item_id: optItem.id,
              option_group_name: optGroup ? optGroup.name : 'Option',
              option_item_name: optItem.name,
              price_delta: MoneyUtil.format(optItem.price_delta),
            });
            itemOptions.push(itemOption);
          }
        }
      }

      const itemUnitPriceWithOptions = MoneyUtil.add(unitPrice, optionsDeltaSum);
      const qtyStr = itemData.quantity.toString();
      const lineSubtotal = MoneyUtil.multiply(itemUnitPriceWithOptions, qtyStr);
      const lineTax = MoneyUtil.multiply(lineSubtotal, product.tax_rate);
      const lineTotal = MoneyUtil.add(lineSubtotal, lineTax);

      calculatedSubtotalSum = MoneyUtil.add(calculatedSubtotalSum, lineSubtotal);
      calculatedTaxSum = MoneyUtil.add(calculatedTaxSum, lineTax);

      const orderItem = this.itemRepo.create({
        tenant_id: tenantId,
        product_id: product.id,
        product_name: product.name,
        unit_price: MoneyUtil.format(unitPrice),
        quantity: MoneyUtil.format(qtyStr),
        subtotal: lineSubtotal,
        tax_amount: lineTax,
        discount_amount: '0.0000',
        total_amount: lineTotal,
        special_instructions: itemData.special_instructions || null,
        options: itemOptions,
      });

      orderItems.push(orderItem);
    }

    // Apply Coupon or Discount calculation
    let calculatedDiscountAmount = '0.0000';
    if (data.coupon_code) {
      const valResult = await this.discountsService.validateCoupon(tenantId, data.coupon_code, calculatedSubtotalSum);
      calculatedDiscountAmount = valResult.calculatedAmount;
    }

    const calculatedTotalAmount = MoneyUtil.subtract(
      MoneyUtil.add(calculatedSubtotalSum, calculatedTaxSum),
      calculatedDiscountAmount,
    );

    const header = this.headerRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id,
      terminal_id: data.terminal_id || null,
      order_number: orderNumber,
      order_type: data.order_type || 'DINE_IN',
      status: 'SUBMITTED',
      customer_id: data.customer_id || null,
      customer_address_id: data.customer_address_id || null,
      price_group_id: data.price_group_id || null,
      discount_id: data.discount_id || null,
      coupon_code: data.coupon_code || null,
      subtotal_amount: calculatedSubtotalSum,
      tax_amount: calculatedTaxSum,
      discount_amount: calculatedDiscountAmount,
      total_amount: calculatedTotalAmount,
      paid_amount: '0.0000',
      due_amount: calculatedTotalAmount,
      fulfillment_status: 'PENDING',
      table_number: data.table_number || null,
      notes: data.notes || null,
      items: orderItems,
    });

    const savedHeader = await this.headerRepo.save(header);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'ORDER_PLACED',
      entityType: 'OrderHeader',
      entityId: savedHeader.id,
      correlationId,
      afterData: savedHeader,
    });

    return savedHeader;
  }

  async updateOrderStatus(
    tenantId: string,
    id: string,
    status: string,
    cancellation_reason_code_id?: string,
    correlationId?: string,
  ) {
    const order = await this.getOrderById(tenantId, id);

    const validStatuses = ['DRAFT', 'SUBMITTED', 'KITCHEN_PREPARING', 'READY', 'COMPLETED', 'CANCELLED', 'REFUNDED'];
    if (!validStatuses.includes(status)) {
      throw new BadRequestException(`Invalid order status ${status}`);
    }

    if (status === 'CANCELLED') {
      if (!cancellation_reason_code_id) {
        throw new BadRequestException('Reason code is mandatory when cancelling an order');
      }
      order.cancellation_reason_code_id = cancellation_reason_code_id;
      order.cancelled_at = new Date();
    }

    order.status = status;
    const updated = await this.headerRepo.save(order);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'ORDER_STATUS_CHANGED',
      entityType: 'OrderHeader',
      entityId: id,
      correlationId: correlationId || 'system',
      afterData: { status, cancellation_reason_code_id },
    });

    return updated;
  }
}
