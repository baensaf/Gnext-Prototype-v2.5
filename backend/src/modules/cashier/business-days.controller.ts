import { Controller, Get, Post, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { BusinessDayService } from './business-day.service';
import { BusinessDayCloseDto, BusinessDayReopenDto } from './dtos/shift.dto';
import { effectiveBranchId } from '../../common/utils/user-scope.util';
import { Roles, MANAGER_AND_ABOVE } from '../../common/decorators/roles.decorator';
import { BranchOwned } from '../../common/decorators/branch-owned.decorator';
import { BusinessDayClose } from '../../entities/BusinessDayClose.entity';

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

  /** Closing the day is the branch manager's call; the interceptor holds `branchId` to theirs. */
  @Roles(...MANAGER_AND_ABOVE)
  @Post('close')
  async closeBusinessDay(@Body() body: BusinessDayCloseDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.businessDayService.closeBusinessDay(tenantId, body, userId, correlationId);
  }

  @Roles(...MANAGER_AND_ABOVE)
  @BranchOwned(BusinessDayClose)
  @Post(':id/reopen')
  async reopenBusinessDay(@Param('id') id: string, @Body() body: BusinessDayReopenDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.businessDayService.reopenBusinessDay(tenantId, id, body, userId, correlationId);
  }
}
