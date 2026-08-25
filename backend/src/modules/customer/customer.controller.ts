import { Controller, Get, Post, Patch, Param, Body, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { CustomerService } from './customer.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

@Controller('api/v1')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get('customer-groups')
  async getCustomerGroups(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.customerService.getCustomerGroups(tenantId);
  }

  @Post('customer-groups')
  async createCustomerGroup(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.customerService.createCustomerGroup(tenantId, body, correlationId);
  }

  @Get('customers')
  async getCustomers(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query() query?: PaginationQueryDto & { search?: string; status?: string },
    @Req() req?: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.customerService.getCustomers(tenantId, query || { search, status });
  }

  @Get('customers/duplicates')
  async getDuplicateCandidates(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.customerService.getDuplicateCandidates(tenantId);
  }

  @Post('customers/merge')
  async mergeCustomers(
    @Body() body: { target_customer_id: string; source_customer_id: string; field_resolutions?: Record<string, string> },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.customerService.mergeCustomers(tenantId, body, correlationId);
  }

  @Get('customers/:id')
  async getCustomerById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.customerService.getCustomerById(tenantId, id);
  }

  @Post('customers')
  async createCustomer(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    return await this.customerService.createCustomer(tenantId, body, correlationId);
  }

  @Post('customers/:id/phones')
  async addPhone(
    @Param('id') id: string,
    @Body() body: { phoneNumber: string; label?: string; isPrimary?: boolean },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.customerService.addPhone(tenantId, id, body.phoneNumber, body.label, body.isPrimary);
  }

  @Post('customers/:id/consents')
  async addConsent(
    @Param('id') id: string,
    @Body() body: { consentType: string; granted?: boolean },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.customerService.addConsent(tenantId, id, body.consentType, body.granted);
  }

  @Get('customers/:id/addresses')
  async getAddressesByCustomer(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.customerService.getAddressesByCustomer(tenantId, id);
  }

  @Post('customers/:id/addresses')
  async createAddress(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.customerService.createAddress(tenantId, id, body);
  }
}

