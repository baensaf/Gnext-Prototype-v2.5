import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agent } from '../../entities/Agent.entity';
import { AgentEnrolmentCode } from '../../entities/AgentEnrolmentCode.entity';
import { Branch } from '../../entities/Branch.entity';
import { AuditModule } from '../audit/audit.module';
import { AgentRegistryController } from './agent-registry.controller';
import { AgentRegistryService } from './agent-registry.service';

/** The cloud side of the branch agent (docs/agent-gateway/agent-protocol.md). */
@Module({
  imports: [TypeOrmModule.forFeature([Agent, AgentEnrolmentCode, Branch]), AuditModule],
  controllers: [AgentRegistryController],
  providers: [AgentRegistryService],
  exports: [AgentRegistryService],
})
export class AgentGatewayModule {}
