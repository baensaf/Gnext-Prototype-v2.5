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
    ]),
    AuditModule,
    KdsModule,
    PrintingModule,
  ],
  providers: [KioskService],
  controllers: [KioskController],
  exports: [KioskService],
})
export class KioskModule {}
