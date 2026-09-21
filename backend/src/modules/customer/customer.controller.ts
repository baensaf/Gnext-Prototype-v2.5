import { Controller, Get, Post, Patch, Param, Body, Query, Req, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { CustomerService } from './customer.service';
import { HeadOfficeOnly } from '../../common/decorators/roles.decorator';
import { isHeadOfficeUser } from '../../common/utils/user-scope.util';
import { CreditService } from './credit.service';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

@Controller('api/v1')
export class CustomerController {
  constructor(
    private readonly customerService: CustomerService,
    private readonly creditService: CreditService,
  ) {}

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

  // One customer record serves the whole chain, so folding two into one is head office's.
  @HeadOfficeOnly()
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
    // Signing a customer up is the counter's; granting them credit is not. Creating the
    // customer also opens their credit account, so a limit sent from a branch is dropped
    // and the account opens at zero until head office sets one.
    const scope = { role: (req as any).userRole, branchId: (req as any).userBranchId ?? null };
    const data = isHeadOfficeUser(scope) ? body : { ...body, credit_limit: undefined };
    return await this.customerService.createCustomer(tenantId, data, correlationId, (req as any).userId);
  }

  // Correcting a name or a birthday is counter work, like signing the customer up.
  @Patch('customers/:id')
  async updateCustomer(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    return await this.customerService.updateCustomer(
      (req as any).tenantId,
      id,
      body,
      (req as any).correlationId,
      (req as any).userId,
    );
  }

  // Refusing to serve somebody is not one branch's call: the customer belongs to the chain,
  // and a block taken at one site has to hold at the next one.
  @HeadOfficeOnly()
  @Post('customers/:id/block')
  async blockCustomer(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: Request) {
    return await this.customerService.setBlocked(
      (req as any).tenantId,
      id,
      true,
      body?.reason,
      (req as any).correlationId,
      (req as any).userId,
    );
  }

  @HeadOfficeOnly()
  @Post('customers/:id/unblock')
  async unblockCustomer(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: Request) {
    return await this.customerService.setBlocked(
      (req as any).tenantId,
      id,
      false,
      body?.reason,
      (req as any).correlationId,
      (req as any).userId,
    );
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

  @Post('customers/:id/consents')
  async addConsent(
    @Param('id') id: string,
    @Body() body: { consentType: string; granted?: boolean },
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    return await this.customerService.addConsent(tenantId, id, body.consentType, body.granted, (req as any).userId);
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

  @HeadOfficeOnly()
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

  @HeadOfficeOnly()
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

  @HeadOfficeOnly()
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

  @HeadOfficeOnly()
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

  @HeadOfficeOnly()
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

