import { Controller, Get, Post, Patch, Put, Delete, Param, Query, Body, Req, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { CatalogService } from './catalog.service';
import { PriceListService } from './price-lists.service';
import { ApprovalService } from '../approval/approval.service';
import { PriceChangeInput, PriceChangeService } from './price-changes.service';
import { StopReportService } from './stop-report.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { HeadOfficeOnly, Roles, MANAGER_AND_ABOVE } from '../../common/decorators/roles.decorator';
import { effectiveBranchId } from '../../common/utils/user-scope.util';

/**
 * The menu is the chain's, the shelf is the branch's.
 *
 * Every write that decides *what an item is* — its name, price, recipe, which
 * category or menu it sits on — is head office only. Reads stay open, because a
 * register cannot sell what it cannot list. The one thing a branch decides for
 * itself is whether an item is available today, and those two endpoints take
 * their branch from the session rather than the request body.
 */
@Controller('api/v1')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly priceLists: PriceListService,
    private readonly approvals: ApprovalService,
    private readonly priceChanges: PriceChangeService,
    private readonly stopReports: StopReportService,
  ) {}

  // Categories
  @Get('categories')
  async getCategories(@Query() query: PaginationQueryDto & { search?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.catalogService.getCategories(tenantId, query);
  }

  @HeadOfficeOnly()
  @Post('categories')
  async createCategory(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.createCategory(tenantId, body, correlationId);
  }

  /** Body: the ids of sibling categories in their new order. */
  @HeadOfficeOnly()
  @Put('categories/order')
  async reorderCategories(@Body() body: { ids: string[] }, @Req() req: Request) {
    return await this.catalogService.reorderCategories((req as any).tenantId, body?.ids, (req as any).correlationId);
  }

  @HeadOfficeOnly()
  @Patch('categories/:id')
  async updateCategory(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.updateCategory(tenantId, id, body, correlationId);
  }

  @HeadOfficeOnly()
  @Delete('categories/:id')
  async archiveCategory(@Param('id') id: string, @Query('moveTo') moveTo: string | undefined, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.archiveCategory(tenantId, id, correlationId, moveTo);
  }

  // Products
  @Get('products')
  async getProducts(
    @Query('categoryId') categoryId?: string,
    @Query() query?: PaginationQueryDto & { search?: string },
    @Req() req?: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.catalogService.getProducts(tenantId, categoryId, query);
  }

  @Get('products/:id')
  async getProductById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.catalogService.getProductById(tenantId, id);
  }

  @HeadOfficeOnly()
  @Post('products')
  async createProduct(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.createProduct(tenantId, body, correlationId);
  }

  @HeadOfficeOnly()
  @Patch('products/:id')
  async updateProduct(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.updateProduct(tenantId, id, body, correlationId);
  }

  @HeadOfficeOnly()
  @Delete('products/:id')
  async archiveProduct(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.archiveProduct(tenantId, id, correlationId);
  }

  @HeadOfficeOnly()
  @Post('products/:id/option-groups')
  async attachOptionGroup(@Param('id') id: string, @Body() body: { optionGroupId: string; sortOrder?: number }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.attachOptionGroupToProduct(tenantId, id, body.optionGroupId, body.sortOrder, correlationId);
  }

  @HeadOfficeOnly()
  @Delete('products/:id/option-groups/:groupId')
  async detachOptionGroup(@Param('id') id: string, @Param('groupId') groupId: string, @Req() req: Request) {
    return await this.catalogService.detachOptionGroupFromProduct((req as any).tenantId, id, groupId, (req as any).correlationId);
  }

  // Which items of an attached group this product leaves out.
  @HeadOfficeOnly()
  @Put('products/:id/option-groups/:groupId/excluded-items')
  async setExcludedOptionItems(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body() body: { excludedItemIds: string[] },
    @Req() req: Request,
  ) {
    return await this.catalogService.setExcludedOptionItems((req as any).tenantId, id, groupId, body.excludedItemIds, (req as any).correlationId);
  }

  // Product Variants Endpoints
  @Get('products/:id/variants')
  async getProductVariants(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.catalogService.getProductVariants(tenantId, id);
  }

  @HeadOfficeOnly()
  @Post('products/:id/variants')
  async createProductVariant(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.createProductVariant(tenantId, id, body, correlationId);
  }

  @HeadOfficeOnly()
  @Patch('products/:id/variants/:variantId')
  async updateProductVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() body: any,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.updateProductVariant(tenantId, id, variantId, body, correlationId);
  }

  @HeadOfficeOnly()
  @Delete('products/:id/variants/:variantId')
  async archiveProductVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.archiveProductVariant(tenantId, id, variantId, correlationId);
  }

  // Option Groups & Items
  @Get('option-groups')
  async getOptionGroups(@Query() query: PaginationQueryDto & { search?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.catalogService.getOptionGroups(tenantId, query);
  }

  @HeadOfficeOnly()
  @Post('option-groups')
  async createOptionGroup(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.createOptionGroup(tenantId, body, correlationId);
  }

  @HeadOfficeOnly()
  @Post('option-groups/:id/items')
  async createOptionItem(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.createOptionItem(tenantId, id, body, correlationId);
  }

  @HeadOfficeOnly()
  @Patch('option-groups/:id')
  async updateOptionGroup(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    return await this.catalogService.updateOptionGroup((req as any).tenantId, id, body, (req as any).correlationId);
  }

  @HeadOfficeOnly()
  @Delete('option-groups/:id')
  async archiveOptionGroup(@Param('id') id: string, @Req() req: Request) {
    return await this.catalogService.archiveOptionGroup((req as any).tenantId, id, (req as any).correlationId);
  }

  @HeadOfficeOnly()
  @Patch('option-groups/:id/items/:itemId')
  async updateOptionItem(@Param('id') id: string, @Param('itemId') itemId: string, @Body() body: any, @Req() req: Request) {
    return await this.catalogService.updateOptionItem((req as any).tenantId, id, itemId, body, (req as any).correlationId);
  }

  @HeadOfficeOnly()
  @Delete('option-groups/:id/items/:itemId')
  async archiveOptionItem(@Param('id') id: string, @Param('itemId') itemId: string, @Req() req: Request) {
    return await this.catalogService.archiveOptionItem((req as any).tenantId, id, itemId, (req as any).correlationId);
  }

  // Branch price lists. A branch on a list sells at the list's prices, everything else at base.
  // Reading a branch's prices is open (a register has to show them); a branch account is
  // answered about its own branch.
  @Get('catalog/prices')
  async getBranchPrices(@Query('branchId') branchId: string, @Req() req: Request) {
    return await this.priceLists.getBranchPrices((req as any).tenantId, effectiveBranchId((req as any).userBranchId, branchId) || null);
  }

  @Get('catalog/price-lists')
  async getPriceLists(@Req() req: Request) {
    return await this.priceLists.getPriceLists((req as any).tenantId);
  }

  @HeadOfficeOnly()
  @Post('catalog/price-lists')
  async createPriceList(@Body() body: { name: string; code?: string }, @Req() req: Request) {
    return await this.priceLists.createPriceList((req as any).tenantId, body, (req as any).correlationId);
  }

  @HeadOfficeOnly()
  @Patch('catalog/price-lists/:id')
  async updatePriceList(@Param('id') id: string, @Body() body: { name?: string; is_active?: boolean }, @Req() req: Request) {
    return await this.priceLists.updatePriceList((req as any).tenantId, id, body, (req as any).correlationId);
  }

  @HeadOfficeOnly()
  @Delete('catalog/price-lists/:id')
  async archivePriceList(@Param('id') id: string, @Req() req: Request) {
    return await this.priceLists.archivePriceList((req as any).tenantId, id, (req as any).correlationId);
  }

  @Get('catalog/price-lists/:id/prices')
  async getPriceListSheet(@Param('id') id: string, @Req() req: Request) {
    return await this.priceLists.getPriceListSheet((req as any).tenantId, id);
  }

  @HeadOfficeOnly()
  @Put('catalog/price-lists/:id/prices')
  async setListPrice(
    @Param('id') id: string,
    @Body() body: { productId: string; variantId?: string | null; amount: string | null },
    @Req() req: Request,
  ) {
    return await this.priceLists.setListPrice(
      (req as any).tenantId,
      id,
      body.productId,
      body.variantId || null,
      body.amount === '' || body.amount === undefined ? null : body.amount,
      (req as any).correlationId,
    );
  }

  @HeadOfficeOnly()
  @Put('catalog/branch-price-list')
  async assignBranchPriceList(@Body() body: { branchId: string; priceListId: string | null }, @Req() req: Request) {
    return await this.priceLists.assignBranch((req as any).tenantId, body.branchId, body.priceListId || null, (req as any).correlationId);
  }

  // Dated price changes ("+10% from Saturday"), on base prices or one list.
  @HeadOfficeOnly()
  @Post('catalog/price-changes/preview')
  async previewPriceChange(@Body() body: PriceChangeInput, @Req() req: Request) {
    return await this.priceChanges.preview((req as any).tenantId, body);
  }

  @HeadOfficeOnly()
  @Post('catalog/price-changes')
  async commitPriceChange(@Body() body: PriceChangeInput, @Req() req: Request) {
    return await this.priceChanges.commit((req as any).tenantId, body, (req as any).userId || null, (req as any).correlationId);
  }

  @HeadOfficeOnly()
  @Get('catalog/price-changes')
  async getPriceChanges(@Req() req: Request) {
    return await this.priceChanges.list((req as any).tenantId);
  }

  @HeadOfficeOnly()
  @Delete('catalog/price-changes/:id')
  async cancelPriceChange(@Param('id') id: string, @Req() req: Request) {
    return await this.priceChanges.cancel((req as any).tenantId, id, (req as any).userId || null, (req as any).correlationId);
  }

  @Get('products/:id/price-history')
  async getPriceHistory(@Param('id') id: string, @Req() req: Request) {
    return await this.priceChanges.getPriceHistory((req as any).tenantId, id);
  }

  // Aggregator price sheet. The markup rule itself is the CHANNEL_PRICING setting.
  @Get('catalog/channel-prices')
  async getChannelPriceSheet(@Query('channel') channel: string, @Query('branchId') branchId: string, @Req() req: Request) {
    return await this.catalogService.getChannelPriceSheet(
      (req as any).tenantId,
      (channel || 'SNAPPFOOD').toUpperCase(),
      effectiveBranchId((req as any).userBranchId, branchId) || null,
    );
  }

  @HeadOfficeOnly()
  @Put('catalog/channel-prices')
  async setChannelFixedPrice(
    @Body() body: { channel?: string; productId: string; variantId?: string | null; amount: string | null; branchId?: string | null },
    @Req() req: Request,
  ) {
    return await this.catalogService.setChannelFixedPrice(
      (req as any).tenantId,
      (body.channel || 'SNAPPFOOD').toUpperCase(),
      body.productId,
      body.variantId || null,
      body.amount === '' || body.amount === undefined ? null : body.amount,
      (req as any).correlationId,
      // Only which branch's sheet comes back; the fixed price itself is chain-wide.
      body.branchId || null,
    );
  }

  // Menus
  @Get('menus')
  async getMenus(@Query('branchId') branchId: string, @Query('channel') channel: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.catalogService.getMenus(tenantId, branchId, channel);
  }

  @Get('menus/:id')
  async getMenuById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.catalogService.getMenuById(tenantId, id);
  }

  @HeadOfficeOnly()
  @Post('menus')
  async createMenu(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.createMenu(tenantId, body, correlationId);
  }

  @HeadOfficeOnly()
  @Patch('menus/:id')
  async updateMenu(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.updateMenu(tenantId, id, body, correlationId);
  }

  @HeadOfficeOnly()
  @Delete('menus/:id')
  async deleteMenu(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.deleteMenu(tenantId, id, correlationId);
  }

  @HeadOfficeOnly()
  @Post('menus/:id/categories')
  async addCategoryToMenu(@Param('id') id: string, @Body() body: { categoryId: string; sortOrder?: number }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.catalogService.addCategoryToMenu(tenantId, id, body.categoryId, body.sortOrder);
  }

  @HeadOfficeOnly()
  @Post('menus/:id/products')
  async addProductToMenu(
    @Param('id') id: string,
    @Body() body: { productId: string; categoryId?: string; sortOrder?: number; overridePrice?: string },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.catalogService.addProductToMenu(tenantId, id, body.productId, body.categoryId, body.sortOrder, body.overridePrice);
  }

  // Availability & Suspension
  @Get('availability')
  async getAvailabilities(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.catalogService.getAvailabilities(
      tenantId,
      effectiveBranchId((req as any).userBranchId, branchId),
    );
  }

  // Weekly selling windows. What sells when is a menu decision, so head office sets them;
  // any register reads which items are outside their window right now.
  @Get('availability/schedules')
  async getSchedules(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.catalogService.getSchedules(tenantId, effectiveBranchId((req as any).userBranchId, branchId));
  }

  @Get('availability/off-schedule')
  async getOffScheduleProducts(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.catalogService.getOffScheduleProducts(tenantId, effectiveBranchId((req as any).userBranchId, branchId));
  }

  @HeadOfficeOnly()
  @Post('availability/schedules')
  async createSchedule(
    @Body() body: { productId?: string; categoryId?: string; branchId?: string; daysOfWeek: number[]; startTime: string; endTime: string; label?: string },
    @Req() req: Request,
  ) {
    return await this.catalogService.createSchedule((req as any).tenantId, body, (req as any).correlationId);
  }

  @HeadOfficeOnly()
  @Delete('availability/schedules/:id')
  async deleteSchedule(@Param('id') id: string, @Req() req: Request) {
    return await this.catalogService.deleteSchedule((req as any).tenantId, id, (req as any).correlationId);
  }

  // `hours` absent or 0 means "off the menu here until somebody puts it back" —
  // the branch does not carry it. A number of hours is today's 86, and the item
  // returns by itself; `until: 'NEXT_SHIFT'` brings it back when the branch next opens.
  // The stop is on the product, or on one variant of it, or on an add-on item.
  @Roles(...MANAGER_AND_ABOVE)
  @Post('availability/suspend')
  async suspendProduct(
    @Body() body: { productId?: string; variantId?: string; optionItemId?: string; branchId?: string; hours?: number; until?: 'NEXT_SHIFT'; reason?: string; channel?: string },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.suspendProduct(
      tenantId,
      body.productId,
      effectiveBranchId((req as any).userBranchId, body.branchId),
      body.hours,
      body.reason,
      correlationId,
      { variantId: body.variantId, optionItemId: body.optionItemId, untilNextShift: body.until === 'NEXT_SHIFT', channel: body.channel || null },
      { userId: (req as any).userId, source: 'ADMIN' },
    );
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post('availability/resume')
  async resumeProduct(@Body() body: { productId?: string; variantId?: string; optionItemId?: string; branchId?: string; channel?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.resumeProduct(
      tenantId,
      body.productId,
      effectiveBranchId((req as any).userBranchId, body.branchId),
      correlationId,
      { variantId: body.variantId, optionItemId: body.optionItemId, channel: body.channel || null },
      { userId: (req as any).userId, source: 'ADMIN' },
    );
  }

  // A stop on a whole category ("the grill is down") or on items at several branches at once.
  // A branch acts at its own branch; head office at the branches it names, or chain-wide.
  @Roles(...MANAGER_AND_ABOVE)
  @Post('availability/bulk-stop')
  async bulkStop(
    @Body() body: { categoryId?: string; productIds?: string[]; branchIds?: string[]; hours?: number; until?: 'NEXT_SHIFT'; reason: string; channel?: string },
    @Req() req: Request,
  ) {
    const reason = (body.reason || '').trim();
    if (!reason) throw new BadRequestException({ statusCode: 400, code: 'REASON_REQUIRED', message: 'Pick why the items are off' });
    return await this.catalogService.bulkStop(
      (req as any).tenantId,
      { categoryId: body.categoryId, productIds: body.productIds, branchIds: this.stopBranches(req, body.branchIds) },
      { hours: body.hours, untilNextShift: body.until === 'NEXT_SHIFT', reason, channel: body.channel || null },
      (req as any).correlationId,
      { userId: (req as any).userId, source: 'BULK' },
    );
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post('availability/bulk-resume')
  async bulkResume(@Body() body: { categoryId?: string; productIds?: string[]; branchIds?: string[]; channel?: string }, @Req() req: Request) {
    return await this.catalogService.bulkResume(
      (req as any).tenantId,
      { categoryId: body.categoryId, productIds: body.productIds, branchIds: this.stopBranches(req, body.branchIds) },
      body.channel || null,
      (req as any).correlationId,
      { userId: (req as any).userId, source: 'BULK' },
    );
  }

  /** Where a bulk stop acts: a branch user's own branch; for head office the branches named, else the chain. */
  private stopBranches(req: Request, requested?: string[]): Array<string | null> {
    const own = (req as any).userBranchId;
    if (own) return [own];
    const named = [...new Set((requested || []).filter(Boolean))];
    return named.length ? named : [null];
  }

  // Who took what off sale, for how long, and the sales refused while it was off.
  @Roles(...MANAGER_AND_ABOVE)
  @Get('availability/report')
  async stopReport(@Query('from') from: string, @Query('to') to: string, @Query('branchId') branchId: string, @Req() req: Request) {
    return await this.stopReports.report((req as any).tenantId, { from, to, branchId: effectiveBranchId((req as any).userBranchId, branchId) });
  }

  // 86 from the register's tile. Any register user can take an item off until the next shift,
  // with a reason. Until further notice, and putting an item back, need an approver: someone
  // whose role can approve, or anyone with an approver's pin. The branch is the session's
  // (or, for head office at a register, the one it is working in).
  @Post('availability/pos-stop')
  async posStop(
    @Body() body: { productId: string; variantId?: string; until: 'NEXT_SHIFT' | 'FURTHER_NOTICE'; reason: string; branchId?: string; approverPin?: string },
    @Req() req: Request,
  ) {
    const branchId = this.registerBranch(req, body.branchId);
    const reason = (body.reason || '').trim();
    if (!reason) throw new BadRequestException({ statusCode: 400, code: 'REASON_REQUIRED', message: 'Pick why the item is off' });
    if (reason.length > 200) throw new BadRequestException('A reason is at most 200 characters');
    if (body.until !== 'NEXT_SHIFT' && body.until !== 'FURTHER_NOTICE') throw new BadRequestException('Stop it until the next shift or until further notice');
    const approverId =
      body.until === 'FURTHER_NOTICE' ? await this.authorizeStop(req, 'ITEM_STOP_UNTIL_FURTHER_NOTICE', body.approverPin) : null;
    return await this.catalogService.suspendProduct(
      (req as any).tenantId,
      body.productId,
      branchId,
      undefined,
      reason,
      (req as any).correlationId,
      { variantId: body.variantId, untilNextShift: body.until === 'NEXT_SHIFT' },
      { userId: (req as any).userId, approverId, source: 'POS' },
    );
  }

  @Post('availability/pos-resume')
  async posResume(@Body() body: { productId: string; variantId?: string; branchId?: string; approverPin?: string }, @Req() req: Request) {
    const branchId = this.registerBranch(req, body.branchId);
    const approverId = await this.authorizeStop(req, 'ITEM_RESUME', body.approverPin);
    return await this.catalogService.resumeProduct(
      (req as any).tenantId,
      body.productId,
      branchId,
      (req as any).correlationId,
      { variantId: body.variantId },
      { userId: (req as any).userId, approverId, source: 'POS' },
    );
  }

  private registerBranch(req: Request, requested?: string) {
    const branchId = effectiveBranchId((req as any).userBranchId, requested);
    if (!branchId) throw new BadRequestException({ statusCode: 400, code: 'BRANCH_REQUIRED', message: 'Pick the branch this register is in' });
    return branchId;
  }

  /** An approver acts alone; anyone else needs an approver's pin. Answers whose pin it was. */
  private authorizeStop(req: Request, action: string, pin?: string) {
    return this.approvals.authorizeMoneyOut(
      (req as any).tenantId,
      action,
      { id: (req as any).userId, role: (req as any).userRole, branchId: (req as any).userBranchId ?? null },
      pin,
    );
  }

  @Get('availability/next-shift')
  async getNextShift(@Query('branchId') branchId: string, @Req() req: Request) {
    const at = await this.catalogService.nextShiftStart((req as any).tenantId, effectiveBranchId((req as any).userBranchId, branchId));
    return { next_shift_start: at };
  }

  // Today's stock: a branch's own count, like the 86, so branch managers set it.
  @Get('availability/daily-stock')
  async getDailyStock(@Query('branchId') branchId: string, @Req() req: Request) {
    const scoped = effectiveBranchId((req as any).userBranchId, branchId);
    if (!scoped) return [];
    return await this.catalogService.getDailyStock((req as any).tenantId, scoped);
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Put('availability/daily-stock')
  async setDailyStock(
    @Body() body: { branchId?: string; entries: Array<{ productId: string; variantId?: string | null; quantity: number | null }> },
    @Req() req: Request,
  ) {
    return await this.catalogService.setDailyStock(
      (req as any).tenantId,
      effectiveBranchId((req as any).userBranchId, body.branchId),
      body.entries,
      (req as any).correlationId,
    );
  }
}
