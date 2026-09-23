import { Controller, Get, Post, Patch, Param, Body, Query, Req, Logger } from '@nestjs/common';
import { Request } from 'express';
import { PaymentService } from './payment.service';
import { OrderService } from '../order/order.service';
import {
  PaymentCreateDto,
  PaymentProcessDto,
  PaymentCorrectionDto,
  PaymentDeviceCreateDto,
  SettlementAccountCreateDto,
  PaymentDeviceAgentDto,
  TerminalResolutionDto,
} from './dtos/payment.dto';
import { HeadOfficeOnly, MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { BranchOwned } from '../../common/decorators/branch-owned.decorator';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { Payment } from '../../entities/Payment.entity';

/** A payment reaches its branch through the order it was taken against. */
const PAYMENT_OF_BRANCH = { through: { entity: OrderHeader, foreignKey: 'order_id' } };

@Controller('api/v1')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly paymentService: PaymentService,
    private readonly orderService: OrderService,
  ) {}

  @BranchOwned(OrderHeader, { param: 'orderId' })
  @Get('orders/:orderId/payments')
  async getOrderPayments(@Param('orderId') orderId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.paymentService.getOrderPayments(tenantId, orderId);
  }

  // The order a payment is taken against is named in the body, not the path.
  @BranchOwned(OrderHeader, { body: 'orderId' })
  @Post('payments')
  async createPaymentIntent(@Body() body: PaymentCreateDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.paymentService.createPaymentIntent(tenantId, body, userId, correlationId);
  }

  @BranchOwned(Payment, PAYMENT_OF_BRANCH)
  @Get('payments/:id')
  async getPaymentById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.paymentService.getPaymentById(tenantId, id);
  }

  @BranchOwned(Payment, PAYMENT_OF_BRANCH)
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
        await this.orderService.afterPaymentSucceeded(tenantId, payment.order_id, userId, correlationId);
      } catch (err) {
        this.logger.error(`Could not complete order ${payment.order_id} after payment: ${(err as Error)?.message}`);
      }
    }

    return payment;
  }

  /** Asks the card terminal how a charge it never confirmed ended. */
  @BranchOwned(Payment, PAYMENT_OF_BRANCH)
  @Post('payments/:id/check-terminal')
  async checkTerminal(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    return await this.paymentService.checkTerminal(tenantId, id, userId, (req as any).correlationId);
  }

  /** A manager settles an unconfirmed card charge from the terminal's own report. */
  @BranchOwned(Payment, PAYMENT_OF_BRANCH)
  @Roles(...MANAGER_AND_ABOVE)
  @Post('payments/:id/resolve-terminal')
  async resolveTerminal(@Param('id') id: string, @Body() body: TerminalResolutionDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    return await this.paymentService.resolveTerminal(tenantId, id, body, userId, (req as any).correlationId);
  }

  @BranchOwned(Payment, PAYMENT_OF_BRANCH)
  @Post('payments/:id/void')
  async voidPayment(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.paymentService.voidPayment(tenantId, id, userId, correlationId);
  }

  @BranchOwned(Payment, PAYMENT_OF_BRANCH)
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

  @BranchOwned(Payment, PAYMENT_OF_BRANCH)
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

  @Roles(...MANAGER_AND_ABOVE)
  @Patch('payment-devices/:id/agent')
  async setDeviceAgent(@Param('id') id: string, @Body() body: PaymentDeviceAgentDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    return await this.paymentService.setDeviceAgent(tenantId, id, body, userId);
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
