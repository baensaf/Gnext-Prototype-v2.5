import { Controller, Get, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { gzipSync } from 'zlib';
import { Agent } from '../../entities/Agent.entity';
import { AgentAuthenticated } from '../agent-gateway/agent-auth.guard';
import { AgentDataService } from './agent-data.service';

/** The version an `If-None-Match` names: the first entity tag, without quotes or a weak prefix. */
export function heldVersion(header: string | string[] | undefined): string | null {
  const value = (Array.isArray(header) ? header[0] : header)?.split(',')[0]?.trim();
  if (!value) return null;
  return value.replace(/^W\//, '').replace(/^"|"$/g, '') || null;
}

/** What the agent keeps so its branch can sell offline (protocol §12). */
@Controller('api/v1/agent/data')
export class AgentDataController {
  constructor(private readonly data: AgentDataService) {}

  /** The branch snapshot (§12.2): 304 when the agent already holds this version. */
  @AgentAuthenticated()
  @Get('snapshot')
  async snapshot(@Req() req: Request, @Res() res: Response) {
    const agent = (req as any).agent as Agent;
    const held = heldVersion(req.headers['if-none-match']);
    const snapshot = await this.data.serve(agent.tenant_id, agent.branch_id, held);
    res.setHeader('Cache-Control', 'no-store');
    if (!snapshot) {
      res.setHeader('ETag', `"${held}"`);
      res.status(304).end();
      return;
    }
    res.setHeader('ETag', `"${snapshot.data_version}"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const body = Buffer.from(JSON.stringify(snapshot), 'utf8');
    if (/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.status(200).end(gzipSync(body));
      return;
    }
    res.status(200).end(body);
  }
}
