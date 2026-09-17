import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../../entities/Payment.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { Tenant } from '../../entities/Tenant.entity';
import { Branch } from '../../entities/Branch.entity';
import { SettlementAccount } from '../../entities/SettlementAccount.entity';
import { PaymentDevice } from '../../entities/PaymentDevice.entity';
import { PaymentAllocation } from '../../entities/PaymentAllocation.entity';
import { PaymentAttempt } from '../../entities/PaymentAttempt.entity';
import { PaymentService } from './payment.service';
import { PaymentController } from './payment.controller';
import { CustomerModule } from '../customer/customer.module';
import { CashierModule } from '../cashier/cashier.module';
import { AuditModule } from '../audit/audit.module';
import { OrderModule } from '../order/order.module';
import { AgentGatewayModule } from '../agent-gateway/agent-gateway.module';
import { OperationalAlert } from '../../entities/OperationalAlert.entity';
import { AgentPaymentsService } from './agent-payments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payment,
      OrderHeader,
      PaymentMethod,
      Tenant,
      Branch,
      SettlementAccount,
      PaymentDevice,
      PaymentAllocation,
      PaymentAttempt,
      OperationalAlert,
    ]),
    CustomerModule,
    CashierModule,
    AuditModule,
    // A paid takeaway order completes once its payment lands.
    OrderModule,
    AgentGatewayModule,
  ],
  providers: [PaymentService, AgentPaymentsService],
  controllers: [PaymentController],
  exports: [PaymentService],
})
export class PaymentModule {}
