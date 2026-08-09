import { Controller, Get, Post, Param, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { PaymentService } from './payment.service';

@Controller('api/v1')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('payments/order/:orderId')
  async getOrderPayments(@Param('orderId') orderId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.paymentService.getOrderPayments(tenantId, orderId);
  }

  @Post('payments')
  async postPayment(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.paymentService.postPayment(tenantId, body, correlationId);
  }

  @Get('orders/:id/receipt')
  async getReceipt(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.paymentService.getReceipt(tenantId, id);
  }

  // Settlement Accounts
  @Get('payments/accounts')
  async getAccounts(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.paymentService.getAccounts(tenantId);
  }

  @Post('payments/accounts')
  async createAccount(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.paymentService.createAccount(tenantId, body, correlationId);
  }

  // Payment Devices
  @Get('payments/devices')
  async getDevices(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.paymentService.getDevices(tenantId);
  }

  @Post('payments/devices')
  async createDevice(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.paymentService.createDevice(tenantId, body, correlationId);
  }

  // Split Multi-Tender Payments
  @Post('payments/split')
  async postSplitPayment(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.paymentService.postSplitPayment(tenantId, body, correlationId);
  }

  // Retries, Reversals & Corrections
  @Post('payments/:id/retry')
  async retryPaymentAttempt(@Param('id') id: string, @Body() body: { deviceId?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.paymentService.retryPaymentAttempt(tenantId, id, body?.deviceId, correlationId);
  }

  @Post('payments/:id/reverse')
  async reversePayment(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.paymentService.reversePayment(tenantId, id, body?.reason || 'Customer request', correlationId);
  }

  @Post('payments/:id/correct')
  async correctPayment(@Param('id') id: string, @Body() body: { newTender: any }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.paymentService.correctPayment(tenantId, id, body.newTender, correlationId);
  }
}
