import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { DineInService } from './dine-in.service';
import { CreateSectionDto, UpdateSectionDto, CreateTableDto, UpdateTableDto, MoveTableDto, MergeOrdersDto } from './dtos/dine-in.dto';
import { HeadOfficeOnly, MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { BranchOwned } from '../../common/decorators/branch-owned.decorator';
import { DiningArea } from '../../entities/DiningArea.entity';
import { DiningTable } from '../../entities/DiningTable.entity';

// One base, one name per thing. Mounted at two bases with per-handler aliases underneath,
// a single handler answered at four addresses, and every rule about who may call it had to
// be written four times. The frontend only ever used the 'dining' family.
@Controller('api/v1/dining')
export class DineInController {
  constructor(private readonly dineInService: DineInService) {}

  // Sections / Areas
  @Get('sections')
  async getSections(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.dineInService.getSections(tenantId, branchId);
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post('sections')
  async createSection(@Body() body: CreateSectionDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.createSection(tenantId, body, correlationId);
  }

  @BranchOwned(DiningArea)
  @Roles(...MANAGER_AND_ABOVE)
  @Patch('sections/:id')
  async updateSection(@Param('id') id: string, @Body() body: UpdateSectionDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.updateSection(tenantId, id, body, correlationId);
  }

  @BranchOwned(DiningArea)
  @Roles(...MANAGER_AND_ABOVE)
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

  @Roles(...MANAGER_AND_ABOVE)
  @Post('tables')
  async createTable(@Body() body: CreateTableDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.createTable(tenantId, body, correlationId);
  }

  @BranchOwned(DiningTable, { through: { entity: DiningArea, foreignKey: 'dining_area_id' } })
  @Roles(...MANAGER_AND_ABOVE)
  @Patch('tables/:id')
  async updateTable(@Param('id') id: string, @Body() body: UpdateTableDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.updateTable(tenantId, id, body, correlationId);
  }

  @BranchOwned(DiningTable, { through: { entity: DiningArea, foreignKey: 'dining_area_id' } })
  @Roles(...MANAGER_AND_ABOVE)
  @Delete('tables/:id')
  async archiveTable(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.archiveTable(tenantId, id, correlationId);
  }

  // Floor Plan
  @Get('floor')
  async getFloorPlan(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const branchId = query.branchId;
    const sectionId = query.sectionId || query.areaId;
    const status = query.status;
    return await this.dineInService.getFloorPlan(tenantId, branchId, sectionId, status);
  }

  // Move table
  @Post('orders/:orderId/move-table')
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
  @Post('orders/merge')
  async mergeOrders(@Body() body: MergeOrdersDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.mergeOrders(tenantId, body, userId, correlationId);
  }

  // Legacy table session helpers for backward compatibility
  @BranchOwned(DiningTable, { through: { entity: DiningArea, foreignKey: 'dining_area_id' } })
  @Post('tables/:id/seat')
  async seatGuests(@Param('id') tableId: string, @Body() body: { guestCount: number; orderId?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.dineInService.seatGuests(tenantId, tableId, body.guestCount, body.orderId, correlationId);
  }

  @BranchOwned(DiningTable, { through: { entity: DiningArea, foreignKey: 'dining_area_id' } })
  @Post('tables/:id/release')
  async releaseTable(@Param('id') tableId: string, @Body() body: { nextStatus?: 'AVAILABLE' | 'CLEANING' }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    const userId = (req as any).user?.id || (req as any).userId;
    return await this.dineInService.releaseTable(tenantId, tableId, body?.nextStatus, correlationId, userId);
  }
}
