import { Controller, Get, Post, Body, Query, Headers, Req } from '@nestjs/common';
import { Request } from 'express';
import { SimulationService } from './simulation.service';

@Controller('api/v1/simulation')
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  @Get('scenarios')
  async getScenarios() {
    return await this.simulationService.getScenarios();
  }

  @Post('snappfood/webhook')
  async handleSnappfoodWebhook(
    @Body() body: any,
    @Headers('x-snappfood-signature') signature: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    const rawBody = JSON.stringify(body);
    return await this.simulationService.handleSnappfoodWebhook(tenantId, rawBody, body, signature, 'snappfood-secret-key-123', correlationId);
  }

  @Post('snappfood/generate')
  async generateSnappfoodOrder(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.simulationService.generateSnappfoodOrder(tenantId, body, correlationId);
  }

  @Post('snappfood/action')
  async triggerSnappfoodAction(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.simulationService.triggerSnappfoodAction(tenantId, body, correlationId);
  }

  @Post('tara/command')
  async executeTaraCommand(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.simulationService.executeTaraCommand(tenantId, body, correlationId);
  }

  @Get('logs')
  async getLogs(
    @Query('provider') provider: string,
    @Query('status') status: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.simulationService.getLogs(tenantId, provider, status);
  }
}
