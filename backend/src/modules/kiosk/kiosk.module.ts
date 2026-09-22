import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { KioskService } from './kiosk.service';
import { KioskController } from './kiosk.controller';
import { AuditModule } from '../audit/audit.module';
import { KdsModule } from '../kds/kds.module';
import { PrintingModule } from '../printing/printing.module';
import { CatalogModule } from '../catalog/catalog.module';
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { PaymentDevice } from '../../entities/PaymentDevice.entity';
import { OrderModule } from '../order/order.module';
import { PaymentModule } from '../payment/payment.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Category,
      Product,
      OptionGroup,
      OptionItem,
      ProductOptionGroup,
      Branch,
      TenantSetting,
      PaymentMethod,
      OrderHeader,
      OrderItem,
      OrderItemOption,
      Payment,
      Customer,
      ProductVariant,
      Terminal,
      PaymentDevice,
    ]),
    AuditModule,
    KdsModule,
    PrintingModule,
    CatalogModule,
    // A paid kiosk order goes to the kitchen the way a till's does, and a card goes to the
    // branch's real terminal through the payment service.
    OrderModule,
    PaymentModule,
  ],
  providers: [KioskService],
  controllers: [KioskController],
  exports: [KioskService],
})
export class KioskModule {}
