import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, Optional } from '@nestjs/common';
import { Request } from 'express';
import { CustomerService } from './customer.service';
import { HeadOfficeOnly } from '../../common/decorators/roles.decorator';
import { isHeadOfficeUser } from '../../common/utils/user-scope.util';
import { CustomFieldsService } from './custom-fields.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

@Controller('api/v1')
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    @Optional() private readonly customFields?: CustomFieldsService,
  ) {}

  // The questions head office adds to the customer record. Every till reads them to ask them;
  // only head office changes them.
  @Get('customer-fields')
  async getCustomerFields(@Query('includeArchived') includeArchived: string, @Req() req: Request) {
    return (await this.customFields?.list((req as any).tenantId, includeArchived === 'true')) ?? [];
  }

  @HeadOfficeOnly()
  @Post('customer-fields')
  async createCustomerField(@Body() body: any, @Req() req: Request) {
    return await this.customFields!.create((req as any).tenantId, body || {}, (req as any).userId);
  }

  @HeadOfficeOnly()
  @Patch('customer-fields/:fieldId')
  async updateCustomerField(@Param('fieldId') fieldId: string, @Body() body: any, @Req() req: Request) {
    return await this.customFields!.update((req as any).tenantId, fieldId, body || {}, (req as any).userId);
  }

  @HeadOfficeOnly()
  @Delete('customer-fields/:fieldId')
  async archiveCustomerField(@Param('fieldId') fieldId: string, @Req() req: Request) {
    return await this.customFields!.archive((req as any).tenantId, fieldId, (req as any).userId);
  }

  @Get('customers')
  async getCustomers(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query() query?: PaginationQueryDto & { search?: string; status?: string; has?: string; branchId?: string },
    @Req() req?: Request,
  ) {
    const tenantId = (req as any).tenantId;
    // A branch account's friends-and-family filter is its own branch, whatever was asked.
    const ownBranch = (req as any).userBranchId;
    const scoped = query && ownBranch ? { ...query, branchId: ownBranch } : query;
    return await this.customerService.getCustomers(tenantId, scoped || { search, status });
  }

  // The POS picker: best matches for what the cashier typed (3+ characters), no paging.
  @Get('customers/search')
  async searchCustomers(@Query('q') q: string, @Query('limit') limit: string, @Req() req: Request) {
    return await this.customerService.searchCustomers((req as any).tenantId, q, Number(limit) || 20);
  }

  @Get('customers/:id')
  async getCustomerById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const customer = await this.customerService.getCustomerById(tenantId, id);
    const custom_values = (await this.customFields?.valuesFor(tenantId, id)) ?? {};
    return { ...customer, custom_values };
  }

  @Post('customers')
  async createCustomer(@Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const correlationId = (req as any).correlationId;
    // Signing a customer up is the counter's; granting them credit is not. Creating the
    // customer also opens their credit account, so a limit sent from a branch is dropped
    // and the account opens at zero until head office sets one.
    const scope = { role: (req as any).userRole, branchId: (req as any).userBranchId ?? null };
    const { custom_values: rawValues, ...rest } = body || {};
    const data = isHeadOfficeUser(scope) ? rest : { ...rest, credit_limit: undefined };
    // Checked before the customer is saved, so a missing required answer leaves nothing behind.
    const values = this.customFields ? await this.customFields.validate(tenantId, rawValues, true) : {};
    const saved = await this.customerService.createCustomer(tenantId, data, correlationId, (req as any).userId);
    if (!this.customFields || !saved?.id) return saved;
    return { ...saved, custom_values: await this.customFields.save(tenantId, saved.id, values) };
  }

  // Correcting a name or a birthday is counter work, like signing the customer up.
  @Patch('customers/:id')
  async updateCustomer(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const { custom_values: rawValues, ...data } = body || {};
    const values = this.customFields && rawValues !== undefined ? await this.customFields.validate(tenantId, rawValues, false) : null;
    const saved = await this.customerService.updateCustomer(tenantId, id, data, (req as any).correlationId, (req as any).userId);
    if (!this.customFields) return saved;
    const custom_values = values ? await this.customFields.save(tenantId, id, values) : await this.customFields.valuesFor(tenantId, id);
    return { ...saved, custom_values };
  }

  @Post('customers/:id/phones')
  async addPhone(
    @Param('id') id: string,
    @Body() body: { phoneNumber: string; label?: string; isPrimary?: boolean },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.customerService.addPhone(tenantId, id, body.phoneNumber, body.label, body.isPrimary, (req as any).userId);
  }

  @Get('customers/:id/addresses')
  async getAddressesByCustomer(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.customerService.getAddressesByCustomer(tenantId, id);
  }

  @Post('customers/:id/addresses')
  async createAddress(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.customerService.createAddress(tenantId, id, body, (req as any).userId);
  }
}
