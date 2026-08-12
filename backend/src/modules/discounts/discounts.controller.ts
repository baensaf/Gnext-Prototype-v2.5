import { Controller, Get, Post, Patch, Delete, Param, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { DiscountsService } from './discounts.service';
import {
  CreateDiscountCampaignDto,
  UpdateDiscountCampaignDto,
  CreateDiscountScopeDto,
  CreateCouponDto,
  DiscountQuoteRequestDto,
} from './dtos/discounts.dto';

@Controller('api/v1')
export class DiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  @Get('discounts')
  async getDiscounts(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.discountsService.getDiscounts(tenantId);
  }

  @Get('discounts/:id')
  async getDiscountById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.discountsService.getDiscountById(tenantId, id);
  }

  @Post('discounts')
  async createDiscount(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;

    // Support both campaign DTO and legacy body
    if (body.discount_type) {
      return await this.discountsService.createDiscountCampaign(tenantId, body as CreateDiscountCampaignDto, correlationId);
    }
    const campaignDto: CreateDiscountCampaignDto = {
      code: body.code,
      name: body.name,
      discount_type: body.calculation_type === 'FIXED_AMOUNT' ? ('FIXED_AMOUNT' as any) : ('PERCENTAGE' as any),
      percentage: body.calculation_type === 'PERCENTAGE' || !body.calculation_type ? body.value : undefined,
      amount: body.calculation_type === 'FIXED_AMOUNT' ? body.value : undefined,
      coupon_required: body.kind === 'COUPON',
      minimum_subtotal: body.min_order_total,
      maximum_discount_amount: body.max_discount_amount,
      is_active: body.is_active ?? true,
    };
    return await this.discountsService.createDiscountCampaign(tenantId, campaignDto, correlationId);
  }

  @Patch('discounts/:id')
  async updateDiscount(@Param('id') id: string, @Body() body: UpdateDiscountCampaignDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.updateDiscountCampaign(tenantId, id, body, correlationId);
  }

  @Delete('discounts/:id')
  async archiveDiscount(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.archiveDiscountCampaign(tenantId, id, correlationId);
  }

  // Scopes
  @Post('discounts/:id/scopes')
  async addScope(
    @Param('id') id: string,
    @Body() body: CreateDiscountScopeDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.addScope(tenantId, id, body, correlationId);
  }

  @Delete('discounts/:id/scopes/:scopeId')
  async removeScope(
    @Param('scopeId') scopeId: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.removeScope(tenantId, scopeId, correlationId);
  }

  // Coupons
  @Get('coupons')
  async getCoupons(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.discountsService.getCoupons(tenantId);
  }

  @Post('coupons')
  async createCoupon(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;

    const dto: CreateCouponDto = {
      campaign_id: body.campaign_id || body.discount_id,
      code: body.code,
      max_uses: body.max_uses ?? body.max_redemptions,
      effective_from: body.effective_from || body.starts_at,
      effective_to: body.effective_to || body.expires_at,
    };
    return await this.discountsService.createCoupon(tenantId, dto, correlationId);
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

  @Post('customer-discounts')
  async createCustomerDiscount(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.createCustomerDiscount(tenantId, body, userId, correlationId);
  }

  @Patch('customer-discounts/:id')
  async updateCustomerDiscount(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.updateCustomerDiscount(tenantId, id, body, userId, correlationId);
  }

  @Delete('customer-discounts/:id')
  async revokeCustomerDiscount(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.revokeCustomerDiscount(tenantId, id, correlationId);
  }

  // One-Time Coupon (Workflow 4)
  @Post('coupons/one-time')
  async createOneTimeCoupon(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.createOneTimeCoupon(tenantId, body, correlationId);
  }
}

