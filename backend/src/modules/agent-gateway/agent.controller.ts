import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { Agent } from '../../entities/Agent.entity';
import { AgentAuthenticated } from './agent-auth.guard';
import { AgentEnrolmentService } from './agent-enrolment.service';

/** Where agents connect. The gateway path sits under /api/ because only that prefix is proxied. */
export const AGENT_WS_PATH = '/api/v1/agent/ws';

/** The client address as nginx passed it on: the first hop of X-Forwarded-For. */
export function clientAddress(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  return (first || req.socket?.remoteAddress || 'unknown').slice(0, 45);
}

function isLocalHost(host: string): boolean {
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return /^(localhost|127\.\d+\.\d+\.\d+|::1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(name);
}

/**
 * The WebSocket URL an agent should use. AGENT_PUBLIC_URL wins when set. Otherwise the host
 * the agent reached us on: TLS ends at the CDN, so the scheme nginx reports is not the one
 * the agent used, and only a local address is taken to be plain `ws`.
 */
export function agentWsUrl(req: Request, publicUrl = process.env.AGENT_PUBLIC_URL): string {
  if (publicUrl) {
    const url = new URL(publicUrl);
    url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
    url.pathname = AGENT_WS_PATH;
    url.search = '';
    return url.toString();
  }
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost';
  return `${isLocalHost(host) ? 'ws' : 'wss'}://${host}${AGENT_WS_PATH}`;
}

/** The agent's own HTTPS surface (docs/agent-gateway/agent-protocol.md). */
@Controller('api/v1/agent')
export class AgentController {
  constructor(private readonly enrolment: AgentEnrolmentService) {}

  @Public()
  @Post('enrol')
  @HttpCode(200)
  async enrol(@Body() body: unknown, @Req() req: Request) {
    return await this.enrolment.enrol(body, { clientKey: clientAddress(req), wsUrl: agentWsUrl(req) });
  }

  /** Who the key belongs to. Lets an installer check a key works before starting the service. */
  @AgentAuthenticated()
  @Get('me')
  me(@Req() req: Request) {
    const agent = (req as any).agent as Agent;
    return {
      agent_id: agent.id,
      tenant_id: agent.tenant_id,
      branch_id: agent.branch_id,
      status: agent.status,
      enrolled_at: agent.enrolled_at,
    };
  }
}
