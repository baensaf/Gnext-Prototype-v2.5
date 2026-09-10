import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Req, NotFoundException, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Printer } from '../../entities/Printer.entity';
import { PrinterGroup } from '../../entities/PrinterGroup.entity';
import { PrinterGroupMember } from '../../entities/PrinterGroupMember.entity';
import { PrintRoute } from '../../entities/PrintRoute.entity';
import { PrintQueueService } from './print-queue.service';
import { AuditWriter } from '../audit/audit-writer.service';
import { HeadOfficeOnly, MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { BranchOwned } from '../../common/decorators/branch-owned.decorator';
import {
  CreatePrinterDto,
  CreatePrinterGroupDto,
  CreatePrintRouteDto,
  UpdatePrinterDto,
  UpdatePrinterGroupDto,
  UpdatePrintRouteDto,
} from './dtos/printing-config.dto';

@Controller('api/v1')
export class PrintersController {
  constructor(
    @InjectRepository(Printer) private readonly printerRepo: Repository<Printer>,
    @InjectRepository(PrinterGroup) private readonly groupRepo: Repository<PrinterGroup>,
    @InjectRepository(PrinterGroupMember) private readonly memberRepo: Repository<PrinterGroupMember>,
    @InjectRepository(PrintRoute) private readonly routeRepo: Repository<PrintRoute>,
    private readonly queueService: PrintQueueService,
    private readonly auditWriter: AuditWriter,
  ) {}

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
    });
    const saved = await this.printerRepo.save(printer);

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

    Object.assign(printer, body);
    const saved = await this.printerRepo.save(printer);
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
    return { success: true };
  }

  // 2. Printer Groups CRUD
  @Get('printer-groups')
  async getGroups(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    const groups = await this.groupRepo.find({ where, order: { name: 'ASC' } });

    const result = [];
    for (const g of groups) {
      const members = await this.memberRepo.find({ where: { group_id: g.id }, order: { priority: 'ASC' } });
      result.push({ ...g, members });
    }
    return result;
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post('printer-groups')
  async createGroup(@Body() body: CreatePrinterGroupDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const group = this.groupRepo.create({
      tenant_id: tenantId,
      branch_id: body.branch_id,
      code: body.code.toUpperCase(),
      name: body.name,
    });
    const savedGroup = await this.groupRepo.save(group);

    if (body.members && Array.isArray(body.members)) {
      for (const m of body.members) {
        const member = this.memberRepo.create({
          group_id: savedGroup.id,
          printer_id: m.printer_id,
          priority: m.priority || 0,
          copies: m.copies || 1,
        });
        await this.memberRepo.save(member);
      }
    }
    return savedGroup;
  }

  @BranchOwned(PrinterGroup)
  @Roles(...MANAGER_AND_ABOVE)
  @Patch('printer-groups/:id')
  async updateGroup(@Param('id') id: string, @Body() body: UpdatePrinterGroupDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const group = await this.groupRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!group) throw new NotFoundException('Printer group not found');

    if (body.name !== undefined) group.name = body.name;
    if (body.code !== undefined) group.code = body.code.toUpperCase();
    if (body.branch_id) group.branch_id = body.branch_id;

    const savedGroup = await this.groupRepo.save(group);

    if (body.members && Array.isArray(body.members)) {
      await this.memberRepo.delete({ group_id: id });
      const savedMembers = [];
      for (const m of body.members) {
        const member = this.memberRepo.create({
          group_id: savedGroup.id,
          printer_id: m.printer_id,
          priority: m.priority || 0,
          copies: m.copies || 1,
        });
        savedMembers.push(await this.memberRepo.save(member));
      }
      return { ...savedGroup, members: savedMembers };
    }

    const members = await this.memberRepo.find({ where: { group_id: id }, order: { priority: 'ASC' } });
    return { ...savedGroup, members };
  }

  @BranchOwned(PrinterGroup)
  @Roles(...MANAGER_AND_ABOVE)
  @Delete('printer-groups/:id')
  async deleteGroup(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    await this.groupRepo.softDelete({ id, tenant_id: tenantId });
    return { success: true };
  }

  // 3. Print Routes CRUD
  @Get('print-routes')
  async getRoutes(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    return await this.routeRepo.find({ where, order: { priority: 'DESC' } });
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post('print-routes')
  async createRoute(@Body() body: CreatePrintRouteDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const route = this.routeRepo.create({
      tenant_id: tenantId,
      branch_id: body.branch_id,
      document_type: body.document_type || 'CUSTOMER_RECEIPT',
      product_id: body.product_id || null,
      category_id: body.category_id || null,
      station_id: body.station_id || null,
      printer_group_id: body.printer_group_id,
      priority: body.priority || 0,
      copies: body.copies || 1,
    });
    return await this.routeRepo.save(route);
  }

  @BranchOwned(PrintRoute)
  @Roles(...MANAGER_AND_ABOVE)
  @Patch('print-routes/:id')
  async updateRoute(@Param('id') id: string, @Body() body: UpdatePrintRouteDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const route = await this.routeRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!route) throw new NotFoundException('Print route not found');

    if (body.document_type !== undefined) route.document_type = body.document_type;
    if (body.printer_group_id !== undefined) route.printer_group_id = body.printer_group_id;
    if (body.priority !== undefined) route.priority = Number(body.priority);
    if (body.copies !== undefined) route.copies = Number(body.copies);
    if ('product_id' in body) route.product_id = body.product_id || null;
    if ('category_id' in body) route.category_id = body.category_id || null;
    if ('station_id' in body) route.station_id = body.station_id || null;
    if (body.branch_id) route.branch_id = body.branch_id;

    return await this.routeRepo.save(route);
  }

  @BranchOwned(PrintRoute)
  @Roles(...MANAGER_AND_ABOVE)
  @Delete('print-routes/:id')
  async deleteRoute(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    await this.routeRepo.softDelete({ id, tenant_id: tenantId });
    return { success: true };
  }

  // 4. Print Jobs Queue & Simulation Actions
  @Get('print-jobs')
  async getJobs(
    @Query('branchId') branchId: string,
    @Query('status') status: string,
    @Query('documentType') documentType: string,
    @Query('limit') limit: number,
    @Query('offset') offset: number,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.queueService.getPrintJobs(tenantId, branchId, status, documentType, limit || 50, offset || 0);
  }

  @Get('print-jobs/:id')
  async getJobById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.queueService.getPrintJobById(tenantId, id);
  }

  @Post('print-jobs/:id/retry')
  async retryJob(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.queueService.retryJob(tenantId, id, body || {});
  }

  @Post('print-jobs/:id/reprint')
  async reprintJob(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    const job = await this.queueService.getPrintJobById(tenantId, id);
    if (!job) throw new NotFoundException('Job not found');

    return await this.queueService.enqueueOrderPrintJobs(
      tenantId,
      job.entity_id,
      job.document_type,
      true,
      body.reason || 'Manual Reprint Request',
      userId,
    );
  }

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
    );
  }

  @Post('simulation/printers/outcome')
  async processOutcome(@Body() body: { printJobId: string; scenarioId?: string; outcome: 'SUCCESS' | 'FAILED'; useFallback?: boolean }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.queueService.processSimulationOutcome(tenantId, body);
  }
}
