import { Controller, Get, Post, Param, Query, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { KdsService } from './kds.service';

@Controller('api/v1/kds')
export class KdsController {
  constructor(private readonly kdsService: KdsService) {}

  @Get('stations')
  async getStations(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.kdsService.getStations(tenantId, branchId);
  }

  @Post('stations')
  async createStation(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.kdsService.createStation(tenantId, body, correlationId);
  }

  @Get('printers')
  async getPrinters(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.kdsService.getPrinters(tenantId, branchId);
  }

  @Post('printers')
  async createPrinter(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.kdsService.createPrinter(tenantId, body, correlationId);
  }

  @Get('tickets')
  async getKdsTickets(@Query('stationId') stationId: string, @Query('isBumped') isBumped: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.kdsService.getKdsTickets(tenantId, stationId, isBumped === 'true');
  }

  @Post('tickets/:id/bump')
  async bumpTicket(@Param('id') ticketId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.kdsService.bumpTicket(tenantId, ticketId, correlationId);
  }

  @Post('tickets/:id/recall')
  async recallTicket(@Param('id') ticketId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.kdsService.recallTicket(tenantId, ticketId, correlationId);
  }

  @Post('tickets/items/:itemId/status')
  async updateItemStatus(@Param('itemId') itemId: string, @Body() body: { status: 'PENDING' | 'COOKING' | 'DONE' }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.kdsService.updateItemStatus(tenantId, itemId, body.status);
  }

  @Post('printers/simulate-print')
  async simulatePrint(@Body() body: { ticket_id?: string; order_id?: string; paper_width_mm?: number }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.kdsService.simulatePrint(tenantId, body);
  }
}
