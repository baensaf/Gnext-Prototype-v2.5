import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { AgentCommand, AgentCommandStatus } from '../../entities/AgentCommand.entity';
import { AgentHandlerResult, AgentMessageHandlers } from './agent-message-handlers.service';
import { envelope, Envelope } from './agent-protocol';
import { AgentConnectionHandle, AgentSessionsService } from './agent-sessions.service';

/** How long a command may wait for the agent's ack (protocol §5.2). */
export const COMMAND_TTL_MS: Record<string, number> = {
  'print.job': 30 * 60_000,
  'payment.charge': 60_000,
  'payment.query': 10 * 60_000,
  'config.updated': 24 * 3600_000,
  'agent.check_update': 24 * 3600_000,
};
const DEFAULT_TTL_MS = 10 * 60_000;

/** Commands the agent only acks; everything else ends in a `*.result`. */
const ACK_ONLY_TYPES = new Set(['config.updated', 'agent.check_update']);

/** A SENT command with no ack after this long is sent again (§4.4). */
export const RESEND_AFTER_MS = 15_000;
const LOOP_INTERVAL_MS = 5_000;

const PENDING: AgentCommandStatus[] = ['QUEUED', 'SENT'];
/** A result is applied to a command in these states; the work happened even if the ack was lost. */
const ACCEPTS_RESULT: AgentCommandStatus[] = ['QUEUED', 'SENT', 'ACKED', 'EXPIRED'];

export interface EnqueueOptions {
  ttlMs?: number;
  entityType?: string;
  entityId?: string;
  /** Defaults by type: config.updated and agent.check_update expect none. */
  expectsResult?: boolean;
}

export interface ResultOutcome {
  status?: 'DONE' | 'FAILED';
  errorCode?: string | null;
  errorMessage?: string | null;
}

/**
 * Applies a result to whatever the command was about (a print attempt, a payment). Runs in
 * the transaction that settles the command, with the command row locked, so a resent result
 * is never applied twice.
 */
export type ResultApplier = (ctx: {
  command: AgentCommand;
  message: Envelope;
  connection: AgentConnectionHandle;
  em: EntityManager;
}) => Promise<ResultOutcome | void>;

/** Told about every command that reached DONE, FAILED or EXPIRED. */
export type CommandSettledListener = (command: AgentCommand) => void | Promise<void>;

/**
 * Durable command delivery to branch agents (protocol §4.4): every command is stored first,
 * sent while the branch's agent is online, resent until acked, replayed on reconnect, and
 * settled by the agent's ack or result.
 *
 * Not built on the outbox: outbox events are retried on a time backoff until an external call
 * succeeds, whereas a command waits for a connection and moves on the agent's ack and result.
 */
