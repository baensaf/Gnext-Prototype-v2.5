import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Product } from '../../entities/Product.entity';
import { Branch } from '../../entities/Branch.entity';
import { OperationalAlert } from '../../entities/OperationalAlert.entity';
import { SimulationService } from './simulation.service';
import { SimulationController } from './simulation.controller';
import { SimulatedWebhooksController } from './simulated-webhooks.controller';
import { AuditModule } from '../audit/audit.module';
import { OrderModule } from '../order/order.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      IntegrationLog,
      OrderHeader,
      OrderItem,
      Product,
      Branch,
      OperationalAlert,
    ]),
    AuditModule,
    // For the branch's incoming-order policy; see the matching note in OrderModule.
    forwardRef(() => OrderModule),
  ],
  providers: [SimulationService],
  controllers: [SimulationController, SimulatedWebhooksController],
  exports: [SimulationService],
})
export class SimulationModule {}
