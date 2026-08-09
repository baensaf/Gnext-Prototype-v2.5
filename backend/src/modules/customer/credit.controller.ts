import { Controller, Get, Post, Patch, Param, Body, Query, Req } from '@nestjs/common';
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
}
