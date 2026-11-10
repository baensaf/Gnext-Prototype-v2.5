import { Controller, Get, Post, Patch, Param, Body, Query, Req, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { CreditService } from './credit.service';
import { HamiClubCreditImportService } from './hamiclub-credit-import.service';
import { HeadOfficeOnly } from '../../common/decorators/roles.decorator';
import {
  CreditAccountCreateDto,
  CreditAccountUpdateDto,
  CreditRepaymentDto,
} from './dtos/credit.dto';

/**
 * Customer credit: a limit per customer, repayments, and the transactions they move.
 *
 * Reach, not seniority: the chain holds credit centrally — one limit and one ledger per
 * customer, usable at every branch — so a branch manager setting a limit or taking a
 * repayment would be deciding for all of them. It sits on the class because no branch
 * screen reads any of it: the POS takes a credit payment through the payment module, which
 * does its own credit work server-side.
 */
@Controller('api/v1')
@HeadOfficeOnly()
export class CreditController {
  constructor(
    private readonly creditService: CreditService,
    private readonly hamiClubImport: HamiClubCreditImportService,
  ) {}

  /**
   * A branch's live HamiClub credit, carried into wallets on its switch day from the file
   * exported from HamiClub. `apply` other than "true" only previews.
   */
  @Post('credit-accounts/wallet/import-hamiclub')
  @UseInterceptors(FileInterceptor('file'))
  async importHamiClubCredit(@UploadedFile() file: any, @Body('apply') apply: string, @Req() req: Request) {
    const userId = (req as any).user?.id || (req as any).userId;
    return await this.hamiClubImport.importFile((req as any).tenantId, file, apply === 'true', userId, (req as any).correlationId);
  }

  /** The chain's credit in one line: what is owed, by how many, the limits and what is left. */
  @Get('credit-accounts/summary')
  async getSummary(@Req() req: Request) {
    return await this.creditService.getSummary((req as any).tenantId);
  }

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

  // The account with its transactions, newest first.
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
}
