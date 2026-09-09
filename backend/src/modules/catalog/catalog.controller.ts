import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { CatalogService } from './catalog.service';
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
  constructor(private readonly catalogService: CatalogService) {}

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

  @HeadOfficeOnly()
  @Patch('categories/:id')
  async updateCategory(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.updateCategory(tenantId, id, body, correlationId);
  }

  @HeadOfficeOnly()
  @Delete('categories/:id')
  async archiveCategory(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.archiveCategory(tenantId, id, correlationId);
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

  @Get('products/:id/effective-price')
  async getEffectivePrice(
    @Param('id') id: string,
    @Query('priceGroupId') priceGroupId?: string,
    @Query('branchId') branchId?: string,
    @Query('channel') channel?: string,
    @Req() req?: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.catalogService.getEffectivePrice(tenantId, id, priceGroupId, branchId, channel);
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

  // Price Groups & Bulk Updates
  @Get('price-groups')
  async getPriceGroups(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.catalogService.getPriceGroups(tenantId);
  }

  @HeadOfficeOnly()
  @Post('price-groups')
  async createPriceGroup(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.createPriceGroup(tenantId, body, correlationId);
  }

  @HeadOfficeOnly()
  @Post('price-groups/:id/overrides')
  async setPriceOverride(@Param('id') id: string, @Body() body: { productId: string; overridePrice: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.setPriceOverride(tenantId, id, body.productId, body.overridePrice, correlationId);
  }

  @HeadOfficeOnly()
  @Post('catalog/prices/bulk-update')
  async bulkUpdatePrices(@Body() body: { price_group_id?: string; category_id?: string; adjustment_type: 'PERCENTAGE' | 'FIXED'; amount: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.bulkUpdatePrices(tenantId, body, correlationId);
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

  // `hours` absent or 0 means "off the menu here until somebody puts it back" —
  // the branch does not carry it. A number of hours is today's 86, and the item
  // returns by itself.
  @Roles(...MANAGER_AND_ABOVE)
  @Post('availability/suspend')
  async suspendProduct(@Body() body: { productId: string; branchId?: string; hours?: number; reason?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.suspendProduct(
      tenantId,
      body.productId,
      effectiveBranchId((req as any).userBranchId, body.branchId),
      body.hours,
      body.reason,
      correlationId,
    );
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post('availability/resume')
  async resumeProduct(@Body() body: { productId: string; branchId?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.catalogService.resumeProduct(
      tenantId,
      body.productId,
      effectiveBranchId((req as any).userBranchId, body.branchId),
      correlationId,
    );
  }
}
