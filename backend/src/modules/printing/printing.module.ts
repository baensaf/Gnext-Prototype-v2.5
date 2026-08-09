import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Printer } from '../../entities/Printer.entity';
import { PrinterGroup } from '../../entities/PrinterGroup.entity';
import { PrinterGroupMember } from '../../entities/PrinterGroupMember.entity';
import { PrintRoute } from '../../entities/PrintRoute.entity';
import { PrintJob } from '../../entities/PrintJob.entity';
import { PrintAttempt } from '../../entities/PrintAttempt.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { PrintRenderService } from './print-render.service';
import { PrintRoutingService } from './print-routing.service';
import { PrintQueueService } from './print-queue.service';
import { PrintersController } from './printers.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Printer,
      PrinterGroup,
      PrinterGroupMember,
      PrintRoute,
      PrintJob,
      PrintAttempt,
      OrderHeader,
    ]),
    AuditModule,
  ],
  providers: [PrintRenderService, PrintRoutingService, PrintQueueService],
  controllers: [PrintersController],
  exports: [PrintQueueService, PrintRenderService, PrintRoutingService],
})
export class PrintingModule {}
