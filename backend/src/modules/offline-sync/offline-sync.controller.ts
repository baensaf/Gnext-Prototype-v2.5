import { Controller, Get, Post, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { OfflineSyncService } from './offline-sync.service';

@Controller('api/v1/sync')
export class OfflineSyncController {
  constructor(private readonly syncService: OfflineSyncService) {}

  @Get('status')
  async getStatus(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.syncService.getStatus(tenantId, branchId);
  }

  @Post('toggle-connectivity')
  async toggleConnectivity(
    @Body('branchId') branchId: string,
    @Body('isOnline') isOnline: boolean,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.syncService.toggleConnectivity(tenantId, branchId, isOnline);
  }

  @Post('queue')
  async enqueueOfflineItem(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.syncService.enqueueOfflineItem(tenantId, body, correlationId);
  }

  @Post('trigger')
  async triggerSyncWorker(@Body('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.syncService.triggerSyncWorker(tenantId, branchId, correlationId);
  }

  @Get('queue')
  async getQueue(
    @Query('branchId') branchId: string,
    @Query('status') status: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.syncService.getQueue(tenantId, branchId, status);
  }

  @Get('conflicts')
  async getConflicts(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.syncService.getConflicts(tenantId);
  }

  @Post('resolve-conflict')
  async resolveConflict(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    const correlationId = (req as any).correlationId;
    return await this.syncService.resolveConflict(tenantId, body, userId, correlationId);
  }
}
