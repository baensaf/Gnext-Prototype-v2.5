import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { DiscountsService } from './discounts.service';
import { HeadOfficeOnly, MANAGER_AND_ABOVE, Roles } from '../../common/decorators/roles.decorator';
import { DiscountQuoteRequestDto } from './dtos/discounts.dto';
import { ItemDiscountsService, ItemDiscountInput } from './item-discounts.service';
import { CouponsService, CouponBatchInput } from './coupons.service';
import { CustomerGroupsService, CustomerGroupInput, GroupDiscountInput } from './customer-groups.service';

/**
 * How an order is discounted. First the automatic item discounts (a dated percent off a
 * product, V1), line by line; then at most one order discount on what is left, in precedence
 * order: a coupon, the cashier's manual discount, then the customer's group discount.
 * Discount campaigns (targeting, conditions, stacking rules) are not part of the prototype.
 */
@Controller('api/v1')
export class DiscountsController {
  constructor(
    private readonly discountsService: DiscountsService,
    private readonly itemDiscounts: ItemDiscountsService,
    private readonly coupons: CouponsService,
    private readonly groups: CustomerGroupsService,
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

  // Customer groups and group discounts: head office keeps both; a branch's manager adds and
  // removes their own branch's people in the groups open to branches.
  @Get('customer-groups')
  async listCustomerGroups(@Req() req: Request) {
    return await this.groups.listGroups((req as any).tenantId);
  }

  @HeadOfficeOnly()
  @Put('customer-groups')
  async saveCustomerGroups(@Body() body: { groups: CustomerGroupInput[] }, @Req() req: Request) {
    return await this.groups.saveGroups((req as any).tenantId, body?.groups || [], (req as any).userId, (req as any).correlationId);
  }

  /** One customer's groups and the group discounts they get, with this month's use. */
  @Get('customer-groups/of/:customerId')
  async customerGroupSummary(@Param('customerId') customerId: string, @Req() req: Request) {
    return await this.groups.summary((req as any).tenantId, customerId);
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post('customer-groups/:id/members')
  async addGroupMembers(
    @Param('id') id: string,
    @Body() body: { customer_ids: string[]; branch_id?: string | null; note?: string | null },
    @Req() req: Request,
  ) {
    return await this.groups.addMembers(
      (req as any).tenantId,
      id,
      body,
      (req as any).userBranchId ?? null,
      (req as any).userId,
      (req as any).correlationId,
    );
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Delete('customer-groups/:id/members/:customerId')
  async removeGroupMember(@Param('id') id: string, @Param('customerId') customerId: string, @Req() req: Request) {
    return await this.groups.removeMember((req as any).tenantId, id, customerId, (req as any).userBranchId ?? null, (req as any).correlationId);
  }

  @Get('group-discounts')
  async listGroupDiscounts(@Req() req: Request) {
    return await this.groups.listDiscounts((req as any).tenantId);
  }

  @HeadOfficeOnly()
  @Put('group-discounts')
  async saveGroupDiscounts(@Body() body: { discounts: GroupDiscountInput[] }, @Req() req: Request) {
    return await this.groups.saveDiscounts((req as any).tenantId, body?.discounts || [], (req as any).userId, (req as any).correlationId);
  }
}
