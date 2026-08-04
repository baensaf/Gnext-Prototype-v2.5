import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { OrderItemOption } from '../../entities/OrderItemOption.entity';
import { Product } from '../../entities/Product.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { CatalogModule } from '../catalog/catalog.module';
import { DiscountsModule } from '../discounts/discounts.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderHeader,
      OrderItem,
      OrderItemOption,
      Product,
      OptionItem,
      OptionGroup,
    ]),
    CatalogModule,
    DiscountsModule,
    AuditModule,
  ],
  providers: [OrderService],
  controllers: [OrderController],
  exports: [OrderService],
})
export class OrderModule {}
