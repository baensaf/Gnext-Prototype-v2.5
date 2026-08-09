import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KitchenStation } from '../../entities/KitchenStation.entity';
import { KdsScreen } from '../../entities/KdsScreen.entity';
import { KdsRoutingRule } from '../../entities/KdsRoutingRule.entity';
import { KitchenTicket } from '../../entities/KitchenTicket.entity';
import { KitchenTicketItem } from '../../entities/KitchenTicketItem.entity';
import { KdsEvent } from '../../entities/KdsEvent.entity';
import { Printer } from '../../entities/Printer.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { KdsService } from './kds.service';
import { KdsController } from './kds.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KitchenStation,
      KdsScreen,
      KdsRoutingRule,
      KitchenTicket,
      KitchenTicketItem,
      KdsEvent,
      Printer,
      OrderHeader,
    ]),
    AuditModule,
  ],
  providers: [KdsService],
  controllers: [KdsController],
  exports: [KdsService],
})
export class KdsModule {}
