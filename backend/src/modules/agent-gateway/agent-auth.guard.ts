import { applyDecorators, CanActivate, ExecutionContext, Injectable, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AgentAuthService, deviceKeyFromHeader } from './agent-auth.service';

/**
 * Lets a branch agent in by its device key. The request then carries the agent and its
 * tenant, but no user: nothing an agent calls may read `userId` or a user's branch.
 */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(private readonly auth: AgentAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const agent = await this.auth.authenticate(deviceKeyFromHeader(req.headers?.authorization));
    req.agent = agent;
    req.agentId = agent.id;
    req.agentBranchId = agent.branch_id;
    req.tenantId = agent.tenant_id;
    return true;
  }
}

/**
 * For agent routes. `Public` takes the route out of the user session and CSRF guards, which
 * have nothing to check on a machine that never had a session; the agent guard replaces them.
 */
export const AgentAuthenticated = () => applyDecorators(Public(), UseGuards(AgentAuthGuard));
