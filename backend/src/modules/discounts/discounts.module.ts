import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { CustomerGroup } from '../../entities/CustomerGroup.entity';
import { CustomerGroupMember } from '../../entities/CustomerGroupMember.entity';
import { GroupDiscount } from '../../entities/GroupDiscount.entity';
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
import { CustomerGroupsService } from './customer-groups.service';
import { DiscountsController } from './discounts.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TenantSetting,
      CustomerGroup,
      CustomerGroupMember,
      GroupDiscount,
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
  providers: [DiscountsService, DiscountEvaluationService, ItemDiscountsService, CouponsService, CustomerGroupsService],
  controllers: [DiscountsController],
  exports: [DiscountsService, DiscountEvaluationService, ItemDiscountsService, CouponsService, CustomerGroupsService],
})
export class DiscountsModule {}
