import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PrintJob } from '../../entities/PrintJob.entity';
import { PrintAttempt } from '../../entities/PrintAttempt.entity';
import { Printer } from '../../entities/Printer.entity';
import { AgentCommand } from '../../entities/AgentCommand.entity';
import { AgentCommandsService, ResultOutcome } from '../agent-gateway/agent-commands.service';
import { Envelope } from '../agent-gateway/agent-protocol';

/** Printing error codes an agent may report (protocol §8.3). Anything else is kept as PRINTER_ERROR. */
const PRINT_ERROR_CODES = new Set([
  'PRINTER_UNREACHABLE',
  'PRINTER_OFFLINE',
  'PAPER_OUT',
  'COVER_OPEN',
  'PRINTER_ERROR',
  'RENDER_FAILED',
  'SPOOLER_ERROR',
  'TIMEOUT',
  'AGENT_RESTARTED',
]);

/** Why an attempt failed when no result ever came (the command itself failed). */
const COMMAND_FAILURE_MESSAGES: Record<string, string> = {
  EXPIRED: 'The branch agent did not take the job in time. Is the agent PC on and online?',
  DEVICE_NOT_CONFIGURED: 'The branch agent does not know this printer. Check its connection settings.',
  WITHDRAWN: 'The job was withdrawn before it reached the branch agent.',
  SUPERSEDED: 'The job was replaced before it reached the branch agent.',
  AGENT_REVOKED: 'The branch agent was revoked. Reprint the job if it is still needed.',
};

/** How long a job waits for an offline agent before it fails (a day); nothing expires by itself (K-20). */
const JOB_WAIT_MS = 24 * 3600_000;

/**
 * Printing through the branch agent (protocol §7.1, §7.2): a print attempt becomes a
 * `print.job` command, and the agent's `print.result` settles the attempt and its job.
 *
 * What the cashier sees (K-20, as in Toast and Square): PROCESSING is "waiting" for the agent;
 * SUCCESS is printed (a printer that cannot report its state counts as printed once it takes the
 * job); FAILED did not print, or its result is unknown. Nothing is sent again by itself: a person
 * reprints.
 */
@Injectable()
export class AgentPrintingService implements OnApplicationBootstrap {
  private readonly logger = new Logger('AgentPrinting');

  constructor(
    private readonly dataSource: DataSource,
    private readonly commands: AgentCommandsService,
    @InjectRepository(PrintAttempt) private readonly attemptRepo: Repository<PrintAttempt>,
  ) {}

  onApplicationBootstrap() {
    this.commands.registerResult('print.result', ['print.job'], (ctx) => this.applyResult(ctx.command, ctx.message, ctx.em));
    this.commands.onSettled((command) => this.onCommandSettled(command));
  }

  /**
   * Hands one attempt of `job` on `printer` to the agent. The attempt stays PENDING and the job
   * PROCESSING until the agent answers; if the agent is offline, the command waits for it.
   */
  async send(tenantId: string, job: PrintJob, printer: Printer, attemptNo: number): Promise<{ job: PrintJob; attempt: PrintAttempt }> {
    const saved = await this.dataSource.transaction(async (em) => {
      const attempt = await em.save(
        PrintAttempt,
        em.create(PrintAttempt, {
          tenant_id: tenantId,
          job_id: job.id,
          printer_id: printer.id,
          attempt_no: attemptNo,
          status: 'PENDING',
          started_at: new Date(),
        }),
      );
      const command = await this.commands.enqueueInTransaction(
        em,
        tenantId,
        job.branch_id,
        'print.job',
        {
          job_id: job.id,
          attempt_no: attemptNo,
          printer_id: printer.id,
          document_type: job.document_type,
          label: job.label ?? null,
          copies: job.copies || 1,
          content: { format: 'html', html: job.rendered_html },
        },
        { entityType: 'PrintAttempt', entityId: attempt.id, ttlMs: JOB_WAIT_MS },
      );
      attempt.agent_command_id = command.id;
      await em.save(PrintAttempt, attempt);

      job.status = 'PROCESSING';
      job.completed_at = null as any;
      if (!job.printer_id) job.printer_id = printer.id;
      const savedJob = await em.save(PrintJob, job);
      return { job: savedJob, attempt };
    });
    await this.commands.flush(tenantId, job.branch_id);
    return saved;
  }

