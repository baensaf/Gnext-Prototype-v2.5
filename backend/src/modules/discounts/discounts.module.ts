import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Discount } from '../../entities/Discount.entity';
import { Coupon } from '../../entities/Coupon.entity';
import { DiscountsService } from './discounts.service';
import { DiscountsController } from './discounts.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Discount, Coupon]),
    AuditModule,
  ],
  providers: [DiscountsService],
  controllers: [DiscountsController],
  exports: [DiscountsService],
})
export class DiscountsModule {}
