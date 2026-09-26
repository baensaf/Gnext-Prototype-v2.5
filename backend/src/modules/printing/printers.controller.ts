import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Req, NotFoundException, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityTarget, Repository } from 'typeorm';
import { Printer } from '../../entities/Printer.entity';
import { PrintJob } from '../../entities/PrintJob.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { PrintQueueService } from './print-queue.service';
import { detachPrinter } from './print-routing.service';
import { AgentConfigService } from '../agent-gateway/agent-config.service';
import { parseDeviceConnection } from '../../common/utils/device-connection.util';
import { AuditWriter } from '../audit/audit-writer.service';
import { MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { BranchOwned } from '../../common/decorators/branch-owned.decorator';
import { CreatePrinterDto, UpdatePrinterDto } from './dtos/printing-config.dto';

@Controller('api/v1')
export class PrintersController {
  constructor(
    @InjectRepository(Printer) private readonly printerRepo: Repository<Printer>,
    private readonly queueService: PrintQueueService,
    private readonly auditWriter: AuditWriter,
    private readonly agentConfig: AgentConfigService,
  ) {}

  /** Printers the agent can reach over the network, through Windows, or on a serial port. */
  private printerConnection(input: unknown) {
    return parseDeviceConnection(input, ['tcp', 'windows', 'serial']);
  }

  /** The branch agent keeps its own copy of the printer list; tell it about the change. */
  private async pushConfig(tenantId: string, ...branchIds: Array<string | undefined>) {
    for (const branchId of new Set(branchIds.filter(Boolean) as string[])) {
      await this.agentConfig.pushToBranch(tenantId, branchId).catch(() => undefined);
    }
  }

  /**
   * A printer named inside a record has to be in that record's branch. The branch guard checks
   * the id in the path; this one rides in the body, and a Valiasr manager could make Nosrat's
   * printer their fallback.
   */
  private async assertInBranch(
    tenantId: string,
    entity: EntityTarget<any>,
    id: string | null | undefined,
    branchId: string | null | undefined,
    label: string,
  ) {
    if (!id) return;
    const row = await this.printerRepo.manager.findOne(entity, { where: { id, tenant_id: tenantId } });
    if (!row || row.branch_id !== branchId) {
      throw new BadRequestException(`${label} ${id} is not in this branch`);
    }
  }

  // 1. Printers CRUD
  @Get('printers')
  async getPrinters(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    return await this.printerRepo.find({ where, order: { name: 'ASC' } });
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post('printers')
  async createPrinter(@Body() body: CreatePrinterDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    await this.assertInBranch(tenantId, Printer, body.fallback_printer_id, body.branch_id, 'Fallback printer');

    const printer = this.printerRepo.create({
      tenant_id: tenantId,
      branch_id: body.branch_id,
      code: body.code.toUpperCase(),
      name: body.name,
      printer_type: body.printer_type || 'THERMAL_RECEIPT',
      simulated_address: body.simulated_address || '192.168.1.100:9100',
      paper_width_mm: body.paper_width_mm || 80,
      is_active: body.is_active !== false,
      fallback_printer_id: body.fallback_printer_id || null,
      agent_connection: this.printerConnection(body.agent_connection),
    });
    const saved = await this.printerRepo.save(printer);
    await this.pushConfig(tenantId, saved.branch_id);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRINTER_CREATED',
      correlationId,
      afterData: saved,
    });
    return saved;
  }

  @BranchOwned(Printer)
  @Roles(...MANAGER_AND_ABOVE)
  @Patch('printers/:id')
  async updatePrinter(@Param('id') id: string, @Body() body: UpdatePrinterDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const printer = await this.printerRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!printer) throw new NotFoundException('Printer not found');

    if (body.fallback_printer_id === id) {
      throw new BadRequestException('Printer cannot have itself as fallback printer');
    }

    const previousBranchId = printer.branch_id;
    const { agent_connection, ...rest } = body;
    Object.assign(printer, rest);
    if (body.fallback_printer_id) {
      await this.assertInBranch(tenantId, Printer, body.fallback_printer_id, printer.branch_id, 'Fallback printer');
    }
    if (agent_connection !== undefined) printer.agent_connection = this.printerConnection(agent_connection);
    const saved = await this.printerRepo.save(printer);
    await this.pushConfig(tenantId, previousBranchId, saved.branch_id);
    return saved;
  }

  @BranchOwned(Printer)
  @Roles(...MANAGER_AND_ABOVE)
  @Delete('printers/:id')
  async deletePrinter(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const printer = await this.printerRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!printer) throw new NotFoundException('Printer not found');

    await this.printerRepo.softDelete({ id });
    await detachPrinter(this.printerRepo.manager, tenantId, id);
    await this.pushConfig(tenantId, printer.branch_id);
    return { success: true };
  }

  /** A test page through the branch agent. The job it returns settles when the printer answers. */
  @BranchOwned(Printer)
  @Roles(...MANAGER_AND_ABOVE)
  @Post('printers/:id/test-print')
  async testPrint(@Param('id') id: string, @Req() req: Request) {
    return await this.queueService.testPrint((req as any).tenantId, id, (req as any).userId);
  }

  // 2. Print Jobs Queue & Simulation Actions
  @Get('print-jobs')
  async getJobs(
    @Query('branchId') branchId: string,
    @Query('status') status: string,
    @Query('documentType') documentType: string,
    @Query('entityId') entityId: string,
    @Query('limit') limit: number,
    @Query('offset') offset: number,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.queueService.getPrintJobs(tenantId, branchId, status, documentType, limit || 50, offset || 0, entityId);
  }

  @BranchOwned(PrintJob)
  @Get('print-jobs/:id')
  async getJobById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.queueService.getPrintJobById(tenantId, id);
  }

  @BranchOwned(PrintJob)
  @Post('print-jobs/:id/retry')
  async retryJob(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.queueService.retryJob(tenantId, id, body || {});
  }

  // `printerId` sends this copy to a named device instead of the one that printed the
  // original — the everyday answer to a printer that has died mid-service.
  @BranchOwned(PrintJob)
  @Post('print-jobs/:id/reprint')
  async reprintJob(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    return await this.queueService.reprintJob(
      tenantId,
      id,
      body?.reason || 'Manual Reprint Request',
      userId,
      body?.printerId || body?.printer_id,
    );
  }

  @BranchOwned(OrderHeader)
  @Post('orders/:id/reprint')
  async reprintOrder(@Param('id') orderId: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    return await this.queueService.enqueueOrderPrintJobs(
      tenantId,
      orderId,
      body.documentType || body.document_type || 'CUSTOMER_RECEIPT',
      true,
      body.reason || 'Order Reprint Request',
      userId,
      body.printerId || body.printer_id,
      // One station's chit only.
      body.stationId || body.station_id,
    );
  }

  // Marking a job printed or failed by hand is a manager's call, and only on their own
  // branch's jobs. The job id rides in the body, where the branch guard would not look unless told.
  @BranchOwned(PrintJob, { body: 'printJobId' })
  @Roles(...MANAGER_AND_ABOVE)
  @Post('simulation/printers/outcome')
  async processOutcome(@Body() body: { printJobId: string; scenarioId?: string; outcome: 'SUCCESS' | 'FAILED'; useFallback?: boolean }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.queueService.processSimulationOutcome(tenantId, body);
  }
}
