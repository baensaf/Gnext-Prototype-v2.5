import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, Header, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { OrderService } from './order.service';
import { effectiveBranchId } from '../../common/utils/user-scope.util';
import { Roles, MANAGER_AND_ABOVE } from '../../common/decorators/roles.decorator';
import {
  OrderCreateDto,
  OrderUpdateDto,
  OrderQuoteRequestDto,
  OrderSubmitDto,
  OrderTransitionDto,
  OrderEditDto,
  OrderTypeChangeDto,
  OrderItemReplaceDto,
  OrderCancelDto,
  OrderReopenDto,
  OrderAcceptDto,
  OrderRejectDto,
  OrderOnlineReportDto,
} from './dtos/order.dto';
import { SplitOrderDto, TransferItemsDto } from '../dine-in/dtos/dine-in.dto';
import { BranchOwned } from '../../common/decorators/branch-owned.decorator';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { IncomingOrderPolicyService } from './incoming-order-policy.service';
import { OnlineOrdersService } from './online-orders.service';
import { OnlinePlatform } from './channels';
import { RequireIdempotency } from '../../common/decorators/idempotency.decorator';

// Every :id on this controller is an order id, and an order belongs to the shop that
// took it. Marking the class covers the transitions too — a branch may not confirm,
// cancel or reopen another shop's order by quoting its id. Routes that name no order
// (the list, the draft create) are unaffected.
@BranchOwned(OrderHeader)
@Controller('api/v1/orders')
export class OrdersController {
  constructor(
    private readonly orderService: OrderService,
    private readonly incomingPolicy: IncomingOrderPolicyService,
    private readonly onlineOrders: OnlineOrdersService,
  ) {}

  @Get()
  async getOrders(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    // The order book used to answer with the whole chain: a cashier at one shop could see
    // and open another shop's orders, with nothing on screen to say whose they were.
    const branchId = effectiveBranchId(
      (req as any).userBranchId,
      query.branch || query.branch_id || query.branchId,
    );
    // The service reads three spellings of the same filter; clearing the other two stops
    // a client-supplied one from winning over the scope decided here.
    return await this.orderService.getOrders(tenantId, {
      ...query,
      branch: undefined,
      branch_id: undefined,
      branchId,
    });
  }

  // The same filters as the list, as a spreadsheet. Declared before ':id' so the router does
  // not take "export" for an order id. The whole book with customers' mobiles is for a
  // manager or head office, not every register.
  @Get('export')
  @Roles(...MANAGER_AND_ABOVE)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="orders.csv"')
  async exportOrders(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const branchId = effectiveBranchId(
      (req as any).userBranchId,
      query.branch || query.branch_id || query.branchId,
    );
    return await this.orderService.exportOrdersCsv(tenantId, {
      ...query,
      branch: undefined,
      branch_id: undefined,
      branchId,
    });
  }

  // The three writes of the register's Place (and Hold) carry an Idempotency-Key when they come
  // through a branch agent, which repeats a request whose answer was lost (agent-protocol §19.11).
  // The key is optional: the kiosk and other clients send none and run as they always did.
  @RequireIdempotency('ORDER_CREATE', { optional: true })
  @Post()
  async createDraft(@Body() body: OrderCreateDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.createDraft(tenantId, body, userId, correlationId);
  }

  // The till's Online panel: the branch's platform orders in lanes, with what each platform
  // allows. Declared before ':id' so the router does not take "online-board" for an order id.
  @Get('online-board')
  async getOnlineBoard(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const branchId = effectiveBranchId((req as any).userBranchId, query.branchId || query.branch_id);
    if (!branchId) throw new BadRequestException('branchId is required');
    return await this.onlineOrders.board(tenantId, branchId);
  }

  // Stop or restart one platform's orders at the branch: minutes, TODAY, or 0 to restart.
  @Post('online-pause')
  async pauseOnlinePlatform(@Body() body: { branchId?: string; platform: OnlinePlatform; minutes: number | 'TODAY' }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const branchId = effectiveBranchId((req as any).userBranchId, body?.branchId);
    if (!branchId) throw new BadRequestException('branchId is required');
    const minutes = body?.minutes === 'TODAY' ? 'TODAY' : Number(body?.minutes);
    if (minutes !== 'TODAY' && (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60)) {
      throw new BadRequestException('minutes must be 0 to 1440, or TODAY');
    }
    return await this.onlineOrders.pause(tenantId, branchId, body.platform, minutes, userId);
  }

  // Snappfood's decline reasons; a store reject must name one. Declared before ':id' so
  // the router does not take "decline-reasons" for an order id.
  @Get('decline-reasons')
  async getDeclineReasons() {
    return await this.orderService.getDeclineReasons();
  }

  // What the Incoming Orders queue needs from the branch's policy: the time limit for its
  // countdown and the prep time an accept starts from.
  @Get('incoming-policy')
  async getIncomingPolicy(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const branchId = effectiveBranchId((req as any).userBranchId, query.branchId || query.branch_id);
    return await this.incomingPolicy.policyFor(tenantId, branchId);
  }

  // An aggregator or website order waits in PENDING_ACCEPTANCE until the store answers.
  @Post(':id/accept')
  async acceptIncomingOrder(@Param('id') id: string, @Body() body: OrderAcceptDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.acceptIncomingOrder(tenantId, id, body, userId, correlationId);
  }

  @Post(':id/reject')
  async rejectIncomingOrder(@Param('id') id: string, @Body() body: OrderRejectDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.rejectIncomingOrder(tenantId, id, body, userId, correlationId);
  }

