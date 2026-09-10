import { Controller, Get, Post, Body, Query, Param, Req } from '@nestjs/common';
import { Request } from 'express';
import { OfflineSyncService } from './offline-sync.service';
import { HeadOfficeOnly } from '../../common/decorators/roles.decorator';

/**
 * Part of the same sandbox: pulling the network out from under the demo and putting it back.
 * Only the Offline Sync Engine screen calls it, and that screen is head office's.
 */
@Controller('api/v1/sync')
@HeadOfficeOnly()
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
    @Body('agentVersion') agentVersion: string,
    @Body('agentHealth') agentHealth: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.syncService.toggleConnectivity(tenantId, branchId, isOnline, agentVersion, agentHealth);
  }

  @Post('queue')
  async enqueueOfflineItem(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.syncService.enqueueOfflineItem(tenantId, body, correlationId);
  }

  @Post('offline/operations')
  async enqueueOfflineOperation(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    const data = {
      branch_id: body.branchId || body.branch_id,
      terminal_id: body.terminalId || body.terminal_id,
      entity_type: body.operationType || body.entity_type || 'ORDER',
      payload: body.payload,
      client_version: body.localVersion || body.client_version || 1,
      dedupe_key: body.dedupeKey || body.dedupe_key,
    };
    return await this.syncService.enqueueOfflineItem(tenantId, data, correlationId);
  }

  @Post('trigger')
  async triggerSyncWorker(@Body('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.syncService.triggerSyncWorker(tenantId, branchId, correlationId);
  }

  @Post('queue/:id/retry')
  async cloneDlqItemParam(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.syncService.cloneDlqItem(tenantId, id, correlationId);
  }

  @Post('retry-dlq')
  async cloneDlqItemBody(@Body('queue_item_id') queueItemId: string, @Body('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.syncService.cloneDlqItem(tenantId, queueItemId || id, correlationId);
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
