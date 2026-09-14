import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaxInvoice } from '../../entities/TaxInvoice.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { Refund } from '../../entities/Refund.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { MoadianService } from './moadian.service';
import { MoadianController } from './moadian.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TaxInvoice, OrderHeader, Refund, TenantSetting])],
  providers: [MoadianService],
  controllers: [MoadianController],
  exports: [MoadianService],
})
export class MoadianModule {}
