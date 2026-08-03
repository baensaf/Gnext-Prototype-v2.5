import { Controller, Get, Patch, Post, Body, Param, Req } from '@nestjs/common';
import { Request } from 'express';
import { SettingsService } from './settings.service';

@Controller('api/v1')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('settings')
  async getSettings(@Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.settingsService.getSettings(tenantId);
  }

  @Patch('settings')
  async updateSetting(@Body() body: { key: string; value: any }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.settingsService.updateSetting(tenantId, body.key, body.value, correlationId);
  }

  @Get('currencies')
  async getCurrencies(@Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.settingsService.getCurrencies(tenantId);
  }

  @Post('currencies')
  async createCurrency(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.settingsService.createCurrency(tenantId, body, correlationId);
  }

  @Patch('currencies/:id')
  async updateCurrency(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.settingsService.updateCurrency(tenantId, id, body, correlationId);
  }

  @Get('payment-methods')
  async getPaymentMethods(@Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.settingsService.getPaymentMethods(tenantId);
  }

  @Post('payment-methods')
  async createPaymentMethod(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.settingsService.createPaymentMethod(tenantId, body, correlationId);
  }

  @Patch('payment-methods/:id')
  async updatePaymentMethod(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.settingsService.updatePaymentMethod(tenantId, id, body, correlationId);
  }

  @Get('reason-codes')
  async getReasonCodes(@Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.settingsService.getReasonCodes(tenantId);
  }

  @Post('reason-codes')
  async createReasonCode(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.settingsService.createReasonCode(tenantId, body, correlationId);
  }

  @Patch('reason-codes/:id')
  async updateReasonCode(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.settingsService.updateReasonCode(tenantId, id, body, correlationId);
  }
}
