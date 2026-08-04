import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KitchenStation } from '../../entities/KitchenStation.entity';
import { KitchenTicket } from '../../entities/KitchenTicket.entity';
import { KitchenTicketItem } from '../../entities/KitchenTicketItem.entity';
import { PrinterDevice } from '../../entities/PrinterDevice.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { KdsService } from './kds.service';
import { KdsController } from './kds.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KitchenStation,
      KitchenTicket,
      KitchenTicketItem,
      PrinterDevice,
      OrderHeader,
    ]),
    AuditModule,
  ],
  providers: [KdsService],
  controllers: [KdsController],
  exports: [KdsService],
})
export class KdsModule {}
