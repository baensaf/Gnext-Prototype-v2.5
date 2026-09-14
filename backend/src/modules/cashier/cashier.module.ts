import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashierShift } from '../../entities/CashierShift.entity';
import { CashMovement } from '../../entities/CashMovement.entity';
import { BusinessDayClose } from '../../entities/BusinessDayClose.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { Payment } from '../../entities/Payment.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { Branch } from '../../entities/Branch.entity';
import { ShiftService } from './shift.service';
import { BusinessDayService } from './business-day.service';
import { ShiftsController } from './shifts.controller';
import { BusinessDaysController } from './business-days.controller';
import { AuditModule } from '../audit/audit.module';
import { ApprovalModule } from '../approval/approval.module';
import { OrderLifecycleModule } from '../order-lifecycle/order-lifecycle.module';

@Module({
  imports: [
    ApprovalModule,
    TypeOrmModule.forFeature([
      CashierShift,
      CashMovement,
      BusinessDayClose,
      Terminal,
      Payment,
      OrderHeader,
      Branch,
    ]),
    AuditModule,
    OrderLifecycleModule,
  ],
  providers: [ShiftService, BusinessDayService],
  controllers: [ShiftsController, BusinessDaysController],
  exports: [ShiftService, BusinessDayService],
})
export class CashierModule {}
