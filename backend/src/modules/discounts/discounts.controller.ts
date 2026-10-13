import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { DiscountsService } from './discounts.service';
import { HeadOfficeOnly, MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { DiscountQuoteRequestDto } from './dtos/discounts.dto';
import { ItemDiscountsService, ItemDiscountInput } from './item-discounts.service';
import { CouponsService, CouponBatchInput } from './coupons.service';

/**
 * How an order is discounted. First the automatic item discounts (a dated percent off a
 * product, V1), line by line; then at most one order discount on what is left, in precedence
 * order: the cashier's manual discount, then the customer's friends-and-family rate at the branch.
 * Discount campaigns (targeting, conditions, stacking rules) are not part of the prototype.
 */
@Controller('api/v1')
export class DiscountsController {
  constructor(
    private readonly discountsService: DiscountsService,
    private readonly itemDiscounts: ItemDiscountsService,
    private readonly coupons: CouponsService,
  ) {}

  // One-time coupons (V2): head office makes batches of codes for a campaign; each code
  // works once at the till.
  @HeadOfficeOnly()
  @Get('coupon-batches')
  async listCouponBatches(@Req() req: Request) {
    return await this.coupons.listBatches((req as any).tenantId);
  }

  @HeadOfficeOnly()
  @Post('coupon-batches')
  async createCouponBatch(@Body() body: CouponBatchInput, @Req() req: Request) {
    return await this.coupons.createBatch((req as any).tenantId, body, (req as any).userId, (req as any).correlationId);
  }

  @HeadOfficeOnly()
  @Get('coupon-batches/:id/codes')
  async listCouponCodes(@Param('id') id: string, @Req() req: Request) {
    return await this.coupons.listCodes((req as any).tenantId, id);
  }

  @HeadOfficeOnly()
  @Patch('coupon-batches/:id')
  async setCouponBatchActive(@Param('id') id: string, @Body() body: { is_active: boolean }, @Req() req: Request) {
    return await this.coupons.setActive((req as any).tenantId, id, body.is_active, (req as any).userId, (req as any).correlationId);
  }

  // Automatic item discounts: head office sets them up; branches can see them.
  @Get('item-discounts')
  async listItemDiscounts(@Req() req: Request) {
    return await this.itemDiscounts.list((req as any).tenantId);
  }

  @HeadOfficeOnly()
  @Post('item-discounts')
  async createItemDiscount(@Body() body: ItemDiscountInput, @Req() req: Request) {
    return await this.itemDiscounts.create((req as any).tenantId, body, (req as any).userId, (req as any).correlationId);
  }

  @HeadOfficeOnly()
  @Patch('item-discounts/:id')
  async updateItemDiscount(@Param('id') id: string, @Body() body: Partial<ItemDiscountInput>, @Req() req: Request) {
    return await this.itemDiscounts.update((req as any).tenantId, id, body, (req as any).userId, (req as any).correlationId);
  }

  @HeadOfficeOnly()
  @Delete('item-discounts/:id')
  async deleteItemDiscount(@Param('id') id: string, @Req() req: Request) {
    return await this.itemDiscounts.remove((req as any).tenantId, id, (req as any).userId, (req as any).correlationId);
  }

  // Quote Evaluation Endpoint (Section 8.5)
  @Post('discount-quotes')
  async evaluateQuote(@Body() body: DiscountQuoteRequestDto, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.discountsService.evaluateQuote(tenantId, body, (req as any).userRole);
  }

  /** What the signed-in account may discount alone, and the ceiling, for the register to ask for a pin. */
  @Get('discount-limits')
  async getManualDiscountLimits(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.discountsService.getManualDiscountLimits(tenantId, (req as any).userRole);
  }

  // Friends-and-family rates: each branch's manager keeps their own branch's few people;
  // head office can set them for any branch.
  @Get('customer-discounts')
  async getCustomerDiscounts(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const customerId = req.query.customer_id as string | undefined;
    return await this.discountsService.getCustomerDiscounts(tenantId, customerId, (req as any).userBranchId ?? null);
  }

  /** One person's percent at one branch; no percent takes it away. */
  @Roles(...MANAGER_AND_ABOVE)
  @Put('customer-discounts/family')
  async setFamilyDiscount(@Body() body: any, @Req() req: Request) {
    return await this.discountsService.setFamilyDiscount(
      (req as any).tenantId,
      body,
      (req as any).userBranchId ?? null,
      (req as any).userId,
      (req as any).correlationId,
    );
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post('customer-discounts')
  async createCustomerDiscount(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.createCustomerDiscount(tenantId, body, userId, correlationId, (req as any).userBranchId ?? null);
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Patch('customer-discounts/:id')
  async updateCustomerDiscount(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.updateCustomerDiscount(tenantId, id, body, userId, correlationId, (req as any).userBranchId ?? null);
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Delete('customer-discounts/:id')
  async revokeCustomerDiscount(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.discountsService.revokeCustomerDiscount(tenantId, id, correlationId, (req as any).userBranchId ?? null);
  }
}
