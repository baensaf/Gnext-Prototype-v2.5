import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { OrderItemOption } from '../../entities/OrderItemOption.entity';
import { OrderAdjustment } from '../../entities/OrderAdjustment.entity';
import { OrderNote } from '../../entities/OrderNote.entity';
import { OrderLink } from '../../entities/OrderLink.entity';
import { OrderStateEvent } from '../../entities/OrderStateEvent.entity';
import { OrderSequence } from '../../entities/OrderSequence.entity';
import { Product } from '../../entities/Product.entity';
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { OperationalAlert } from '../../entities/OperationalAlert.entity';
import { OrderService } from './order.service';
import { OrderSequenceService } from './order-sequence.service';
import { IncomingOrderPolicyService } from './incoming-order-policy.service';
import { OrdersController } from './order.controller';
import { CatalogModule } from '../catalog/catalog.module';
import { PricingModule } from '../pricing/pricing.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { CustomerModule } from '../customer/customer.module';
import { AuditModule } from '../audit/audit.module';
import { OutboxModule } from '../outbox/outbox.module';
import { KdsModule } from '../kds/kds.module';
import { PrintingModule } from '../printing/printing.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { ApprovalModule } from '../approval/approval.module';
import { RefundModule } from '../refund/refund.module';
import { SimulationModule } from '../simulation/simulation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderHeader,
      OrderItem,
      OrderItemOption,
      OrderAdjustment,
      OrderNote,
      OrderLink,
      OrderStateEvent,
      OrderSequence,
      Product,
      ProductVariant,
      OptionItem,
      OptionGroup,
      TenantSetting,
      OperationalAlert,
    ]),
    CatalogModule,
    PricingModule,
    DiscountsModule,
    CustomerModule,
    AuditModule,
    OutboxModule,
    KdsModule,
    PrintingModule,
    DeliveryModule,
    ApprovalModule,
    RefundModule,
    // Each needs the other: orders tell Snappfood about accepts and rejects, and a Snappfood
    // order is put through the branch's acceptance policy as it lands.
    forwardRef(() => SimulationModule),
  ],
  providers: [OrderService, OrderSequenceService, IncomingOrderPolicyService],
  controllers: [OrdersController],
  exports: [OrderService, OrderSequenceService, IncomingOrderPolicyService],
})
export class OrderModule {}
