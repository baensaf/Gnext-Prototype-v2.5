import { Controller, Get, Post, Param, Body, Query, Req, Header } from '@nestjs/common';
import { Request } from 'express';
import { InventoryService } from './inventory.service';
import { PostInventoryTxDto } from '../../common/dto/inventory.dto';

@Controller('api/v1/inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('items')
  @Header('X-V5-Preview', 'true')
  async getInventoryItems(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.inventoryService.getInventoryItems(tenantId, branchId);
  }

  @Get('alerts')
  @Header('X-V5-Preview', 'true')
  async getLowStockAlerts(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.inventoryService.getLowStockAlerts(tenantId, branchId);
  }

  @Post('transactions')
  @Header('X-V5-Preview', 'true')
  async postTransaction(@Body() body: PostInventoryTxDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.inventoryService.postTransaction(tenantId, body, correlationId);
  }

  @Get('items/:id/transactions')
  @Header('X-V5-Preview', 'true')
  async getTransactions(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.inventoryService.getTransactions(tenantId, id);
  }
}
