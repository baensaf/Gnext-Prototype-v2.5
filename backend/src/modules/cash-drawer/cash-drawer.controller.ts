import { Controller, Get, Post, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { CashDrawerService } from './cash-drawer.service';

@Controller('api/v1/cash-drawer')
export class CashDrawerController {
  constructor(private readonly cashDrawerService: CashDrawerService) {}

  @Get('shifts/active')
  async getActiveShift(
    @Query('branchId') branchId: string,
    @Query('terminalId') terminalId: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.cashDrawerService.getActiveShift(tenantId, branchId, terminalId);
  }

  @Post('shifts/open')
  async openShift(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.cashDrawerService.openShift(tenantId, body, correlationId);
  }

  @Post('shifts/:id/transactions')
  async postTransaction(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.cashDrawerService.postTransaction(tenantId, id, body, correlationId);
  }

  @Post('shifts/:id/close')
  async closeShift(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.cashDrawerService.closeShift(tenantId, id, body, correlationId);
  }
}
