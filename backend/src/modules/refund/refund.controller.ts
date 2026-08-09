import { Controller, Get, Post, Param, Query, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { RefundService } from './refund.service';

@Controller('api/v1')
export class RefundController {
  constructor(private readonly refundService: RefundService) {}

  @Get('refunds')
  async getRefunds(@Query('orderId') orderId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.refundService.getRefunds(tenantId, orderId);
  }

  @Get('refunds/:id')
  async getRefundById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.refundService.getRefundById(tenantId, id);
  }

  @Post('refunds')
  async createRefund(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const requesterUserId = (req as any).user?.id || 'd3b07384-d113-4603-9a3d-3c220f86fb04';
    const correlationId = (req as any).correlationId;
    return await this.refundService.createRefund(tenantId, requesterUserId, body, correlationId);
  }

  @Post('orders/:id/cancel-paid')
  async cancelPaidOrder(@Param('id') id: string, @Body() body: { reason?: string; pin?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const requesterUserId = (req as any).user?.id || 'd3b07384-d113-4603-9a3d-3c220f86fb04';
    const correlationId = (req as any).correlationId;
    return await this.refundService.cancelPaidOrder(tenantId, requesterUserId, id, body?.reason || 'Customer cancellation', body?.pin, correlationId);
  }
}
