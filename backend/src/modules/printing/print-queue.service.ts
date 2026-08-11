import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrintJob } from '../../entities/PrintJob.entity';
import { PrintAttempt } from '../../entities/PrintAttempt.entity';
import { Printer } from '../../entities/Printer.entity';
import { PrinterGroup } from '../../entities/PrinterGroup.entity';
import { PrinterGroupMember } from '../../entities/PrinterGroupMember.entity';
import { PrintRoute } from '../../entities/PrintRoute.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { PrintRenderService } from './print-render.service';
import { PrintRoutingService } from './print-routing.service';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class PrintQueueService {
  constructor(
    @InjectRepository(PrintJob) private readonly jobRepo: Repository<PrintJob>,
    @InjectRepository(PrintAttempt) private readonly attemptRepo: Repository<PrintAttempt>,
    @InjectRepository(Printer) private readonly printerRepo: Repository<Printer>,
    @InjectRepository(PrinterGroup) private readonly groupRepo: Repository<PrinterGroup>,
    @InjectRepository(PrinterGroupMember) private readonly memberRepo: Repository<PrinterGroupMember>,
    @InjectRepository(PrintRoute) private readonly routeRepo: Repository<PrintRoute>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    private readonly renderService: PrintRenderService,
    private readonly routingService: PrintRoutingService,
    private readonly auditWriter: AuditWriter,
  ) {}

  // Enqueue print jobs for order submission or reprint
  async enqueueOrderPrintJobs(tenantId: string, orderId: string, documentType: string = 'CUSTOMER_RECEIPT', isReprint = false, reason?: string, userId?: string) {
    try {
      const order = await this.orderRepo.findOne({
        where: { id: orderId, tenant_id: tenantId },
        relations: ['items', 'items.options'],
      });
      if (!order) throw new NotFoundException(`Order ${orderId} not found`);

      const { printers, copies } = await this.routingService.resolvePrintersForRoute({
        tenantId,
        branchId: order.branch_id,
        documentType,
      });

      const html = this.renderService.renderDocument({
        documentType,
        orderNumber: order.order_number,
        orderType: order.order_type,
        tableNumber: order.table_number || undefined,
        customerName: order.customer_id || undefined,
        placedAt: order.placed_at || order.submitted_at || new Date(),
        items: (order.items || []).map((i) => ({
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          total_price: i.subtotal || i.unit_price,
          special_instructions: i.special_instructions || undefined,
          options_summary: i.options ? i.options.map((o) => o.option_item_name).join(', ') : undefined,
        })),
        subtotal: order.subtotal,
        discountTotal: order.discount_total,
        taxTotal: order.tax_total,
        grandTotal: order.grand_total,
      });

      const primaryPrinter = printers[0] || null;

      const job = this.jobRepo.create({
        tenant_id: tenantId,
        branch_id: order.branch_id,
        document_type: documentType,
        entity_type: 'Order',
        entity_id: order.id,
        printer_id: primaryPrinter ? primaryPrinter.id : undefined,
        status: 'QUEUED',
        copies: copies || 1,
        rendered_html: html,
        is_reprint: isReprint,
        reason: reason || null,
        created_by: userId || null,
      });

      const savedJob = await this.jobRepo.save(job);

      // Create initial simulated attempt
      if (primaryPrinter) {
        const attempt = this.attemptRepo.create({
          tenant_id: tenantId,
          job_id: savedJob.id,
          printer_id: primaryPrinter.id,
          attempt_no: 1,
          status: 'SUCCESS',
          started_at: new Date(),
          finished_at: new Date(),
        });
        await this.attemptRepo.save(attempt);
        savedJob.status = 'SUCCESS';
        savedJob.completed_at = new Date();
        await this.jobRepo.save(savedJob);
      }

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: isReprint ? 'PRINT_JOB_REPRINTED' : 'PRINT_JOB_ENQUEUED',
        entityType: 'PrintJob',
        entityId: savedJob.id,
        correlationId: 'corr-print-enqueue',
      });

      return savedJob;
    } catch (err: any) {
      // Safe fallback: printing errors must NEVER throw and roll back order transactions!
      return null;
    }
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
