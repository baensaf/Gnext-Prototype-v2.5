import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Req, Sse } from '@nestjs/common';
import { Request } from 'express';
import { Observable, interval } from 'rxjs';
import { map } from 'rxjs/operators';
import { KdsService, MessageEvent } from './kds.service';
import { effectiveBranchId } from '../../common/utils/user-scope.util';

@Controller('api/v1/kds')
export class KdsController {
  constructor(private readonly kdsService: KdsService) {}

  // SSE Events Stream
  @Sse('events')
  sendEvents(): Observable<MessageEvent> {
    return this.kdsService.getEventStream();
  }

  // Board View
  @Get('board')
  async getKdsBoard(
    @Query('branchId') branchId: string,
    @Query('stationIds') stationIdsStr: string,
    @Query('state') state: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const stationIds = stationIdsStr ? stationIdsStr.split(',') : undefined;
    return await this.kdsService.getKdsBoard(
      tenantId,
      effectiveBranchId((req as any).userBranchId, branchId),
      stationIds,
      state,
    );
  }

  @Get('tickets')
  async getKdsTickets(
    @Query('stationId') stationId: string,
    @Query('isBumped') isBumped: string,
    @Query('branchId') branchId: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    // A kitchen display belongs to a kitchen; it used to show every kitchen in the chain.
    return await this.kdsService.getKdsTickets(
      tenantId,
      stationId,
      isBumped === 'true',
      effectiveBranchId((req as any).userBranchId, branchId),
    );
  }

  // Ticket Actions
  @Post('tickets/:id/start')
  async startTicket(@Param('id') ticketId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    return await this.kdsService.startTicket(tenantId, ticketId, userId);
  }

  @Post('tickets/:id/bump')
  async bumpTicket(@Param('id') ticketId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    const userId = (req as any).userId;
    return await this.kdsService.bumpTicket(tenantId, ticketId, correlationId, userId);
  }

  @Post('tickets/:id/recall')
  async recallTicket(@Param('id') ticketId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    const userId = (req as any).userId;
    return await this.kdsService.recallTicket(tenantId, ticketId, correlationId, userId);
  }

  @Post('tickets/:id/priority')
  async setPriority(@Param('id') ticketId: string, @Body() body: { priority: number }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    return await this.kdsService.setTicketPriority(tenantId, ticketId, body.priority || 0, userId);
  }

  @Post('ticket-items/:id/state')
  async updateItemState(@Param('id') itemId: string, @Body() body: { state: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    return await this.kdsService.updateItemStatus(tenantId, itemId, body.state, userId);
  }

  @Post('tickets/items/:itemId/status')
  async updateItemStatusLegacy(@Param('itemId') itemId: string, @Body() body: { status: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    return await this.kdsService.updateItemStatus(tenantId, itemId, body.status, userId);
  }

  // Stations CRUD
  @Get('stations')
  async getStations(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.kdsService.getStations(
      tenantId,
      effectiveBranchId((req as any).userBranchId, branchId),
    );
  }

  @Post('stations')
  async createStation(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.kdsService.createStation(tenantId, body, correlationId);
  }

  @Patch('stations/:id')
  async updateStation(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.kdsService.updateStation(tenantId, id, body);
  }

  @Delete('stations/:id')
  async deleteStation(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.kdsService.deleteStation(tenantId, id);
  }

  // Screens CRUD
  @Get('screens')
  async getScreens(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.kdsService.getScreens(tenantId, branchId);
  }

  @Post('screens')
  async createScreen(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.kdsService.createScreen(tenantId, body);
  }

  @Patch('screens/:id')
  async updateScreen(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.kdsService.updateScreen(tenantId, id, body);
  }

  @Delete('screens/:id')
  async deleteScreen(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.kdsService.deleteScreen(tenantId, id);
  }

  // Routing Rules CRUD
  @Get('routing-rules')
  async getRoutingRules(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.kdsService.getRoutingRules(tenantId, branchId);
  }

  @Post('routing-rules')
  async createRoutingRule(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.kdsService.createRoutingRule(tenantId, body);
  }

  @Delete('routing-rules/:id')
  async deleteRoutingRule(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.kdsService.deleteRoutingRule(tenantId, id);
  }
}
