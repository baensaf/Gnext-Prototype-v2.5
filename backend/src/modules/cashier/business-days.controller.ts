import { Controller, Get, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { BusinessDayService } from './business-day.service';
import { effectiveBranchId } from '../../common/utils/user-scope.util';

/** Read-only: the business day closes by itself (see BusinessDayAutoCloseService). */
@Controller('api/v1/business-days')
export class BusinessDaysController {
  constructor(private readonly businessDayService: BusinessDayService) {}

  @Get()
  async getBusinessDays(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    // The screen sends `branch`, which the branch-scope interceptor does not know to
    // confine — so a branch account naming another shop there was answered about it.
    const branch = effectiveBranchId((req as any).userBranchId, query.branch || query.branchId);
    return await this.businessDayService.getBusinessDays(tenantId, { ...query, branch, branchId: branch });
  }

  /** Which business day it is at a branch and when it turns over. */
  @Get('current')
  async getCurrent(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const branchId = effectiveBranchId((req as any).userBranchId, query.branchId || query.branch);
    return await this.businessDayService.getCurrentBusinessDay(tenantId, branchId);
  }
}
