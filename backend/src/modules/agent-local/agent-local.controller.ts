import { Body, Controller, Delete, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { Agent } from '../../entities/Agent.entity';
import { AgentAuthenticated } from '../agent-gateway/agent-auth.guard';
import { clientAddress } from '../agent-gateway/agent.controller';
import { AgentLocalService } from './agent-local.service';

/** Header the agent uses to pass on the session of whoever signed in to its local page. */
export const LOCAL_SESSION_HEADER = 'x-gnext-user-session';

/**
 * Called by a branch agent on behalf of its local settings page. Every route needs the
 * agent's device key; changes also need a manager's session in `X-Gnext-User-Session`.
 */
@AgentAuthenticated()
@Controller('api/v1/agent/local')
export class AgentLocalController {
  constructor(private readonly local: AgentLocalService) {}

  private agent(req: Request): Agent {
    return (req as any).agent;
  }

  private actor(req: Request, session?: string) {
    return this.local.actor(this.agent(req), session, (req as any).correlationId);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Req() req: Request) {
    return this.local.login(this.agent(req), body, clientAddress(req), (req as any).correlationId);
  }

  /** A cloud session for a cashier signing in at the agent's till, by PIN (§16.3). */
  @Post('pin-login')
  @HttpCode(200)
  pinLogin(@Body() body: unknown, @Req() req: Request) {
    return this.local.pinLogin(this.agent(req), body, clientAddress(req), (req as any).correlationId);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Headers(LOCAL_SESSION_HEADER) session: string) {
    return this.local.logout(session);
  }

  @Post('printers')
  async createPrinter(@Body() body: unknown, @Req() req: Request, @Headers(LOCAL_SESSION_HEADER) session: string) {
    return this.local.createPrinter(await this.actor(req, session), body);
  }

  @Patch('printers/:id')
  async updatePrinter(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request, @Headers(LOCAL_SESSION_HEADER) session: string) {
    return this.local.updatePrinter(await this.actor(req, session), id, body);
  }

  @Delete('printers/:id')
  async deletePrinter(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Headers(LOCAL_SESSION_HEADER) session: string) {
    return this.local.deletePrinter(await this.actor(req, session), id);
  }

  @Post('terminals')
  async createTerminal(@Body() body: unknown, @Req() req: Request, @Headers(LOCAL_SESSION_HEADER) session: string) {
    return this.local.createTerminal(await this.actor(req, session), body);
  }

  @Patch('terminals/:id')
  async updateTerminal(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request, @Headers(LOCAL_SESSION_HEADER) session: string) {
    return this.local.updateTerminal(await this.actor(req, session), id, body);
  }

  @Delete('terminals/:id')
  async removeTerminal(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Headers(LOCAL_SESSION_HEADER) session: string) {
    return this.local.removeTerminal(await this.actor(req, session), id);
  }
}
