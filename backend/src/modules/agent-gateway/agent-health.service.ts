import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { AdminUser } from '../../entities/AdminUser.entity';
import { Agent } from '../../entities/Agent.entity';
import { CashierShift } from '../../entities/CashierShift.entity';
import { Branch } from '../../entities/Branch.entity';
import { OperationalAlert } from '../../entities/OperationalAlert.entity';
import { AgentCommandsService } from './agent-commands.service';
import { AgentRegistryService, AgentView } from './agent-registry.service';
import { AgentSessionsService } from './agent-sessions.service';
import { AgentSyncReport, LiveAgentConnectionHandle } from './agent-connection';

/** How long an agent may be away before head office is told. A reconnect blip is not news. */
export const OFFLINE_ALERT_AFTER_MS = 90_000;

/** A connected agent whose snapshot has not been confirmed for this long is falling behind (§12.7). */
export const SNAPSHOT_STALE_AFTER_MS = 30 * 60_000;
/** Offline orders waiting this long while the agent is online are stuck. */
export const BACKLOG_STUCK_AFTER_MS = 10 * 60_000;

/** What head office should look at in an agent's sync report. */
export function syncWarnings(sync: AgentSyncReport, now = new Date()): string[] {
  const out: string[] = [];
  const age = (at: string | null) => (at ? now.getTime() - new Date(at).getTime() : Infinity);
  if (age(sync.data_pulled_at) > SNAPSHOT_STALE_AFTER_MS) out.push('SNAPSHOT_STALE');
  if (sync.pending_orders > 0 && age(sync.oldest_pending_at) > BACKLOG_STUCK_AFTER_MS) out.push('BACKLOG_STUCK');
  if (sync.last_upload_error) out.push('UPLOAD_FAILING');
  return out;
}
const SWEEP_INTERVAL_MS = 30_000;

/** The roles the offline till's staff list carries (§13.3); kept in step with agent-data. */
const TILL_ROLES = ['CASHIER', 'SUPERVISOR', 'MANAGER', 'ADMIN', 'OWNER'];

/**
 * Whether a branch could sell offline if the internet went now (agent-protocol.md §16.8), and
 * what is missing. Said while the agent is online, so it is fixed before it matters.
 */
export type OfflineReadiness = { ready: boolean; problems: OfflineProblem[] };
export type OfflineProblem = 'AGENT_TOO_OLD' | 'NO_TILL' | 'NO_SHIFT' | 'NO_STAFF' | 'SNAPSHOT_STALE' | 'UPLOADS_WAITING';
export const AGENT_OFFLINE_ALERT = 'AGENT_OFFLINE';

/**
 * Whether each branch agent is there, and what it last said about its devices (task 7).
 *
 * Offline alerts come from a sweep rather than from socket close events: a deploy closes every
 * socket at once, and after a restart an agent that never comes back produces no event at all.
 * The sweep only asks "active, not connected, and not seen for a while".
 */
