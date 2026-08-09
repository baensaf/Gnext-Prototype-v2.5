import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PriceEntry } from '../../entities/PriceEntry.entity';
import { PriceGroupBranch } from '../../entities/PriceGroupBranch.entity';
import { PriceBulkJob } from '../../entities/PriceBulkJob.entity';
import { Product } from '../../entities/Product.entity';
import { PricingService } from './pricing.service';
import { PricingController } from './pricing.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PriceEntry, PriceGroupBranch, PriceBulkJob, Product]),
    AuditModule,
  ],
  providers: [PricingService],
  controllers: [PricingController],
  exports: [PricingService],
})
export class PricingModule {}
