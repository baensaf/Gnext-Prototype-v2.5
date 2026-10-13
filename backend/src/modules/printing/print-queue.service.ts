import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { PrintJob } from '../../entities/PrintJob.entity';
import { PrintAttempt } from '../../entities/PrintAttempt.entity';
import { Printer } from '../../entities/Printer.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { Branch } from '../../entities/Branch.entity';
import { Tenant } from '../../entities/Tenant.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { Customer } from '../../entities/Customer.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { Payment } from '../../entities/Payment.entity';
import { Product } from '../../entities/Product.entity';
import { CALENDAR_SETTING_KEY, readCalendar } from '../../common/utils/calendar.util';
import { markAsReprint, PrintRenderService, RenderDocOptions, TicketTemplate } from './print-render.service';
import { PrintRoutingService, RoutedPrinter } from './print-routing.service';
import { AuditWriter } from '../audit/audit-writer.service';
import { AgentPrintingService } from './agent-printing.service';
import { printableOrderNote } from '../order/order-notes';

/** What changed on an order the kitchen has already been sent. */
export type KitchenChange =
  | { kind: 'AMENDED'; voidedItemIds: string[]; addedItemIds: string[]; reason?: string }
  | { kind: 'CANCELLED'; reason?: string };

const isActiveLine = (item: { state?: string }): boolean => (item.state || 'ACTIVE') === 'ACTIVE';

type LineChange = 'VOID' | 'ADD';

/** The lines of one order that one kitchen printer prints, and so share a chit. */
interface PrinterBatch {
  /** Null when a line has nowhere to print: the branch has no kitchen printer. */
  printer: Printer | null;
  label: string;
  lines: Array<{ item: OrderItem; change?: LineChange }>;
  /** Every line of the order, for a printer at the pass. */
  wholeOrder?: boolean;
  /** The other stations' chits for the same order, by name. */
  otherStations?: string[];
}

/** One kitchen chit a made-up order would print, for checking routing before service. */
export interface KitchenChitPreview {
  printer_id: string | null;
  printer_name: string | null;
  /** False for a printer out of service: its chit would fail. */
  in_service: boolean;
  label: string;
  whole_order: boolean;
  html: string;
}

