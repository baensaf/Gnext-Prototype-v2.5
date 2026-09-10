import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Headers, Req } from '@nestjs/common';
import { Request } from 'express';
import { SimulationService } from './simulation.service';
import { HeadOfficeOnly } from '../../common/decorators/roles.decorator';

/**
 * The demo sandbox: aggregator orders, hardware outcomes, scenario switches. Nothing here
 * is part of running a shop, and the Simulation section of the sidebar is head office's, so
 * the API says the same thing the menu does. It is not read-only either — the snappfood
 * simulator writes real orders.
 */
@Controller('api/v1/simulation')
@HeadOfficeOnly()
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  @Get('scenarios')
  async getScenarios() {
    return await this.simulationService.getScenarios();
  }

  @Post('scenarios')
  async createScenario(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.createScenario(tenantId, body);
  }

  @Patch('scenarios/:id')
  async updateScenario(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.updateScenario(tenantId, id, body);
  }

  @Delete('scenarios/:id')
  async deleteScenario(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.deleteScenario(tenantId, id);
  }

  @Post('snappfood/webhook')
  async handleSnappfoodWebhook(
    @Body() body: any,
    @Headers('x-snappfood-signature') signature: string,
    @Headers('x-snappfood-timestamp') timestamp: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    const rawBody = JSON.stringify(body);
    return await this.simulationService.handleSnappfoodWebhook(
      tenantId,
      rawBody,
      body,
      signature,
      timestamp,
      'snappfood-secret-key-123',
      correlationId,
    );
  }

  @Post('snappfood/orders')
  async generateSnappfoodOrder(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.simulationService.generateSnappfoodOrder(tenantId, body, correlationId);
  }

  @Post('snappfood/generate')
  async generateSnappfoodOrderAlias(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.simulationService.generateSnappfoodOrder(tenantId, body, correlationId);
  }

  @Post('snappfood/duplicates')
  async triggerSnappfoodDuplicate(@Body() body: { sourceWebhookReceiptId?: string; log_id?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    const logId = body.sourceWebhookReceiptId || body.log_id;
    return await this.simulationService.triggerSnappfoodDuplicate(tenantId, logId, correlationId);
  }

  @Post('snappfood/orders/:orderId/action')
  async triggerSnappfoodOrderAction(
    @Param('orderId') orderId: string,
    @Body() body: { action: 'PICK' | 'ACCEPT' | 'REJECT' | 'MODIFY' | 'CANCEL' | 'RECOVER'; payload?: any; scenarioId?: string },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.simulationService.triggerSnappfoodAction(tenantId, { ...body, order_id: orderId }, correlationId);
  }

  @Post('snappfood/action')
  async triggerSnappfoodActionLegacy(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.simulationService.triggerSnappfoodAction(tenantId, body, correlationId);
  }

  @Post('snappfood/token')
  async issueOAuthToken(@Body() body: any) {
    return await this.simulationService.issueOAuthToken(body);
  }

  @Get('snappfood/va/v1.1/product')
  async getProductsCatalog(@Query('vendorCode') vendorCode: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.getProductsCatalog(tenantId, vendorCode);
  }

  @Post('snappfood/va/v1/category/sync/categoryId')
  async syncCategory(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.syncCategory(tenantId, body);
  }

  @Post('snappfood/va/v1/product/sync/productId')
  async syncProduct(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.syncProduct(tenantId, body);
  }

  @Post('snappfood/va/v1/menu')
  async createOrUpdateMenu(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.createOrUpdateMenu(tenantId, body);
  }

  @Post('snappfood/va/v1.1/product')
  async createOrUpdateProduct(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.createOrUpdateProduct(tenantId, body);
  }

  @Patch('snappfood/va/v1/product')
  async toggleProductPatch(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.toggleProduct(tenantId, body);
  }

  @Patch('snappfood/va/v1/menu')
  async toggleMenuPatch(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.toggleMenu(tenantId, body);
  }

  @Get('snappfood/va/v1/topping/groups')
  async getToppingGroups(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.getToppingGroups(tenantId);
  }

  @Post('snappfood/va/v1/topping')
  async createToppingGroup(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.createToppingGroup(tenantId, body);
  }

  @Post('snappfood/va/v1/topping/add-to-product')
  async linkToppingsToProduct(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.linkToppingsToProduct(tenantId, body);
  }

  @Post('snappfood/va/v1/product/productDetails')
  async updateProductDetails(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.updateProductDetails(tenantId, body);
  }

  @Post('snappfood/va/v1/product/:productId/image')
  async assignProductImage(@Param('productId') productId: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.assignProductImage(tenantId, productId, body);
  }

  @Delete('snappfood/va/v1/product/image/:imageCode')
  async deleteProductImage(@Param('imageCode') imageCode: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.deleteProductImage(tenantId, imageCode);
  }

  @Get('snappfood/va/v1/vendor/status')
  async getVendorStatus(@Query('vendorCode') vendorCode: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.getVendorStatus(tenantId, vendorCode);
  }

  @Get('snappfood/va/v1/vendor/vendorDeliveries')
  async getVendorDeliveries(@Query('vendorCode') vendorCode: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.getVendorDeliveries(tenantId, vendorCode);
  }

  @Post('snappfood/va/v1/order/:orderCode/ack')
  async ackOrder(@Param('orderCode') orderCode: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.ackOrder(tenantId, orderCode);
  }

  @Post('snappfood/va/v1/order/:orderCode/pick')
  async pickOrder(@Param('orderCode') orderCode: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.pickOrder(tenantId, orderCode);
  }

  @Post('snappfood/va/v1/order/:orderCode/accept')
  async acceptOrder(@Param('orderCode') orderCode: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.acceptOrder(tenantId, orderCode, body);
  }

  @Post('snappfood/va/v1/order/:orderCode/reject')
  async rejectOrder(@Param('orderCode') orderCode: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.rejectOrder(tenantId, orderCode, body);
  }

  @Get('snappfood/va/v1/order/decline-reason')
  async getDeclineReasons() {
    return await this.simulationService.getDeclineReasons();
  }

  @Post('snappfood/va/v1/order/latest')
  async getLatestOrders(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.getLatestOrders(tenantId, body);
  }

  @Post('snappfood/catalog-sync')
  async triggerCatalogSync(@Body() body: { branchId?: string; direction?: 'PUSH' | 'RECOVER'; entityTypes?: string[]; scenarioId?: string }, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.simulationService.triggerCatalogSync(tenantId, body, correlationId);
  }

  @Post('tara/transactions')
  async executeTaraTransaction(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.simulationService.executeTaraCommand(tenantId, body, correlationId);
  }

  @Post('tara/command')
  async executeTaraCommandLegacy(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.simulationService.executeTaraCommand(tenantId, body, correlationId);
  }

  @Get('logs')
  async getLogs(
    @Query('provider') provider: string,
    @Query('status') status: string,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.getLogs(tenantId, provider, status);
  }

  @Get('logs/:id')
  async getLogDetail(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.simulationService.getLogDetail(tenantId, id);
  }
}
