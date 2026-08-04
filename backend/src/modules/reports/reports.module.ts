import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Payment } from '../../entities/Payment.entity';
import { AuditEvent } from '../../entities/AuditEvent.entity';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { CashDrawerShift } from '../../entities/CashDrawerShift.entity';
import { CourierSettlement } from '../../entities/CourierSettlement.entity';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderHeader,
      OrderItem,
      Payment,
      AuditEvent,
      IntegrationLog,
      CashDrawerShift,
      CourierSettlement,
    ]),
  ],
  providers: [ReportsService],
  controllers: [ReportsController],
  exports: [ReportsService],
})
export class ReportsModule {}
