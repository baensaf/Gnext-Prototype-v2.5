import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrintJob } from '../../entities/PrintJob.entity';
import { PrintAttempt } from '../../entities/PrintAttempt.entity';
import { Printer } from '../../entities/Printer.entity';
import { PrintRoute } from '../../entities/PrintRoute.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { OperationalAlert } from '../../entities/OperationalAlert.entity';
import { PrintRenderService } from './print-render.service';
import { PrintRoutingService } from './print-routing.service';
import { AuditWriter } from '../audit/audit-writer.service';
import { AgentPrintingService } from './agent-printing.service';

/** What changed on an order the kitchen has already been sent. */
export type KitchenChange =
  | { kind: 'AMENDED'; voidedItemIds: string[]; addedItemIds: string[]; reason?: string }
  | { kind: 'CANCELLED'; reason?: string };

const isActiveLine = (item: { state?: string }): boolean => (item.state || 'ACTIVE') === 'ACTIVE';

type LineChange = 'VOID' | 'ADD';

/** The lines of one order that share a print route, and so share a chit. */
interface StationBatch {
  route: PrintRoute | null;
  label: string;
  lines: Array<{ item: OrderItem; change?: LineChange }>;
}

interface JobOptions {
  isReprint: boolean;
  reason?: string;
  userId?: string;
  /**
   * Force every job this call produces onto one named printer, ignoring routing. Set only
   * by a person reprinting to somewhere else because the usual device is unusable. For a
   * kitchen ticket this deliberately collapses the station split: one printer working is
   * better than three stations printing nowhere.
   */
  targetPrinterId?: string;
}

@Injectable()
export class PrintQueueService {
  constructor(
    @InjectRepository(PrintJob) private readonly jobRepo: Repository<PrintJob>,
    @InjectRepository(PrintAttempt) private readonly attemptRepo: Repository<PrintAttempt>,
    @InjectRepository(Printer) private readonly printerRepo: Repository<Printer>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    private readonly renderService: PrintRenderService,
    private readonly routingService: PrintRoutingService,
    private readonly auditWriter: AuditWriter,
    @InjectRepository(OperationalAlert) private readonly alertRepo: Repository<OperationalAlert>,
    private readonly agentPrinting: AgentPrintingService,
  ) {}

  /**
   * Print a document for an order, returning every job it made.
   *
   * A kitchen ticket is split by print route: each line goes to its most specific route
   * (product, then category, then kitchen station, then the catch-all), and the lines that share
   * a route's printer group share one chit. A burger, fries and a drink can so come out as three
   * chits on three printers, each saying which part of the order it is. Receipts, bills and
   * courier slips are about the whole order and print once, on the catch-all route.
   */
  async enqueueOrderPrintJobs(
    tenantId: string,
    orderId: string,
    documentType: string = 'CUSTOMER_RECEIPT',
    isReprint = false,
    reason?: string,
    userId?: string,
    targetPrinterId?: string,
  ): Promise<PrintJob[]> {
    // Outside the catch below on purpose. That catch exists so a printing fault can never
    // roll back an order, and it swallows everything — including "you picked a printer that
    // does not exist", which is an answer the person at the till is waiting for. A named
    // printer is only ever passed by someone choosing one, so it is checked up front where
    // the error can still reach them.
    if (targetPrinterId) {
      const order = await this.orderRepo.findOne({ where: { id: orderId, tenant_id: tenantId } });
      if (!order) throw new NotFoundException(`Order ${orderId} not found`);
      await this.forcedTarget(tenantId, order.branch_id, targetPrinterId, 1);
    }

    try {
      const order = await this.loadOrder(tenantId, orderId);
      // Voided and replaced lines stay on the order for history, but a reprint that
      // showed them would send the kitchen back to cooking food that was struck off.
      const activeLines = (order.items || []).filter(isActiveLine);
      const opts = { isReprint, reason, userId, targetPrinterId };

      if (documentType !== 'KITCHEN_TICKET') {
        const html = this.renderService.renderDocument({
          ...this.orderHeading(order),
          documentType,
          items: activeLines.map((i) => this.renderLine(i)),
          subtotal: order.subtotal,
          discountTotal: order.discount_total,
          taxTotal: order.tax_total,
          grandTotal: order.grand_total,
        });
        const routes = await this.routingService.loadRoutes(tenantId, order.branch_id, documentType);
        return await this.recordJobs(tenantId, order, documentType, html, this.routingService.matchRoute(routes, {}), opts);
      }

      if (activeLines.length === 0) return [];
      const batches = await this.splitByRoute(tenantId, order, activeLines.map((item) => ({ item })));
      const jobs: PrintJob[] = [];
      for (const batch of batches) {
        const html = this.renderService.renderDocument({
          ...this.orderHeading(order),
          documentType,
          stationLabel: batch.label,
          items: batch.lines.map((l) => this.renderLine(l.item)),
        });
        jobs.push(...(await this.recordJobs(tenantId, order, documentType, html, batch.route, opts, batch.label)));
      }
      return jobs;
    } catch (err: any) {
      // Safe fallback: printing errors must NEVER throw and roll back order transactions!
      return [];
    }
  }

