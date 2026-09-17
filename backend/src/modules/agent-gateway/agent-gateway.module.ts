import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agent } from '../../entities/Agent.entity';
import { AgentEnrolmentCode } from '../../entities/AgentEnrolmentCode.entity';
import { Branch } from '../../entities/Branch.entity';
import { AuditModule } from '../audit/audit.module';
import { AgentAuthGuard } from './agent-auth.guard';
import { AgentAuthService } from './agent-auth.service';
import { AgentController } from './agent.controller';
import { AgentEnrolmentService } from './agent-enrolment.service';
import { AgentRegistryController } from './agent-registry.controller';
import { AgentRegistryService } from './agent-registry.service';
import { AgentSessionsService } from './agent-sessions.service';

/** The cloud side of the branch agent (docs/agent-gateway/agent-protocol.md). */
@Module({
  imports: [TypeOrmModule.forFeature([Agent, AgentEnrolmentCode, Branch]), AuditModule],
  controllers: [AgentRegistryController, AgentController],
  providers: [AgentRegistryService, AgentSessionsService, AgentAuthService, AgentAuthGuard, AgentEnrolmentService],
  exports: [AgentRegistryService, AgentSessionsService, AgentAuthService],
})
export class AgentGatewayModule {}