  private async applyResult(command: AgentCommand, message: Envelope, em: EntityManager): Promise<ResultOutcome> {
    const p = message.payload;
    const attempt = await em.findOne(PrintAttempt, {
      where: { id: command.entity_id!, tenant_id: command.tenant_id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!attempt) return { status: 'FAILED', errorCode: 'NOT_FOUND', errorMessage: 'The print attempt no longer exists.' };
    if (p.job_id !== undefined && p.job_id !== attempt.job_id) {
      return { status: 'FAILED', errorCode: 'INVALID_PAYLOAD', errorMessage: 'job_id does not match the command.' };
    }

    const success = p.status === 'SUCCESS';
    const error = success ? null : p.error || {};
    const errorCode = success ? null : PRINT_ERROR_CODES.has(error.code) ? error.code : 'PRINTER_ERROR';
    const errorMessage = success ? null : typeof error.message === 'string' ? error.message.slice(0, 1000) : null;
    const finishedAt = parseDate(p.finished_at) ?? new Date();

    attempt.status = success ? 'SUCCESS' : 'FAILED';
    attempt.error_code = errorCode;
    attempt.error_message = errorMessage;
    attempt.finished_at = finishedAt;
    await em.save(PrintAttempt, attempt);

    await this.settleJob(em, attempt, success ? 'SUCCESS' : 'FAILED', errorCode, errorMessage);
    return success ? { status: 'DONE' } : { status: 'FAILED', errorCode, errorMessage };
  }

  /** A command that ended without a result: refused by the agent, or never acked. */
  private async onCommandSettled(command: AgentCommand) {
    if (command.type !== 'print.job' || command.status === 'DONE' || command.result) return;
    const code = command.error_code || 'AGENT_ERROR';
    await this.dataSource.transaction(async (em) => {
      const attempt = await em.findOne(PrintAttempt, {
        where: { id: command.entity_id!, tenant_id: command.tenant_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!attempt || attempt.status !== 'PENDING') return;
      const message = COMMAND_FAILURE_MESSAGES[code] || command.error_message || 'The branch agent could not print this job.';
      attempt.status = 'FAILED';
      attempt.error_code = code;
      attempt.error_message = message;
      attempt.finished_at = new Date();
      await em.save(PrintAttempt, attempt);
      // Never answered: it did not print, or nobody knows; either way it is Failed (K-20).
      await this.settleJob(em, attempt, 'FAILED', code, message);
    });
  }

  /**
   * The job follows its latest attempt. A failure leaves the job FAILED in the print queue,
   * where a person reprints it.
   */
  private async settleJob(
    em: EntityManager,
    attempt: PrintAttempt,
    status: 'SUCCESS' | 'FAILED',
    code: string | null,
    message: string | null,
  ) {
    const job = await em.findOne(PrintJob, { where: { id: attempt.job_id, tenant_id: attempt.tenant_id } });
    if (!job) return;
    const latest = await em.findOne(PrintAttempt, { where: { job_id: job.id }, order: { attempt_no: 'DESC' } });
    // An older attempt answering late does not overrule a newer one.
    if (latest && latest.id !== attempt.id) return;

    job.status = status;
    job.completed_at = status === 'SUCCESS' ? new Date() : (null as any);
    await em.save(PrintJob, job);

    if (status === 'SUCCESS') return;
    this.logger.warn(`print job ${job.id} failed on ${attempt.printer_id}: ${code}`);
  }
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
