import { Controller, Get, Post, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { InventoryService } from './inventory.service';

@Controller('api/v1/inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('items')
  async getInventoryItems(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.inventoryService.getInventoryItems(tenantId, branchId);
  }

  @Get('alerts')
  async getLowStockAlerts(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.inventoryService.getLowStockAlerts(tenantId, branchId);
  }

  @Post('transactions')
  async postTransaction(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.inventoryService.postTransaction(tenantId, body, correlationId);
  }

  @Get('items/:id/transactions')
  async getTransactions(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.inventoryService.getTransactions(tenantId, id);
  }
}
