import { Module, forwardRef } from '@nestjs/common';
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
import { Menu } from '../../entities/Menu.entity';
import { MenuCategory } from '../../entities/MenuCategory.entity';
import { MenuProduct } from '../../entities/MenuProduct.entity';
import { ProductAvailability } from '../../entities/ProductAvailability.entity';
import { AvailabilitySchedule } from '../../entities/AvailabilitySchedule.entity';
import { Branch } from '../../entities/Branch.entity';
import { BranchOperatingHour } from '../../entities/BranchOperatingHour.entity';
import { DailyStock } from '../../entities/DailyStock.entity';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { PriceListService } from './price-lists.service';
import { PriceChangeService } from './price-changes.service';
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
      Menu,
      MenuCategory,
      MenuProduct,
      ProductAvailability,
      AvailabilitySchedule,
      Branch,
      BranchOperatingHour,
      DailyStock,
    ]),
    AuditModule,
    ApprovalModule,
  ],
  providers: [CatalogService, PriceListService, PriceChangeService],
  controllers: [CatalogController],
  exports: [CatalogService, PriceListService, PriceChangeService],
})
export class CatalogModule {}