  // An accepted platform order needs more time or cannot be made: the platform takes it.
  @Post(':id/online/report')
  async reportOnlineOrder(@Param('id') id: string, @Body() body: OrderOnlineReportDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.reportOnlineOrder(tenantId, id, body, userId, correlationId);
  }

  // A cashier opened a waiting platform order (Snappfood hears it as a pick).
  @Post(':id/online/opened')
  async onlineOrderOpened(@Param('id') id: string, @Req() req: Request) {
    return await this.onlineOrders.opened((req as any).tenantId, id);
  }

  // The cashier saw an alert on the Online panel (a platform cancel, a lost order).
  @Post(':id/online/alert-seen')
  async seeOnlineAlert(@Param('id') id: string, @Req() req: Request) {
    return await this.onlineOrders.seeAlert((req as any).tenantId, id);
  }

  // The bag is ready for the rider or the customer.
  @Post(':id/online/ready')
  async markOnlineOrderReady(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as any).user?.id || (req as any).userId;
    return await this.onlineOrders.markReady((req as any).tenantId, id, userId, (req as any).correlationId);
  }

  // The platform's rider took it, or the customer collected it.
  @Post(':id/online/handed-over')
  async handOverOnlineOrder(@Param('id') id: string, @Req() req: Request) {
    const userId = (req as any).user?.id || (req as any).userId;
    return await this.onlineOrders.handOver((req as any).tenantId, id, userId, (req as any).correlationId);
  }

  @Get(':id')
  async getOrderById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const order = await this.orderService.getOrderById(tenantId, id);
    // The names behind the ids, so the detail page can say who was involved and link to them,
    // and where a delivery is going.
    const [people, context] = await Promise.all([
      this.orderService.getOrderPeople(tenantId, order),
      this.orderService.getOrderContext(tenantId, order),
    ]);
    return { ...order, people, context };
  }

  @RequireIdempotency('ORDER_UPDATE_DRAFT', { optional: true })
  @Patch(':id')
  async updateDraft(@Param('id') id: string, @Body() body: OrderUpdateDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.updateDraft(tenantId, id, body, userId, correlationId);
  }

  @Post(':id/quote')
  async getQuote(@Param('id') id: string, @Body() body: OrderQuoteRequestDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.orderService.getQuote(tenantId, id, body, (req as any).userRole);
  }

  @RequireIdempotency('ORDER_SUBMIT', { optional: true })
  @Post(':id/submit')
  async submitOrder(@Param('id') id: string, @Body() body: OrderSubmitDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.submitOrder(tenantId, id, body, userId, correlationId, (req as any).userRole);
  }

  @Post(':id/confirm')
  async confirmOrder(@Param('id') id: string, @Body() body: OrderTransitionDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.transitionState(tenantId, id, 'CONFIRM', body, userId, correlationId);
  }

  @Post(':id/start-preparation')
  async startPreparation(@Param('id') id: string, @Body() body: OrderTransitionDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.transitionState(tenantId, id, 'START_PREPARATION', body, userId, correlationId);
  }

  @Post(':id/mark-ready')
  async markReady(@Param('id') id: string, @Body() body: OrderTransitionDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.transitionState(tenantId, id, 'MARK_READY', body, userId, correlationId);
  }

  @Post(':id/dispatch')
  async dispatchOrder(@Param('id') id: string, @Body() body: OrderTransitionDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.transitionState(tenantId, id, 'DISPATCH', body, userId, correlationId);
  }

  @Post(':id/complete')
  async completeOrder(@Param('id') id: string, @Body() body: OrderTransitionDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.transitionState(tenantId, id, 'COMPLETE', body, userId, correlationId);
  }

  @Post(':id/edit')
  async editOrder(@Param('id') id: string, @Body() body: OrderEditDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.editOrder(tenantId, id, body, userId, correlationId);
  }

  // Rung up as the wrong kind of order. Ordinary counter work inside the cashier's window,
  // and the service escalates to an approval past it or once money has landed.
  @Post(':id/change-type')
  async changeOrderType(@Param('id') id: string, @Body() body: OrderTypeChangeDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.changeOrderType(tenantId, id, body, userId, correlationId);
  }

  @Post(':id/replace-item')
  async replaceItem(@Param('id') id: string, @Body() body: OrderItemReplaceDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.replaceItem(tenantId, id, body, userId, correlationId);
  }

  @Post(':id/cancel')
  async cancelOrder(@Param('id') id: string, @Body() body: OrderCancelDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.cancelOrder(tenantId, id, body, userId, correlationId);
  }

  @Post(':id/reopen')
  async reopenOrder(@Param('id') id: string, @Body() body: OrderReopenDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.reopenOrder(tenantId, id, body, userId, correlationId);
  }

  @Get(':id/history')
  async getOrderHistory(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.orderService.getOrderHistory(tenantId, id);
  }

  @Post(':id/split')
  async splitOrder(@Param('id') id: string, @Body() body: SplitOrderDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.splitOrder(tenantId, id, body, userId, correlationId);
  }

  // The service holds the target to the source's branch.
  @BranchOwned(OrderHeader, { body: 'sourceOrderId' })
  @Post('transfer-items')
  async transferItems(@Body() body: TransferItemsDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.transferItems(tenantId, body, userId, correlationId);
  }

  @Get(':id/guest-bill')
  async getGuestBill(@Param('id') id: string, @Query('locale') locale: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.orderService.getGuestBill(tenantId, id, locale || 'en');
  }

  @Get(':id/receipt')
  async getReceiptData(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.orderService.getReceiptData(tenantId, id);
  }
}
