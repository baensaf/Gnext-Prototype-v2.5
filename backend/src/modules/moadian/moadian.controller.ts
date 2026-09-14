import { Controller, Get, Post, Param, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { MoadianService } from './moadian.service';
import { effectiveBranchId } from '../../common/utils/user-scope.util';
import { MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';

@Controller('api/v1/moadian')
export class MoadianController {
  constructor(private readonly moadianService: MoadianService) {}

  @Get('invoices')
  async list(@Query() query: any, @Req() req: Request) {
    return await this.moadianService.listInvoices((req as any).tenantId, {
      status: query.status,
      orderId: query.orderId,
      // A branch account sees its own site's invoices whatever it asks for.
      branchId: effectiveBranchId((req as any).userBranchId ?? null, query.branchId),
    });
  }

  @Post('orders/:orderId/issue')
  async issue(@Param('orderId') orderId: string, @Req() req: Request) {
    return await this.moadianService.issueForOrder((req as any).tenantId, orderId);
  }

  @Post('invoices/:id/retry')
  @Roles(...MANAGER_AND_ABOVE)
  async retry(@Param('id') id: string, @Req() req: Request) {
    return await this.moadianService.retry((req as any).tenantId, id);
  }

  /** Runs the send-and-answer cycle now instead of waiting for the background timer. */
  @Post('process')
  @Roles(...MANAGER_AND_ABOVE)
  async process(@Req() req: Request) {
    return await this.moadianService.processTenant((req as any).tenantId, { force: true });
  }
}
