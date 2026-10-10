import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Payment } from '../../entities/Payment.entity';
import { Refund } from '../../entities/Refund.entity';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { CashierShift } from '../../entities/CashierShift.entity';
import { CourierSettlement } from '../../entities/CourierSettlement.entity';
import { CreditEntry } from '../../entities/CreditEntry.entity';
import { OrderAdjustment } from '../../entities/OrderAdjustment.entity';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderHeader,
      OrderItem,
      Payment,
      Refund,
      IntegrationLog,
      CashierShift,
      CourierSettlement,
      CreditEntry,
      OrderAdjustment,
    ]),
  ],
  providers: [ReportsService],
  controllers: [ReportsController],
  exports: [ReportsService],
})
export class ReportsModule {}