interface JobOptions {
  isReprint: boolean;
  reason?: string;
  userId?: string;
  /**
   * Force every job this call produces onto one named printer, ignoring routing. Set only
   * by a person reprinting to somewhere else because the usual device is unusable. For a
   * kitchen ticket this deliberately collapses the printer split: one printer working is
   * better than three printing nowhere.
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
    private readonly agentPrinting: AgentPrintingService,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
  ) {}

  /**
   * Print a document for an order, returning every job it made.
   *
   * A kitchen ticket is split by printer: each line prints on the printers its product or its
   * category is sent to, and the lines of one printer share one chit. A burger, fries and a
   * drink can so come out as three chits on three printers, each saying which part of the order
   * it is. Receipts, bills and courier slips are about the whole order and print once, at the
   * till the order was taken on.
   */
  async enqueueOrderPrintJobs(
    tenantId: string,
    orderId: string,
    documentType: string = 'CUSTOMER_RECEIPT',
    isReprint = false,
    reason?: string,
    userId?: string,
    targetPrinterId?: string,
    /** A kitchen reprint for one printer's chit only: the grill's chit fell in the fryer. */
    onlyPrinterId?: string,
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
      // A late entry was served before it was rung up: the kitchen has nothing to cook.
      if (documentType === 'KITCHEN_TICKET' && order.is_late_entry) return [];
      // Voided and replaced lines stay on the order for history, but a reprint that
      // showed them would send the kitchen back to cooking food that was struck off.
      const activeLines = (order.items || []).filter(isActiveLine);
      const opts = { isReprint, reason, userId, targetPrinterId };

      const heading = await this.orderHeading(order);

      if (documentType !== 'KITCHEN_TICKET') {
        const { printers, template } = await this.routingService.printersForDocument(tenantId, order.branch_id, order.terminal_id);
        const html = this.renderService.renderDocument({
          ...heading,
          ...(await this.orderMoney(order)),
          documentType,
          isReprint,
          template,
          items: activeLines.map((i) => this.renderLine(i, undefined, true)),
        });
        return await this.recordJobs(tenantId, order, documentType, html, printers, opts);
      }

      if (activeLines.length === 0) return [];
      const batches = (await this.splitByPrinter(tenantId, order, activeLines.map((item) => ({ item })))).filter(
        // The printer's lines as they stand now, so a line added since the first chit is on it.
        (batch) => !onlyPrinterId || batch.printer?.id === onlyPrinterId,
      );
      const jobs: PrintJob[] = [];
      for (const batch of batches) {
        const html = this.renderKitchenChit(heading, batch, { isReprint });
        jobs.push(...(await this.recordBatchJobs(tenantId, order, html, batch, opts)));
      }
      if (!isReprint && !onlyPrinterId) await this.rememberDestinations(batches);
      return jobs;
    } catch (err: any) {
      // Safe fallback: printing errors must NEVER throw and roll back order transactions!
      return [];
    }
  }

  /**
   * Each line keeps the printers it was sent to, so a later void goes to the same kitchens even
   * if the routing has changed since.
   */
  private async rememberDestinations(batches: PrinterBatch[]) {
    const byLine = new Map<string, Set<string>>();
    for (const batch of batches) {
      if (!batch.printer || batch.wholeOrder) continue;
      for (const { item } of batch.lines) {
        if (!item.id || item.id.startsWith('preview-')) continue;
        const set = byLine.get(item.id) ?? new Set<string>();
        set.add(batch.printer.id);
        byLine.set(item.id, set);
      }
    }
    const em = this.orderRepo.manager;
    if (typeof em?.update !== 'function') return;
    for (const [id, printers] of byLine) {
      await em.update(OrderItem, { id }, { kitchen_printer_ids: [...printers] });
    }
  }

  /**
   * Takes back the order's kitchen chits the branch agent has not received yet. Answers the
   * printers they were for: those get the order as it now stands instead of a change chit (an
   * edit), or nothing at all (a cancel).
   */
  private async withdrawUnsentKitchenChits(tenantId: string, orderId: string, why: string): Promise<Set<string>> {
    const jobs = await this.jobRepo.find({
      where: { tenant_id: tenantId, entity_type: 'Order', entity_id: orderId, document_type: 'KITCHEN_TICKET', status: In(['QUEUED', 'PROCESSING']) },
    });
    const replaced = new Set<string>();
    for (const job of jobs) {
      if (!job.printer_id) continue;
      const pending = await this.agentPrinting.pendingAttempt(tenantId, job.id);
      if (!pending || !(await this.agentPrinting.withdraw(pending, why))) continue;
      job.status = 'REPLACED';
      await this.jobRepo.save(job);
      replaced.add(job.printer_id);
    }
    return replaced;
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
   * The original chit is never reprinted as though it were current. Each printer gets only the
   * delta for its own lines - struck lines marked VOID, appended lines marked ADD - or, for a
   * cancellation, every line of its still on the order under a STOP heading. The lines go to
   * their printers exactly as the original chits did, so a voided burger reaches the grill and
   * not the bar.
   */
  async enqueueKitchenChangeTicket(tenantId: string, orderId: string, change: KitchenChange, userId?: string): Promise<PrintJob[]> {
    try {
      const order = await this.loadOrder(tenantId, orderId);
      if (order.is_late_entry) return [];
      const items = order.items || [];

      const lines: PrinterBatch['lines'] =
        change.kind === 'CANCELLED'
          ? items.filter(isActiveLine).map((item) => ({ item, change: 'VOID' as const }))
          : [
              ...items.filter((i) => change.voidedItemIds.includes(i.id)).map((item) => ({ item, change: 'VOID' as const })),
              ...items.filter((i) => change.addedItemIds.includes(i.id)).map((item) => ({ item, change: 'ADD' as const })),
            ];
      if (lines.length === 0) return [];

      const label = change.kind === 'CANCELLED' ? 'Order cancelled' : 'Order amended';
      const opts = { isReprint: false, reason: change.reason ? `${label}: ${change.reason}` : label, userId };

      // A kitchen that has not been sent its chit yet gets the order as it now stands (an edit)
      // or nothing (a cancel), never the old chit followed by a change.
      const replaced = await this.withdrawUnsentKitchenChits(tenantId, orderId, `Replaced: ${label.toLowerCase()} before it printed`);

      const heading = await this.orderHeading(order);
      const jobs: PrintJob[] = [];
      const changeBatches = (await this.splitByPrinter(tenantId, order, lines)).filter((b) => !b.printer || !replaced.has(b.printer.id));
      for (const batch of changeBatches) {
        const html = this.renderKitchenChit(heading, batch, {
          kitchenChange: change.kind,
          changeReason: change.reason,
          placedAt: new Date(),
        });
        jobs.push(...(await this.recordBatchJobs(tenantId, order, html, batch, opts)));
      }
      if (change.kind === 'AMENDED') {
        await this.rememberDestinations(changeBatches.map((b) => ({ ...b, lines: b.lines.filter((l) => l.change === 'ADD') })));
        if (replaced.size) {
          const current = (order.items || []).filter(isActiveLine).map((item) => ({ item }));
          const fresh = (await this.splitByPrinter(tenantId, order, current)).filter((b) => b.printer && replaced.has(b.printer.id));
          for (const batch of fresh) {
            const html = this.renderKitchenChit(heading, batch, { changeReason: change.reason });
            jobs.push(...(await this.recordBatchJobs(tenantId, order, html, batch, { ...opts, reason: `${opts.reason} (replaces the unsent chit)` })));
          }
          await this.rememberDestinations(fresh);
        }
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

  /**
   * Print a test page on one printer, through the branch agent, and hand back the job so the
   * caller can watch it settle. The job is in the print queue like any other, so a test that
   * failed says why there. A printer the agent does not drive has nothing to test.
   */
  async testPrint(tenantId: string, printerId: string, userId?: string): Promise<PrintJob> {
    const printer = await this.printerRepo.findOne({ where: { id: printerId, tenant_id: tenantId } });
    if (!printer) throw new NotFoundException(`Printer ${printerId} not found`);
    if (!printer.agent_connection) {
      throw new BadRequestException(
        `Printer ${printer.name} is not connected to the branch agent. Set up its connection, then test it.`,
      );
    }
    const branch = await this.orderRepo.manager
      ?.findOne(Branch, { where: { id: printer.branch_id, tenant_id: tenantId } })
      .catch(() => null);

    const job = await this.jobRepo.save(
      this.jobRepo.create({
        tenant_id: tenantId,
        branch_id: printer.branch_id,
        document_type: 'TEST_PRINT',
        entity_type: 'Printer',
        entity_id: printer.id,
        printer_id: printer.id,
        label: printer.name,
        status: 'QUEUED',
        copies: 1,
        rendered_html: this.renderService.renderTestPage(printer.name, branch?.name),
        is_reprint: false,
        created_by: userId || null,
      }),
    );
    const { job: sent } = await this.agentPrinting.send(tenantId, job, printer, 1);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: userId,
      action: 'PRINT_TEST_SENT',
      entityType: 'PrintJob',
      entityId: sent.id,
      correlationId: 'corr-print-test',
      details: { printerId: printer.id },
    });
    return sent;
  }

  private async loadOrder(tenantId: string, orderId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, tenant_id: tenantId },
      relations: ['items', 'items.options'],
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    // Postgres returns the lines in no set order. Chits print in the order their first line
    // appears, so without this the same order could number its printers differently each time.
    order.items = [...(order.items || [])].sort((a, b) => (a.line_number || 0) - (b.line_number || 0));
    return order;
  }

  /**
   * Group lines by the printers they print on, keeping the order the lines came in. A line sent
   * to two printers is on both chits; a line on the "not printed" list is on none. Lines with
   * nowhere to print share one batch with no printer, which fails and raises an alert. Each
   * printer at the pass gets one more chit with every line, so whoever bags the order sees it
   * whole; a line routed only to such a printer is on that chit already.
   */
  private async splitByPrinter(
    tenantId: string,
    order: Pick<OrderHeader, 'branch_id'>,
    lines: PrinterBatch['lines'],
  ): Promise<PrinterBatch[]> {
    const [routing, passPrinters, everyPrinter] = await Promise.all([
      this.routingService.routeProducts(tenantId, order.branch_id, lines.map((l) => l.item.product_id)),
      this.routingService.wholeOrderPrinters(tenantId, order.branch_id),
      this.routingService.allBranchPrinters(tenantId, order.branch_id),
    ]);
    const atPass = new Set(passPrinters.map((p) => p.id));
    const printerById = new Map(everyPrinter.map((p) => [p.id, p]));

    const batches = new Map<string, PrinterBatch>();
    for (const line of lines) {
      // A void goes where the line was first sent, whatever the routing says now.
      const sentTo = line.change === 'VOID' ? line.item.kitchen_printer_ids : null;
      if (sentTo && sentTo.length === 0) continue;
      const routed = sentTo
        ? { printers: sentTo.map((id) => printerById.get(id)).filter((p): p is Printer => !!p), source: 'PRODUCT' as const }
        : routing.get(line.item.product_id);
      if (routed?.source === 'NOT_PRINTED') continue;
      const printers = (routed?.printers ?? []).filter((p) => !atPass.has(p.id));
      if (printers.length === 0 && routed?.printers.length) continue;
      for (const printer of printers.length ? printers : [null]) {
        const key = printer?.id ?? '';
        const batch = batches.get(key);
        if (batch) batch.lines.push(line);
        else batches.set(key, { printer, label: '', lines: [line] });
      }
    }

    const stations = [...batches.values()];
    const names = stations.map((batch) => batch.printer?.name || 'آشپزخانه');
    for (const [index, batch] of stations.entries()) {
      batch.label = stations.length > 1 ? `${names[index]} (${index + 1}/${stations.length})` : names[index];
      batch.otherStations = names.filter((_, i) => i !== index);
    }
    const whole = passPrinters.map((printer): PrinterBatch => ({ printer, label: printer.name, lines, wholeOrder: true }));
    return [...stations, ...whole];
  }

  private renderKitchenChit(
    heading: Omit<RenderDocOptions, 'documentType' | 'items'>,
    batch: PrinterBatch,
    extra: Partial<RenderDocOptions> = {},
  ): string {
    return this.renderService.renderDocument({
      ...heading,
      documentType: 'KITCHEN_TICKET',
      stationLabel: batch.label,
      otherStations: batch.otherStations,
      wholeOrder: batch.wholeOrder,
      items: batch.lines.map((l) => this.renderLine(l.item, l.change)),
      ...extra,
    });
  }

  /**
   * The kitchen chits a made-up order would print at the branch, as they would come out, with
   * nothing queued or printed: a manager checks the routing before service, not during it.
   * Products on the "not printed" list are named, since they print nowhere to be seen.
   */
  async previewKitchenChits(
    tenantId: string,
    branchId: string,
    input: { product_ids: string[]; order_type?: string; notes?: string },
  ): Promise<{ chits: KitchenChitPreview[]; not_printed: string[] }> {
    const ids = input.product_ids || [];
    const products = ids.length ? await this.productRepo.find({ where: { id: In([...new Set(ids)]), tenant_id: tenantId } }) : [];
    const byId = new Map(products.map((p) => [p.id, p]));
    const lines: PrinterBatch['lines'] = ids
      .filter((id) => byId.has(id))
      .map((id, index) => ({
        item: { id: `preview-${index}`, product_id: id, product_name: byId.get(id)!.name, quantity: '1', line_number: index + 1 } as unknown as OrderItem,
      }));
    if (lines.length === 0) return { chits: [], not_printed: [] };

    const order = {
      tenant_id: tenantId,
      branch_id: branchId,
      order_number: 'PREVIEW',
      call_number: 123,
      order_type: input.order_type || 'TAKEAWAY',
      channel: input.order_type === 'AGGREGATOR' ? 'AGGREGATOR' : 'POS',
      // A platform order's customer note sits on its "Note:" line, which is all that prints.
      notes: input.notes ? (input.order_type === 'AGGREGATOR' ? `Note: ${input.notes}` : input.notes) : null,
      placed_at: new Date(),
    } as unknown as OrderHeader;
    const [heading, routing, batches] = await Promise.all([
      this.orderHeading(order),
      this.routingService.routeProducts(tenantId, branchId, ids),
      this.splitByPrinter(tenantId, order, lines),
    ]);
    return {
      chits: batches.map((batch) => ({
        printer_id: batch.printer?.id ?? null,
        printer_name: batch.printer?.name ?? null,
        in_service: batch.printer ? batch.printer.is_active !== false : false,
        label: batch.label,
        whole_order: !!batch.wholeOrder,
        html: this.renderKitchenChit(heading, batch),
      })),
      not_printed: [...new Set(lines.filter((l) => routing.get(l.item.product_id)?.source === 'NOT_PRINTED').map((l) => l.item.product_name))],
    };
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
      orderNotes: printableOrderNote(order),
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

  /** One line of a ticket. A customer document marks a line's automatic item discount; the kitchen never sees it. */
  private renderLine(i: OrderItem, change?: LineChange, forCustomer = false) {
    const lineTotal = [i.line_total, i.subtotal].find((v) => v && Number(v) > 0);
    const name = i.variant_name ? `${i.product_name} (${i.variant_name})` : i.product_name;
    const itemDiscount = forCustomer && Number(i.item_discount_percent || 0) > 0 ? ` (${Number(i.item_discount_percent)}٪ تخفیف)` : '';
    return {
      product_name: `${name}${itemDiscount}`,
      quantity: i.quantity,
      unit_price: i.unit_price,
      total_price: lineTotal || String(Number(i.unit_price || 0) * Number(i.quantity || 1)),
      special_instructions: i.notes || i.special_instructions || undefined,
      options_summary: i.options?.length ? i.options.map((o) => o.option_item_name).join('، ') : undefined,
      change,
    };
  }

  /** A printer's chit on that printer, or one failed job when the lines had nowhere to go. */
  private async recordBatchJobs(tenantId: string, order: OrderHeader, html: string, batch: PrinterBatch, opts: JobOptions) {
    const routed = batch.printer ? [{ printer: batch.printer, copies: 1 }] : [];
    return this.recordJobs(tenantId, order, 'KITCHEN_TICKET', html, routed, opts, batch.label);
  }

  /** One job per printer the document goes to, or one failed job when there is none. */
  private async recordJobs(
    tenantId: string,
    order: OrderHeader,
    documentType: string,
    html: string,
    routed: RoutedPrinter[],
    opts: JobOptions,
    label?: string,
  ): Promise<PrintJob[]> {
    // A hand-picked printer replaces whatever routing chose, and keeps the routed copy count
    // so a receipt that normally prints twice still does.
    const targets = opts.targetPrinterId
      ? await this.forcedTarget(tenantId, order.branch_id, opts.targetPrinterId, routed[0]?.copies || 1)
      : routed;
    const newJob = (printerId: string | undefined, copies: number) =>
      this.jobRepo.create({
        tenant_id: tenantId,
        branch_id: order.branch_id,
        document_type: documentType,
        entity_type: 'Order',
        entity_id: order.id,
        printer_id: printerId,
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
    // looked exactly like one that printed. Fail it where the print queue shows failures.
    if (targets.length === 0) {
      const savedJob = await this.jobRepo.save(newJob(undefined, 1));
      savedJob.status = 'FAILED';
      await this.jobRepo.save(savedJob);
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
      if (!target.printer.is_active) {
        // A printer taken out of service keeps its routes: its chit fails where it can be seen,
        // and the order's other printers still print.
        jobs.push(await this.failOutOfService(tenantId, savedJob, target.printer, opts));
        continue;
      }
      jobs.push(await this.printOn(tenantId, savedJob, target.printer.id, opts));
    }
    return jobs;
  }

  private async failOutOfService(tenantId: string, job: PrintJob, printer: Printer, opts: Pick<JobOptions, 'isReprint' | 'userId'>) {
    await this.attemptRepo.save(
      this.attemptRepo.create({
        tenant_id: tenantId,
        job_id: job.id,
        printer_id: printer.id,
        attempt_no: 1,
        status: 'FAILED',
        error_code: 'PRINTER_OUT_OF_SERVICE',
        error_message: `Printer ${printer.name} is out of service`,
        started_at: new Date(),
        finished_at: new Date(),
      }),
    );
    job.status = 'FAILED';
    const saved = await this.jobRepo.save(job);
    await this.auditPrint(tenantId, saved, opts, { outOfService: printer.id });
    return saved;
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

  // Handle simulation outcome
  async processSimulationOutcome(
    tenantId: string,
    data: { printJobId: string; scenarioId?: string; outcome: 'SUCCESS' | 'FAILED' },
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

    const finalPrinterId = job.printer_id;
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
      details: { outcome: data.outcome, attemptNo, printerId: finalPrinterId },
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
  async retryJob(tenantId: string, jobId: string, data: { reason?: string }) {
    const job = await this.jobRepo.findOne({ where: { id: jobId, tenant_id: tenantId } });
    if (!job) throw new NotFoundException(`Print job ${jobId} not found`);
    // Sending it again by itself could put a second chit on the rail.
    if (job.status === 'UNCERTAIN') {
      throw new BadRequestException('This job may have printed. Check the printer: confirm it printed, or reprint it.');
    }
    if (job.status === 'EXPIRED') {
      throw new BadRequestException('This kitchen chit expired at the end of the business day. Reprint it or dismiss it.');
    }

    const targets = await this.retryTargets(tenantId, job);
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

    // A job routed afresh takes the first printer; any other gets a job of its own, as it
    // would have had those printers been working at the time.
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
   * Where a retry prints. A job with a printer goes back to that printer. A job with none — nothing was reachable when it was made — is routed again: a
   * kitchen chit, whose lines had no printer, to the branch's default kitchen printer; any other
   * document to the printer of the till its order was taken on.
   */
  private async retryTargets(tenantId: string, job: PrintJob): Promise<RoutedPrinter[]> {
    if (job.printer_id) {
      const current = await this.printerRepo.findOne({ where: { id: job.printer_id, tenant_id: tenantId } });
      if (!current) {
        throw new BadRequestException('The printer this job went to has been removed. Reprint the job to another printer.');
      }
      const printer = current;
      if (!printer.is_active) throw new BadRequestException(`Printer ${printer.name} is not in service`);
      return [{ printer, copies: job.copies || 1 }];
    }

    let routed: RoutedPrinter[];
    if (job.document_type === 'KITCHEN_TICKET') {
      const fallback = await this.routingService.kitchenDefault(tenantId, job.branch_id);
      routed = fallback ? [{ printer: fallback, copies: job.copies || 1 }] : [];
    } else {
      const order =
        job.entity_type === 'Order' ? await this.orderRepo.findOne({ where: { id: job.entity_id, tenant_id: tenantId } }) : null;
      routed = (await this.routingService.printersForDocument(tenantId, job.branch_id, order?.terminal_id)).printers;
    }
    if (routed.length === 0) {
      throw new BadRequestException(`No printer is in service for ${job.document_type} at this branch. Add a printer, then retry.`);
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

  /** The cashier saw the paper: a "check printer" or expired job is recorded as printed. */
  async confirmPrinted(tenantId: string, jobId: string, userId?: string) {
    const job = await this.jobRepo.findOne({ where: { id: jobId, tenant_id: tenantId } });
    if (!job) throw new NotFoundException(`Print job ${jobId} not found`);
    if (job.status !== 'UNCERTAIN' && job.status !== 'EXPIRED') {
      throw new BadRequestException('Only a job that may have printed can be confirmed');
    }
    const before = job.status;
    job.status = 'SUCCESS';
    job.completed_at = new Date();
    const saved = await this.jobRepo.save(job);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: userId,
      action: 'PRINT_JOB_CONFIRMED',
      entityType: 'PrintJob',
      entityId: job.id,
      correlationId: 'corr-print-confirm',
      details: { before },
    });
    return saved;
  }

  /** An expired, failed or unsure job set aside on purpose, with the reason. */
  async dismissJob(tenantId: string, jobId: string, reason: string, userId?: string) {
    const job = await this.jobRepo.findOne({ where: { id: jobId, tenant_id: tenantId } });
    if (!job) throw new NotFoundException(`Print job ${jobId} not found`);
    if (!['EXPIRED', 'FAILED', 'UNCERTAIN'].includes(job.status)) {
      throw new BadRequestException('Only a job that did not print, or may not have, can be dismissed');
    }
    const text = String(reason || '').trim();
    if (!text) throw new BadRequestException('Say why the job is dismissed');
    const before = job.status;
    job.status = 'DISMISSED';
    job.reason = text.slice(0, 255);
    const saved = await this.jobRepo.save(job);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: userId,
      action: 'PRINT_JOB_DISMISSED',
      entityType: 'PrintJob',
      entityId: job.id,
      correlationId: 'corr-print-dismiss',
      details: { before, reason: text },
    });
    return saved;
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
