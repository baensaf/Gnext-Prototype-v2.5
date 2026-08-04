import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Product } from '../../entities/Product.entity';
import { Branch } from '../../entities/Branch.entity';
import { SimulationService } from './simulation.service';
import { SimulationController } from './simulation.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      IntegrationLog,
      OrderHeader,
      OrderItem,
      Product,
      Branch,
    ]),
    AuditModule,
  ],
  providers: [SimulationService],
  controllers: [SimulationController],
  exports: [SimulationService],
})
export class SimulationModule {}
