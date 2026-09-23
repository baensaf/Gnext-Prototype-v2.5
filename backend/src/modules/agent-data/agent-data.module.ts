import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentDataSnapshot } from '../../entities/AgentDataSnapshot.entity';
import { Branch } from '../../entities/Branch.entity';
import { CashierShift } from '../../entities/CashierShift.entity';
import { Category } from '../../entities/Category.entity';
import { DeliveryZone } from '../../entities/DeliveryZone.entity';
import { DiningArea } from '../../entities/DiningArea.entity';
import { DiningTable } from '../../entities/DiningTable.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { Product } from '../../entities/Product.entity';
import { ProductOptionGroup } from '../../entities/ProductOptionGroup.entity';
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { Tenant } from '../../entities/Tenant.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { AgentGatewayModule } from '../agent-gateway/agent-gateway.module';
import { CatalogModule } from '../catalog/catalog.module';
import { LiveModule } from '../live/live.module';
import { AgentDataChangesService } from './agent-data-changes.service';
import { AgentDataController } from './agent-data.controller';
import { AgentDataService } from './agent-data.service';

/** The branch snapshot the agent keeps for selling offline (protocol §12). */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AgentDataSnapshot,
      Tenant,
      Branch,
      Category,
      Product,
      ProductVariant,
      OptionGroup,
      OptionItem,
      ProductOptionGroup,
      PaymentMethod,
      DiningArea,
      DiningTable,
      DeliveryZone,
      Terminal,
      CashierShift,
      TenantSetting,
    ]),
    AgentGatewayModule,
    CatalogModule,
    LiveModule,
  ],
  controllers: [AgentDataController],
  providers: [AgentDataService, AgentDataChangesService],
  exports: [AgentDataService],
})
export class AgentDataModule {}
