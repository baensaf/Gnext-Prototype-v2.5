import { Controller, Get, Post, Param, Body, Query, Req, Logger } from '@nestjs/common';
import { Request } from 'express';
import { PaymentService } from './payment.service';
import { OrderService } from '../order/order.service';
import {
  PaymentCreateDto,
  PaymentProcessDto,
  PaymentCorrectionDto,
  PaymentDeviceCreateDto,
  SettlementAccountCreateDto,
} from './dtos/payment.dto';
import { HeadOfficeOnly, MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';

@Controller('api/v1')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly orderService: OrderService,
  ) {}

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
    const payment = await this.paymentService.processPayment(tenantId, id, body, userId, correlationId);

    // Only once the payment has committed: completing inside its transaction would wait on
    // the order row that transaction still holds. The money is taken either way, so a
    // failure here is logged rather than reported as a failed payment.
    if (payment.status === 'SUCCEEDED') {
      try {
        await this.orderService.completeWhenPaidInFull(tenantId, payment.order_id, userId, correlationId);
      } catch (err) {
        this.logger.error(`Could not complete order ${payment.order_id} after payment: ${(err as Error)?.message}`);
      }
    }

    return payment;
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

  @Roles(...MANAGER_AND_ABOVE)
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

  @HeadOfficeOnly()
  @Post('settlement-accounts')
  async createSettlementAccount(@Body() body: SettlementAccountCreateDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.paymentService.createSettlementAccount(tenantId, body);
  }
}
