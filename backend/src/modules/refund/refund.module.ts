import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Refund } from '../../entities/Refund.entity';
import { RefundAllocation } from '../../entities/RefundAllocation.entity';
import { AdminUser } from '../../entities/AdminUser.entity';
import { AuditEvent } from '../../entities/AuditEvent.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { RefundService } from './refund.service';
import { RefundController } from './refund.controller';
import { CustomerModule } from '../customer/customer.module';
import { CashierModule } from '../cashier/cashier.module';
import { ApprovalModule } from '../approval/approval.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Refund,
      RefundAllocation,
      OrderHeader,
      AuditEvent,
      AdminUser,
    ]),
    CustomerModule,
    CashierModule,
    ApprovalModule,
    AuditModule,
  ],
  providers: [RefundService],
  controllers: [RefundController],
  exports: [RefundService],
})
export class RefundModule {}
