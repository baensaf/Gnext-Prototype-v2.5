import { Controller, Get, Post, Query, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { PricingService, PriceContext } from './pricing.service';

@Controller('api/v1')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get('prices/resolve')
  async resolvePrice(
    @Query('productId') productId: string,
    @Query('variantId') variantId?: string,
    @Query('modifierOptionId') modifierOptionId?: string,
    @Query('priceGroupId') priceGroupId?: string,
    @Query('branchId') branchId?: string,
    @Query('channel') channel?: string,
    @Query('orderType') orderType?: string,
    @Query('currencyCode') currencyCode?: string,
    @Query('evalTime') evalTime?: string,
    @Req() req?: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const context: PriceContext = {
      productId,
      variantId,
      modifierOptionId,
      priceGroupId,
      branchId,
      channel,
      orderType,
      currencyCode,
      evalTime: evalTime ? new Date(evalTime) : undefined,
    };
    return await this.pricingService.resolvePrice(tenantId, context);
  }

  @Post('prices')
  async createPriceEntry(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.pricingService.createPriceEntry(tenantId, body, correlationId);
  }

  @Post('prices/bulk-preview')
  async bulkPreview(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.pricingService.bulkPreview(tenantId, body);
  }

  @Post('prices/bulk-commit')
  async bulkCommit(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.pricingService.bulkCommit(tenantId, body, correlationId);
  }

  @Post('price-groups/branches')
  async assignBranchToPriceGroup(@Body() body: { branchId: string; priceGroupId: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.pricingService.assignBranchToPriceGroup(tenantId, body.branchId, body.priceGroupId, correlationId);
  }
}
