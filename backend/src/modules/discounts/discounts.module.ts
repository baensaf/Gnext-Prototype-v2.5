import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coupon } from '../../entities/Coupon.entity';
import { DiscountUsage } from '../../entities/DiscountUsage.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { CustomerDiscount } from '../../entities/CustomerDiscount.entity';
import { Customer } from '../../entities/Customer.entity';
import { ApprovalRequest } from '../../entities/ApprovalRequest.entity';
import { Product } from '../../entities/Product.entity';
import { DiscountsService } from './discounts.service';
import { DiscountEvaluationService } from './discount-evaluation.service';
import { DiscountsController } from './discounts.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Coupon,
      DiscountUsage,
      TenantSetting,
      CustomerDiscount,
      Customer,
      ApprovalRequest,
      Product,
    ]),
    AuditModule,
  ],
  providers: [DiscountsService, DiscountEvaluationService],
  controllers: [DiscountsController],
  exports: [DiscountsService, DiscountEvaluationService],
})
export class DiscountsModule {}
