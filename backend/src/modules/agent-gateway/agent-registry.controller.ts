import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { HeadOfficeOnly, MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { BranchOwned } from '../../common/decorators/branch-owned.decorator';
import { Agent } from '../../entities/Agent.entity';
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
 * Which PC may speak for a branch is a chain decision: a branch account could otherwise enrol a
 * machine for the shop next door, so enrolment codes and revoking are head office's. Reading the
 * agent is everyone's at its branch (2026-10-19): the Branch agent page is where the till's own
 * people see its status and devices. A branch account only ever reads its own branch's.
 */
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
    return await this.registry.listAgents((req as any).tenantId, {
      branchId: branchId || undefined,
      includeRevoked: includeRevoked === 'true',
    });
  }

  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Get('enrolment-codes')
  async listCodes(@Req() req: Request, @Query('branchId') branchId?: string) {
    return await this.registry.listEnrolmentCodes((req as any).tenantId, branchId || undefined);
  }

  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Post('enrolment-codes')
  async createCode(@Body() body: CreateEnrolmentCodeDto, @Req() req: Request) {
    return await this.registry.createEnrolmentCode((req as any).tenantId, body.branch_id, actorOf(req));
  }

  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Delete('enrolment-codes/:id')
  async cancelCode(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return await this.registry.cancelEnrolmentCode((req as any).tenantId, id, actorOf(req));
  }

  @BranchOwned(Agent)
  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return await this.registry.getAgent((req as any).tenantId, id);
  }

  /** Connection, devices and recent commands, for the health screen. */
  @BranchOwned(Agent)
  @Get(':id/health')
  async agentHealth(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return await this.health.health((req as any).tenantId, id);
  }

  @HeadOfficeOnly()
  @Roles(...MANAGER_AND_ABOVE)
  @Post(':id/revoke')
  async revoke(@Param('id', ParseUUIDPipe) id: string, @Body() body: RevokeAgentDto, @Req() req: Request) {
    return await this.registry.revokeAgent((req as any).tenantId, id, body?.reason, actorOf(req));
  }
}

function actorOf(req: Request) {
  return { userId: (req as any).userId, correlationId: (req as any).correlationId };
}
