import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from '../../entities/Category.entity';
import { Product } from '../../entities/Product.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { ProductOptionGroup } from '../../entities/ProductOptionGroup.entity';
import { PriceGroup } from '../../entities/PriceGroup.entity';
import { PriceGroupItem } from '../../entities/PriceGroupItem.entity';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Category, Product, OptionGroup, OptionItem, ProductOptionGroup, PriceGroup, PriceGroupItem]),
    AuditModule,
  ],
  providers: [CatalogService],
  controllers: [CatalogController],
  exports: [CatalogService],
})
export class CatalogModule {}
