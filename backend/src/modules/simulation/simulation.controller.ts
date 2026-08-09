import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Headers, Req } from '@nestjs/common';
import { Request } from 'express';
import { SimulationService } from './simulation.service';

@Controller('api/v1/simulation')
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  @Get('scenarios')
  async getScenarios() {
    return await this.simulationService.getScenarios();
  }

  @Post('scenarios')
  async createScenario(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.createScenario(tenantId, body);
  }

  @Patch('scenarios/:id')
  async updateScenario(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.updateScenario(tenantId, id, body);
  }

  @Delete('scenarios/:id')
  async deleteScenario(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.deleteScenario(tenantId, id);
  }

  @Post('snappfood/webhook')
  async handleSnappfoodWebhook(
    @Body() body: any,
    @Headers('x-snappfood-signature') signature: string,
    @Headers('x-snappfood-timestamp') timestamp: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    const rawBody = JSON.stringify(body);
    return await this.simulationService.handleSnappfoodWebhook(
      tenantId,
      rawBody,
      body,
      signature,
      timestamp,
      'snappfood-secret-key-123',
      correlationId,
    );
  }

  @Post('snappfood/orders')
  async generateSnappfoodOrder(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.simulationService.generateSnappfoodOrder(tenantId, body, correlationId);
  }

  @Post('snappfood/generate')
  async generateSnappfoodOrderAlias(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.simulationService.generateSnappfoodOrder(tenantId, body, correlationId);
  }

  @Post('snappfood/duplicates')
  async triggerSnappfoodDuplicate(@Body() body: { sourceWebhookReceiptId?: string; log_id?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    const logId = body.sourceWebhookReceiptId || body.log_id;
    return await this.simulationService.triggerSnappfoodDuplicate(tenantId, logId, correlationId);
  }

  @Post('snappfood/orders/:orderId/action')
  async triggerSnappfoodOrderAction(
    @Param('orderId') orderId: string,
    @Body() body: { action: 'PICK' | 'ACCEPT' | 'REJECT' | 'MODIFY' | 'CANCEL' | 'RECOVER'; payload?: any; scenarioId?: string },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.simulationService.triggerSnappfoodAction(tenantId, { ...body, order_id: orderId }, correlationId);
  }

  @Post('snappfood/action')
  async triggerSnappfoodActionLegacy(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.simulationService.triggerSnappfoodAction(tenantId, body, correlationId);
  }

  @Post('snappfood/catalog-sync')
  async triggerCatalogSync(@Body() body: { branchId?: string; direction?: 'PUSH' | 'RECOVER'; entityTypes?: string[]; scenarioId?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.simulationService.triggerCatalogSync(tenantId, body, correlationId);
  }

  @Post('tara/transactions')
  async executeTaraTransaction(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.simulationService.executeTaraCommand(tenantId, body, correlationId);
  }

  @Post('tara/command')
  async executeTaraCommandLegacy(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.simulationService.executeTaraCommand(tenantId, body, correlationId);
  }

  @Get('logs')
  async getLogs(
    @Query('provider') provider: string,
    @Query('status') status: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.getLogs(tenantId, provider, status);
  }

  @Get('logs/:id')
  async getLogDetail(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.getLogDetail(tenantId, id);
  }
}
