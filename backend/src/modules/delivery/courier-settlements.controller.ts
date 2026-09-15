import { Controller, Get, Post, Patch, Param, Query, Body, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { DeliveryService } from './delivery.service';
import { BranchOwned } from '../../common/decorators/branch-owned.decorator';
import { CourierSettlement } from '../../entities/CourierSettlement.entity';

@Controller('api/v1/courier-settlements')
export class CourierSettlementsController {
  constructor(private readonly deliveryService: DeliveryService) {}

  @Get('unsettled-summary')
  async getUnsettledSummary(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getUnsettledSummary(tenantId, branchId);
  }

  @Get('preview')
  async previewSettlementGet(
    @Query('courierId') courierId: string,
    @Query('branchId') branchId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('currency') currency: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.previewSettlement(tenantId, courierId, undefined, branchId, dateFrom, dateTo, currency);
  }

  @Post('preview')
  async previewSettlementPost(@Body() body: { courier_id?: string; courierId?: string; assignment_ids?: string[]; lineIds?: string[]; branch_id?: string; branchId?: string; dateFrom?: string; dateTo?: string; currency?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const courierId = body.courier_id || body.courierId;
    const lineIds = body.assignment_ids || body.lineIds;
    const branchId = body.branch_id || body.branchId;
    return await this.deliveryService.previewSettlement(tenantId, courierId, lineIds, branchId, body.dateFrom, body.dateTo, body.currency);
  }

  @Get()
  async getSettlements(
    @Query('courierId') courierId: string,
    @Query('status') status: string,
    @Query('branchId') branchId: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getSettlements(tenantId, courierId, status, branchId);
  }

  @Post()
  async createSettlement(@Body() body: { courier_id?: string; courierId?: string; branch_id?: string; branchId?: string; dateFrom?: string; dateTo?: string; currency?: string; assignment_ids?: string[]; lineIds?: string[]; notes?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('User session required');
    const correlationId = (req as any).correlationId;
    const courierId = body.courier_id || body.courierId;
    const branchId = body.branch_id || body.branchId;
    const lineIds = body.assignment_ids || body.lineIds;
    return await this.deliveryService.createSettlement(
      tenantId,
      userId,
      {
        courier_id: courierId,
        branch_id: branchId,
        dateFrom: body.dateFrom,
        dateTo: body.dateTo,
        currency: body.currency,
        assignment_ids: lineIds,
        notes: body.notes,
      },
      correlationId,
    );
  }

  @BranchOwned(CourierSettlement)
  @Get(':id')
  async getSettlementDetail(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getSettlementDetail(tenantId, id);
  }

  @BranchOwned(CourierSettlement)
  @Patch(':id')
  async updateSettlement(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.updateSettlement(tenantId, id, body, correlationId);
  }

  @BranchOwned(CourierSettlement)
  @Post(':id/review')
  async reviewSettlement(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('User session required');
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.reviewSettlement(tenantId, id, userId, correlationId);
  }

  @BranchOwned(CourierSettlement)
  @Post(':id/return')
  async returnSettlement(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('User session required');
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.returnSettlement(tenantId, id, userId, body?.reason, correlationId);
  }

  @BranchOwned(CourierSettlement)
  @Post(':id/close')
  async closeSettlement(@Param('id') id: string, @Body() body: { reasonCodeId?: string; reason?: string; approvalRequestId?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('User session required');
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.closeSettlement(tenantId, id, userId, body?.approvalRequestId, correlationId);
  }

  @BranchOwned(CourierSettlement)
  @Post(':id/reverse')
  async reverseSettlement(@Param('id') id: string, @Body() body: { reasonCodeId?: string; reason?: string; approvalRequestId?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('User session required');
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.reverseSettlement(tenantId, id, userId, body?.reason, correlationId);
  }

  @BranchOwned(CourierSettlement)
  @Get(':id/statement')
  async getSettlementStatement(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getSettlementStatement(tenantId, id);
  }
}
