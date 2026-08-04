import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { CatalogService } from './catalog.service';

@Controller('api/v1')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  // Categories
  @Get('categories')
  async getCategories(@Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.catalogService.getCategories(tenantId);
  }

  @Post('categories')
  async createCategory(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.createCategory(tenantId, body, correlationId);
  }

  @Patch('categories/:id')
  async updateCategory(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.updateCategory(tenantId, id, body, correlationId);
  }

  @Delete('categories/:id')
  async archiveCategory(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.archiveCategory(tenantId, id, correlationId);
  }

  // Products
  @Get('products')
  async getProducts(@Query('categoryId') categoryId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.catalogService.getProducts(tenantId, categoryId);
  }

  @Get('products/:id')
  async getProductById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.catalogService.getProductById(tenantId, id);
  }

  @Post('products')
  async createProduct(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.createProduct(tenantId, body, correlationId);
  }

  @Patch('products/:id')
  async updateProduct(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.updateProduct(tenantId, id, body, correlationId);
  }

  @Delete('products/:id')
  async archiveProduct(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.archiveProduct(tenantId, id, correlationId);
  }

  @Post('products/:id/option-groups')
  async attachOptionGroup(@Param('id') id: string, @Body() body: { optionGroupId: string; sortOrder?: number }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.attachOptionGroupToProduct(tenantId, id, body.optionGroupId, body.sortOrder, correlationId);
  }

  @Get('products/:id/effective-price')
  async getEffectivePrice(
    @Param('id') id: string,
    @Query('priceGroupId') priceGroupId?: string,
    @Query('branchId') branchId?: string,
    @Query('channel') channel?: string,
    @Req() req?: Request,
  ) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.catalogService.getEffectivePrice(tenantId, id, priceGroupId, branchId, channel);
  }

  // Option Groups & Items
  @Get('option-groups')
  async getOptionGroups(@Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.catalogService.getOptionGroups(tenantId);
  }

  @Post('option-groups')
  async createOptionGroup(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.createOptionGroup(tenantId, body, correlationId);
  }

  @Post('option-groups/:id/items')
  async createOptionItem(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.createOptionItem(tenantId, id, body, correlationId);
  }

  // Price Groups & Bulk Updates
  @Get('price-groups')
  async getPriceGroups(@Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.catalogService.getPriceGroups(tenantId);
  }

  @Post('price-groups')
  async createPriceGroup(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.createPriceGroup(tenantId, body, correlationId);
  }

  @Post('price-groups/:id/overrides')
  async setPriceOverride(@Param('id') id: string, @Body() body: { productId: string; overridePrice: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.setPriceOverride(tenantId, id, body.productId, body.overridePrice, correlationId);
  }

  @Post('catalog/prices/bulk-update')
  async bulkUpdatePrices(@Body() body: { price_group_id?: string; category_id?: string; adjustment_type: 'PERCENTAGE' | 'FIXED'; amount: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.bulkUpdatePrices(tenantId, body, correlationId);
  }

  // Menus
  @Get('menus')
  async getMenus(@Query('branchId') branchId: string, @Query('channel') channel: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.catalogService.getMenus(tenantId, branchId, channel);
  }

  @Get('menus/:id')
  async getMenuById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.catalogService.getMenuById(tenantId, id);
  }

  @Post('menus')
  async createMenu(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.createMenu(tenantId, body, correlationId);
  }

  @Patch('menus/:id')
  async updateMenu(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.updateMenu(tenantId, id, body, correlationId);
  }

  @Delete('menus/:id')
  async deleteMenu(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.deleteMenu(tenantId, id, correlationId);
  }

  @Post('menus/:id/categories')
  async addCategoryToMenu(@Param('id') id: string, @Body() body: { categoryId: string; sortOrder?: number }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.catalogService.addCategoryToMenu(tenantId, id, body.categoryId, body.sortOrder);
  }

  @Post('menus/:id/products')
  async addProductToMenu(
    @Param('id') id: string,
    @Body() body: { productId: string; categoryId?: string; sortOrder?: number; overridePrice?: string },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.catalogService.addProductToMenu(tenantId, id, body.productId, body.categoryId, body.sortOrder, body.overridePrice);
  }

  // Availability & Suspension
  @Get('availability')
  async getAvailabilities(@Query('branchId') branchId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    return await this.catalogService.getAvailabilities(tenantId, branchId);
  }

  @Post('availability/suspend')
  async suspendProduct(@Body() body: { productId: string; branchId?: string; hours?: number; reason?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.suspendProduct(tenantId, body.productId, body.branchId, body.hours, body.reason, correlationId);
  }

  @Post('availability/resume')
  async resumeProduct(@Body() body: { productId: string; branchId?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId || 'e8ae80c5-b667-4d58-899a-ce6ef7c3847e';
    const correlationId = (req as any).correlationId;
    return await this.catalogService.resumeProduct(tenantId, body.productId, body.branchId, correlationId);
  }
}
