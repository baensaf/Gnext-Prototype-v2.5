import { Controller, Get, Post, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ShiftService } from './shift.service';
import { effectiveBranchId } from '../../common/utils/user-scope.util';
import { HeadOfficeOnly } from '../../common/decorators/roles.decorator';
import { BranchOwned } from '../../common/decorators/branch-owned.decorator';
import { CashierShift } from '../../entities/CashierShift.entity';
import {
  ShiftOpenDto,
  CashMovementDto,
  ShiftBeginCloseDto,
  ShiftReturnToOpenDto,
  ShiftCloseDto,
} from './dtos/shift.dto';

/**
 * Every route that names a shift by id is held to the caller's own branch by
 * `BranchOwnershipGuard`: a shift id is not a permission, and without this a Downtown
 * account could read, pay into or count down Central Plaza's drawer.
 */
@BranchOwned(CashierShift)
@Controller('api/v1/shifts')
export class ShiftsController {
  constructor(private readonly shiftService: ShiftService) {}

  @Get()
  async getShifts(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    // Same rule for the list behind it: a branch account sees its own shifts.
    const branch = effectiveBranchId((req as any).userBranchId, query.branch || query.branchId);
    return await this.shiftService.getShifts(tenantId, { ...query, branch });
  }

  @Post('open')
  async openShift(@Body() body: ShiftOpenDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.shiftService.openShift(
      tenantId,
      body,
      userId,
      correlationId,
      (req as any).userBranchId ?? null,
    );
  }

  @Get('current')
  async getCurrentShift(
    @Query('terminalId') terminalId: string,
    @Query('branchId') branchId: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    // The branch never appeared in the query, so nothing was there to confine: a Downtown
    // cashier asking whether their drawer was open was answered about Central Plaza's, and
    // the screen would have offered to close somebody else's till. A branch account is
    // held to its own shop; head office working inside a branch names it, because with no
    // branch at all the answer was the newest drawer open anywhere in the chain.
    return await this.shiftService.getCurrentShift(
      tenantId,
      terminalId,
      effectiveBranchId((req as any).userBranchId, branchId),
    );
  }

  /**
   * Head office only. A branch has its own drawer screen; this one answers about the tills
   * in everybody else's shops, and it reads without touching anything.
   *
   * Declared above `@Get(':id')` because Nest matches routes in declaration order, and a
   * shift id is a path segment like any other — put below, `rollup` would be looked up as
   * a shift and 404.
   */
  @HeadOfficeOnly()
  @Get('rollup')
  async getShiftRollup(@Query('businessDate') businessDate: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.shiftService.getShiftRollup(tenantId, businessDate);
  }

  @Get(':id')
  async getShiftById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.shiftService.getShiftById(tenantId, id);
  }

  @Post(':id/movements')
  async recordMovement(@Param('id') id: string, @Body() body: CashMovementDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.shiftService.recordMovement(tenantId, id, body, userId, correlationId);
  }

  @Post(':id/begin-close')
  async beginClose(@Param('id') id: string, @Body() body: ShiftBeginCloseDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.shiftService.beginClose(tenantId, id, userId, correlationId);
  }

  @Post(':id/return-to-open')
  async returnToOpen(@Param('id') id: string, @Body() body: ShiftReturnToOpenDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.shiftService.returnToOpen(tenantId, id, body, userId, correlationId);
  }

  @Post(':id/close')
  async closeShift(@Param('id') id: string, @Body() body: ShiftCloseDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.shiftService.closeShift(tenantId, id, body, userId, correlationId);
  }

  @Get(':id/statement')
  async getShiftStatement(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.shiftService.getShiftStatement(tenantId, id);
  }
}
