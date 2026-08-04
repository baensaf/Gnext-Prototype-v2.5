import { Controller, Get, Post, Patch, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { OrderService } from './order.service';

@Controller('api/v1')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get('orders')
  async getOrders(
    @Query('branchId') branchId: string,
    @Query('status') status: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.orderService.getOrders(tenantId, branchId, status);
  }

  @Get('orders/:id')
  async getOrderById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.orderService.getOrderById(tenantId, id);
  }

  @Post('orders')
  async createOrder(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.orderService.createOrder(tenantId, body, correlationId);
  }

  @Patch('orders/:id/status')
  async updateOrderStatus(
    @Param('id') id: string,
    @Body() body: { status: string; cancellation_reason_code_id?: string },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.orderService.updateOrderStatus(
      tenantId,
      id,
      body.status,
      body.cancellation_reason_code_id,
      correlationId,
    );
  }
}
