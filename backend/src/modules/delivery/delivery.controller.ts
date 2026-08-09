import { Controller, Get, Post, Patch, Param, Query, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { DeliveryService } from './delivery.service';

@Controller('api/v1/delivery')
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Get('couriers')
  async getCouriers(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getCouriers(tenantId, branchId);
  }

  @Post('couriers')
  async createCourier(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.createCourier(tenantId, body, correlationId);
  }

  @Post('couriers/:id/status')
  async updateCourierStatus(@Param('id') id: string, @Body() body: { status: 'AVAILABLE' | 'ON_DELIVERY' | 'INACTIVE' }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.updateCourierStatus(tenantId, id, body.status, correlationId);
  }

  @Get('assignments')
  async getAssignments(@Query('branchId') branchId: string, @Query('status') statusFilter: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getAssignments(tenantId, branchId, statusFilter);
  }

  @Post('orders/:id/assign')
  async assignOrder(@Param('id') orderId: string, @Body() body: { courierId: string; deliveryFee?: number; tipAmount?: number }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.assignOrder(tenantId, orderId, body.courierId, body.deliveryFee, body.tipAmount, correlationId);
  }

  @Post('assignments/:id/status')
  async updateAssignmentStatus(
    @Param('id') assignmentId: string,
    @Body() body: { status: 'ASSIGNED' | 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'RETURNED'; failureReason?: string },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.updateAssignmentStatus(tenantId, assignmentId, body.status, body.failureReason, correlationId);
  }

  // --- SLICE 17: COURIER SETTLEMENT ENDPOINTS ---

  @Get('settlements/unsettled-summary')
  async getUnsettledSummary(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getUnsettledSummary(tenantId, branchId);
  }

  @Post('settlements/preview')
  async previewSettlement(@Body() body: { courier_id: string; assignment_ids?: string[] }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.previewSettlement(tenantId, body.courier_id, body.assignment_ids);
  }

  @Get('settlements')
  async getSettlements(
    @Query('courierId') courierId: string,
    @Query('status') status: string,
    @Query('branchId') branchId: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getSettlements(tenantId, courierId, status, branchId);
  }

  @Post('settlements')
  async createSettlement(
    @Body() body: { courier_id: string; branch_id?: string; assignment_ids?: string[]; notes?: string },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || 'admin-user-id';
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.createSettlement(tenantId, userId, body, correlationId);
  }

  @Get('settlements/:id')
  async getSettlementDetail(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getSettlementDetail(tenantId, id);
  }

  @Patch('settlements/:id')
  async updateSettlement(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.updateSettlement(tenantId, id, body, correlationId);
  }

  @Post('settlements/:id/review')
  async reviewSettlement(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || 'admin-user-id';
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.reviewSettlement(tenantId, id, userId, correlationId);
  }

  @Post('settlements/:id/close')
  async closeSettlement(@Param('id') id: string, @Body() body: { approval_request_id?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || 'admin-user-id';
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.closeSettlement(tenantId, id, userId, body?.approval_request_id, correlationId);
  }

  @Post('settlements/:id/reverse')
  async reverseSettlement(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || 'admin-user-id';
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.reverseSettlement(tenantId, id, userId, body?.reason, correlationId);
  }

  @Get('settlements/:id/statement')
  async getStatement(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getStatement(tenantId, id);
  }
}
