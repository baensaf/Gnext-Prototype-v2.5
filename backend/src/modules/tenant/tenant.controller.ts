import { Controller, Get, Patch, Post, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { TenantService } from './tenant.service';
import { HeadOfficeOnly } from '../../common/decorators/roles.decorator';
import { effectiveBranchId } from '../../common/utils/user-scope.util';

@Controller('api/v1')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get('tenant')
  async getTenantProfile(@Req() req: Request) {
    const tenantId = (req as any).tenantId; // Fallback seed tenant
    return await this.tenantService.getProfile(tenantId);
  }

  @Patch('tenant')
  @HeadOfficeOnly()
  async updateTenantProfile(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.tenantService.updateProfile(tenantId, body, correlationId);
  }

  @Get('branches')
  async getBranches(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    // The switcher already hid the other sites from a branch account. Hiding them here
    // too means it is a rule rather than a courtesy the next screen could forget.
    return await this.tenantService.getBranches(tenantId, undefined, (req as any).userBranchId ?? null);
  }

  @Get('branches/:id')
  async getBranchById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.tenantService.getBranchById(tenantId, id);
  }

  // Opening, renaming and closing sites is what head office is for. A branch account
  // reaching this would be editing the chain around itself.
  @Post('branches')
  @HeadOfficeOnly()
  async createBranch(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.tenantService.createBranch(tenantId, body, correlationId);
  }

  @Patch('branches/:id')
  @HeadOfficeOnly()
  async updateBranch(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.tenantService.updateBranch(tenantId, id, body, correlationId);
  }

  @Delete('branches/:id')
  @HeadOfficeOnly()
  async archiveBranch(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.tenantService.archiveBranch(tenantId, id, correlationId);
  }

  @Get('branches/:id/operating-hours')
  async getBranchHours(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.tenantService.getBranchHours(tenantId, id);
  }

  @Patch('branches/:id/operating-hours')
  async updateBranchHours(@Param('id') id: string, @Body() body: { hours: any[] }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.tenantService.updateBranchHours(tenantId, id, body.hours || [], correlationId);
  }

  @Get('branches/:id/status')
  async getBranchStatus(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.tenantService.getBranchStatus(tenantId, id);
  }

  @Get('terminals')
  async getTerminals(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.tenantService.getTerminals(tenantId, branchId);
  }

  @Post('terminals')
  async createTerminal(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.tenantService.createTerminal(tenantId, body, correlationId);
  }

  @Patch('terminals/:id')
  async updateTerminal(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.tenantService.updateTerminal(tenantId, id, body, correlationId);
  }

  @Delete('terminals/:id')
  async archiveTerminal(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.tenantService.archiveTerminal(tenantId, id, correlationId);
  }
}
