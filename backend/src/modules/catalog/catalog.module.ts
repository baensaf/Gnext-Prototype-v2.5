import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../../entities/Category.entity';
import { Product } from '../../entities/Product.entity';
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { ProductOptionGroup } from '../../entities/ProductOptionGroup.entity';
import { PriceGroup } from '../../entities/PriceGroup.entity';
import { PriceGroupBranch } from '../../entities/PriceGroupBranch.entity';
import { PriceEntry } from '../../entities/PriceEntry.entity';
import { ProductAvailability } from '../../entities/ProductAvailability.entity';
import { AvailabilitySchedule } from '../../entities/AvailabilitySchedule.entity';
import { Branch } from '../../entities/Branch.entity';
import { BranchOperatingHour } from '../../entities/BranchOperatingHour.entity';
import { DailyStock } from '../../entities/DailyStock.entity';
import { NoteTemplate } from '../../entities/NoteTemplate.entity';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { PriceListService } from './price-lists.service';
import { PriceChangeService } from './price-changes.service';
import { StopReportService } from './stop-report.service';
import { NoteTemplateService } from './note-template.service';
import { PriceBulkJob } from '../../entities/PriceBulkJob.entity';
import { AuditEvent } from '../../entities/AuditEvent.entity';
import { AuditModule } from '../audit/audit.module';
import { ApprovalModule } from '../approval/approval.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Category,
      Product,
      ProductVariant,
      OptionGroup,
      OptionItem,
      ProductOptionGroup,
      PriceGroup,
      PriceGroupBranch,
      PriceEntry,
      PriceBulkJob,
      AuditEvent,
      ProductAvailability,
      AvailabilitySchedule,
      Branch,
      BranchOperatingHour,
      DailyStock,
      NoteTemplate,
    ]),
    AuditModule,
    ApprovalModule,
  ],
  providers: [CatalogService, PriceListService, PriceChangeService, StopReportService, NoteTemplateService],
  controllers: [CatalogController],
  exports: [CatalogService, PriceListService, PriceChangeService, NoteTemplateService],
})
export class CatalogModule {}