@Injectable()
export class AgentHealthService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AgentHealth');
  private timer: NodeJS.Timeout | null = null;
  private stopPresence: (() => void) | null = null;
  private running: Promise<void> | null = null;

  constructor(
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    @InjectRepository(OperationalAlert) private readonly alertRepo: Repository<OperationalAlert>,
    @InjectRepository(CashierShift) private readonly shiftRepo: Repository<CashierShift>,
    @InjectRepository(AdminUser) private readonly userRepo: Repository<AdminUser>,
    private readonly sessions: AgentSessionsService,
    private readonly commands: AgentCommandsService,
    private readonly registry: AgentRegistryService,
  ) {}

  onApplicationBootstrap() {
    // last_seen_at is written at most once a minute while connected; stamp the moment it left,
    // so the grace period is counted from the disconnect.
    this.stopPresence = this.sessions.onPresence((event, handle) => {
      if (event !== 'offline') return;
      this.agentRepo.update({ id: handle.agentId }, { last_seen_at: new Date() }).catch(() => undefined);
    });
    // The timer skips a beat rather than queue behind a slow sweep.
    this.timer = setInterval(() => {
      if (!this.running) void this.sweep();
    }, SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopPresence?.();
  }

  /**
   * Opens an alert for every active agent away too long, and closes the alerts of those back.
   * Runs one at a time; a caller that arrives mid-sweep waits for it and then sweeps itself,
   * so what it asked for is always done.
   */
  async sweep(now = new Date(), tenantId?: string): Promise<void> {
    while (this.running) await this.running;
    this.running = this.runSweep(now, tenantId);
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }

  private async runSweep(now: Date, tenantId?: string): Promise<void> {
    try {
      const agents = await this.agentRepo.find({ where: { status: 'ACTIVE', ...(tenantId ? { tenant_id: tenantId } : {}) } });
      for (const agent of agents) {
        if (this.sessions.isConnected(agent.id)) {
          await this.closeAlert(agent, now);
          continue;
        }
        const lastSign = new Date(agent.last_seen_at ?? agent.enrolled_at).getTime();
        if (now.getTime() - lastSign >= OFFLINE_ALERT_AFTER_MS) await this.openAlert(agent, lastSign);
      }
      // A revoked agent is not missing; it is gone on purpose.
      const orphaned = this.alertRepo
        .createQueryBuilder()
        .update(OperationalAlert)
        .set({ acknowledged: true, acknowledged_at: now, acknowledged_by: 'SYSTEM' })
        .where('type = :type AND acknowledged = false', { type: AGENT_OFFLINE_ALERT })
        .andWhere(
          `NOT EXISTS (SELECT 1 FROM agent a WHERE a.status = 'ACTIVE' AND a.tenant_id = operational_alert.tenant_id AND a.branch_id = operational_alert.branch_id)`,
        );
      if (tenantId) orphaned.andWhere('tenant_id = :tenantId', { tenantId });
      await orphaned.execute();
    } catch (err: any) {
      this.logger.error(`agent health sweep failed: ${err?.message || err}`);
    }
  }

  /**
   * Offline readiness for each connected, active agent; an agent not connected gets null: what
   * it last said may be stale, and its being away is shown already.
   */
  async offlineReadiness(tenantId: string, agents: AgentView[], now = new Date()): Promise<Map<string, OfflineReadiness | null>> {
    const out = new Map<string, OfflineReadiness | null>();
    for (const agent of agents) {
      const live = this.sessions.get(agent.id) as LiveAgentConnectionHandle | undefined;
      if (agent.status !== 'ACTIVE' || !live) {
        out.set(agent.id, null);
        continue;
      }
      const problems: OfflineProblem[] = [];
      if (!live.capabilities.includes('pos.till')) problems.push('AGENT_TOO_OLD');
      const terminalId = live.till?.terminal_id ?? null;
      if (!terminalId) problems.push('NO_TILL');
      else if ((await this.shiftRepo.count({ where: { tenant_id: tenantId, terminal_id: terminalId, state: 'OPEN' as any } })) === 0) {
        problems.push('NO_SHIFT');
      }
      const staff = await this.userRepo.count({
        where: { tenant_id: tenantId, branch_id: agent.branch_id, is_active: true, pin_hash: Not(IsNull()), role: In(TILL_ROLES) },
      });
      if (staff === 0) problems.push('NO_STAFF');
      const pulled = live.sync?.data_pulled_at ? new Date(live.sync.data_pulled_at).getTime() : 0;
      if (now.getTime() - pulled > SNAPSHOT_STALE_AFTER_MS) problems.push('SNAPSHOT_STALE');
      if ((live.sync?.pending_orders ?? 0) > 0) problems.push('UPLOADS_WAITING');
      out.set(agent.id, { ready: problems.length === 0, problems });
    }
    return out;
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
            sync: live.sync ?? null,
            till: live.till ?? null,
          }
        : { connected: false, devices: [] },
      sync_warnings: live?.sync ? syncWarnings(live.sync) : [],
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

  private async openAlert(agent: Agent, lastSign: number) {
    const open = await this.alertRepo.findOne({
      where: { tenant_id: agent.tenant_id, branch_id: agent.branch_id, type: AGENT_OFFLINE_ALERT, acknowledged: false },
    });
    if (open) return;
    const branch = await this.branchRepo.findOne({ where: { id: agent.branch_id, tenant_id: agent.tenant_id }, withDeleted: true });
    await this.alertRepo.save(
      this.alertRepo.create({
        tenant_id: agent.tenant_id,
        branch_id: agent.branch_id,
        type: AGENT_OFFLINE_ALERT,
        // Printers and card terminals the agent drives stop working while it is away.
        severity: 'CRITICAL',
        title: `Branch agent offline: ${branch?.name ?? agent.branch_id}`.slice(0, 150),
        message: `The branch agent on ${agent.hostname || 'the branch PC'} has not been connected since ${new Date(lastSign).toISOString()}. Print jobs and card payments for its devices wait until it is back. Check that the PC is on and online, and that the Gnext Agent service is running.`,
        acknowledged: false,
      }),
    );
    this.logger.warn(`agent ${agent.id} (branch ${agent.branch_id}) is offline`);
  }

  private async closeAlert(agent: Agent, now: Date) {
    await this.alertRepo.update(
      { tenant_id: agent.tenant_id, branch_id: agent.branch_id, type: AGENT_OFFLINE_ALERT, acknowledged: false },
      { acknowledged: true, acknowledged_at: now, acknowledged_by: 'SYSTEM' },
    );
  }
}
