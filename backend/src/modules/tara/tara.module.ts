import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TaraClientService } from './tara-client.service';
import { TaraController } from './tara.controller';
import { TaraPayService } from './tara-pay.service';
import { TaraService } from './tara.service';
import { TaraSimulatorService } from './tara-simulator.service';

/** Tara as a way to pay at the till (V3), against the simulated Tara purchase API. */
@Module({
  imports: [AuditModule],
  providers: [TaraSimulatorService, TaraClientService, TaraService, TaraPayService],
  controllers: [TaraController],
  exports: [TaraService, TaraPayService],
})
export class TaraModule {}