  /**
   * Tell the kitchen about a change to an order it already holds chits for.
   *
   * The original chit is never reprinted as though it were current. Each station gets only the
   * delta for its own lines - struck lines marked VOID, appended lines marked ADD - or, for a
   * cancellation, every line of its still on the order under a STOP heading. The lines are
   * routed exactly as the original chits were, so a voided burger reaches the grill and not
   * the bar.
   */
  async enqueueKitchenChangeTicket(tenantId: string, orderId: string, change: KitchenChange, userId?: string): Promise<PrintJob[]> {
    try {
      const order = await this.loadOrder(tenantId, orderId);
      const items = order.items || [];

      const lines: StationBatch['lines'] =
        change.kind === 'CANCELLED'
          ? items.filter(isActiveLine).map((item) => ({ item, change: 'VOID' as const }))
          : [
              ...items.filter((i) => change.voidedItemIds.includes(i.id)).map((item) => ({ item, change: 'VOID' as const })),
              ...items.filter((i) => change.addedItemIds.includes(i.id)).map((item) => ({ item, change: 'ADD' as const })),
            ];
      if (lines.length === 0) return [];

      const label = change.kind === 'CANCELLED' ? 'Order cancelled' : 'Order amended';
      const opts = { isReprint: false, reason: change.reason ? `${label}: ${change.reason}` : label, userId };

      const jobs: PrintJob[] = [];
      for (const batch of await this.splitByRoute(tenantId, order, lines)) {
        const html = this.renderService.renderDocument({
          ...this.orderHeading(order),
          documentType: 'KITCHEN_TICKET',
          stationLabel: batch.label,
          kitchenChange: change.kind,
          changeReason: change.reason,
          placedAt: new Date(),
          items: batch.lines.map((l) => this.renderLine(l.item, l.change)),
        });
        jobs.push(...(await this.recordJobs(tenantId, order, 'KITCHEN_TICKET', html, batch.route, opts, batch.label)));
      }
      return jobs;
    } catch (err: any) {
      // Same contract as enqueueOrderPrintJobs: the edit has already committed.
      return [];
    }
  }

