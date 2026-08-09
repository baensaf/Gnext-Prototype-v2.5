import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OfflineQueueItem } from '../../entities/OfflineQueueItem.entity';
import { SyncConflictRecord } from '../../entities/SyncConflictRecord.entity';
import { BranchStatusSnapshot } from '../../entities/BranchStatusSnapshot.entity';
import { OfflineSyncService } from './offline-sync.service';
import { OfflineSyncController } from './offline-sync.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OfflineQueueItem,
      SyncConflictRecord,
      BranchStatusSnapshot,
    ]),
    AuditModule,
  ],
  providers: [OfflineSyncService],
  controllers: [OfflineSyncController],
  exports: [OfflineSyncService],
})
export class OfflineSyncModule {}
