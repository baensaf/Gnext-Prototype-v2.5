import { Controller, Get, Post, Param, Query, Body, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { ApprovalService } from './approval.service';
import { isApprover } from '../../common/utils/user-scope.util';

@Controller('api/v1/approvals')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Get('rules')
  async getRules(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.approvalService.getRules(tenantId);
  }

  @Post('rules')
  async createOrUpdateRule(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.approvalService.createOrUpdateRule(tenantId, body, correlationId);
  }

  @Post('user-pin')
  async setUserPin(@Body() body: { userId?: string; pin: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = body.userId || (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('User session required');
    const correlationId = (req as any).correlationId;
    return await this.approvalService.setUserPin(tenantId, userId, body.pin, correlationId);
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
