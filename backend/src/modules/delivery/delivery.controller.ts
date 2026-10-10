import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Req, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { DeliveryService } from './delivery.service';
import { MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { BranchOwned } from '../../common/decorators/branch-owned.decorator';
import { Courier } from '../../entities/Courier.entity';
import { CourierSettlement } from '../../entities/CourierSettlement.entity';
import { Delivery } from '../../entities/Delivery.entity';
import { DeliveryZone } from '../../entities/DeliveryZone.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { CreateCourierDto, CreateZoneDto, UpdateZoneDto } from './dtos/delivery-config.dto';

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

  // --- 2. COURIERS ---
  @Get('couriers')
  async getCouriers(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.getCouriers(tenantId, branchId);
  }

  /**
   * A manager adds a courier wherever they manage, on any pay. A cashier adds one to their
   * own branch, on the branch's default pay: who is riding tonight is the counter's to know,
   * what a courier earns is the manager's to decide.
   */
  @Roles(...MANAGER_AND_ABOVE, 'CASHIER')
  @Post('couriers')
  async createCourier(@Body() body: CreateCourierDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    let data = body;
    if (String((req as any).userRole || '').toUpperCase() === 'CASHIER') {
      const ownBranchId = (req as any).userBranchId;
      if (!ownBranchId) {
        throw new ForbiddenException({
          code: 'COURIER_BRANCH_REQUIRED',
          title: 'No Branch',
          detail: 'A cashier adds couriers to their own branch, and this account has none.',
        });
      }
      data = { ...body, branch_id: ownBranchId };
    }
    return await this.deliveryService.createCourier(tenantId, data, correlationId, (req as any).userId);
  }

  @BranchOwned(Courier)
  @Post('couriers/:id/status')
  async updateCourierStatus(@Param('id') id: string, @Body() body: { status: 'AVAILABLE' | 'ON_DELIVERY' | 'INACTIVE' }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.deliveryService.updateCourierStatus(tenantId, id, body.status, correlationId, (req as any).userId);
  }

  // --- 3. DELIVERY EXECUTION & STATE MACHINE ---
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

  // The board's one step: name the courier and the order leaves.
  @BranchOwned(Delivery, BY_ORDER)
  @Post(':id/dispatch')
  async dispatchCourier(@Param('id') deliveryId: string, @Body() body: { courierId: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    return await this.deliveryService.dispatchCourier(tenantId, deliveryId, body.courierId, userId);
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
    @Body() body: { status: 'ASSIGNED' | 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'RETURNED' },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.deliveryService.updateAssignmentStatus(tenantId, assignmentId, body.status);
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

  /** Settles a courier in one go: card slips per ride and the cash handed over, then closed. */
  @Post('settlements/settle')
  async settleCourier(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id;
    if (!userId) throw new UnauthorizedException('User session required');
    return await this.deliveryService.settleCourier(
      tenantId,
      userId,
      {
        courier_id: body.courier_id || body.courierId,
        branch_id: body.branch_id || body.branchId,
        card: body.card,
        actual_cash_amount: body.actual_cash_amount ?? body.actualCashAmount,
        approvalRequestId: body.approvalRequestId,
      },
      (req as any).correlationId,
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
}
