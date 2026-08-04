import { Controller, Get, Post, Param, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { PaymentService } from './payment.service';

@Controller('api/v1')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('payments/order/:orderId')
  async getOrderPayments(@Param('orderId') orderId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.paymentService.getOrderPayments(tenantId, orderId);
  }

  @Post('payments')
  async postPayment(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.paymentService.postPayment(tenantId, body, correlationId);
  }

  @Get('orders/:id/receipt')
  async getReceipt(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.paymentService.getReceipt(tenantId, id);
  }
}
