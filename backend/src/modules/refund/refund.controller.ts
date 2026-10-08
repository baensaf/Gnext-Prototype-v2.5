import { Controller, Get, Post, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { RefundService } from './refund.service';
import { ApprovalService } from '../approval/approval.service';
import { RefundCreateDto, PaidOrderCancelDto } from './dtos/refund.dto';
import { BranchOwned } from '../../common/decorators/branch-owned.decorator';
import { effectiveBranchId } from '../../common/utils/user-scope.util';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { Refund } from '../../entities/Refund.entity';

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
   * Returns who released it: the approver whose pin was given, or null for an approver
   * acting on their own authority.
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
    // A branch account sees its own branch's refunds, whatever it asks for.
    const branchId = effectiveBranchId((req as any).userBranchId, query.branchId || query.branch_id);
    return await this.refundService.getRefunds(tenantId, query, branchId);
  }

  @BranchOwned(OrderHeader, { param: 'orderId' })
  @Post('orders/:orderId/refunds')
  async createRefund(
    @Param('orderId') orderId: string,
    @Body() body: RefundCreateDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    const approver = await this.authorize(req, 'REFUND_ORDER', body.pin);
    return await this.refundService.refundOrder(tenantId, orderId, body, {
      userId,
      correlationId,
      approvedBy: approver ?? userId,
    });
  }

  @BranchOwned(Refund, { through: { entity: OrderHeader, foreignKey: 'order_id' } })
  @Get('refunds/:id')
  async getRefundById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.refundService.getRefundById(tenantId, id);
  }

  @BranchOwned(OrderHeader, { param: 'orderId' })
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
    // The PIN released this, so an approval id the client sent proves nothing and is not kept.
    return await this.refundService.cancelPaidOrder(
      tenantId,
      orderId,
      { ...body, approvalRequestId: undefined },
      userId,
      correlationId,
    );
  }
}
