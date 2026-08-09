import { Controller, Get, Post, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { ShiftService } from './shift.service';
import {
  ShiftOpenDto,
  CashMovementDto,
  ShiftBeginCloseDto,
  ShiftReturnToOpenDto,
  ShiftCloseDto,
} from './dtos/shift.dto';

@Controller('api/v1/shifts')
export class ShiftsController {
  constructor(private readonly shiftService: ShiftService) {}

  @Get()
  async getShifts(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.shiftService.getShifts(tenantId, query);
  }

  @Post('open')
  async openShift(@Body() body: ShiftOpenDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.shiftService.openShift(tenantId, body, userId, correlationId);
  }

  @Get('current')
  async getCurrentShift(@Query('terminalId') terminalId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.shiftService.getCurrentShift(tenantId, terminalId);
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
