import { Controller, Get, Post, Patch, Param, Body, Query, Req, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { CreditService } from './credit.service';
import {
  CreditAccountCreateDto,
  CreditAccountUpdateDto,
  CreditAccountStatusDto,
  CreditRepaymentDto,
  CreditAdjustmentDto,
} from './dtos/credit.dto';

@Controller('api/v1')
export class CreditController {
  constructor(private readonly creditService: CreditService) {}

  @Get('credit-accounts')
  async getAccounts(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.creditService.getAccounts(tenantId, query);
  }

  @Post('customers/:customerId/credit-accounts')
  async createAccount(
    @Param('customerId') customerId: string,
    @Body() body: CreditAccountCreateDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.creditService.createAccount(tenantId, customerId, body, userId, correlationId);
  }

  @Get('credit-accounts/:id')
  async getAccountById(@Param('id') id: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.creditService.getAccountById(tenantId, id);
  }

  @Patch('credit-accounts/:id')
  async updateAccount(
    @Param('id') id: string,
    @Body() body: CreditAccountUpdateDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.creditService.updateAccount(tenantId, id, body, userId, correlationId);
  }

  @Post('credit-accounts/:id/suspend')
  async suspendAccount(
    @Param('id') id: string,
    @Body() body: CreditAccountStatusDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.creditService.updateStatus(tenantId, id, 'SUSPENDED', body, userId, correlationId);
  }

  @Post('credit-accounts/:id/activate')
  async activateAccount(
    @Param('id') id: string,
    @Body() body: CreditAccountStatusDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.creditService.updateStatus(tenantId, id, 'ACTIVE', body, userId, correlationId);
  }

  @Get('credit-accounts/:id/statement')
  async getAccountStatement(@Param('id') id: string, @Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.creditService.getAccountStatement(tenantId, id, query);
  }

  @Post('credit-accounts/:id/repayments')
  async postRepayment(
    @Param('id') id: string,
    @Body() body: CreditRepaymentDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.creditService.postRepayment(tenantId, id, body, userId, correlationId);
  }

  @Post('credit-accounts/:id/adjustments')
  async postAdjustment(
    @Param('id') id: string,
    @Body() body: CreditAdjustmentDto,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;
    return await this.creditService.postAdjustment(tenantId, id, body, userId, correlationId);
  }

  @Get('credit-aging')
  async getCreditAging(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    return await this.creditService.getCreditAging(tenantId, query);
  }

  // --- Backward compatibility / customer sub-resource aliases ---

  @Get('customers/credit/aging')
  async getCustomerCreditAgingAlias(@Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const aging = await this.creditService.getCreditAging(tenantId, query);
    // If client expects flat array of customer aging items
    return aging.customers.map((c: any) => ({
      customer_id: c.customerId,
      customer_code: c.customer?.code || '',
      customer_name: c.customer?.name || '',
      credit_limit: c.totalExposure,
      current_balance: `-${c.totalExposure}`,
      available_credit: '0.0000',
      aging: {
        current_0_30: c.current,
        days_31_60: c.days31_60,
        days_61_90: c.days61_90,
        days_90_plus: c.days90Plus,
      },
    }));
  }

  @Get(['customers/:customerId/credit-account', 'customers/:customerId/credit'])
  async getCreditAccountByCustomer(@Param('customerId') customerId: string, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    const acc = await this.creditService.getAccountByCustomer(tenantId, customerId);
    if (!acc) return null;
    const statement = await this.creditService.getAccountStatement(tenantId, acc.id, {});
    return {
      account: acc,
      transactions: statement.entries.map((e: any) => ({
        ...e,
        transaction_type: e.entry_type,
        recorded_at: e.posted_at,
        note: e.reason_text || e.reference,
      })),
    };
  }

  @Post([
    'customers/:customerId/credit-account/transactions',
    'customers/:customerId/credit/transactions',
  ])
  async postCustomerCreditTransactionAlias(
    @Param('customerId') customerId: string,
    @Body() body: any,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;

    return await this.creditService.postCreditTransaction(
      tenantId,
      customerId,
      body,
      userId,
      correlationId,
    );
  }

  @Get(['customers/:customerId/credit-account/statement', 'customers/:customerId/credit/statement'])
  async getCustomerStatementAlias(@Param('customerId') customerId: string, @Query() query: any, @Req() req: Request) {
    const tenantId = (req as any).tenantId;
    let acc = await this.creditService.getAccountByCustomer(tenantId, customerId);
    if (!acc) {
      acc = await this.creditService.getAccountById(tenantId, customerId).catch(() => null);
    }
    if (!acc) {
      throw new NotFoundException(`Credit account not found for customer ${customerId}`);
    }
    return await this.creditService.getAccountStatement(tenantId, acc.id, query);
  }

  @Post(['customers/:customerId/credit-account/repayments', 'customers/:customerId/credit/repayments'])
  async postCustomerRepaymentAlias(
    @Param('customerId') customerId: string,
    @Body() body: any,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;

    let acc = await this.creditService.getAccountByCustomer(tenantId, customerId);
    if (!acc) {
      acc = await this.creditService.getAccountById(tenantId, customerId).catch(() => null);
    }
    if (!acc) {
      throw new NotFoundException(`Credit account not found for customer ${customerId}`);
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
      ...res,
    };
  }

  @Post(['customers/:customerId/credit-account/adjustments', 'customers/:customerId/credit/adjustments'])
  async postCustomerAdjustmentAlias(
    @Param('customerId') customerId: string,
    @Body() body: any,
    @Req() req: Request,
  ) {
    const tenantId = (req as any).tenantId;
    const userId = (req as any).user?.id || (req as any).userId;
    const correlationId = (req as any).correlationId;

    let acc = await this.creditService.getAccountByCustomer(tenantId, customerId);
    if (!acc) {
      acc = await this.creditService.getAccountById(tenantId, customerId).catch(() => null);
    }
    if (!acc) {
      throw new NotFoundException(`Credit account not found for customer ${customerId}`);
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
      ...res,
    };
  }
}
