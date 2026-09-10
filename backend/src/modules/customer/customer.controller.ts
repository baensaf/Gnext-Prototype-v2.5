import { Controller, Get, Post, Patch, Param, Body, Query, Req, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { CustomerService } from './customer.service';
import { HeadOfficeOnly, Roles, MANAGER_AND_ABOVE } from '../../common/decorators/roles.decorator';
import { CreditService } from './credit.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

@Controller('api/v1')
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly creditService: CreditService,
  ) {}

  @Get('customer-groups')
  async getCustomerGroups(@Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.customerService.getCustomerGroups(tenantId);
  }

  @HeadOfficeOnly()
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

  @Roles(...MANAGER_AND_ABOVE)
  @Get(['customers/:id/credit-account', 'customers/:id/credit'])
  async getCustomerCreditAccount(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    let acc = await this.creditService.getAccountByCustomer(tenantId, id);
    if (!acc) {
      acc = await this.creditService.getAccountById(tenantId, id).catch(() => null);
    }
    if (!acc) {
      throw new NotFoundException(`Credit account not found for customer ${id}`);
    }
    const stmt = await this.creditService.getAccountStatement(tenantId, acc.id);
    return {
      account: acc,
      transactions: stmt.entries.map((e: any) => ({
        ...e,
        transaction_type: e.entry_type,
        recorded_at: e.posted_at,
        note: e.reason_text || e.reference,
      })),
    };
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post(['customers/:id/credit-account/transactions', 'customers/:id/credit/transactions'])
  async postCustomerCreditTransaction(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;

    return await this.creditService.postCreditTransaction(
      tenantId,
      id,
      body,
      userId,
      correlationId,
    );
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Get(['customers/:id/credit-account/statement', 'customers/:id/credit/statement'])
  async getCustomerStatement(@Param('id') id: string, @Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    let acc = await this.creditService.getAccountByCustomer(tenantId, id);
    if (!acc) {
      acc = await this.creditService.getAccountById(tenantId, id).catch(() => null);
    }
    if (!acc) {
      throw new NotFoundException(`Credit account not found for customer ${id}`);
    }
    return await this.creditService.getAccountStatement(tenantId, acc.id, query);
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post(['customers/:id/credit-account/repayments', 'customers/:id/credit/repayments'])
  async postCustomerRepayment(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;

    let acc = await this.creditService.getAccountByCustomer(tenantId, id);
    if (!acc) {
      acc = await this.creditService.getAccountById(tenantId, id).catch(() => null);
    }
    if (!acc) {
      throw new NotFoundException(`Credit account not found for customer ${id}`);
    }

    const res = await this.creditService.postRepayment(
      tenantId,
      acc.id,
      {
        amount: String(body.amount),
        reference: body.reference || body.reference_id || undefined,
        reason: body.note || body.reason || undefined,
        approvalRequestId: body.approvalRequestId || undefined,
      },
      userId,
      correlationId,
    );

    return {
      account: { ...acc, current_balance: res.newBalance },
      transaction: res.entry,
      entry: res.entry,
      newBalance: res.newBalance,
      availableCredit: res.availableCredit,
      ...res,
    };
  }

  @Roles(...MANAGER_AND_ABOVE)
  @Post(['customers/:id/credit-account/adjustments', 'customers/:id/credit/adjustments'])
  async postCustomerAdjustment(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;

    let acc = await this.creditService.getAccountByCustomer(tenantId, id);
    if (!acc) {
      acc = await this.creditService.getAccountById(tenantId, id).catch(() => null);
    }
    if (!acc) {
      throw new NotFoundException(`Credit account not found for customer ${id}`);
    }

    const res = await this.creditService.postAdjustment(
      tenantId,
      acc.id,
      {
        amountSigned: String(body.amountSigned || body.amount),
        reason: body.reason || body.note || 'Adjustment',
        reference: body.reference || body.reference_id || undefined,
        approvalRequestId: body.approvalRequestId || 'system-approved',
      },
      userId,
      correlationId,
    );

    return {
      account: { ...acc, current_balance: res.newBalance },
      transaction: res.entry,
      entry: res.entry,
      newBalance: res.newBalance,
      availableCredit: res.availableCredit,
      ...res,
    };
  }
}

