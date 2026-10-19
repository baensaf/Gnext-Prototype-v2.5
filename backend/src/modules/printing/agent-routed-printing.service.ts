import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PrintJob } from '../../entities/PrintJob.entity';
import { PrintAttempt } from '../../entities/PrintAttempt.entity';
import { Printer } from '../../entities/Printer.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Agent } from '../../entities/Agent.entity';
import { AgentCommand } from '../../entities/AgentCommand.entity';
import { AgentCommandsService, ResultOutcome } from '../agent-gateway/agent-commands.service';
import { Envelope } from '../agent-gateway/agent-protocol';
import { AuditWriter } from '../audit/audit-writer.service';

/** The capability of an agent that routes kitchen chits itself (protocol §21). */
export const ROUTE_CAPABILITY = 'print.route';

/** How long an order waits for an offline agent before its job fails, as a print.job does (K-20). */
const ORDER_WAIT_MS = 24 * 3600_000;

/** Printing error codes an agent may report for a chit; anything else is kept as PRINTER_ERROR. */
const CHIT_ERROR_CODES = new Set([
  'PRINTER_UNREACHABLE',
  'PRINTER_OFFLINE',
  'PAPER_OUT',
  'COVER_OPEN',
  'PRINTER_ERROR',
  'RENDER_FAILED',
  'TIMEOUT',
  'AGENT_RESTARTED',
  'UNROUTED',
  'PRINTER_OUT_OF_SERVICE',
  'DEVICE_NOT_CONFIGURED',
]);

const COMMAND_FAILURE_MESSAGES: Record<string, string> = {
  EXPIRED: 'The branch agent did not take the order in time. Is the agent PC on and online?',
  WITHDRAWN: 'The order was withdrawn before it reached the branch agent.',
  AGENT_REVOKED: 'The branch agent was revoked. Reprint the chits if they are still needed.',
};

/** What the cloud sends with order.print: the chits' heading and the order's kitchen lines. */
export interface OrderPrintPayload {
  order_id: string;
  heading: {
    display_number: string;
    order_number: string;
    type_line: string;
    date_time: string;
    time: string;
    order_notes?: string;
    template?: string;
  };
  lines: Array<{
    line_id: string;
    product_id: string;
    category_id?: string;
    name: string;
    quantity: string;
    options?: string;
    note?: string;
    change?: 'VOID' | 'ADD';
    sent_to: string[] | null;
  }>;
  kitchen_change?: 'AMENDED' | 'CANCELLED';
  change_reason?: string;
}

/**
 * Kitchen chits routed by the branch agent (protocol §21, agent 2.5.0). The cloud sends the order
 * once; the agent splits it by printer with the routing in its config, lays out and prints each
 * chit, and reports every one. Until it answers, one job stands for the order in the print queue,
 * waiting; the answer turns it into one job per chit, printed or failed, which a person reprints
 * as any other (K-20).
 */
@Injectable()
export class AgentRoutedPrintingService implements OnApplicationBootstrap {
  private readonly logger = new Logger('AgentRoutedPrinting');

  constructor(
    private readonly dataSource: DataSource,
    private readonly commands: AgentCommandsService,
    private readonly auditWriter: AuditWriter,
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
  ) {}

  onApplicationBootstrap() {
    this.commands.registerResult('order.print.result', ['order.print'], (ctx) => this.applyResult(ctx.command, ctx.message, ctx.em));
    this.commands.onSettled((command) => this.onCommandSettled(command));
  }

  /** Whether the branch's agent routes kitchen chits: it said so in its last hello. */
  async routesOnAgent(tenantId: string, branchId: string): Promise<boolean> {
    if (typeof this.agentRepo?.findOne !== 'function') return false;
    const agent = await this.agentRepo.findOne({ where: { tenant_id: tenantId, branch_id: branchId, status: 'ACTIVE' } });
    return !!agent?.capabilities?.includes(ROUTE_CAPABILITY);
  }

