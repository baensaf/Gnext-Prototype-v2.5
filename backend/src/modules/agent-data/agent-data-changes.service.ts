import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { AgentCommandsService } from '../agent-gateway/agent-commands.service';
import { AgentSessionsService } from '../agent-gateway/agent-sessions.service';
import { LiveChange, LiveChangesService, RESYNC_TOPIC } from '../live/live-changes.service';
import { AgentDataService } from './agent-data.service';

/** The notice topic migrations 073 and 076 raise for the tables a snapshot or staff list is built from. */
export const AGENT_DATA_TOPIC = 'agent-data';
/** Changes inside this window reach the agent as one `data.changed` (§12.3). */
export const DATA_CHANGED_COALESCE_MS = 10_000;

/**
 * Tells a connected agent when its branch snapshot has changed (protocol §12.3), so it pulls
 * without waiting for its 15-minute check. Only agents that advertise `data.pull` are told,
 * and only when the new version differs from the one they last fetched.
 */
@Injectable()
export class AgentDataChangesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentDataChangesService.name);
  private subscription: Subscription | null = null;
  /** Per tenant: the branches with a change waiting (null: the whole tenant), and its timer. */
  private readonly pending = new Map<string, { branches: Set<string | null>; timer: NodeJS.Timeout }>();
  /** Settles when every flush started so far is done; tests wait on it. */
  private flushing: Promise<void> = Promise.resolve();

  constructor(
    private readonly live: LiveChangesService,
    private readonly sessions: AgentSessionsService,
    private readonly commands: AgentCommandsService,
    private readonly data: AgentDataService,
  ) {}

  onModuleInit() {
    this.subscription = this.live.changes.subscribe((change) => this.onChange(change));
  }

  onModuleDestroy() {
    this.subscription?.unsubscribe();
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  onChange(change: LiveChange) {
    if (change.topic === RESYNC_TOPIC) {
      // Notices were lost while the listener was down: check every connected agent.
      for (const tenantId of new Set(this.sessions.all().map((h) => h.tenantId))) this.schedule(tenantId, null);
      return;
    }
    if (change.topic !== AGENT_DATA_TOPIC || !change.tenant_id) return;
    this.schedule(change.tenant_id, change.branch_id);
  }

  /** Whether a change for the tenant is waiting for its window to close. */
  isWaiting(tenantId: string): boolean {
    return this.pending.has(tenantId);
  }

  /** Waits for every flush started so far. */
  async settled(): Promise<void> {
    await this.flushing;
  }

  /** Checks the tenant's waiting branches now instead of when the window closes. */
  flushNow(tenantId: string): Promise<void> {
    const entry = this.pending.get(tenantId);
    if (!entry) return this.flushing;
    clearTimeout(entry.timer);
    this.pending.delete(tenantId);
    return this.startFlush(tenantId, entry.branches);
  }

  private schedule(tenantId: string, branchId: string | null) {
    const entry = this.pending.get(tenantId);
    if (entry) {
      entry.branches.add(branchId);
      return;
    }
    const timer = setTimeout(() => {
      const waiting = this.pending.get(tenantId);
      this.pending.delete(tenantId);
      if (waiting) void this.startFlush(tenantId, waiting.branches);
    }, DATA_CHANGED_COALESCE_MS);
    timer.unref?.();
    this.pending.set(tenantId, { branches: new Set([branchId]), timer });
  }

  private startFlush(tenantId: string, branches: Set<string | null>): Promise<void> {
    const run = this.flushing.then(() => this.flush(tenantId, branches));
    this.flushing = run.catch(() => undefined);
    return this.flushing;
  }

  private async flush(tenantId: string, branches: Set<string | null>) {
    const everyBranch = branches.has(null);
    const agents = this.sessions
      .all()
      .filter((h) => h.tenantId === tenantId && h.capabilities.includes('data.pull') && (everyBranch || branches.has(h.branchId)));
    for (const handle of agents) {
      try {
        const { data_version } = await this.data.build(tenantId, handle.branchId);
        // An agent with the offline till also keeps the staff list (§13.3), announced the same way.
        const staff_version = handle.capabilities.includes('pos.offline')
          ? (await this.data.buildStaff(tenantId, handle.branchId)).staff_version
          : undefined;
        const dataCurrent = data_version === this.data.servedVersion(tenantId, handle.branchId);
        const staffCurrent = !staff_version || staff_version === this.data.servedStaffVersion(tenantId, handle.branchId);
        if (dataCurrent && staffCurrent) continue;
        await this.commands.enqueue(tenantId, handle.branchId, 'data.changed', staff_version ? { data_version, staff_version } : { data_version });
      } catch (err: any) {
        this.logger.warn(`data.changed for agent ${handle.agentId} failed: ${err?.message || err}`);
      }
    }
  }
}
