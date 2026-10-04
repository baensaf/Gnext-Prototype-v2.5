import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { HeadOfficeOnly, MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { AgentRegistryService } from './agent-registry.service';
import { AgentHealthService } from './agent-health.service';

export class CreateEnrolmentCodeDto {
  @IsUUID()
  branch_id: string;
}

export class RevokeAgentDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

/**
 * Which PC may speak for a branch is a chain decision: a branch account could otherwise
 * enrol a machine for the shop next door. Everything here is head office's.
 */
@HeadOfficeOnly()
@Roles(...MANAGER_AND_ABOVE)
@Controller('api/v1/agents')
export class AgentRegistryController {
  constructor(
    private readonly registry: AgentRegistryService,
    private readonly health: AgentHealthService,
  ) {}

  @Get()
  async list(
    @Req() req: Request,
    @Query('branchId') branchId?: string,
    @Query('includeRevoked') includeRevoked?: string,
  ) {
    const tenantId = (req as any).tenantId;
    const agents = await this.registry.listAgents(tenantId, {
      branchId: branchId || undefined,
      includeRevoked: includeRevoked === 'true',
    });
    // §16.8: whether each branch could sell offline if the internet went now.
    const readiness = await this.health.offlineReadiness(tenantId, agents);
    return agents.map((a) => ({ ...a, offline_ready: readiness.get(a.id) ?? null }));
  }

  @Get('enrolment-codes')
  async listCodes(@Req() req: Request, @Query('branchId') branchId?: string) {
    return await this.registry.listEnrolmentCodes((req as any).tenantId, branchId || undefined);
  }

  @Post('enrolment-codes')
  async createCode(@Body() body: CreateEnrolmentCodeDto, @Req() req: Request) {
    return await this.registry.createEnrolmentCode((req as any).tenantId, body.branch_id, actorOf(req));
  }

  @Delete('enrolment-codes/:id')
  async cancelCode(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return await this.registry.cancelEnrolmentCode((req as any).tenantId, id, actorOf(req));
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return await this.registry.getAgent((req as any).tenantId, id);
  }

  /** Connection, devices and recent commands, for the health screen. */
  @Get(':id/health')
  async agentHealth(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return await this.health.health((req as any).tenantId, id);
  }

  @Post(':id/revoke')
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Body() body: RevokeAgentDto, @Req() req: Request) {
    return await this.registry.revokeAgent((req as any).tenantId, id, body?.reason, actorOf(req));
  }
}

/**
 * Whether a register is served by its branch agent's Gnext POS (agent-protocol.md §16.10, §18.7),
 * and where it opens it. Asked by the web POS of any signed-in user, so it says no more.
 */
@Controller('api/v1/terminals')
export class TerminalAgentTillController {
  constructor(private readonly health: AgentHealthService) {}

  @Get(':id/agent-till')
  agentTill(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const served = this.health.tillServedByAgent((req as any).tenantId, id);
    return { served_by_agent: served !== null, url: served?.url ?? null };
  }
}

function actorOf(req: Request) {
  return { userId: (req as any).userId, correlationId: (req as any).correlationId };
}
