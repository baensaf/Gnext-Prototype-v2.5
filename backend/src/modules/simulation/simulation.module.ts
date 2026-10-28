import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Product } from '../../entities/Product.entity';
import { Branch } from '../../entities/Branch.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentAllocation } from '../../entities/PaymentAllocation.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { CustomerPhone } from '../../entities/CustomerPhone.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { ChannelItemMap } from '../../entities/ChannelItemMap.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { SimulationService } from './simulation.service';
import { SnappfoodCatalogService } from './snappfood-catalog.service';
import { CatalogModule } from '../catalog/catalog.module';
import { SimulationController } from './simulation.controller';
import { SimulatedWebhooksController } from './simulated-webhooks.controller';
import { SnappfoodWebhookController } from './snappfood-webhook.controller';
import { SnappfoodConnection, SnappfoodWebhook } from '../../entities/SnappfoodConnection.entity';
import { SnappfoodModule } from '../snappfood/snappfood.module';
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
      Payment,
      PaymentAllocation,
      PaymentMethod,
      CustomerPhone,
      CustomerAddress,
      ChannelItemMap,
      TenantSetting,
      SnappfoodWebhook,
      SnappfoodConnection,
    ]),
    // A branch on the real Snappfood is acked there, not in the simulator.
    SnappfoodModule,
    // The menu sync reads the Snappfood price sheet and the branch's stops.
    CatalogModule,
    AuditModule,
    // Snappfood's customer becomes a customer record.
    CustomerModule,
    // For the branch's incoming-order policy; see the matching note in OrderModule.
    forwardRef(() => OrderModule),
  ],
  providers: [SimulationService, SnappfoodCatalogService],
  controllers: [SimulationController, SimulatedWebhooksController, SnappfoodWebhookController],
  exports: [SimulationService, SnappfoodCatalogService],
})
export class SimulationModule {}
