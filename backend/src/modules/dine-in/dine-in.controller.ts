import { Controller, Get, Post, Param, Query, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { DineInService } from './dine-in.service';

@Controller('api/v1/dine-in')
export class DineInController {
  constructor(private readonly dineInService: DineInService) {}

  @Get('areas')
  async getAreas(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.dineInService.getAreas(tenantId, branchId);
  }

  @Post('areas')
  async createArea(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.dineInService.createArea(tenantId, body, correlationId);
  }

  @Get('tables')
  async getTables(@Query('areaId') areaId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.dineInService.getTables(tenantId, areaId);
  }

  @Post('tables')
  async createTable(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.dineInService.createTable(tenantId, body, correlationId);
  }

  @Get('floor-plan')
  async getFloorPlan(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.dineInService.getFloorPlan(tenantId, branchId);
  }

  @Post('tables/:id/seat')
  async seatGuests(@Param('id') tableId: string, @Body() body: { guestCount: number; orderId?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.dineInService.seatGuests(tenantId, tableId, body.guestCount, body.orderId, correlationId);
  }

  @Post('tables/:id/transfer')
  async transferTable(@Param('id') sourceTableId: string, @Body() body: { targetTableId: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.dineInService.transferTable(tenantId, sourceTableId, body.targetTableId, correlationId);
  }

  @Post('tables/merge')
  async mergeTables(@Body() body: { sourceTableId: string; targetTableId: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.dineInService.mergeTables(tenantId, body.sourceTableId, body.targetTableId, correlationId);
  }

  @Post('tables/:id/release')
  async releaseTable(@Param('id') tableId: string, @Body() body: { nextStatus?: 'AVAILABLE' | 'CLEANING' }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.dineInService.releaseTable(tenantId, tableId, body?.nextStatus, correlationId);
  }
}