  /**
   * Print one job again - the paper jammed, the chit fell in the fryer. It goes to the same
   * printer with the same content, so the grill gets back the grill's chit and not the whole
   * order. A job that never had a printer is routed afresh instead.
   *
   * `targetPrinterId` overrides where it lands. Routing and the fallback printer cover a
   * printer that reports failure, but not the everyday case where the device is simply
   * gone — out of paper, unplugged by a cleaner, cooked — and the chit has to come out
   * somewhere else now. The override is recorded on the job so the print history shows the
   * copy went elsewhere and why.
   */
  async reprintJob(
    tenantId: string,
    jobId: string,
    reason?: string,
    userId?: string,
    targetPrinterId?: string,
  ): Promise<PrintJob[]> {
    const job = await this.jobRepo.findOne({ where: { id: jobId, tenant_id: tenantId } });
    if (!job) throw new NotFoundException(`Print job ${jobId} not found`);

    // A printer from another tenant, or one that has been retired, must not receive a chit.
    let override: Printer | null = null;
    if (targetPrinterId) {
      override = await this.printerRepo.findOne({ where: { id: targetPrinterId, tenant_id: tenantId } });
      if (!override) throw new NotFoundException(`Printer ${targetPrinterId} not found`);
      // Sending the kitchen's chit to another site's printer is worse than not printing.
      if (job.branch_id && override.branch_id && override.branch_id !== job.branch_id) {
        throw new BadRequestException('Cannot reprint to a printer at a different branch');
      }
    }

    if (!job.printer_id && !override) {
      return this.enqueueOrderPrintJobs(tenantId, job.entity_id, job.document_type, true, reason, userId);
    }

    const destination = override ? override.id : job.printer_id;

    const copy = await this.jobRepo.save(
      this.jobRepo.create({
        tenant_id: tenantId,
        branch_id: job.branch_id,
        document_type: job.document_type,
        entity_type: job.entity_type,
        entity_id: job.entity_id,
        printer_id: destination,
        // The group routed the original. A copy aimed by hand at one device is no longer
        // that group's job, and leaving the link would let a retry re-route it back.
        printer_group_id: override ? null : job.printer_group_id,
        label: job.label,
        status: 'QUEUED',
        copies: job.copies,
        rendered_html: job.rendered_html,
        is_reprint: true,
        reason: override ? `${reason || 'Manual Reprint Request'} (redirected to ${override.name})` : reason || null,
        created_by: userId || null,
      }),
    );
    return [await this.printOn(tenantId, copy, destination, { isReprint: true, userId })];
  }

