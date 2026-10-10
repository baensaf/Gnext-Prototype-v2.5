import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent } from '../../entities/Agent.entity';
import { AgentCommandsService } from './agent-commands.service';
import { AgentRegistryService } from './agent-registry.service';
import { AgentSessionsService } from './agent-sessions.service';
import { LiveAgentConnectionHandle } from './agent-connection';

/**
 * What the health screen shows for one branch agent: whether it is there, and what it last said
 * about its devices (task 7).
 *
 * An agent that disconnects is stamped with the moment it left, so "last seen" is the
 * disconnect and not the last heartbeat a minute before it.
 */
@Injectable()
export class AgentHealthService implements OnApplicationBootstrap, OnApplicationShutdown {
  private stopPresence: (() => void) | null = null;

  constructor(
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    private readonly sessions: AgentSessionsService,
    private readonly commands: AgentCommandsService,
    private readonly registry: AgentRegistryService,
  ) {}

  onApplicationBootstrap() {
    // last_seen_at is written at most once a minute while connected; stamp the moment it left.
    this.stopPresence = this.sessions.onPresence((event, handle) => {
      if (event !== 'offline') return;
      this.agentRepo.update({ id: handle.agentId }, { last_seen_at: new Date() }).catch(() => undefined);
    });
  }

  onApplicationShutdown() {
    this.stopPresence?.();
  }

  /** Everything the health screen shows for one agent. */
  async health(tenantId: string, agentId: string) {
    const agent = await this.registry.getAgent(tenantId, agentId);
    const live = this.sessions.get(agentId) as LiveAgentConnectionHandle | undefined;
    const commands = await this.commands.recentForAgentBranch(tenantId, agent.branch_id, 25);
    return {
      agent,
      connection: live
        ? {
            connected: true,
            session_id: live.sessionId,
            connected_at: live.connectedAt,
            last_frame_at: live.lastFrameAt ?? null,
            agent_version: live.agentVersion,
            capabilities: live.capabilities,
            devices: live.devices ? [...live.devices.values()] : [],
          }
        : { connected: false, devices: [] },
      recent_commands: commands.map((c) => ({
        id: c.id,
        type: c.type,
        status: c.status,
        send_count: c.send_count,
        created_at: c.created_at,
        acked_at: c.acked_at,
        completed_at: c.completed_at,
        error_code: c.error_code,
        error_message: c.error_message,
        entity_type: c.entity_type,
        entity_id: c.entity_id,
      })),
    };
  }
}