@Injectable()
export class AgentCommandsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AgentCommands');
  private readonly settledListeners = new Set<CommandSettledListener>();
  private readonly flushing = new Set<string>();
  private readonly flushAgain = new Map<string, boolean>();
  private loop: NodeJS.Timeout | null = null;
  private stopPresence: (() => void) | null = null;
  private ticking = false;

  constructor(
    @InjectRepository(AgentCommand) private readonly repo: Repository<AgentCommand>,
    private readonly dataSource: DataSource,
    private readonly sessions: AgentSessionsService,
    private readonly handlers: AgentMessageHandlers,
  ) {}

  onApplicationBootstrap() {
    this.handlers.register('ack', (message, connection) => this.handleAck(message, connection));
    this.stopPresence = this.sessions.onPresence((event, handle) => {
      // A reconnect replays everything not yet acked, SENT included: the old socket may have lost it.
      if (event === 'online') void this.flush(handle.tenantId, handle.branchId, true);
    });
    this.loop = setInterval(() => void this.tick(), LOOP_INTERVAL_MS);
    this.loop.unref?.();
  }

  onApplicationShutdown() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.stopPresence?.();
  }

  onSettled(listener: CommandSettledListener): () => void {
    this.settledListeners.add(listener);
    return () => this.settledListeners.delete(listener);
  }

  /**
   * Handles `resultType` messages for commands of `commandTypes`: the applier runs once per
   * command, and the agent gets `ack ok:true` for every copy it sends (§4.4).
   */
  registerResult(resultType: string, commandTypes: string[], applier: ResultApplier): void {
    this.handlers.register(resultType, (message, connection) => this.handleResult(message, connection, commandTypes, applier));
  }

  /** Stores a command and sends it at once if the branch's agent is online. */
  async enqueue(tenantId: string, branchId: string, type: string, payload: Record<string, any>, options: EnqueueOptions = {}) {
    const command = await this.repo.save(this.build(tenantId, branchId, type, payload, options));
    await this.flush(tenantId, branchId);
    return command;
  }

  /** Stores a command inside the caller's transaction. Call `flush` once it has committed. */
  async enqueueInTransaction(
    em: EntityManager,
    tenantId: string,
    branchId: string,
    type: string,
    payload: Record<string, any>,
    options: EnqueueOptions = {},
  ) {
    return await em.save(AgentCommand, this.build(tenantId, branchId, type, payload, options));
  }

  /**
   * Sends what is waiting for the branch's agent, oldest first: new commands, and with
   * `includeSent` also those sent but not yet acked.
   */
  async flush(tenantId: string, branchId: string, includeSent = false): Promise<void> {
    if (!this.sessions.forBranch(tenantId, branchId)) return;
    const key = `${tenantId}:${branchId}`;
    // One flush per branch at a time, so a burst of enqueues does not send a command twice.
    // A flush asked for meanwhile runs once more afterwards.
    if (this.flushing.has(key)) {
      this.flushAgain.set(key, (this.flushAgain.get(key) ?? false) || includeSent);
      return;
    }
    this.flushing.add(key);
    try {
      let sendSent = includeSent;
      for (;;) {
        const handle = this.sessions.forBranch(tenantId, branchId);
        if (!handle) return;
        const pending = await this.repo.find({
          where: {
            tenant_id: tenantId,
            branch_id: branchId,
            status: In(sendSent ? PENDING : ['QUEUED']),
            expires_at: MoreThan(new Date()),
          },
          order: { created_at: 'ASC' },
        });
        for (const command of pending) await this.send(handle, command);
        if (!this.flushAgain.has(key)) break;
        sendSent = this.flushAgain.get(key)!;
        this.flushAgain.delete(key);
      }
    } catch (err: any) {
      this.logger.error(`flush ${key} failed: ${err?.message || err}`);
    } finally {
      this.flushing.delete(key);
      this.flushAgain.delete(key);
    }
  }

  /** Expires what nobody acked in time and resends what is overdue for an ack. */
  async tick(now = new Date()): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const expired = await this.repo.find({ where: { status: In(PENDING), expires_at: LessThanOrEqual(now) } });
      for (const command of expired) {
        const res = await this.repo.update(
          { id: command.id, status: In(PENDING) },
          { status: 'EXPIRED', completed_at: now, error_code: 'EXPIRED', error_message: 'The agent did not acknowledge the command in time.' },
        );
        if (res.affected) await this.notify({ ...command, status: 'EXPIRED', completed_at: now, error_code: 'EXPIRED' });
      }

      const overdue = await this.repo.find({
        where: { status: 'SENT', last_sent_at: LessThanOrEqual(new Date(now.getTime() - RESEND_AFTER_MS)), expires_at: MoreThan(now) },
        order: { created_at: 'ASC' },
      });
      for (const command of overdue) {
        const handle = this.sessions.forBranch(command.tenant_id, command.branch_id);
        if (handle) await this.send(handle, command);
      }
    } catch (err: any) {
      this.logger.error(`delivery loop failed: ${err?.message || err}`);
    } finally {
      this.ticking = false;
    }
  }

  async recentForAgentBranch(tenantId: string, branchId: string, limit = 50) {
    return await this.repo.find({
      where: { tenant_id: tenantId, branch_id: branchId },
      order: { created_at: 'DESC' },
      take: limit,
    });
  }

  private build(tenantId: string, branchId: string, type: string, payload: Record<string, any>, options: EnqueueOptions) {
    return this.repo.create({
      id: randomUUID(),
      tenant_id: tenantId,
      branch_id: branchId,
      type,
      payload,
      status: 'QUEUED',
      expects_result: options.expectsResult ?? !ACK_ONLY_TYPES.has(type),
      entity_type: options.entityType ?? null,
      entity_id: options.entityId ?? null,
      expires_at: new Date(Date.now() + (options.ttlMs ?? COMMAND_TTL_MS[type] ?? DEFAULT_TTL_MS)),
      send_count: 0,
    });
  }

  private async send(handle: AgentConnectionHandle, command: AgentCommand) {
    const message = envelope(command.type, { ...command.payload, expires_at: new Date(command.expires_at).toISOString() }, null, command.id);
    if (!handle.send(message)) return;
    await this.repo
      .createQueryBuilder()
      .update(AgentCommand)
      .set({ status: 'SENT', send_count: () => 'send_count + 1', last_sent_at: new Date() })
      .where('id = :id AND status IN (:...pending)', { id: command.id, pending: PENDING })
      .execute();
  }

  private async handleAck(message: Envelope, connection: AgentConnectionHandle): Promise<AgentHandlerResult> {
    if (!message.ref) return null;
    const command = await this.repo.findOne({
      where: { id: message.ref, tenant_id: connection.tenantId, branch_id: connection.branchId },
    });
    // Acks for anything else (there is nothing else in v1) are ignored; an ack is never answered.
    if (!command || !PENDING.includes(command.status)) return null;

    const now = new Date();
    const ok = message.payload.ok === true;
    const error = ok ? null : message.payload.error || {};
    const next: Partial<AgentCommand> = ok
      ? command.expects_result
        ? { status: 'ACKED', acked_at: now }
        : { status: 'DONE', acked_at: now, completed_at: now }
      : {
          status: 'FAILED',
          acked_at: now,
          completed_at: now,
          error_code: String(error.code || 'REFUSED').slice(0, 64),
          error_message: typeof error.message === 'string' ? error.message : null,
        };

    const res = await this.repo.update({ id: command.id, status: In(PENDING) }, { ...next, agent_id: connection.agentId });
    if (res.affected && next.status !== 'ACKED') await this.notify({ ...command, ...next, agent_id: connection.agentId });
    return null;
  }

  private async handleResult(
    message: Envelope,
    connection: AgentConnectionHandle,
    commandTypes: string[],
    applier: ResultApplier,
  ): Promise<AgentHandlerResult> {
    if (!message.ref) return { ok: false, error: { code: 'INVALID_PAYLOAD', message: 'ref must name the command' } };

    let settled: AgentCommand | null = null;
    const answer = await this.dataSource.transaction(async (em): Promise<AgentHandlerResult> => {
      const command = await em.findOne(AgentCommand, {
        where: { id: message.ref!, tenant_id: connection.tenantId, branch_id: connection.branchId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!command) {
        // Nothing to apply it to, but the agent must stop resending it.
        this.logger.warn(`agent ${connection.agentId}: ${message.type} for unknown command ${message.ref}`);
        return { ok: true };
      }
      if (!commandTypes.includes(command.type)) {
        return { ok: false, error: { code: 'INVALID_PAYLOAD', message: `${message.type} does not answer ${command.type}` } };
      }
      if (!ACCEPTS_RESULT.includes(command.status)) {
        // Already settled: a resent result, or a result for a command the agent refused.
        return { ok: true };
      }

      const outcome = (await applier({ command, message, connection, em })) || {};
      const now = new Date();
      command.status = outcome.status ?? 'DONE';
      command.agent_id = connection.agentId;
      command.acked_at = command.acked_at ?? now;
      command.completed_at = now;
      command.result = message.payload;
      command.result_message_id = isUuid(message.id) ? message.id : null;
      command.error_code = outcome.errorCode ?? null;
      command.error_message = outcome.errorMessage ?? null;
      settled = await em.save(AgentCommand, command);
      return { ok: true };
    });

    if (settled) await this.notify(settled);
    return answer;
  }

  private async notify(command: AgentCommand) {
    for (const listener of this.settledListeners) {
      try {
        await listener(command);
      } catch (err: any) {
        this.logger.error(`settled listener failed for ${command.id}: ${err?.message || err}`);
      }
    }
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
