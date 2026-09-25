import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { PrintJob } from '../../entities/PrintJob.entity';
import { PrintAttempt } from '../../entities/PrintAttempt.entity';
import { Printer } from '../../entities/Printer.entity';
import { PrintRoute } from '../../entities/PrintRoute.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { OperationalAlert } from '../../entities/OperationalAlert.entity';
import { Branch } from '../../entities/Branch.entity';
import { Tenant } from '../../entities/Tenant.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { Customer } from '../../entities/Customer.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { Payment } from '../../entities/Payment.entity';
import { CALENDAR_SETTING_KEY, readCalendar } from '../../common/utils/calendar.util';
import { markAsReprint, PrintRenderService, RenderDocOptions, TicketTemplate } from './print-render.service';
import { PrintRoutingService, RoutedPrinter } from './print-routing.service';
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
  /** The station group's choice of paper; null takes the chit's default. */
  template: TicketTemplate | null;
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
    /** A kitchen reprint for one station only: the grill's chit fell in the fryer. */
    onlyGroupId?: string,
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

      const heading = await this.orderHeading(order);

      if (documentType !== 'KITCHEN_TICKET') {
        const routes = await this.routingService.loadRoutes(tenantId, order.branch_id, documentType);
        const route = this.routingService.matchRoute(routes, {});
        const html = this.renderService.renderDocument({
          ...heading,
          ...(await this.orderMoney(order)),
          documentType,
          isReprint,
          template: (await this.routingService.group(tenantId, route?.printer_group_id))?.ticket_template ?? null,
          items: activeLines.map((i) => this.renderLine(i)),
        });
        return await this.recordJobs(tenantId, order, documentType, html, route, opts);
      }

      if (activeLines.length === 0) return [];
      const batches = (await this.splitByRoute(tenantId, order, activeLines.map((item) => ({ item })))).filter(
        // The station's lines as they stand now, so a line added since the first chit is on it.
        (batch) => !onlyGroupId || batch.route?.printer_group_id === onlyGroupId,
      );
      const jobs: PrintJob[] = [];
      for (const batch of batches) {
        const html = this.renderService.renderDocument({
          ...heading,
          documentType,
          isReprint,
          template: batch.template,
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

  /** Whether this document has already been printed for the order, reprints aside. */
  async hasPrinted(tenantId: string, orderId: string, documentType: string): Promise<boolean> {
    const count = await this.jobRepo.count({
      where: { tenant_id: tenantId, entity_type: 'Order', entity_id: orderId, document_type: documentType, is_reprint: false },
    });
    return count > 0;
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

      const heading = await this.orderHeading(order);
      const jobs: PrintJob[] = [];
      for (const batch of await this.splitByRoute(tenantId, order, lines)) {
        const html = this.renderService.renderDocument({
          ...heading,
          documentType: 'KITCHEN_TICKET',
          template: batch.template,
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
        // Marked as a copy on the paper too: a second grill chit that looks like the first
        // gets cooked twice.
        rendered_html: markAsReprint(job.rendered_html),
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
        batches.set(key, { route, label: '', template: null, lines: [line] });
        continue;
      }
      batch.lines.push(line);
      if (route && (route.copies || 1) > (batch.route?.copies || 1)) batch.route = route;
    }

    const result = [...batches.values()];
    for (const [index, batch] of result.entries()) {
      const group = await this.routingService.group(tenantId, batch.route?.printer_group_id);
      const name = group?.name || 'آشپزخانه';
      batch.label = result.length > 1 ? `${name} (${index + 1}/${result.length})` : name;
      batch.template = group?.ticket_template ?? null;
    }
    return result;
  }

  /**
   * What every document for the order is headed with: who is printing it (the chain, the
   * branch), the order, and who it is for. The lookups are best effort; a document with a
   * missing phone number still prints.
   */
  private async orderHeading(order: OrderHeader): Promise<Omit<RenderDocOptions, 'documentType' | 'items'>> {
    const heading: Omit<RenderDocOptions, 'documentType' | 'items'> = {
      orderNumber: order.order_number,
      callNumber: order.call_number ?? null,
      orderType: order.order_type,
      channel: order.channel,
      tableNumber: order.table_number || undefined,
      orderNotes: order.notes || undefined,
      placedAt: order.placed_at || order.submitted_at || new Date(),
    };
    const em = this.orderRepo.manager;
    if (!em) return heading;
    try {
      const [tenant, branch, calendar, customer, address] = await Promise.all([
        em.findOne(Tenant, { where: { id: order.tenant_id } }),
        em.findOne(Branch, { where: { id: order.branch_id, tenant_id: order.tenant_id } }),
        em.findOne(TenantSetting, { where: { tenant_id: order.tenant_id, key: CALENDAR_SETTING_KEY, branch_id: IsNull() } }),
        order.customer_id ? em.findOne(Customer, { where: { id: order.customer_id, tenant_id: order.tenant_id } }) : null,
        order.customer_address_id
          ? em.findOne(CustomerAddress, { where: { id: order.customer_address_id, tenant_id: order.tenant_id } })
          : null,
      ]);
      heading.brandName = tenant?.name || undefined;
      heading.branchName = branch?.name || undefined;
      heading.branchAddress = branch?.address || undefined;
      heading.branchPhone = branch?.phone || undefined;
      heading.calendar = readCalendar(calendar?.value);
      const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(' ').trim();
      heading.customerName = name || undefined;
      heading.customerMobile = customer?.mobile || undefined;
      heading.deliveryAddress = address?.address_text || undefined;
    } catch {
      // A heading without the branch's address is still a ticket.
    }
    return heading;
  }

  /** The money half of a customer document: totals, and what has been paid and how. */
  private async orderMoney(order: OrderHeader): Promise<Partial<RenderDocOptions>> {
    const money: Partial<RenderDocOptions> = {
      subtotal: order.subtotal,
      discountTotal: order.discount_total,
      taxTotal: order.tax_total,
      deliveryFee: order.delivery_fee,
      packagingTotal: order.packaging_total,
      grandTotal: order.grand_total,
      paidTotal: order.paid_total,
      outstandingTotal: order.outstanding_total ?? undefined,
    };
    const em = this.orderRepo.manager;
    if (!em) return money;
    try {
      const payments = await em.find(Payment, {
        where: { tenant_id: order.tenant_id, order_id: order.id, status: In(['SUCCEEDED', 'COMPLETED', 'PARTIALLY_REFUNDED']) },
        order: { initiated_at: 'ASC' },
      });
      money.payments = payments.map((p) => ({ method: p.method_kind, amount: p.amount }));
    } catch {
      // Totals alone still make a receipt.
    }
    return money;
  }

  private renderLine(i: OrderItem, change?: LineChange) {
    const lineTotal = [i.line_total, i.subtotal].find((v) => v && Number(v) > 0);
    return {
      product_name: i.variant_name ? `${i.product_name} (${i.variant_name})` : i.product_name,
      quantity: i.quantity,
      unit_price: i.unit_price,
      total_price: lineTotal || String(Number(i.unit_price || 0) * Number(i.quantity || 1)),
      special_instructions: i.notes || i.special_instructions || undefined,
      options_summary: i.options?.length ? i.options.map((o) => o.option_item_name).join('، ') : undefined,
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
    const routed = await this.routingService.printersForRoute(tenantId, order.branch_id, route, documentType);
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
  async processSimulationOutcome(
    tenantId: string,
    data: { printJobId: string; scenarioId?: string; outcome: 'SUCCESS' | 'FAILED'; useFallback?: boolean },
  ) {
    const job = await this.jobRepo.findOne({ where: { id: data.printJobId, tenant_id: tenantId } });
    if (!job) throw new NotFoundException(`Print job ${data.printJobId} not found`);

    // A real printer reports its own result through the agent. Marking its job printed by hand
    // would tell the kitchen a chit is on the rail that never came out.
    if (job.printer_id) {
      const current = await this.printerRepo.findOne({ where: { id: job.printer_id, tenant_id: tenantId } });
      if (current?.agent_connection) {
        throw new BadRequestException('This job went to a real printer through the branch agent; its outcome cannot be simulated.');
      }
    }

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

  /**
   * Send a failed job to its printer again, for real.
   *
   * A retry only ever goes through the branch agent. A printer that is gone or has no agent
   * connection is refused with the reason, never marked printed: the queue saying "printed"
   * for a chit that never came out is the one outcome worse than a failure.
   */
  async retryJob(tenantId: string, jobId: string, data: { useFallback?: boolean; reason?: string }) {
    const job = await this.jobRepo.findOne({ where: { id: jobId, tenant_id: tenantId } });
    if (!job) throw new NotFoundException(`Print job ${jobId} not found`);

    const targets = await this.retryTargets(tenantId, job, data.useFallback);
    const offline = targets.find((t) => !t.printer.agent_connection);
    if (offline) {
      throw new BadRequestException(
        `Printer ${offline.printer.name} is not connected to the branch agent, so a retry cannot print on it. Set up its connection, or reprint the job to a connected printer.`,
      );
    }

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

    // A job routed afresh takes the first printer; every other printer in the group gets a job
    // of its own, as it would have had the group been working when the order was placed.
    const [first, ...others] = targets;
    if (!job.printer_id) {
      job.printer_id = first.printer.id;
      job.copies = first.copies;
      await this.jobRepo.save(job);
    }

    const attemptNo = (await this.attemptRepo.count({ where: { job_id: job.id } })) + 1;
    const { job: sent, attempt } = await this.agentPrinting.send(tenantId, job, first.printer, attemptNo);
    await this.auditRetry(tenantId, sent, attemptNo, first.printer, data.reason);

    const jobs = [sent];
    for (const target of others) {
      const extra = await this.jobRepo.save(
        this.jobRepo.create({
          tenant_id: job.tenant_id,
          branch_id: job.branch_id,
          document_type: job.document_type,
          entity_type: job.entity_type,
          entity_id: job.entity_id,
          printer_id: target.printer.id,
          printer_group_id: job.printer_group_id,
          label: job.label,
          status: 'QUEUED',
          copies: target.copies,
          rendered_html: job.rendered_html,
          is_reprint: job.is_reprint,
          reason: job.reason,
          created_by: job.created_by,
        }),
      );
      const { job: sentExtra } = await this.agentPrinting.send(tenantId, extra, target.printer, 1);
      await this.auditRetry(tenantId, sentExtra, 1, target.printer, data.reason);
      jobs.push(sentExtra);
    }
    return { job: sent, attempt, jobs };
  }

  /**
   * Where a retry prints. A job with a printer goes back to that printer, or to its fallback
   * when asked. A job with none — nothing was reachable when it was made — is routed again as
   * it first was: through its station's printer group when it had one, so the grill's chit
   * reaches the grill and every printer the group has gained since; otherwise on the route
   * with no selector.
   */
  private async retryTargets(tenantId: string, job: PrintJob, useFallback?: boolean): Promise<RoutedPrinter[]> {
    if (job.printer_id) {
      const current = await this.printerRepo.findOne({ where: { id: job.printer_id, tenant_id: tenantId } });
      if (!current) {
        throw new BadRequestException('The printer this job went to has been removed. Reprint the job to another printer.');
      }
      let printer = current;
      if (useFallback && current.fallback_printer_id) {
        const fallback = await this.printerRepo.findOne({ where: { id: current.fallback_printer_id, tenant_id: tenantId } });
        if (!fallback) {
          throw new BadRequestException(`The fallback printer of ${current.name} has been removed. Reprint the job to another printer.`);
        }
        printer = fallback;
      }
      if (!printer.is_active) throw new BadRequestException(`Printer ${printer.name} is not in service`);
      return [{ printer, copies: job.copies || 1 }];
    }

    const route = job.printer_group_id
      ? ({ printer_group_id: job.printer_group_id, copies: job.copies || 1 } as PrintRoute)
      : this.routingService.matchRoute(await this.routingService.loadRoutes(tenantId, job.branch_id, job.document_type), {});
    const routed = await this.routingService.printersForRoute(tenantId, job.branch_id, route, job.document_type);
    if (routed.length === 0) {
      throw new BadRequestException(
        `No printer is routed for ${job.document_type} at this branch. Add a printer and a print route, then retry.`,
      );
    }
    return routed;
  }

  private async auditRetry(tenantId: string, job: PrintJob, attemptNo: number, printer: Printer, reason?: string) {
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRINT_JOB_RETRIED',
      entityType: 'PrintJob',
      entityId: job.id,
      correlationId: 'corr-print-retry',
      details: { attemptNo, printerId: printer.id, via: 'AGENT', reason },
    });
  }

  // List print jobs with filters & paging
  async getPrintJobs(tenantId: string, branchId?: string, status?: string, documentType?: string, limit = 50, offset = 0, entityId?: string) {
    const where: any = { tenant_id: tenantId };
    if (entityId) where.entity_id = entityId;
    if (branchId) where.branch_id = branchId;
    if (status) where.status = status;
    if (documentType) where.document_type = documentType;

    const [jobs, total] = await this.jobRepo.findAndCount({
      where,
      order: { created_at: 'DESC' },
      take: limit,
      skip: offset,
    });

    // The queue is read by people looking for "order 12's grill chit", not by job id.
    const orderIds = [...new Set(jobs.filter((j) => j.entity_type === 'Order' && j.entity_id).map((j) => j.entity_id))];
    const printerIds = [...new Set(jobs.map((j) => j.printer_id).filter(Boolean))];
    const [orders, printers]: [OrderHeader[], Printer[]] = await Promise.all([
      orderIds.length ? this.orderRepo.find({ where: { id: In(orderIds), tenant_id: tenantId } }) : Promise.resolve([]),
      printerIds.length
        ? this.printerRepo.find({ where: { id: In(printerIds), tenant_id: tenantId }, withDeleted: true })
        : Promise.resolve([]),
    ]);
    const orderNumber = new Map<string, string>(orders.map((o) => [o.id, o.order_number]));
    const printer = new Map<string, Printer>(printers.map((p) => [p.id, p]));
    const items = jobs.map((j) => ({
      ...j,
      order_number: orderNumber.get(j.entity_id) ?? null,
      printer_name: printer.get(j.printer_id)?.name ?? null,
      via_agent: !!printer.get(j.printer_id)?.agent_connection,
    }));
    return { items, total };
  }

  async getPrintJobById(tenantId: string, id: string) {
    const job = await this.jobRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!job) throw new NotFoundException(`Print job ${id} not found`);

    const attempts = await this.attemptRepo.find({ where: { job_id: id }, order: { attempt_no: 'ASC' } });
    return { ...job, attempts };
  }
}