  /**
   * Hands the order's kitchen lines to the branch's agent. The job returned stands for every chit
   * of the order until the agent answers; if the agent is offline, the order waits for it.
   */
  async send(
    tenantId: string,
    branchId: string,
    payload: OrderPrintPayload,
    opts: { reason?: string | null; userId?: string | null },
  ): Promise<PrintJob> {
    const job = await this.dataSource.transaction(async (em) => {
      const saved = await em.save(
        PrintJob,
        em.create(PrintJob, {
          tenant_id: tenantId,
          branch_id: branchId,
          document_type: 'KITCHEN_TICKET',
          entity_type: 'Order',
          entity_id: payload.order_id,
          printer_id: undefined,
          label: 'آشپزخانه',
          status: 'PROCESSING',
          copies: 1,
          rendered_html: '',
          is_reprint: false,
          reason: opts.reason || null,
          created_by: opts.userId || null,
        }),
      );
      await this.commands.enqueueInTransaction(em, tenantId, branchId, 'order.print', { job_id: saved.id, ...payload }, {
        entityType: 'PrintJob',
        entityId: saved.id,
        ttlMs: ORDER_WAIT_MS,
      });
      return saved;
    });
    await this.commands.flush(tenantId, branchId);
    await this.auditWriter.write({
      tenantId,
      actorType: opts.userId ? 'ADMIN' : 'SYSTEM',
      actorId: opts.userId ?? undefined,
      action: 'PRINT_ORDER_SENT_TO_AGENT',
      entityType: 'PrintJob',
      entityId: job.id,
      correlationId: 'corr-print-enqueue',
      details: { orderId: payload.order_id, lines: payload.lines.length, change: payload.kitchen_change ?? null },
    });
    return job;
  }

