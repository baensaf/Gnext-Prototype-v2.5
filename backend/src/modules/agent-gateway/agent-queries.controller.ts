import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { effectiveBranchId } from '../../common/utils/user-scope.util';
import { Agent } from '../../entities/Agent.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { AgentConnectionHandle, AgentQueryError, AgentQueryName, AgentSessionsService } from './agent-sessions.service';

export class ScanBranchNetworkDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** The port to try; network printers listen on 9100. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;
}

export class AgentPcSettingsDto {
  /** Whether Gnext opens by itself when someone signs in to Windows on the branch PC. */
  @IsBoolean()
  app_at_sign_in: boolean;
}

/**
 * What the branch agent's own settings page used to do, asked of the agent live from the cloud's
 * screens (protocol §20): find printers on the branch network, read its logs, change the PC's
 * own setting and fetch a newer app build. Nothing is stored; the agent has to be online.
 *
 * Everyone at the branch reads its agent (the Branch agent page, 2026-10-19); the branch's manager
 * and head office change things. A branch account reaches only its own branch's agent.
 */
@Controller('api/v1/agents')
export class AgentQueriesController {
  constructor(
    private readonly sessions: AgentSessionsService,
    @InjectRepository(Agent) private readonly agents: Repository<Agent>,
    private readonly auditWriter: AuditWriter,
  ) {}

  /** The branch's own manager adds printers, so finding them is theirs too. */
  @Roles(...MANAGER_AND_ABOVE)
  @Post('branch-scan')
  async scan(@Body() body: ScanBranchNetworkDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const branchId = effectiveBranchId((req as any).userBranchId, body.branchId);
    if (!branchId) throw new BadRequestException('Pick a branch to search its network.');
    const handle = this.sessions.forBranch(tenantId, branchId);
    if (!handle) throw new ConflictException({ code: 'AGENT_OFFLINE', message: 'The branch agent is offline, so its network cannot be searched.' });
    return await this.ask(handle, 'scan', { port: body.port ?? 9100 });
  }

  @Get(':id/logs')
  async logs(@Param('id', ParseUUIDPipe) id: string, @Query('lines') lines: string | undefined, @Req() req: Request) {
    const handle = await this.live(req, id);
    return await this.ask(handle, 'logs', { lines: Number(lines) || 300 });
  }

  @Get(':id/settings')
  async settings(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const handle = await this.live(req, id);
    return await this.ask(handle, 'settings', {});
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Patch(':id/settings')
  async changeSettings(@Param('id', ParseUUIDPipe) id: string, @Body() body: AgentPcSettingsDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const handle = await this.live(req, id);
    const answer = await this.ask(handle, 'settings', { app_at_sign_in: body.app_at_sign_in });
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'AGENT_PC_SETTINGS_CHANGED',
      entityType: 'Agent',
      entityId: id,
      details: { app_at_sign_in: body.app_at_sign_in },
      correlationId: (req as any).correlationId,
    });
    return answer;
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post(':id/app-refresh')
  async appRefresh(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const handle = await this.live(req, id);
    // Downloading a build can take a while on a slow branch line.
    return await this.ask(handle, 'app.refresh', {}, 120_000);
  }

  /** The agent's live connection. Another branch's agent answers as not found, as one that does not exist. */
  private async live(req: Request, agentId: string): Promise<AgentConnectionHandle> {
    const agent = await this.agents.findOne({ where: { id: agentId, tenant_id: (req as any).tenantId } });
    const own = (req as any).userBranchId ?? null;
    if (!agent || (own && agent.branch_id !== own)) throw new NotFoundException('Agent not found');
    const handle = this.sessions.get(agentId);
    if (!handle) throw new ConflictException({ code: 'AGENT_OFFLINE', message: 'The branch agent is offline.' });
    return handle;
  }

  /** Every failure is a 409 with its code: a 5xx would read as the cloud itself being down. */
  private async ask(handle: AgentConnectionHandle, query: AgentQueryName, args: Record<string, any>, timeoutMs?: number) {
    try {
      return await this.sessions.query(handle, query, args, timeoutMs);
    } catch (err) {
      if (err instanceof AgentQueryError) throw new ConflictException({ code: err.code, message: err.message });
      throw err;
    }
  }
}
