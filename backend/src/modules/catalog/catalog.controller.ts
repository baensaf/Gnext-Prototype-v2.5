import { Controller, Get, Post, Patch, Put, Delete, Param, Query, Body, Req, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import { CatalogService, StopUntil } from './catalog.service';
import { PriceListService } from './price-lists.service';
import { PriceChangeInput, PriceChangeService } from './price-changes.service';
import { NoteTemplateService } from './note-template.service';
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
    private readonly priceChanges: PriceChangeService,
    private readonly noteTemplates: NoteTemplateService,
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

  /** Body: the ids of the category's products in their new order. */
  @HeadOfficeOnly()
  @Put('categories/:id/products/order')
  async reorderProducts(@Param('id') id: string, @Body() body: { ids: string[] }, @Req() req: Request) {
    return await this.catalogService.reorderProducts((req as any).tenantId, id, body?.ids, (req as any).correlationId);
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
  async attachOptionGroup(@Param('id') id: string, @Body() body: { optionGroupId: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.attachOptionGroupToProduct(tenantId, id, body.optionGroupId, correlationId);
  }

  // The choices of one group this product offers, as the switches on its add-ons page set them.
  // None offered takes the group off the product.
  @HeadOfficeOnly()
  @Put('products/:id/option-groups/:groupId/choices')
  async setOfferedChoices(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body() body: { offeredItemIds: string[] },
    @Req() req: Request,
  ) {
    return await this.catalogService.setOfferedChoices((req as any).tenantId, id, groupId, body.offeredItemIds, (req as any).correlationId);
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

  /** Body: the ids of the product's sizes in their new order. */
  @HeadOfficeOnly()
  @Put('products/:id/variants/order')
  async reorderVariants(@Param('id') id: string, @Body() body: { ids: string[] }, @Req() req: Request) {
    return await this.catalogService.reorderVariants((req as any).tenantId, id, body?.ids, (req as any).correlationId);
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
    // The group form sends the group with its items: created in one go, as a save.
    if (Array.isArray(body?.items)) return await this.catalogService.saveOptionGroup(tenantId, null, body, correlationId);
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

  /** The group editor's Save: rules, items and removals in one transaction. */
  @HeadOfficeOnly()
  @Put('option-groups/:id')
  async saveOptionGroup(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    return await this.catalogService.saveOptionGroup((req as any).tenantId, id, body, (req as any).correlationId);
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
    @Body() body: { productId: string; variantId?: string | null; amount: string | null; channel?: string | null },
    @Req() req: Request,
  ) {
    return await this.priceLists.setListPrice(
      (req as any).tenantId,
      id,
      body.productId,
      body.variantId || null,
      body.amount === '' || body.amount === undefined ? null : body.amount,
      (req as any).correlationId,
      // Empty is the list's in-store price; SNAPPFOOD is its Snappfood one.
      body.channel ? String(body.channel).toUpperCase() : null,
    );
  }

  @HeadOfficeOnly()
  @Put('catalog/branch-price-list')
  async assignBranchPriceList(@Body() body: { branchId: string; priceListId: string | null }, @Req() req: Request) {
    return await this.priceLists.assignBranch((req as any).tenantId, body.branchId, body.priceListId || null, (req as any).correlationId);
  }

  // Price changes ("+10% on drinks"), on base prices, one list or add-ons: previewed, then applied at once.
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

  @Get('products/:id/price-history')
  async getPriceHistory(@Param('id') id: string, @Req() req: Request) {
    return await this.priceChanges.getPriceHistory((req as any).tenantId, id);
  }

  // Aggregator price sheet, read only: what a branch gets on the channel. The Snappfood price
  // itself is set on the branch's price list; the markup rule is the CHANNEL_PRICING setting.
  @Get('catalog/channel-prices')
  async getChannelPriceSheet(@Query('channel') channel: string, @Query('branchId') branchId: string, @Req() req: Request) {
    return await this.catalogService.getChannelPriceSheet(
      (req as any).tenantId,
      (channel || 'SNAPPFOOD').toUpperCase(),
      effectiveBranchId((req as any).userBranchId, branchId) || null,
    );
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

  // An item stays off until somebody puts it back, or until the next shift (Snappfood's two kinds
  // of "ناموجود", 2026-10-12); no reason. The stop is on the product, one variant of it, or an add-on.
  @Roles(...MANAGER_AND_ABOVE)
  @Post('availability/suspend')
  async suspendProduct(
    @Body() body: { productId?: string; variantId?: string; branchId?: string; channel?: string; until?: StopUntil },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.suspendProduct(
      tenantId,
      body.productId,
      effectiveBranchId((req as any).userBranchId, body.branchId),
      correlationId,
      { variantId: body.variantId, channel: body.channel || null, until: body.until || null },
      { userId: (req as any).userId, source: 'ADMIN' },
    );
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post('availability/resume')
  async resumeProduct(@Body() body: { productId?: string; variantId?: string; branchId?: string; channel?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.resumeProduct(
      tenantId,
      body.productId,
      effectiveBranchId((req as any).userBranchId, body.branchId),
      correlationId,
      { variantId: body.variantId, channel: body.channel || null },
      { userId: (req as any).userId, source: 'ADMIN' },
    );
  }

  // A stop on a whole category ("the grill is down") or on items at several branches at once.
  // A branch acts at its own branch; head office at the branches it names, or chain-wide.
  @Roles(...MANAGER_AND_ABOVE)
  @Post('availability/bulk-stop')
  async bulkStop(
    @Body() body: { categoryId?: string; productIds?: string[]; branchIds?: string[]; channel?: string; until?: StopUntil },
    @Req() req: Request,
  ) {
    return await this.catalogService.bulkStop(
      (req as any).tenantId,
      { categoryId: body.categoryId, productIds: body.productIds, branchIds: this.stopBranches(req, body.branchIds) },
      { channel: body.channel || null, until: body.until || null },
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

  // 86 from the register's tile: any register user takes an item off until the next shift by
  // default, as Snappfood's everyday stop; "until further notice" when asked. No reason and no
  // approver. The branch is the session's (or, for head office at a register, the one it is in).
  @Post('availability/pos-stop')
  async posStop(@Body() body: { productId: string; variantId?: string; branchId?: string; until?: StopUntil }, @Req() req: Request) {
    const branchId = this.registerBranch(req, body.branchId);
    return await this.catalogService.suspendProduct(
      (req as any).tenantId,
      body.productId,
      branchId,
      (req as any).correlationId,
      { variantId: body.variantId, until: body.until || 'NEXT_SHIFT' },
      { userId: (req as any).userId, source: 'POS' },
    );
  }

  @Post('availability/pos-resume')
  async posResume(@Body() body: { productId: string; variantId?: string; branchId?: string }, @Req() req: Request) {
    const branchId = this.registerBranch(req, body.branchId);
    return await this.catalogService.resumeProduct(
      (req as any).tenantId,
      body.productId,
      branchId,
      (req as any).correlationId,
      { variantId: body.variantId },
      { userId: (req as any).userId, source: 'POS' },
    );
  }

  private registerBranch(req: Request, requested?: string) {
    const branchId = effectiveBranchId((req as any).userBranchId, requested);
    if (!branchId) throw new BadRequestException({ statusCode: 400, code: 'BRANCH_REQUIRED', message: 'Pick the branch this register is in' });
    return branchId;
  }

  // Note templates: the fixed phrases a cashier taps instead of typing a note. What the
  // chain is willing to say on a ticket is decided like the menu is, so writes are head
  // office. Reads stay open — every register needs the list.
  @Get('note-templates')
  async getNoteTemplates(@Query() query: { scope?: string; includeInactive?: string }, @Req() req: Request) {
    return await this.noteTemplates.list((req as any).tenantId, {
      scope: query.scope,
      includeInactive: query.includeInactive === 'true',
    });
  }

  @HeadOfficeOnly()
  @Post('note-templates')
  async createNoteTemplate(@Body() body: any, @Req() req: Request) {
    return await this.noteTemplates.create(
      (req as any).tenantId,
      body,
      (req as any).userId,
      (req as any).correlationId,
    );
  }

  @HeadOfficeOnly()
  @Patch('note-templates/:id')
  async updateNoteTemplate(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    return await this.noteTemplates.update(
      (req as any).tenantId,
      id,
      body,
      (req as any).userId,
      (req as any).correlationId,
    );
  }

  @HeadOfficeOnly()
  @Delete('note-templates/:id')
  async archiveNoteTemplate(@Param('id') id: string, @Req() req: Request) {
    return await this.noteTemplates.archive(
      (req as any).tenantId,
      id,
      (req as any).userId,
      (req as any).correlationId,
    );
  }
}
