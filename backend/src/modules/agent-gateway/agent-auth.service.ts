import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent } from '../../entities/Agent.entity';
import { DEVICE_KEY_PREFIX, hashSecret } from './agent-credentials';

/** Writing last_seen_at on every request would turn each heartbeat into a row update. */
const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;

export function agentKeyInvalid() {
  return new UnauthorizedException({
    code: 'AGENT_KEY_INVALID',
    title: 'Agent Not Authenticated',
    detail: 'A valid agent device key is required.',
  });
}

export function agentRevoked() {
  return new ForbiddenException({
    code: 'AGENT_REVOKED',
    title: 'Agent Revoked',
    detail: 'This agent has been revoked. Enrol it again with a new code.',
  });
}

/** Reads `Authorization: Bearer gak_…`. Anything else is no key at all. */
export function deviceKeyFromHeader(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith('Bearer ')) return null;
  const key = value.slice(7).trim();
  return key.startsWith(DEVICE_KEY_PREFIX) ? key : null;
}

/**
 * Turns a device key into the agent it belongs to (protocol §3.4). Used by the HTTPS guard
 * and, in the gateway, by the WebSocket upgrade, so both refuse exactly the same keys.
 */
@Injectable()
export class AgentAuthService {
  constructor(@InjectRepository(Agent) private readonly agentRepo: Repository<Agent>) {}

  async authenticate(deviceKey: string | null): Promise<Agent> {
    if (!deviceKey) throw agentKeyInvalid();
    const agent = await this.agentRepo.findOne({ where: { key_hash: hashSecret(deviceKey) } });
    if (!agent) throw agentKeyInvalid();
    if (agent.status !== 'ACTIVE') throw agentRevoked();
    await this.touch(agent);
    return agent;
  }

  async touch(agent: Agent, now = new Date()): Promise<void> {
    const last = agent.last_seen_at ? new Date(agent.last_seen_at).getTime() : 0;
    if (now.getTime() - last < LAST_SEEN_WRITE_INTERVAL_MS) return;
    agent.last_seen_at = now;
    // Only this column, so a concurrent revoke is never written back to ACTIVE.
    await this.agentRepo.update({ id: agent.id }, { last_seen_at: now });
  }
}
