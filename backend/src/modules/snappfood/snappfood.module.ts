import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Branch } from '../../entities/Branch.entity';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { SnappfoodConnection, SnappfoodWebhook } from '../../entities/SnappfoodConnection.entity';
import { AuditModule } from '../audit/audit.module';
import { SnappfoodLiveService } from './snappfood-live.service';
import { SnappfoodSetupService } from './snappfood-setup.service';
import { SnappfoodSetupController } from './snappfood-setup.controller';

/**
 * The live Snappfood connection: each branch's account, the calls a store makes about its
 * orders, and the settings page. The webhook itself is answered in SimulationModule, where the
 * order intake lives, and this module knows nothing of it.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SnappfoodConnection, SnappfoodWebhook, IntegrationLog, Branch]), AuditModule],
  providers: [SnappfoodLiveService, SnappfoodSetupService],
  controllers: [SnappfoodSetupController],
  exports: [SnappfoodLiveService, SnappfoodSetupService],
})
export class SnappfoodModule {}
