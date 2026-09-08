import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { DineInService } from './dine-in.service';
import { CreateSectionDto, UpdateSectionDto, CreateTableDto, UpdateTableDto, MoveTableDto, MergeOrdersDto } from './dtos/dine-in.dto';

@Controller(['api/v1/dining', 'api/v1/dine-in'])
export class DineInController {
  constructor(private readonly dineInService: DineInService) {}

  // Sections / Areas
  @Get(['sections', 'areas'])
  async getSections(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.dineInService.getSections(tenantId, branchId);
  }

  @Post(['sections', 'areas'])
  async createSection(@Body() body: CreateSectionDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.createSection(tenantId, body, correlationId);
  }

  @Patch('sections/:id')
  async updateSection(@Param('id') id: string, @Body() body: UpdateSectionDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.updateSection(tenantId, id, body, correlationId);
  }

  @Delete('sections/:id')
  async archiveSection(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.archiveSection(tenantId, id, correlationId);
  }

  // Tables
  @Get('tables')
  async getTables(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const areaId = query.areaId || query.sectionId || query.dining_area_id;
    return await this.dineInService.getTables(tenantId, { ...query, areaId });
  }

  @Post('tables')
  async createTable(@Body() body: CreateTableDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.createTable(tenantId, body, correlationId);
  }

  @Patch('tables/:id')
  async updateTable(@Param('id') id: string, @Body() body: UpdateTableDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.updateTable(tenantId, id, body, correlationId);
  }

  @Delete('tables/:id')
  async archiveTable(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.archiveTable(tenantId, id, correlationId);
  }

  // Floor Plan
  @Get(['floor', 'floor-plan'])
  async getFloorPlan(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const branchId = query.branchId;
    const sectionId = query.sectionId || query.areaId;
    const status = query.status;
    return await this.dineInService.getFloorPlan(tenantId, branchId, sectionId, status);
  }

  // Move table
  @Post(['orders/:orderId/move-table', 'tables/:orderId/move'])
  async moveTable(
    @Param('orderId') orderId: string,
    @Body() body: MoveTableDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.moveTable(tenantId, orderId, body.targetTableId, body.guestCount, userId, correlationId);
  }

  // Merge orders
  @Post(['orders/merge', 'tables/merge-orders'])
  async mergeOrders(@Body() body: MergeOrdersDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.mergeOrders(tenantId, body, userId, correlationId);
  }

  // Legacy table session helpers for backward compatibility
  @Post('tables/:id/seat')
  async seatGuests(@Param('id') tableId: string, @Body() body: { guestCount: number; orderId?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.seatGuests(tenantId, tableId, body.guestCount, body.orderId, correlationId);
  }

  @Post('tables/:id/release')
  async releaseTable(@Param('id') tableId: string, @Body() body: { nextStatus?: 'AVAILABLE' | 'CLEANING' }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    const userId = (req as any).user?.id || (req as any).userId;
    return await this.dineInService.releaseTable(tenantId, tableId, body?.nextStatus, correlationId, userId);
  }
}
