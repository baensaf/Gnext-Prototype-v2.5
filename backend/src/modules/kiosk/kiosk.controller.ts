import { Controller, Get, Post, Query, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { KioskService } from './kiosk.service';

@Controller('api/v1/kiosk')
export class KioskController {
  constructor(private readonly kioskService: KioskService) {}

  @Get('bootstrap')
  async getBootstrapContext(
    @Query('branchId') branchId: string,
    @Query('terminalId') terminalId: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.kioskService.getBootstrapContext(tenantId, branchId, terminalId);
  }

  @Post('orders')
  async createKioskOrder(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.kioskService.createKioskOrder(tenantId, body, correlationId);
  }

  @Post('pay')
  async processKioskPayment(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.kioskService.processKioskPayment(tenantId, body, correlationId);
  }
}
