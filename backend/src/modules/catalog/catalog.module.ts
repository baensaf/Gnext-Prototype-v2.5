import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../../entities/Category.entity';
import { Product } from '../../entities/Product.entity';
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { ProductOptionGroup } from '../../entities/ProductOptionGroup.entity';
import { PriceGroup } from '../../entities/PriceGroup.entity';
import { PriceGroupItem } from '../../entities/PriceGroupItem.entity';
import { Menu } from '../../entities/Menu.entity';
import { MenuCategory } from '../../entities/MenuCategory.entity';
import { MenuProduct } from '../../entities/MenuProduct.entity';
import { ProductAvailability } from '../../entities/ProductAvailability.entity';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { AuditModule } from '../audit/audit.module';
import { PricingModule } from '../pricing/pricing.module';

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
      PriceGroupItem,
      Menu,
      MenuCategory,
      MenuProduct,
      ProductAvailability,
    ]),
    AuditModule,
    forwardRef(() => PricingModule),
  ],
  providers: [CatalogService],
  controllers: [CatalogController],
  exports: [CatalogService],
})
export class CatalogModule {}
