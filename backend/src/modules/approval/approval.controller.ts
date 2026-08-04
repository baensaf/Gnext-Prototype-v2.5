import { Controller, Get, Post, Param, Query, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { ApprovalService } from './approval.service';

@Controller('api/v1/approvals')
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Get('rules')
  async getRules(@Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.approvalService.getRules(tenantId);
  }

  @Post('rules')
  async createOrUpdateRule(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.approvalService.createOrUpdateRule(tenantId, body, correlationId);
  }

  @Post('verify-pin')
  async verifyPin(@Body() body: { userId?: string; pin: string; actionName?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const userId = body.userId || (req as any).user?.id || 'd3b07384-d113-4603-9a3d-3c220f86fb04';
    return await this.approvalService.verifyManagerPin(tenantId, userId, body.pin, body.actionName);
  }

  @Post('evaluate')
  async evaluateAction(@Body() body: { action: string; value: number }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.approvalService.evaluateAction(tenantId, body.action, body.value);
  }

  @Get('requests')
  async getPendingRequests(@Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.approvalService.getPendingRequests(tenantId);
  }

  @Get('requests/:id')
  async getRequestById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.approvalService.getRequestById(tenantId, id);
  }

  @Post('requests')
  async createRequest(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const requesterUserId = (req as any).user?.id || 'd3b07384-d113-4603-9a3d-3c220f86fb04';
    const correlationId = (req as any).correlationId;
    return await this.approvalService.createRequest(tenantId, requesterUserId, body, correlationId);
  }

  @Post('requests/:id/approve')
  async approveRequest(@Param('id') id: string, @Body() body: { approverUserId?: string; pin: string; note?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const approverUserId = body.approverUserId || (req as any).user?.id || 'd3b07384-d113-4603-9a3d-3c220f86fb04';
    const correlationId = (req as any).correlationId;
    return await this.approvalService.approveRequest(tenantId, id, approverUserId, body.pin, body.note, correlationId);
  }

  @Post('requests/:id/reject')
  async rejectRequest(@Param('id') id: string, @Body() body: { approverUserId?: string; pin: string; note?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const approverUserId = body.approverUserId || (req as any).user?.id || 'd3b07384-d113-4603-9a3d-3c220f86fb04';
    const correlationId = (req as any).correlationId;
    return await this.approvalService.rejectRequest(tenantId, id, approverUserId, body.pin, body.note, correlationId);
  }
}
