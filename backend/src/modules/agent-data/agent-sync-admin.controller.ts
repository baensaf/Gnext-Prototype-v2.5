import { Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { HeadOfficeOnly, MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { AgentSyncService } from './agent-sync.service';

/** Head office's view of the orders branches uploaded after selling offline (protocol §12.7). */
@HeadOfficeOnly()
@Roles(...MANAGER_AND_ABOVE)
@Controller('api/v1/agent-sync/orders')
export class AgentSyncAdminController {
  constructor(private readonly sync: AgentSyncService) {}

  /** `view=attention` (default): held, and flagged but not reviewed. `view=all`: everything. */
  @Get()
  async list(@Req() req: Request, @Query('view') view?: string, @Query('branchId') branchId?: string, @Query('limit') limit?: string) {
    return await this.sync.list((req as any).tenantId, { view, branchId: branchId || undefined, limit: limit ? Number(limit) : undefined });
  }

  @Post(':id/retry')
  async retry(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return await this.sync.retry((req as any).tenantId, id, (req as any).userId);
  }

  @Post(':id/review')
  async review(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return await this.sync.markReviewed((req as any).tenantId, id, (req as any).userId);
  }
}
