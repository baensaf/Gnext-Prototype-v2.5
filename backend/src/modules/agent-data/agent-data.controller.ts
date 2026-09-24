import { Controller, ForbiddenException, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { gzipSync } from 'zlib';
import { Agent } from '../../entities/Agent.entity';
import { AgentAuthenticated } from '../agent-gateway/agent-auth.guard';
import { AgentSessionsService } from '../agent-gateway/agent-sessions.service';
import { AgentDataService } from './agent-data.service';

/** The version an `If-None-Match` names: the first entity tag, without quotes or a weak prefix. */
export function heldVersion(header: string | string[] | undefined): string | null {
  const value = (Array.isArray(header) ? header[0] : header)?.split(',')[0]?.trim();
  if (!value) return null;
  return value.replace(/^W\//, '').replace(/^"|"$/g, '') || null;
}

/** What the agent keeps so its branch can sell offline (protocol §12, §13). */
@Controller('api/v1/agent/data')
export class AgentDataController {
  constructor(
    private readonly data: AgentDataService,
    private readonly sessions: AgentSessionsService,
  ) {}

  /** The branch snapshot (§12.2): 304 when the agent already holds this version. */
  @AgentAuthenticated()
  @Get('snapshot')
  async snapshot(@Req() req: Request, @Res() res: Response) {
    const agent = (req as any).agent as Agent;
    const held = heldVersion(req.headers['if-none-match']);
    const snapshot = await this.data.serve(agent.tenant_id, agent.branch_id, held);
    send(req, res, held, snapshot?.data_version, snapshot);
  }

  /**
   * Who may sign in at the offline till, with their PIN hashes (§13.3). Only for an agent whose
   * live session advertised `pos.offline`: an older agent would keep the hashes in a plain file.
   */
  @AgentAuthenticated()
  @Get('staff')
  async staff(@Req() req: Request, @Res() res: Response) {
    const agent = (req as any).agent as Agent;
    if (!this.sessions.get(agent.id)?.capabilities.includes('pos.offline')) {
      throw new ForbiddenException({
        code: 'CAPABILITY_REQUIRED',
        title: 'Offline till not advertised',
        detail: 'Only an agent connected with the pos.offline capability receives the staff list.',
      });
    }
    const held = heldVersion(req.headers['if-none-match']);
    const staff = await this.data.serveStaff(agent.tenant_id, agent.branch_id, held);
    send(req, res, held, staff?.staff_version, staff);
  }
}

/** A versioned document: 304 when the agent holds it, else the JSON, gzipped when asked. */
function send(req: Request, res: Response, held: string | null, version: string | undefined, doc: object | null) {
  res.setHeader('Cache-Control', 'no-store');
  if (!doc) {
    res.setHeader('ETag', `"${held}"`);
    res.status(304).end();
    return;
  }
  res.setHeader('ETag', `"${version}"`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const body = Buffer.from(JSON.stringify(doc), 'utf8');
  if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.status(200).end(gzipSync(body));
    return;
  }
  res.status(200).end(body);
}
