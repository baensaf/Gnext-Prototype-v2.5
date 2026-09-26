import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentSyncOrder } from '../../entities/AgentSyncOrder.entity';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { OrderStateEvent } from '../../entities/OrderStateEvent.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Product } from '../../entities/Product.entity';
import { Branch } from '../../entities/Branch.entity';
import { OperationalAlert } from '../../entities/OperationalAlert.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentAllocation } from '../../entities/PaymentAllocation.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { CustomerPhone } from '../../entities/CustomerPhone.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { SimulationService } from './simulation.service';
import { SimulationController } from './simulation.controller';
import { SimulatedWebhooksController } from './simulated-webhooks.controller';
import { AuditModule } from '../audit/audit.module';
import { OrderModule } from '../order/order.module';
import { CustomerModule } from '../customer/customer.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      IntegrationLog,
      OrderHeader,
      OrderItem,
      Product,
      Branch,
      OperationalAlert,
      Payment,
      PaymentAllocation,
      PaymentMethod,
      CustomerPhone,
      CustomerAddress,
      // A Snappfood order the till took while the cloud was away is matched here (§17.7).
      AgentSyncOrder,
      OrderStateEvent,
    ]),
    AuditModule,
    // Snappfood's customer becomes a customer record.
    CustomerModule,
    // For the branch's incoming-order policy; see the matching note in OrderModule.
    forwardRef(() => OrderModule),
  ],
  providers: [SimulationService],
  controllers: [SimulationController, SimulatedWebhooksController],
  exports: [SimulationService],
})
export class SimulationModule {}
