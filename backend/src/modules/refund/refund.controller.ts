import { Controller, Get, Post, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { RefundService } from './refund.service';
import { ApprovalService } from '../approval/approval.service';
import {
  RefundCreateDto,
  RefundProcessDto,
  PaidOrderCancelDto,
  RefundReversalDto,
} from './dtos/refund.dto';

@Controller('api/v1')
export class RefundController {
  constructor(
    private readonly refundService: RefundService,
    private readonly approvalService: ApprovalService,
  ) {}

  /**
   * Money going back out of the till. A manager or above carries their own authority; a
   * register operator needs an approver standing there with a pin. Called before the
   * refund service does anything, so a refused approval leaves no half-made refund.
   */
  private async authorize(req: Request, action: string, pin?: string) {
    return await this.approvalService.authorizeMoneyOut(
      (req as any).tenantId,
      action,
      {
        id: (req as any).user?.id || (req as any).userId,
        role: (req as any).userRole,
        branchId: (req as any).userBranchId ?? null,
      },
      pin,
    );
  }

  @Get('refunds')
  async getRefunds(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.refundService.getRefunds(tenantId, query);
  }

  @Post('orders/:orderId/refunds')
  async createRefundIntent(
    @Param('orderId') orderId: string,
    @Body() body: RefundCreateDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    await this.authorize(req, 'REFUND_ORDER', body.pin);
    const intent = await this.refundService.createRefundIntent(tenantId, orderId, body, userId, correlationId);
    return await this.refundService.processRefund(tenantId, intent.id, { scenarioId: body.scenarioId }, userId, correlationId);
  }

  @Get('refunds/:id')
  async getRefundById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.refundService.getRefundById(tenantId, id);
  }

  @Post('refunds/:id/process')
  async processRefund(
    @Param('id') id: string,
    @Body() body: RefundProcessDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    await this.authorize(req, 'REFUND_PROCESS', body.pin);
    return await this.refundService.processRefund(tenantId, id, body, userId, correlationId);
  }

  @Post('orders/:orderId/cancel-paid')
  async cancelPaidOrder(
    @Param('orderId') orderId: string,
    @Body() body: PaidOrderCancelDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    await this.authorize(req, 'CANCEL_PAID_ORDER', body.pin);
    return await this.refundService.cancelPaidOrder(tenantId, orderId, body, userId, correlationId);
  }

  @Post('refunds/:id/reverse')
  async reverseRefund(
    @Param('id') id: string,
    @Body() body: RefundReversalDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    await this.authorize(req, 'REFUND_REVERSE', body.pin);
    return await this.refundService.reverseRefund(tenantId, id, body, userId, correlationId);
  }
}
