import { Controller, Get, Post, Patch, Delete, Param, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { DiscountsService } from './discounts.service';

@Controller('api/v1')
export class DiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  @Get('discounts')
  async getDiscounts(@Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.discountsService.getDiscounts(tenantId);
  }

  @Get('discounts/:id')
  async getDiscountById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.discountsService.getDiscountById(tenantId, id);
  }

  @Post('discounts')
  async createDiscount(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.discountsService.createDiscount(tenantId, body, correlationId);
  }

  @Patch('discounts/:id')
  async updateDiscount(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.discountsService.updateDiscount(tenantId, id, body, correlationId);
  }

  @Delete('discounts/:id')
  async archiveDiscount(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.discountsService.archiveDiscount(tenantId, id, correlationId);
  }

  @Get('coupons')
  async getCoupons(@Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.discountsService.getCoupons(tenantId);
  }

  @Post('coupons')
  async createCoupon(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.discountsService.createCoupon(tenantId, body, correlationId);
  }

  @Post('coupons/validate')
  async validateCoupon(@Body() body: { couponCode: string; orderTotal: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.discountsService.validateCoupon(tenantId, body.couponCode, body.orderTotal);
  }
}
