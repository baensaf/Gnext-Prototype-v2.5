import { Controller, Get, Post, Patch, Delete, Param, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { DiscountsService } from './discounts.service';
import { HeadOfficeOnly } from '../../common/decorators/roles.decorator';
import { DiscountQuoteRequestDto } from './dtos/discounts.dto';

/**
 * Three ways an order is discounted, in precedence order: the cashier's manual discount, a
 * one-time coupon code, and the customer's own rate. Discount campaigns — automatic
 * promotions with scopes and stacking — are not part of the prototype.
 */
@Controller('api/v1')
export class DiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  // Coupons
  @Get('coupons')
  async getCoupons(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.discountsService.getCoupons(tenantId);
  }

  @Post('coupons/validate')
  async validateCoupon(@Body() body: { couponCode: string; orderTotal: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.discountsService.validateCoupon(tenantId, body.couponCode, body.orderTotal);
  }

  // Quote Evaluation Endpoint (Section 8.5)
  @Post('discount-quotes')
  async evaluateQuote(@Body() body: DiscountQuoteRequestDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.discountsService.evaluateQuote(tenantId, body);
  }

  // Customer Discounts (Workflow 1)
  @Get('customer-discounts')
  async getCustomerDiscounts(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const customerId = req.query.customer_id as string | undefined;
    return await this.discountsService.getCustomerDiscounts(tenantId, customerId);
  }

  @HeadOfficeOnly()
  @Post('customer-discounts')
  async createCustomerDiscount(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.createCustomerDiscount(tenantId, body, userId, correlationId);
  }

  @HeadOfficeOnly()
  @Patch('customer-discounts/:id')
  async updateCustomerDiscount(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.updateCustomerDiscount(tenantId, id, body, userId, correlationId);
  }

  @HeadOfficeOnly()
  @Delete('customer-discounts/:id')
  async revokeCustomerDiscount(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.revokeCustomerDiscount(tenantId, id, correlationId);
  }

  // One-Time Coupon (Workflow 4)
  @HeadOfficeOnly()
  @Post('coupons/one-time')
  async createOneTimeCoupon(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.createOneTimeCoupon(tenantId, body, correlationId);
  }

  /** Switch a code off (a leaked code, a campaign ended early) or back on. */
  @HeadOfficeOnly()
  @Patch('coupons/:id')
  async setCouponActive(@Param('id') id: string, @Body() body: { is_active: boolean }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.setCouponActive(tenantId, id, body.is_active !== false, correlationId);
  }
}

