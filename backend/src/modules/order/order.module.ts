import { Module } from '@nestjs/common';
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
import { OrderService } from './order.service';
import { OrderSequenceService } from './order-sequence.service';
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
  ],
  providers: [OrderService, OrderSequenceService],
  controllers: [OrdersController],
  exports: [OrderService, OrderSequenceService],
})
export class OrderModule {}
