import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { OrderService } from './order.service';
import {
  OrderCreateDto,
  OrderUpdateDto,
  OrderQuoteRequestDto,
  OrderSubmitDto,
  OrderTransitionDto,
  OrderEditDto,
  OrderItemReplaceDto,
  OrderCancelDto,
  OrderReopenDto,
} from './dtos/order.dto';

@Controller('api/v1/orders')
export class OrdersController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  async getOrders(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.orderService.getOrders(tenantId, query);
  }

  @Post()
  async createDraft(@Body() body: OrderCreateDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.createDraft(tenantId, body, userId, correlationId);
  }

  @Get(':id')
  async getOrderById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.orderService.getOrderById(tenantId, id);
  }

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
    return await this.orderService.getQuote(tenantId, id, body);
  }

  @Post(':id/submit')
  async submitOrder(@Param('id') id: string, @Body() body: OrderSubmitDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.orderService.submitOrder(tenantId, id, body, userId, correlationId);
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
}
