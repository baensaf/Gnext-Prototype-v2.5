import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agent } from '../../entities/Agent.entity';
import { AgentEnrolmentCode } from '../../entities/AgentEnrolmentCode.entity';
import { AgentRelease } from '../../entities/AgentRelease.entity';
import { AgentCommand } from '../../entities/AgentCommand.entity';
import { Branch } from '../../entities/Branch.entity';
import { PaymentDevice } from '../../entities/PaymentDevice.entity';
import { Printer } from '../../entities/Printer.entity';
import { PrintRoute } from '../../entities/PrintRoute.entity';
import { AuditModule } from '../audit/audit.module';
import { AgentAuthGuard } from './agent-auth.guard';
import { AgentAuthService } from './agent-auth.service';
import { AgentController } from './agent.controller';
import { AgentEnrolmentService } from './agent-enrolment.service';
import { AgentRegistryController } from './agent-registry.controller';
import { AgentQueriesController } from './agent-queries.controller';
import { AgentRegistryService } from './agent-registry.service';
import { AgentSessionsService } from './agent-sessions.service';
import { AgentConfigService } from './agent-config.service';
import { AgentMessageHandlers } from './agent-message-handlers.service';
import { AgentWsServer } from './agent-ws.server';
import { AgentCommandsService } from './agent-commands.service';
import { AgentHealthService } from './agent-health.service';
import { AgentReleasesService } from './agent-releases.service';
import { AgentReleasesCiController, AgentReleasesController } from './agent-releases.controller';

/** The cloud side of the branch agent (docs/agent-gateway/agent-protocol.md). */
@Module({
  imports: [TypeOrmModule.forFeature([Agent, AgentEnrolmentCode, AgentCommand, AgentRelease, Branch, Printer, PaymentDevice, PrintRoute]), AuditModule],
  controllers: [AgentRegistryController, AgentQueriesController, AgentController, AgentReleasesCiController, AgentReleasesController],
  providers: [
    AgentRegistryService,
    AgentSessionsService,
    AgentAuthService,
    AgentAuthGuard,
    AgentEnrolmentService,
    AgentConfigService,
    AgentMessageHandlers,
    AgentWsServer,
    AgentCommandsService,
    AgentHealthService,
    AgentReleasesService,
  ],
  exports: [
    AgentRegistryService,
    AgentSessionsService,
    AgentAuthService,
    AgentConfigService,
    AgentMessageHandlers,
    AgentCommandsService,
  ],
})
export class AgentGatewayModule {}
