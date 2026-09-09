import { Controller, Delete, Get, Patch, Post, Body, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { SettingsService } from './settings.service';
import { UserScope } from '../../common/utils/user-scope.util';

/** The signed-in account's scope, as the session guard recorded it. */
function actorScope(req: Request): UserScope {
  return { role: (req as any).userRole, branchId: (req as any).userBranchId ?? null };
}

@Controller('api/v1')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('settings')
  async getSettings(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.settingsService.getSettings(tenantId, branchId || undefined);
  }

  /** Same values, annotated with which level each came from. */
  @Get('settings/scoped')
  async getScopedSettings(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.settingsService.getSettingsWithScope(tenantId, branchId || undefined);
  }

  @Patch('settings')
  async updateSetting(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    const key = body.key || 'GENERAL';
    const value = body.value !== undefined ? body.value : body;
    return await this.settingsService.updateSetting(tenantId, key, value, correlationId, body.branchId, actorScope(req));
  }

  @Patch('settings/:group')
  async updateSettingGroup(@Param('group') group: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    const keyToSave = body.key || group;
    const valueToSave = body.value !== undefined ? body.value : body;
    return await this.settingsService.updateSetting(tenantId, keyToSave, valueToSave, correlationId, body.branchId, actorScope(req));
  }

  /** Drop a branch's override and go back to inheriting the organization value. */
  @Delete('settings/:group/override')
  async clearBranchOverride(
    @Param('group') group: string,
    @Query('branchId') branchId: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.settingsService.clearBranchOverride(tenantId, group, branchId, correlationId, actorScope(req));
  }

  @Get('currencies')
  async getCurrencies(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.settingsService.getCurrencies(tenantId);
  }

  @Post('currencies')
  async createCurrency(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.settingsService.createCurrency(tenantId, body, correlationId);
  }

  @Patch('currencies/:id')
  async updateCurrency(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.settingsService.updateCurrency(tenantId, id, body, correlationId);
  }

  @Get('payment-methods')
  async getPaymentMethods(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.settingsService.getPaymentMethods(tenantId);
  }

  @Post('payment-methods')
  async createPaymentMethod(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.settingsService.createPaymentMethod(tenantId, body, correlationId);
  }

  @Patch('payment-methods/:id')
  async updatePaymentMethod(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.settingsService.updatePaymentMethod(tenantId, id, body, correlationId);
  }

  @Get('reason-codes')
  async getReasonCodes(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.settingsService.getReasonCodes(tenantId);
  }

  @Post('reason-codes')
  async createReasonCode(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.settingsService.createReasonCode(tenantId, body, correlationId);
  }

  @Patch('reason-codes/:id')
  async updateReasonCode(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.settingsService.updateReasonCode(tenantId, id, body, correlationId);
  }
}
