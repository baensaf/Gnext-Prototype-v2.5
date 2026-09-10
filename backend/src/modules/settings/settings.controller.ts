import { Controller, Delete, Get, Patch, Post, Body, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { SettingsService } from './settings.service';
import { effectiveBranchId, UserScope } from '../../common/utils/user-scope.util';
import { HeadOfficeOnly, MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';

/** The signed-in account's scope, as the session guard recorded it. */
function actorScope(req: Request): UserScope {
  return { role: (req as any).userRole, branchId: (req as any).userBranchId ?? null };
}

/**
 * Which branch's settings a read is really about.
 *
 * The write paths have always confined a branch account to its own site; the reads took
 * the query string's word for it, so passing another branch's id answered with that
 * branch's rules. Confinement has to hold on the way out as well as the way in.
 */
function scopedBranchId(req: Request, requested?: string): string | undefined {
  return effectiveBranchId((req as any).userBranchId ?? null, requested);
}

@Controller('api/v1')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('settings')
  async getSettings(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.settingsService.getSettings(tenantId, scopedBranchId(req, branchId));
  }

  /** Same values, annotated with which level each came from. */
  @Get('settings/scoped')
  async getScopedSettings(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.settingsService.getSettingsWithScope(tenantId, scopedBranchId(req, branchId));
  }

  // Which scope a write lands in is the service's business; whether the account may
  // write settings at all is this decorator's.
  @Patch('settings')
  @Roles(...MANAGER_AND_ABOVE)
  async updateSetting(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    const key = body.key || 'GENERAL';
    const value = body.value !== undefined ? body.value : body;
    return await this.settingsService.updateSetting(tenantId, key, value, correlationId, body.branchId, actorScope(req));
  }

  @Patch('settings/:group')
  @Roles(...MANAGER_AND_ABOVE)
  async updateSettingGroup(@Param('group') group: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    const keyToSave = body.key || group;
    const valueToSave = body.value !== undefined ? body.value : body;
    return await this.settingsService.updateSetting(tenantId, keyToSave, valueToSave, correlationId, body.branchId, actorScope(req));
  }

  /** Drop a branch's override and go back to inheriting the organization value. */
  @Delete('settings/:group/override')
  @Roles(...MANAGER_AND_ABOVE)
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

  // Currencies, tender types and reason codes have no branch dimension at all: there is
  // one set for the chain, and one place it is decided.
  @Post('currencies')
  @HeadOfficeOnly()
  async createCurrency(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.settingsService.createCurrency(tenantId, body, correlationId);
  }

  @Patch('currencies/:id')
  @HeadOfficeOnly()
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
  @HeadOfficeOnly()
  async createPaymentMethod(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.settingsService.createPaymentMethod(tenantId, body, correlationId);
  }

  @Patch('payment-methods/:id')
  @HeadOfficeOnly()
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
  @HeadOfficeOnly()
  async createReasonCode(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.settingsService.createReasonCode(tenantId, body, correlationId);
  }

  @Patch('reason-codes/:id')
  @HeadOfficeOnly()
  async updateReasonCode(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.settingsService.updateReasonCode(tenantId, id, body, correlationId);
  }
}