  private async loadOrder(tenantId: string, orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, tenant_id: tenantId },
      relations: ['items', 'items.options'],
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    // Postgres returns the lines in no set order. Chits print in the order their first line
    // appears, so without this the same order could number its stations differently each time.
    order.items = [...(order.items || [])].sort((a, b) => (a.line_number || 0) - (b.line_number || 0));
    return order;
  }

  /**
   * Group lines by the printer group their route sends them to, keeping the order the lines
   * came in. Two routes naming the same group are one chit, printed with the larger copy count.
   * Lines no route claims share one batch, which falls back to any printer in the branch.
   */
  private async splitByRoute(tenantId: string, order: OrderHeader, lines: StationBatch['lines']): Promise<StationBatch[]> {
    const [routes, contexts] = await Promise.all([
      this.routingService.loadRoutes(tenantId, order.branch_id, 'KITCHEN_TICKET'),
      this.routingService.lineContexts(tenantId, order.branch_id, lines.map((l) => l.item.product_id)),
    ]);

    const batches = new Map<string, StationBatch>();
    for (const line of lines) {
      const route = this.routingService.matchRoute(routes, contexts.get(line.item.product_id) || {});
      const key = route ? route.printer_group_id : '';
      const batch = batches.get(key);
      if (!batch) {
        batches.set(key, { route, label: '', lines: [line] });
        continue;
      }
      batch.lines.push(line);
      if (route && (route.copies || 1) > (batch.route?.copies || 1)) batch.route = route;
    }

    const result = [...batches.values()];
    for (const [index, batch] of result.entries()) {
      const name = (batch.route && (await this.routingService.groupName(tenantId, batch.route.printer_group_id))) || 'Kitchen';
      batch.label = result.length > 1 ? `${name} (${index + 1}/${result.length})` : name;
    }
    return result;
  }

  private orderHeading(order: OrderHeader) {
    return {
      orderNumber: order.order_number,
      orderType: order.order_type,
      tableNumber: order.table_number || undefined,
      customerName: order.customer_id || undefined,
      placedAt: order.placed_at || order.submitted_at || new Date(),
    };
  }

  private renderLine(i: OrderItem, change?: LineChange) {
    return {
      product_name: i.product_name,
      quantity: i.quantity,
      unit_price: i.unit_price,
      total_price: i.subtotal || i.unit_price,
      special_instructions: i.special_instructions || undefined,
      options_summary: i.options ? i.options.map((o) => o.option_item_name).join(', ') : undefined,
      change,
    };
  }

  /** One job per printer the route reaches, or one failed job when it reaches none. */
  private async recordJobs(
    tenantId: string,
    order: OrderHeader,
    documentType: string,
    html: string,
    route: PrintRoute | null,
    opts: JobOptions,
    label?: string,
  ): Promise<PrintJob[]> {
    // A hand-picked printer replaces whatever routing chose, and keeps the route's copy
    // count so a receipt that normally prints twice still does.
    const routed = await this.routingService.printersForRoute(tenantId, order.branch_id, route);
    const targets = opts.targetPrinterId
      ? await this.forcedTarget(tenantId, order.branch_id, opts.targetPrinterId, route?.copies || routed[0]?.copies || 1)
      : routed;
    const newJob = (printerId: string | undefined, copies: number) =>
      this.jobRepo.create({
        tenant_id: tenantId,
        branch_id: order.branch_id,
        document_type: documentType,
        entity_type: 'Order',
        entity_id: order.id,
        printer_id: printerId,
        printer_group_id: route?.printer_group_id,
        label,
        status: 'QUEUED',
        copies,
        rendered_html: html,
        is_reprint: opts.isReprint,
        reason: opts.reason || null,
        created_by: opts.userId || null,
      });

    // No printer at all, so nothing will ever print this. It used to stay QUEUED with no
    // printer and an ordinary "enqueued" audit entry — a kitchen ticket that went nowhere
    // looked exactly like one that printed. Fail it where the print queue shows failures,
    // and tell the branch.
    if (targets.length === 0) {
      const savedJob = await this.jobRepo.save(newJob(undefined, route?.copies || 1));
      savedJob.status = 'FAILED';
      await this.jobRepo.save(savedJob);
      await this.raiseUnroutedAlert(tenantId, order, documentType);
      await this.auditWriter.write({
        tenantId,
        actorType: opts.userId ? 'ADMIN' : 'SYSTEM',
        actorId: opts.userId,
        action: 'PRINT_JOB_UNROUTED',
        entityType: 'PrintJob',
        entityId: savedJob.id,
        correlationId: 'corr-print-enqueue',
        details: { documentType, orderNumber: order.order_number, branchId: order.branch_id, label },
      });
      return [savedJob];
    }

    const jobs: PrintJob[] = [];
    for (const target of targets) {
      const savedJob = await this.jobRepo.save(newJob(target.printer.id, target.copies));
      jobs.push(await this.printOn(tenantId, savedJob, target.printer.id, opts));
    }
    return jobs;
  }

  /**
   * The one printer an operator named, checked before anything is queued to it: it has to
   * exist for this tenant, be in service, and belong to the order's branch. A chit that
   * prints at another site is worse than one that does not print.
   */
  private async forcedTarget(
    tenantId: string,
    branchId: string,
    printerId: string,
    copies: number,
  ): Promise<Array<{ printer: Printer; copies: number }>> {
    const printer = await this.printerRepo.findOne({ where: { id: printerId, tenant_id: tenantId } });
    if (!printer) throw new NotFoundException(`Printer ${printerId} not found`);
    if (!printer.is_active) throw new BadRequestException(`Printer ${printer.name} is not in service`);
    if (branchId && printer.branch_id && printer.branch_id !== branchId) {
      throw new BadRequestException('Cannot print to a printer at a different branch');
    }
    return [{ printer, copies }];
  }

  /**
   * A printer the branch agent drives gets the job through the agent, and the job waits for its
   * answer. Any other printer is the simulator's, which takes the job at once: one successful
   * attempt. Either way, then the audit entry.
   */
  private async printOn(tenantId: string, job: PrintJob, printerId: string, opts: Pick<JobOptions, 'isReprint' | 'userId'>) {
    const printer = await this.printerRepo.findOne({ where: { id: printerId, tenant_id: tenantId } });
    if (printer?.agent_connection) {
      const { job: sent } = await this.agentPrinting.send(tenantId, job, printer, 1);
      await this.auditPrint(tenantId, sent, opts, { via: 'AGENT' });
      return sent;
    }

    await this.attemptRepo.save(
      this.attemptRepo.create({
        tenant_id: tenantId,
        job_id: job.id,
        printer_id: printerId,
        attempt_no: 1,
        status: 'SUCCESS',
        started_at: new Date(),
        finished_at: new Date(),
      }),
    );
    job.status = 'SUCCESS';
    job.completed_at = new Date();
    const saved = await this.jobRepo.save(job);
    await this.auditPrint(tenantId, saved, opts);
    return saved;
  }

  private async auditPrint(tenantId: string, job: PrintJob, opts: Pick<JobOptions, 'isReprint' | 'userId'>, details?: Record<string, any>) {
    await this.auditWriter.write({
      tenantId,
      actorType: opts.userId ? 'ADMIN' : 'SYSTEM',
      actorId: opts.userId,
      action: opts.isReprint ? 'PRINT_JOB_REPRINTED' : 'PRINT_JOB_ENQUEUED',
      entityType: 'PrintJob',
      entityId: job.id,
      correlationId: 'corr-print-enqueue',
      details,
    });
  }

  /**
   * One open alert per branch and document type: a branch with no kitchen printer would
   * otherwise raise one for every order until somebody noticed.
   */
  private async raiseUnroutedAlert(tenantId: string, order: OrderHeader, documentType: string) {
    const title = `No printer for ${documentType}`;
    const open = await this.alertRepo.findOne({
      where: { tenant_id: tenantId, branch_id: order.branch_id, type: 'PRINT_UNROUTED', title, acknowledged: false },
    });
    if (open) return;
    await this.alertRepo.save(
      this.alertRepo.create({
        tenant_id: tenantId,
        branch_id: order.branch_id,
        type: 'PRINT_UNROUTED',
        // A kitchen ticket that never prints is food nobody cooks.
        severity: documentType === 'KITCHEN_TICKET' ? 'CRITICAL' : 'WARNING',
        title,
        message: `Order ${order.order_number}: no active printer is routed for ${documentType} at this branch, so it did not print. Add a printer and a print route, then retry the job from the print queue.`,
        acknowledged: false,
      }),
    );
  }

  // Handle simulation outcome
  async processSimulationOutcome(tenantId: string, data: { printJobId: string; scenarioId?: string; outcome: 'SUCCESS' | 'FAILED'; useFallback?: boolean }) {
    const job = await this.jobRepo.findOne({ where: { id: data.printJobId, tenant_id: tenantId } });
    if (!job) throw new NotFoundException(`Print job ${data.printJobId} not found`);

    const attemptsCount = await this.attemptRepo.count({ where: { job_id: job.id } });
    const attemptNo = attemptsCount + 1;

    let targetPrinterId = job.printer_id;

    if (data.outcome === 'FAILED' && data.useFallback && job.printer_id) {
      const printer = await this.printerRepo.findOne({ where: { id: job.printer_id, tenant_id: tenantId } });
      if (printer && printer.fallback_printer_id) {
        targetPrinterId = printer.fallback_printer_id;
      }
    }

    const finalPrinterId = targetPrinterId || job.printer_id;
    if (!finalPrinterId) {
      throw new BadRequestException('Printer ID is required for print attempt');
    }

    const attempt = this.attemptRepo.create({
      tenant_id: tenantId,
      job_id: job.id,
      printer_id: finalPrinterId,
      attempt_no: attemptNo,
      status: data.outcome,
      scenario_id: data.scenarioId || null,
      error_code: data.outcome === 'FAILED' ? 'SIMULATED_PRINTER_ERROR' : null,
      error_message: data.outcome === 'FAILED' ? 'Simulated print hardware failure' : null,
      started_at: new Date(),
      finished_at: new Date(),
    });
    await this.attemptRepo.save(attempt);

    job.status = data.outcome;
    if (data.outcome === 'SUCCESS') {
      job.completed_at = new Date();
    }
    const savedJob = await this.jobRepo.save(job);

    await this.auditWriter.write({
      tenantId,
      actorType: 'SIMULATOR',
      action: 'PRINT_OUTCOME_SIMULATED',
      entityType: 'PrintJob',
      entityId: job.id,
      correlationId: 'corr-print-outcome',
      details: { outcome: data.outcome, attemptNo, targetPrinterId },
    });

    return { job: savedJob, attempt };
  }

  // Retry a failed job
  async retryJob(tenantId: string, jobId: string, data: { scenarioId?: string; useFallback?: boolean; reason?: string }) {
    const job = await this.jobRepo.findOne({ where: { id: jobId, tenant_id: tenantId } });
    if (!job) throw new NotFoundException(`Print job ${jobId} not found`);

    // A job that failed for want of a route gets one now, if the branch has added a printer
    // since; otherwise say what is missing rather than "Printer ID is required".
    if (!job.printer_id) {
      const { printers } = await this.routingService.resolvePrintersForRoute({
        tenantId,
        branchId: job.branch_id,
        documentType: job.document_type,
      });
      if (!printers[0]) {
        throw new BadRequestException(
          `No printer is routed for ${job.document_type} at this branch. Add a printer and a print route, then retry.`,
        );
      }
      job.printer_id = printers[0].id;
      await this.jobRepo.save(job);
    }

    // A printer the agent drives is retried for real: a new attempt goes to the agent.
    let targetId = job.printer_id;
    if (data.useFallback) {
      const current = await this.printerRepo.findOne({ where: { id: job.printer_id, tenant_id: tenantId } });
      if (current?.fallback_printer_id) targetId = current.fallback_printer_id;
    }
    const target = await this.printerRepo.findOne({ where: { id: targetId, tenant_id: tenantId } });
    if (target?.agent_connection) {
      const pending = await this.agentPrinting.pendingAttempt(tenantId, job.id);
      if (pending) {
        // Still waiting. Only a job that never reached the agent can be taken back and resent;
        // otherwise a retry could print the chit twice.
        const withdrawn = pending.agent_command_id
          ? await this.agentPrinting.withdraw(pending, 'Retried from the print queue')
          : false;
        if (!withdrawn) {
          throw new BadRequestException('This job is still with the branch agent. Wait for it to finish or fail, then retry.');
        }
      }
      const attemptNo = (await this.attemptRepo.count({ where: { job_id: job.id } })) + 1;
      const { job: sent, attempt } = await this.agentPrinting.send(tenantId, job, target, attemptNo);
      await this.auditWriter.write({
        tenantId,
        actorType: 'ADMIN',
        action: 'PRINT_JOB_RETRIED',
        entityType: 'PrintJob',
        entityId: job.id,
        correlationId: 'corr-print-retry',
        details: { attemptNo, printerId: target.id, via: 'AGENT', reason: data.reason },
      });
      return { job: sent, attempt };
    }

    return await this.processSimulationOutcome(tenantId, {
      printJobId: job.id,
      scenarioId: data.scenarioId,
      outcome: 'SUCCESS',
      useFallback: data.useFallback,
    });
  }

  // List print jobs with filters & paging
  async getPrintJobs(tenantId: string, branchId?: string, status?: string, documentType?: string, limit = 50, offset = 0) {
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    if (status) where.status = status;
    if (documentType) where.document_type = documentType;

    const [items, total] = await this.jobRepo.findAndCount({
      where,
      order: { created_at: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items, total };
  }

  async getPrintJobById(tenantId: string, id: string) {
    const job = await this.jobRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!job) throw new NotFoundException(`Print job ${id} not found`);

    const attempts = await this.attemptRepo.find({ where: { job_id: id }, order: { attempt_no: 'ASC' } });
    return { ...job, attempts };
  }
}
