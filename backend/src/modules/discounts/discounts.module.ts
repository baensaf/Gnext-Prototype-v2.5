import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { CustomerDiscount } from '../../entities/CustomerDiscount.entity';
import { PersonalDiscountGroup } from '../../entities/PersonalDiscountGroup.entity';
import { Customer } from '../../entities/Customer.entity';
import { ApprovalRequest } from '../../entities/ApprovalRequest.entity';
import { Product } from '../../entities/Product.entity';
import { ItemDiscount } from '../../entities/ItemDiscount.entity';
import { PriceGroup } from '../../entities/PriceGroup.entity';
import { Coupon } from '../../entities/Coupon.entity';
import { CouponBatch } from '../../entities/CouponBatch.entity';
import { DiscountsService } from './discounts.service';
import { DiscountEvaluationService } from './discount-evaluation.service';
import { ItemDiscountsService } from './item-discounts.service';
import { CouponsService } from './coupons.service';
import { PersonalDiscountsService } from './personal-discounts.service';
import { DiscountsController } from './discounts.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TenantSetting,
      CustomerDiscount,
      PersonalDiscountGroup,
      Customer,
      ApprovalRequest,
      Product,
      ItemDiscount,
      PriceGroup,
      Coupon,
      CouponBatch,
    ]),
    AuditModule,
  ],
  providers: [DiscountsService, DiscountEvaluationService, ItemDiscountsService, CouponsService, PersonalDiscountsService],
  controllers: [DiscountsController],
  exports: [DiscountsService, DiscountEvaluationService, ItemDiscountsService, CouponsService, PersonalDiscountsService],
})
export class DiscountsModule {}
