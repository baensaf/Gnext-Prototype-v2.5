import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Agent } from '../../entities/Agent.entity';
import { AgentAuthenticated } from '../agent-gateway/agent-auth.guard';
import { AgentSyncService } from './agent-sync.service';

/** Orders the branch took while offline, uploaded by its agent (protocol §12.5). */
@Controller('api/v1/agent/sync')
export class AgentSyncController {
  constructor(private readonly sync: AgentSyncService) {}

  @AgentAuthenticated()
  @Post('orders')
  @HttpCode(200)
  async orders(@Body() body: unknown, @Req() req: Request) {
    return await this.sync.receive((req as any).agent as Agent, body);
  }
}