  /**
   * The agent's chits. The order's job becomes the first chit and each other chit a job of its
   * own, each with one attempt saying what the printer said. A chit for a printer the agent
   * cannot reach because it has no connection is the simulator's, as before: printed.
   */
  private async applyResult(command: AgentCommand, message: Envelope, em: EntityManager): Promise<ResultOutcome> {
    const p = message.payload;
    const job = await em.findOne(PrintJob, {
      where: { id: command.entity_id!, tenant_id: command.tenant_id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!job) return { status: 'FAILED', errorCode: 'NOT_FOUND', errorMessage: 'The print job no longer exists.' };
    if (p.job_id !== undefined && p.job_id !== job.id) {
      return { status: 'FAILED', errorCode: 'INVALID_PAYLOAD', errorMessage: 'job_id does not match the command.' };
    }
    const finishedAt = parseDate(p.finished_at) ?? new Date();
    const chits: any[] = Array.isArray(p.chits) ? p.chits : [];

    if (chits.length === 0) {
      if (p.error) {
        const code = CHIT_ERROR_CODES.has(p.error.code) ? p.error.code : 'PRINTER_ERROR';
        job.status = 'FAILED';
        job.reason = job.reason || (typeof p.error.message === 'string' ? p.error.message.slice(0, 1000) : code);
        await em.save(PrintJob, job);
        return { status: 'FAILED', errorCode: code, errorMessage: p.error.message ?? null };
      }
      // Every line is on the "not printed" list: nothing to print, so no job either.
      await em.delete(PrintJob, { id: job.id });
      return { status: 'DONE' };
    }

    const printerIds = [...new Set(chits.map((c) => c.printer_id).filter(Boolean))];
    const printers = printerIds.length
      ? await em.find(Printer, { where: printerIds.map((id) => ({ id, tenant_id: job.tenant_id })) })
      : [];
    const simulated = new Set(printers.filter((pr) => !pr.agent_connection).map((pr) => pr.id));

    const destinations = new Map<string, Set<string>>();
    let anyFailed = false;
    for (const [index, chit] of chits.entries()) {
      const printerId: string | null = chit.printer_id || null;
      const code: string | null = chit.status === 'SUCCESS' ? null : chit.error?.code ?? 'PRINTER_ERROR';
      // The agent reaches only printers with a connection; the rest still print in the simulator.
      const success = chit.status === 'SUCCESS' || (code === 'DEVICE_NOT_CONFIGURED' && !!printerId && simulated.has(printerId));
      const target =
        index === 0
          ? job
          : em.create(PrintJob, {
              tenant_id: job.tenant_id,
              branch_id: job.branch_id,
              document_type: job.document_type,
              entity_type: job.entity_type,
              entity_id: job.entity_id,
              copies: 1,
              is_reprint: false,
              reason: job.reason,
              created_by: job.created_by,
            });
      target.printer_id = printerId as any;
      target.label = typeof chit.label === 'string' ? chit.label.slice(0, 160) : job.label;
      target.rendered_html = typeof chit.html === 'string' ? chit.html : '';
      target.status = success ? 'SUCCESS' : 'FAILED';
      target.completed_at = success ? finishedAt : (null as any);
      const saved = await em.save(PrintJob, target);
      const errorCode = success ? null : CHIT_ERROR_CODES.has(code!) ? code : 'PRINTER_ERROR';
      await this.attempt(em, saved, printerId, success, errorCode, success ? null : chit.error?.message, finishedAt);
      if (!success) {
        anyFailed = true;
        this.logger.warn(`kitchen chit ${saved.id} failed on ${printerId ?? 'no printer'}: ${errorCode}`);
      }
      if (errorCode === 'UNROUTED') {
        await this.auditWriter.write({
          tenantId: job.tenant_id,
          actorType: 'SYSTEM',
          action: 'PRINT_JOB_UNROUTED',
          entityType: 'PrintJob',
          entityId: saved.id,
          correlationId: 'corr-print-enqueue',
          details: { documentType: job.document_type, branchId: job.branch_id, label: saved.label },
        });
      }
      // Each line keeps the printers it was sent to, so a later void goes to the same kitchens.
      if (printerId && !chit.whole_order) {
        for (const lineId of Array.isArray(chit.line_ids) ? chit.line_ids : []) {
          const set = destinations.get(lineId) ?? new Set<string>();
          set.add(printerId);
          destinations.set(lineId, set);
        }
      }
    }
    for (const [lineId, ids] of destinations) {
      await em.update(OrderItem, { id: lineId, tenant_id: job.tenant_id }, { kitchen_printer_ids: [...ids] });
    }
    return anyFailed ? { status: 'DONE', errorCode: 'SOME_CHITS_FAILED' } : { status: 'DONE' };
  }

  /** What the printer said, kept as the job's attempt. A chit with no printer has none, as in the cloud's own routing. */
  private async attempt(
    em: EntityManager,
    job: PrintJob,
    printerId: string | null,
    success: boolean,
    code: string | null,
    message: string | null | undefined,
    at: Date,
  ) {
    if (!printerId) return;
    await em.save(
      PrintAttempt,
      em.create(PrintAttempt, {
        tenant_id: job.tenant_id,
        job_id: job.id,
        printer_id: printerId,
        attempt_no: 1,
        status: success ? 'SUCCESS' : 'FAILED',
        error_code: code,
        error_message: typeof message === 'string' ? message.slice(0, 1000) : null,
        started_at: at,
        finished_at: at,
      }),
    );
  }

  /** An order the agent never answered: its job fails where the print queue shows it (K-20). */
  private async onCommandSettled(command: AgentCommand) {
    if (command.type !== 'order.print' || command.status === 'DONE' || command.result) return;
    const code = command.error_code || 'AGENT_ERROR';
    await this.dataSource.transaction(async (em) => {
      const job = await em.findOne(PrintJob, {
        where: { id: command.entity_id!, tenant_id: command.tenant_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!job || job.status !== 'PROCESSING') return;
      const message = COMMAND_FAILURE_MESSAGES[code] || command.error_message || 'The branch agent could not print this order.';
      job.status = 'FAILED';
      job.reason = job.reason || message;
      await em.save(PrintJob, job);
    });
  }
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
