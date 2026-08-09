import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Refund } from '../../entities/Refund.entity';
import { RefundRequest } from '../../entities/RefundRequest.entity';
import { RefundItem } from '../../entities/RefundItem.entity';
import { RefundAllocation } from '../../entities/RefundAllocation.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
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
      RefundRequest,
      RefundItem,
      RefundAllocation,
      OrderHeader,
      OrderItem,
      Payment,
      PaymentMethod,
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
