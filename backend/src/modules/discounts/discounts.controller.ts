import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Req, Query } from '@nestjs/common';
import { Request } from 'express';
import { DiscountsService } from './discounts.service';
import { HeadOfficeOnly, MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { DiscountQuoteRequestDto } from './dtos/discounts.dto';
import { ItemDiscountsService, ItemDiscountInput } from './item-discounts.service';
import { CouponsService, CouponBatchInput } from './coupons.service';
import { PersonalDiscountsService, PersonalDiscountGroupInput } from './personal-discounts.service';

/**
 * How an order is discounted. First the automatic item discounts (a dated percent off a
 * product, V1), line by line; then at most one order discount on what is left, in precedence
 * order: a coupon, the cashier's manual discount, then the person's personal discount group.
 * Discount campaigns (targeting, conditions, stacking rules) are not part of the prototype.
 */
@Controller('api/v1')
export class DiscountsController {
  constructor(
    private readonly discountsService: DiscountsService,
    private readonly itemDiscounts: ItemDiscountsService,
    private readonly coupons: CouponsService,
    private readonly personal: PersonalDiscountsService,
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

  // Personal discounts: head office's groups, and who is in which. A branch's manager puts
  // their own branch's people in a group for one branch; head office anyone in any group.
  @Get('personal-discount-groups')
  async listPersonalDiscountGroups(@Req() req: Request) {
    return await this.personal.listGroups((req as any).tenantId);
  }

  @HeadOfficeOnly()
  @Put('personal-discount-groups')
  async savePersonalDiscountGroups(@Body() body: { groups: PersonalDiscountGroupInput[] }, @Req() req: Request) {
    return await this.personal.saveGroups((req as any).tenantId, body?.groups || [], (req as any).userId, (req as any).correlationId);
  }

  /** The person's group and what is left of it this month; null when they have none. */
  @Get('customer-discounts/personal')
  async getPersonalDiscount(@Query('customer_id') customerId: string, @Req() req: Request) {
    return await this.personal.summary((req as any).tenantId, customerId);
  }

  /** Puts a person in a group at the branch they work at; no group takes them out. */
  @Roles(...MANAGER_AND_ABOVE)
  @Put('customer-discounts/personal')
  async setPersonalDiscount(@Body() body: any, @Req() req: Request) {
    return await this.personal.assign(
      (req as any).tenantId,
      body,
      (req as any).userBranchId ?? null,
      (req as any).userId,
      (req as any).correlationId,
    );
  }
}
