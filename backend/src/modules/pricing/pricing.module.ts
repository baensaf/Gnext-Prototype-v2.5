import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PriceEntry } from '../../entities/PriceEntry.entity';
import { PriceGroupBranch } from '../../entities/PriceGroupBranch.entity';
import { PriceBulkJob } from '../../entities/PriceBulkJob.entity';
import { Product } from '../../entities/Product.entity';
import { PricingService } from './pricing.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PriceEntry, PriceGroupBranch, PriceBulkJob, Product]),
    AuditModule,
  ],
  // No controller. Price resolution is what this module is for and it is asked for it
  // in-process, by catalog.service and order.service; the five HTTP routes it used to
  // publish had no caller in the frontend and were a second home for the head-office rule
  // that the catalogue already owns.
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
