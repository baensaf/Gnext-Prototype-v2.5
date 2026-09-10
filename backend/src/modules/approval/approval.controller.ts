import { Controller, Get, Post, Param, Query, Body, Req, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { ApprovalService } from './approval.service';
import { isApprover, isHeadOfficeUser, UserScope } from '../../common/utils/user-scope.util';
import { HeadOfficeOnly } from '../../common/decorators/roles.decorator';

@Controller('api/v1/approvals')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Get('rules')
  async getRules(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.approvalService.getRules(tenantId);
  }

  @Post('rules')
  @HeadOfficeOnly()
  async createOrUpdateRule(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.approvalService.createOrUpdateRule(tenantId, body, correlationId);
  }

  /**
   * A pin is the thing that releases money the person holding it was not trusted to
   * release alone, so who may set one is the whole point of having one.
   *
   * The route took `userId` from the request body and set that account's pin, with no
   * check of any kind: a cashier could overwrite an approver's pin and then approve their
   * own refunds with it. Setting your own is self-service; setting somebody else's is
   * administering the chain's staff, which is where the users screen already lives.
   */
  @Post('user-pin')
  async setUserPin(@Body() body: { userId?: string; pin: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const selfId = (req as any).user?.id || (req as any).userId;
    if (!selfId) throw new UnauthorizedException('User session required');

    const targetId = body.userId || selfId;
    if (targetId !== selfId) {
      const actor: UserScope = {
        role: (req as any).userRole,
        branchId: (req as any).userBranchId ?? null,
      };
      if (!isHeadOfficeUser(actor)) {
        throw new ForbiddenException('Only head office may set another account’s pin');
      }
    }

    const correlationId = (req as any).correlationId;
    return await this.approvalService.setUserPin(tenantId, targetId, body.pin, correlationId);
  }

  @Post('verify-pin')
  async verifyPin(@Body() body: { userId?: string; pin: string; actionName?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = body.userId || (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('User session required');

    // An account that can approve confirms itself. Anyone else is asking someone senior to
    // stand there, so the pin has to belong to that someone rather than to them.
    if (!isApprover((req as any).userRole)) {
      return await this.approvalService.verifyApproverPin(
        tenantId,
        body.pin,
        body.actionName || 'VERIFY_PIN',
        (req as any).userId,
        (req as any).userBranchId ?? null,
      );
    }

    return await this.approvalService.verifyManagerPin(tenantId, userId, body.pin, body.actionName);
  }

  @Post('evaluate')
  async evaluateAction(@Body() body: { action: string; value: number }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.approvalService.evaluateAction(tenantId, body.action, body.value);
  }

  @Get('requests')
  async getPendingRequests(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.approvalService.getPendingRequests(tenantId);
  }

  @Get('requests/:id')
  async getRequestById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.approvalService.getRequestById(tenantId, id);
  }

  @Post('requests')
  async createRequest(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const requesterUserId = (req as any).user?.id;
    if (!requesterUserId) throw new UnauthorizedException('User session required');
    const correlationId = (req as any).correlationId;
    return await this.approvalService.createRequest(tenantId, requesterUserId, body, correlationId);
  }

  @Post('requests/:id/approve')
  async approveRequest(@Param('id') id: string, @Body() body: { approverUserId?: string; pin: string; note?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const approverUserId = body.approverUserId || (req as any).user?.id;
    if (!approverUserId) throw new UnauthorizedException('User session required');
    const correlationId = (req as any).correlationId;
    return await this.approvalService.approveRequest(tenantId, id, approverUserId, body.pin, body.note, correlationId);
  }

  @Post('requests/:id/reject')
  async rejectRequest(@Param('id') id: string, @Body() body: { approverUserId?: string; pin: string; note?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const approverUserId = body.approverUserId || (req as any).user?.id;
    if (!approverUserId) throw new UnauthorizedException('User session required');
    const correlationId = (req as any).correlationId;
    return await this.approvalService.rejectRequest(tenantId, id, approverUserId, body.pin, body.note, correlationId);
  }
}
