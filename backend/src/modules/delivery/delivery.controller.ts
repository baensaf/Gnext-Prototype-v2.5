import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Req, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { DeliveryService } from './delivery.service';
import { HeadOfficeOnly, MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { BranchOwned } from '../../common/decorators/branch-owned.decorator';
import { Courier } from '../../entities/Courier.entity';
import { CourierSettlement } from '../../entities/CourierSettlement.entity';
import { Delivery } from '../../entities/Delivery.entity';
import { DeliveryZone } from '../../entities/DeliveryZone.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { CreateCourierDto, CreateZoneDto, UpdateCourierPayDto, UpdateZoneDto } from './dtos/delivery-config.dto';

/** A delivery has no branch column: it belongs to the shop that sold its order. */
const BY_ORDER = { through: { entity: OrderHeader, foreignKey: 'order_id' } };

@Controller('api/v1/delivery')
export class DeliveryController {
  constructor(private readonly deliveryService: DeliveryService) {}

  // --- 1. ZONES ---
  @Get('zones')
  async getZones(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getZones(tenantId, branchId);
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post('zones')
  async createZone(@Body() body: CreateZoneDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.createZone(tenantId, body);
  }

  @BranchOwned(DeliveryZone)
  @Roles(...MANAGER_AND_ABOVE)
  @Patch('zones/:id')
  async updateZone(@Param('id') id: string, @Body() body: UpdateZoneDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.updateZone(tenantId, id, body, (req as any).userId);
  }

  @BranchOwned(DeliveryZone)
  @Roles(...MANAGER_AND_ABOVE)
  @Delete('zones/:id')
  async deleteZone(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.deleteZone(tenantId, id);
  }

  // --- 2. COURIERS & ATTENDANCE ---
  @Get('couriers')
  async getCouriers(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getCouriers(tenantId, branchId);
  }

  @BranchOwned(Courier)
  @Get('couriers/:id')
  async getCourierById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getCourierById(tenantId, id);
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post('couriers')
  async createCourier(@Body() body: CreateCourierDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.createCourier(tenantId, body, correlationId, (req as any).userId);
  }

  /**
   * Brings a courier who is on file at another branch over to this one.
   *
   * Deliberately not `@BranchOwned`: the courier belongs to another shop until this call
   * succeeds, so that check would refuse every move. What it may not do is send a courier
   * anywhere but the caller's own branch — a pinned account's target is its own branch
   * whatever the body says, and only head office names one.
   */
  @Roles(...MANAGER_AND_ABOVE)
  @Post('couriers/:id/move')
  async moveCourier(@Param('id') id: string, @Body() body: { branch_id?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const targetBranchId = (req as any).userBranchId ?? body?.branch_id;
    return await this.deliveryService.moveCourier(tenantId, id, targetBranchId, (req as any).userId);
  }

  /** How the courier is paid. Priced into each trip when it closes, so past trips keep their pay. */
  @BranchOwned(Courier)
  @Roles(...MANAGER_AND_ABOVE)
  @Patch('couriers/:id/pay')
  async updateCourierPay(@Param('id') id: string, @Body() body: UpdateCourierPayDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.updateCourierPay(tenantId, id, body, (req as any).userId);
  }

  @BranchOwned(Courier)
  @Post('couriers/:id/status')
  async updateCourierStatus(@Param('id') id: string, @Body() body: { status: 'AVAILABLE' | 'ON_DELIVERY' | 'INACTIVE' }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.updateCourierStatus(tenantId, id, body.status, correlationId, (req as any).userId);
  }

  @Post('couriers/attendance')
  async recordAttendance(@Body() body: { courier_id: string; branch_id: string; status: 'CHECKED_IN' | 'CHECKED_OUT' | 'PAUSED'; availability_status?: 'AVAILABLE' | 'BUSY' | 'OFF_LINE' }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.recordAttendance(tenantId, body, (req as any).userId, (req as any).userBranchId ?? null);
  }

  @BranchOwned(Courier)
  @Post('couriers/:id/availability')
  async setCourierAvailability(@Param('id') courierId: string, @Body() body: { availability_status: 'AVAILABLE' | 'BUSY' | 'OFF_LINE' }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.setCourierAvailability(tenantId, courierId, body.availability_status, (req as any).userId);
  }

  // --- 3. TERMINAL ASSIGNMENTS ---
  @BranchOwned(Courier)
  @Post('couriers/:id/terminal-assignment')
  async assignMobileTerminal(@Param('id') courierId: string, @Body() body: { terminalId: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.assignMobileTerminal(tenantId, courierId, body.terminalId, (req as any).userId);
  }

  @BranchOwned(Courier)
  @Delete('couriers/:id/terminal-assignment')
  async unassignMobileTerminal(@Param('id') courierId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.unassignMobileTerminal(tenantId, courierId, (req as any).userId);
  }

  // --- 4. DELIVERY EXECUTION & STATE MACHINE ---
  @Get('board')
  async getDeliveries(@Query('branchId') branchId: string, @Query('state') state: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getDeliveries(tenantId, branchId, state);
  }

  @BranchOwned(OrderHeader, { param: 'orderId' })
  @Post('orders/:orderId')
  async createDeliveryForOrder(@Param('orderId') orderId: string, @Body() body: { zoneId?: string; addressSnapshot?: any }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.createDeliveryForOrder(tenantId, orderId, body.zoneId, body.addressSnapshot);
  }

  @BranchOwned(Delivery, BY_ORDER)
  @Post(':id/assign')
  async assignCourierToDelivery(@Param('id') deliveryId: string, @Body() body: { courierId: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    return await this.deliveryService.assignCourier(tenantId, deliveryId, body.courierId, userId);
  }

  @BranchOwned(Delivery, BY_ORDER)
  @Post(':id/depart')
  async departDelivery(@Param('id') deliveryId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    return await this.deliveryService.departDelivery(tenantId, deliveryId, userId);
  }

  @BranchOwned(Delivery, BY_ORDER)
  @Post(':id/complete')
  async completeDelivery(@Param('id') deliveryId: string, @Body() body: { cashCollected?: number; posAmount?: number }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    return await this.deliveryService.completeDelivery(tenantId, deliveryId, body, userId);
  }

  @BranchOwned(Delivery, BY_ORDER)
  @Post(':id/fail')
  async failDelivery(@Param('id') deliveryId: string, @Body() body: { reason: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    return await this.deliveryService.failDelivery(tenantId, deliveryId, body.reason, userId);
  }

  @BranchOwned(Delivery, BY_ORDER)
  @Post(':id/requeue')
  async requeueDelivery(@Param('id') deliveryId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    return await this.deliveryService.requeueDelivery(tenantId, deliveryId, userId);
  }

  @BranchOwned(Delivery, BY_ORDER)
  @Get(':id/events')
  async getDeliveryEvents(@Param('id') deliveryId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getDeliveryEvents(tenantId, deliveryId);
  }

  // --- LEGACY ENDPOINTS BACKWARDS COMPATIBILITY ---
  @Get('assignments')
  async getAssignments(@Query('branchId') branchId: string, @Query('status') statusFilter: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getAssignments(tenantId, branchId, statusFilter);
  }

  @BranchOwned(OrderHeader)
  @Post('orders/:id/assign')
  async assignOrder(@Param('id') orderId: string, @Body() body: { courierId: string; deliveryFee?: number; tipAmount?: number }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.assignOrder(tenantId, orderId, body.courierId, body.deliveryFee, body.tipAmount, correlationId);
  }

  // Despite the path, the id here is a delivery's.
  @BranchOwned(Delivery, BY_ORDER)
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

  @Get('settlements/unsettled-summary')
  async getUnsettledSummary(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getUnsettledSummary(tenantId, branchId);
  }

  @Get('settlements/preview')
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

  @Post('settlements/preview')
  async previewSettlementPost(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const courierId = body.courier_id || body.courierId;
    const lineIds = body.assignment_ids || body.lineIds;
    const branchId = body.branch_id || body.branchId;
    return await this.deliveryService.previewSettlement(tenantId, courierId, lineIds, branchId, body.dateFrom, body.dateTo, body.currency);
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
  async createSettlement(@Body() body: any, @Req() req: Request) {
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
  @Get('settlements/:id')
  async getSettlementDetail(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getSettlementDetail(tenantId, id);
  }

  @BranchOwned(CourierSettlement)
  @Patch('settlements/:id')
  async updateSettlement(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.updateSettlement(tenantId, id, body, correlationId);
  }

  @BranchOwned(CourierSettlement)
  @Post('settlements/:id/review')
  async reviewSettlement(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('User session required');
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.reviewSettlement(tenantId, id, userId, correlationId);
  }

  @BranchOwned(CourierSettlement)
  @Post('settlements/:id/return')
  async returnSettlement(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('User session required');
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.returnSettlement(tenantId, id, userId, body?.reason, correlationId);
  }

  @BranchOwned(CourierSettlement)
  @Post('settlements/:id/close')
  async closeSettlement(@Param('id') id: string, @Body() body: { reasonCodeId?: string; reason?: string; approvalRequestId?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('User session required');
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.closeSettlement(tenantId, id, userId, body?.approvalRequestId, correlationId);
  }

  @BranchOwned(CourierSettlement)
  @Post('settlements/:id/reverse')
  async reverseSettlement(@Param('id') id: string, @Body() body: { reasonCodeId?: string; reason?: string; approvalRequestId?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('User session required');
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.reverseSettlement(tenantId, id, userId, body?.reason, correlationId);
  }

  @BranchOwned(CourierSettlement)
  @Get('settlements/:id/statement')
  async getSettlementStatement(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getSettlementStatement(tenantId, id);
  }

  // --- CHAIN ROLL-UP ---

  /**
   * Head office only, and on purpose: a branch manager already has the board, and this
   * answers about everybody else's shops. Nothing here writes, so there is no @Roles —
   * reach is the whole question, not seniority.
   */
  @HeadOfficeOnly()
  @Get('rollup')
  async getFleetRollup(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getFleetRollup(tenantId);
  }
}
