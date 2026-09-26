import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Printer } from '../../entities/Printer.entity';
import { PrintJob } from '../../entities/PrintJob.entity';
import { PrintAttempt } from '../../entities/PrintAttempt.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { Branch } from '../../entities/Branch.entity';
import { OperationalAlert } from '../../entities/OperationalAlert.entity';
import { Product } from '../../entities/Product.entity';
import { KdsRoutingRule } from '../../entities/KdsRoutingRule.entity';
import { KitchenStation } from '../../entities/KitchenStation.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { PrintRenderService } from './print-render.service';
import { PrintRoutingService } from './print-routing.service';
import { PrintQueueService } from './print-queue.service';
import { PrintersController } from './printers.controller';
import { AuditModule } from '../audit/audit.module';
import { AgentGatewayModule } from '../agent-gateway/agent-gateway.module';
import { AgentPrintingService } from './agent-printing.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Printer,
      PrintJob,
      PrintAttempt,
      OrderHeader,
      Branch,
      OperationalAlert,
      Product,
      KdsRoutingRule,
      KitchenStation,
      Terminal,
    ]),
    AuditModule,
    AgentGatewayModule,
  ],
  providers: [PrintRenderService, PrintRoutingService, PrintQueueService, AgentPrintingService],
  controllers: [PrintersController],
  exports: [PrintQueueService, PrintRenderService, PrintRoutingService],
})
export class PrintingModule {}
