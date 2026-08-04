import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalRule } from '../../entities/ApprovalRule.entity';
import { ApprovalRequest } from '../../entities/ApprovalRequest.entity';
import { ApprovalDecision } from '../../entities/ApprovalDecision.entity';
import { PinAttemptLog } from '../../entities/PinAttemptLog.entity';
import { AdminUser } from '../../entities/AdminUser.entity';
import { ApprovalService } from './approval.service';
import { ApprovalController } from './approval.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ApprovalRule,
      ApprovalRequest,
      ApprovalDecision,
      PinAttemptLog,
      AdminUser,
    ]),
    AuditModule,
  ],
  providers: [ApprovalService],
  controllers: [ApprovalController],
  exports: [ApprovalService],
})
export class ApprovalModule {}
