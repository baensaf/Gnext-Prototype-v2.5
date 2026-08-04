import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryItem } from '../../entities/InventoryItem.entity';
import { InventoryTransaction } from '../../entities/InventoryTransaction.entity';
import { Product } from '../../entities/Product.entity';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InventoryItem,
      InventoryTransaction,
      Product,
    ]),
    AuditModule,
  ],
  providers: [InventoryService],
  controllers: [InventoryController],
  exports: [InventoryService],
})
export class InventoryModule {}
