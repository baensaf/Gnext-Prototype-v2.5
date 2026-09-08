import { Controller, Get, Post, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { PaymentService } from './payment.service';
import {
  PaymentCreateDto,
  PaymentProcessDto,
  PaymentCorrectionDto,
  PaymentDeviceCreateDto,
  SettlementAccountCreateDto,
} from './dtos/payment.dto';

@Controller('api/v1')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @Get('orders/:orderId/payments')
  async getOrderPayments(@Param('orderId') orderId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.paymentService.getOrderPayments(tenantId, orderId);
  }

  @Post('payments')
  async createPaymentIntent(@Body() body: PaymentCreateDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.paymentService.createPaymentIntent(tenantId, body, userId, correlationId);
  }

  @Get('payments/:id')
  async getPaymentById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.paymentService.getPaymentById(tenantId, id);
  }

  @Post('payments/:id/process')
  async processPayment(
    @Param('id') id: string,
    @Body() body: PaymentProcessDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.paymentService.processPayment(tenantId, id, body, userId, correlationId);
  }

  @Post('payments/:id/void')
  async voidPayment(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.paymentService.voidPayment(tenantId, id, userId, correlationId);
  }

  @Post('payments/:id/reverse')
  async reversePayment(
    @Param('id') id: string,
    @Body() body: { reason: string; approvalRequestId?: string },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.paymentService.reversePayment(tenantId, id, body, userId, correlationId);
  }

  @Post('payments/:id/correct')
  async correctPayment(
    @Param('id') id: string,
    @Body() body: PaymentCorrectionDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.paymentService.correctPayment(tenantId, id, body, userId, correlationId);
  }

  @Get('payment-devices')
  async getDevices(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.paymentService.getDevices(tenantId, branchId);
  }

  @Post('payment-devices')
  async createDevice(@Body() body: PaymentDeviceCreateDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.paymentService.createDevice(tenantId, body);
  }

  @Get('settlement-accounts')
  async getSettlementAccounts(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.paymentService.getSettlementAccounts(tenantId);
  }

  @Post('settlement-accounts')
  async createSettlementAccount(@Body() body: SettlementAccountCreateDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.paymentService.createSettlementAccount(tenantId, body);
  }
}
