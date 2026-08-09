import { Controller, Get, Post, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { CashDrawerService } from './cash-drawer.service';
import { OpenShiftDto, PostCashTxDto, CloseShiftDto } from '../../common/dto/cash-drawer.dto';

@Controller('api/v1/cash-drawer')
export class CashDrawerController {
  constructor(private readonly cashDrawerService: CashDrawerService) {}

  @Get('shifts/active')
  async getActiveShift(
    @Query('branchId') branchId: string,
    @Query('terminalId') terminalId: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.cashDrawerService.getActiveShift(tenantId, branchId, terminalId);
  }

  @Post('shifts/open')
  async openShift(@Body() body: OpenShiftDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).userId;
    const correlationId = (req as any).correlationId;
    const payload = {
      ...body,
      user_id: body.user_id || userId,
    };
    return await this.cashDrawerService.openShift(tenantId, payload, correlationId);
  }

  @Post('shifts/:id/transactions')
  async postTransaction(@Param('id') id: string, @Body() body: PostCashTxDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.cashDrawerService.postTransaction(tenantId, id, body, correlationId);
  }

  @Post('shifts/:id/close')
  async closeShift(@Param('id') id: string, @Body() body: CloseShiftDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.cashDrawerService.closeShift(tenantId, id, body, correlationId);
  }
}
