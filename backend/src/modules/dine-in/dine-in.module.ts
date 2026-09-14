import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DiningArea } from '../../entities/DiningArea.entity';
import { DiningTable } from '../../entities/DiningTable.entity';
import { TableSession } from '../../entities/TableSession.entity';
import { TableOccupancyEvent } from '../../entities/TableOccupancyEvent.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentAllocation } from '../../entities/PaymentAllocation.entity';
import { DineInService } from './dine-in.service';
import { DineInController } from './dine-in.controller';
import { AuditModule } from '../audit/audit.module';
import { OrderLifecycleModule } from '../order-lifecycle/order-lifecycle.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DiningArea,
      DiningTable,
      TableSession,
      TableOccupancyEvent,
      OrderHeader,
      Payment,
      PaymentAllocation,
    ]),
    AuditModule,
    OrderLifecycleModule,
  ],
  providers: [DineInService],
  controllers: [DineInController],
  exports: [DineInService],
})
export class DineInModule {}
