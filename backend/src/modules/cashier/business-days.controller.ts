import { Controller, Get, Post, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { BusinessDayService } from './business-day.service';
import { BusinessDayCloseDto, BusinessDayReopenDto } from './dtos/shift.dto';

@Controller('api/v1/business-days')
export class BusinessDaysController {
  constructor(private readonly businessDayService: BusinessDayService) {}

  @Get()
  async getBusinessDays(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.businessDayService.getBusinessDays(tenantId, query);
  }

  @Post('close')
  async closeBusinessDay(@Body() body: BusinessDayCloseDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.businessDayService.closeBusinessDay(tenantId, body, userId, correlationId);
  }

  @Post(':id/reopen')
  async reopenBusinessDay(@Param('id') id: string, @Body() body: BusinessDayReopenDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.businessDayService.reopenBusinessDay(tenantId, id, body, userId, correlationId);
  }
}
