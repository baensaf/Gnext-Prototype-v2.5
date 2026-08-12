import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { CustomerCreditAccount, CreditMode, CreditAccountStatus } from '../../entities/CustomerCreditAccount.entity';
import { CreditEntry, CreditEntryType } from '../../entities/CreditEntry.entity';
import { Customer } from '../../entities/Customer.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { MoneyUtil } from '../../common/utils/money.util';
import {
  CreditAccountCreateDto,
  CreditAccountUpdateDto,
  CreditAccountStatusDto,
  CreditRepaymentDto,
  CreditAdjustmentDto,
  CreditPurchaseDto,
} from './dtos/credit.dto';

@Injectable()
export class CreditService {
  constructor(
    @InjectRepository(CustomerCreditAccount)
    private readonly accountRepo: Repository<CustomerCreditAccount>,
    @InjectRepository(CreditEntry)
    private readonly entryRepo: Repository<CreditEntry>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    private readonly auditWriter: AuditWriter,
    private readonly dataSource: DataSource,
  ) {}

  calculateAvailableCredit(account: CustomerCreditAccount): string {
    if (account.mode === 'UNLIMITED') {
      return '999999999999.0000';
    }
    const limit = account.credit_limit || '0.0000';
    const available = MoneyUtil.add(limit, account.current_balance);
    return MoneyUtil.greaterThanOrEqual(available, '0.0000') ? available : '0.0000';
  }

  async getAccounts(tenantId: string, query: any) {
    const qb = this.accountRepo
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId });

    if (query.customer) qb.andWhere('a.customer_id = :customer', { customer: query.customer });
    if (query.status) qb.andWhere('a.status = :status', { status: query.status });
    if (query.currency) qb.andWhere('a.currency_code = :currency', { currency: query.currency });

    qb.orderBy('a.created_at', 'DESC');
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '50', 10);
    qb.skip((page - 1) * limit).take(limit);

    const [accounts, total] = await qb.getManyAndCount();

    const data = accounts.map((acc) => ({
      ...acc,
      availableCredit: this.calculateAvailableCredit(acc),
    }));

    return { data, total, page, limit };
  }

  async getAccountById(tenantId: string, id: string) {
    const acc = await this.accountRepo.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['entries'],
    });
    if (!acc) throw new NotFoundException(`Credit account ${id} not found`);
    return {
      ...acc,
      availableCredit: this.calculateAvailableCredit(acc),
    };
  }

  async getAccountByCustomer(tenantId: string, customerId: string, currencyCode: string = 'IRR') {
    const acc = await this.accountRepo.findOne({
      where: { tenant_id: tenantId, customer_id: customerId, currency_code: currencyCode },
      relations: ['entries'],
    });
    if (!acc) return null;
    return {
      ...acc,
      availableCredit: this.calculateAvailableCredit(acc),
    };
  }

  async createAccount(tenantId: string, customerId: string, dto: CreditAccountCreateDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const customer = await em.findOne(Customer, { where: { id: customerId, tenant_id: tenantId } });
      if (!customer) throw new NotFoundException(`Customer ${customerId} not found`);

      const currencyCode = dto.currencyCode || 'IRR';
      const mode = dto.mode || 'FINITE';

      if (mode === 'FINITE' && !dto.creditLimit) {
        throw new BadRequestException('Credit limit is required for FINITE mode');
      }

      const existing = await em.findOne(CustomerCreditAccount, {
        where: { tenant_id: tenantId, customer_id: customerId, currency_code: currencyCode },
      });
      if (existing) {
        throw new ConflictException(`Customer already has a credit account for currency ${currencyCode}`);
      }

      const limit = mode === 'UNLIMITED' ? null : MoneyUtil.format(dto.creditLimit || '0.0000');

      const acc = em.create(CustomerCreditAccount, {
        tenant_id: tenantId,
        customer_id: customerId,
        currency_code: currencyCode,
        mode,
        credit_limit: limit,
        current_balance: '0.0000',
        status: 'ACTIVE',
        policy_note: dto.policyNote || null,
        created_by: userId || null,
      });

      const savedAcc = await em.save(CustomerCreditAccount, acc);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'CREDIT_ACCOUNT_CREATED',
        entityType: 'CustomerCreditAccount',
        entityId: savedAcc.id,
        correlationId: correlationId || 'system',
        afterData: savedAcc,
      });

      return {
        ...savedAcc,
        availableCredit: this.calculateAvailableCredit(savedAcc),
      };
    });
  }

  async updateAccount(tenantId: string, id: string, dto: CreditAccountUpdateDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const acc = await em.findOne(CustomerCreditAccount, { where: { id, tenant_id: tenantId } });
      if (!acc) throw new NotFoundException(`Credit account ${id} not found`);

      if (dto.mode !== undefined) acc.mode = dto.mode;
      if (dto.policyNote !== undefined) acc.policy_note = dto.policyNote;

      if (dto.creditLimit !== undefined && acc.mode !== 'UNLIMITED') {
        const newLimit = MoneyUtil.format(dto.creditLimit);
        // If reducing limit below current exposure (balance is negative), check approval
        const currentExposure = MoneyUtil.abs(acc.current_balance);
        if (MoneyUtil.lessThan(acc.current_balance, '0.0000') && MoneyUtil.lessThan(newLimit, currentExposure)) {
          if (!dto.approvalRequestId) {
            throw new ForbiddenException('Reducing credit limit below active balance exposure requires approval');
          }
        }
        acc.credit_limit = newLimit;
      }

      acc.updated_by = userId || null;
      const savedAcc = await em.save(CustomerCreditAccount, acc);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'CREDIT_ACCOUNT_UPDATED',
        entityType: 'CustomerCreditAccount',
        entityId: id,
        correlationId: correlationId || 'system',
        afterData: savedAcc,
      });

      return {
        ...savedAcc,
        availableCredit: this.calculateAvailableCredit(savedAcc),
      };
    });
  }

  async updateStatus(tenantId: string, id: string, status: CreditAccountStatus, dto: CreditAccountStatusDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const acc = await em.findOne(CustomerCreditAccount, { where: { id, tenant_id: tenantId } });
      if (!acc) throw new NotFoundException(`Credit account ${id} not found`);

      if (status === 'CLOSED' && MoneyUtil.notEqual(acc.current_balance, '0.0000')) {
        throw new BadRequestException('Cannot close a credit account with a non-zero balance');
      }

      acc.status = status;
      acc.is_blocked = status === 'SUSPENDED' || status === 'CLOSED';
      acc.updated_by = userId || null;

      const savedAcc = await em.save(CustomerCreditAccount, acc);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: `CREDIT_ACCOUNT_${status}`,
        entityType: 'CustomerCreditAccount',
        entityId: id,
        correlationId: correlationId || 'system',
      });

      return {
        ...savedAcc,
        availableCredit: this.calculateAvailableCredit(savedAcc),
      };
    });
  }

  async postPurchase(tenantId: string, accountId: string, dto: CreditPurchaseDto, userId?: string, entityManager?: EntityManager) {
    const execute = async (em: EntityManager) => {
      const acc = await em.findOne(CustomerCreditAccount, {
        where: { id: accountId, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!acc) throw new NotFoundException(`Credit account ${accountId} not found`);

      if (acc.status !== 'ACTIVE' || acc.is_blocked) {
        throw new ForbiddenException(`Credit account ${accountId} is ${acc.status} and cannot process purchases`);
      }

      const purchaseAmount = MoneyUtil.format(dto.amount);
      if (MoneyUtil.lessThanOrEqual(purchaseAmount, '0.0000')) {
        throw new BadRequestException('Purchase amount must be greater than zero');
      }

      const available = this.calculateAvailableCredit(acc);
      if (acc.mode !== 'UNLIMITED' && MoneyUtil.greaterThan(purchaseAmount, available)) {
        if (!dto.approvalRequestId) {
          throw new ForbiddenException({
            statusCode: 403,
            error: 'CREDIT_LIMIT_EXCEEDED',
            message: `Purchase amount (${purchaseAmount}) exceeds available credit (${available}) and no approval override provided`,
          });
        }
      }

      const signedAmount = `-${purchaseAmount}`;
      const newBalance = MoneyUtil.add(acc.current_balance, signedAmount);

      const dateStr = dto.businessDate || new Date().toISOString().slice(0, 10);

      const entry = em.create(CreditEntry, {
        tenant_id: tenantId,
        account_id: acc.id,
        entry_type: 'PURCHASE',
        amount: signedAmount,
        currency_code: acc.currency_code,
        order_id: dto.orderId,
        payment_id: dto.paymentId || null,
        business_date: dateStr,
        posted_by: userId || null,
        balance_after: newBalance,
      });
      const savedEntry = await em.save(CreditEntry, entry);

      acc.current_balance = newBalance;
      await em.save(CustomerCreditAccount, acc);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'CREDIT_PURCHASE_POSTED',
        entityType: 'CreditEntry',
        entityId: savedEntry.id,
        correlationId: 'system',
        afterData: savedEntry,
      });

      return savedEntry;
    };

    if (entityManager) return await execute(entityManager);
    return await this.dataSource.transaction(execute);
  }

  async postRepayment(tenantId: string, accountId: string, dto: CreditRepaymentDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const acc = await em.findOne(CustomerCreditAccount, {
        where: { id: accountId, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!acc) throw new NotFoundException(`Credit account ${accountId} not found`);

      if (acc.status === 'CLOSED') {
        throw new BadRequestException('Cannot post repayment to a CLOSED credit account');
      }

      const repaymentAmount = MoneyUtil.format(dto.amount);
      if (MoneyUtil.lessThanOrEqual(repaymentAmount, '0.0000')) {
        throw new BadRequestException('Repayment amount must be greater than zero');
      }

      const signedAmount = repaymentAmount;
      const newBalance = MoneyUtil.add(acc.current_balance, signedAmount);

      // Over-repayment check: if new balance becomes > 0, check approval
      if (MoneyUtil.greaterThan(newBalance, '0.0000') && MoneyUtil.lessThanOrEqual(acc.current_balance, '0.0000')) {
        if (!dto.approvalRequestId) {
          throw new ForbiddenException('Over-repayment resulting in a positive balance requires approval');
        }
      }

      const dateStr = new Date().toISOString().slice(0, 10);

      const entry = em.create(CreditEntry, {
        tenant_id: tenantId,
        account_id: acc.id,
        entry_type: 'REPAYMENT',
        amount: signedAmount,
        currency_code: acc.currency_code,
        reference: dto.reference || null,
        reason_text: dto.reason || null,
        business_date: dateStr,
        posted_by: userId || null,
        balance_after: newBalance,
      });
      const savedEntry = await em.save(CreditEntry, entry);

      acc.current_balance = newBalance;
      await em.save(CustomerCreditAccount, acc);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'CREDIT_REPAYMENT_POSTED',
        entityType: 'CreditEntry',
        entityId: savedEntry.id,
        correlationId: correlationId || 'system',
        afterData: savedEntry,
      });

      return {
        entry: savedEntry,
        newBalance: acc.current_balance,
        availableCredit: this.calculateAvailableCredit(acc),
      };
    });
  }

  async postAdjustment(tenantId: string, accountId: string, dto: CreditAdjustmentDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const acc = await em.findOne(CustomerCreditAccount, {
        where: { id: accountId, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!acc) throw new NotFoundException(`Credit account ${accountId} not found`);

      if (!dto.approvalRequestId) {
        throw new BadRequestException('Manual credit adjustment requires an approvalRequestId');
      }

      const signedAmount = MoneyUtil.format(dto.amountSigned);
      if (MoneyUtil.isZero(signedAmount)) {
        throw new BadRequestException('Adjustment amount cannot be zero');
      }

      const newBalance = MoneyUtil.add(acc.current_balance, signedAmount);
      const dateStr = new Date().toISOString().slice(0, 10);

      const entry = em.create(CreditEntry, {
        tenant_id: tenantId,
        account_id: acc.id,
        entry_type: 'ADJUSTMENT',
        amount: signedAmount,
        currency_code: acc.currency_code,
        reason_code_id: dto.reasonCodeId || null,
        reason_text: dto.reason,
        reference: dto.reference || null,
        business_date: dateStr,
        posted_by: userId || null,
        balance_after: newBalance,
      });
      const savedEntry = await em.save(CreditEntry, entry);

      acc.current_balance = newBalance;
      await em.save(CustomerCreditAccount, acc);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'CREDIT_ADJUSTMENT_POSTED',
        entityType: 'CreditEntry',
        entityId: savedEntry.id,
        correlationId: correlationId || 'system',
        afterData: savedEntry,
      });

      return {
        entry: savedEntry,
        newBalance: acc.current_balance,
        availableCredit: this.calculateAvailableCredit(acc),
      };
    });
  }

  async getAccountStatement(tenantId: string, accountId: string, query: any) {
    const acc = await this.accountRepo.findOne({ where: { id: accountId, tenant_id: tenantId } });
    if (!acc) throw new NotFoundException(`Credit account ${accountId} not found`);

    const qb = this.entryRepo
      .createQueryBuilder('e')
      .where('e.account_id = :accountId', { accountId });

    if (query.dateFrom) qb.andWhere('e.business_date >= :dateFrom', { dateFrom: query.dateFrom });
    if (query.dateTo) qb.andWhere('e.business_date <= :dateTo', { dateTo: query.dateTo });

    qb.orderBy('e.posted_at', 'ASC');
    const entries = await qb.getMany();

    // Opening balance calculation
    let openingBalance = '0.0000';
    if (query.dateFrom) {
      const priorEntries = await this.entryRepo
        .createQueryBuilder('e')
        .where('e.account_id = :accountId', { accountId })
        .andWhere('e.business_date < :dateFrom', { dateFrom: query.dateFrom })
        .getMany();

      for (const p of priorEntries) {
        openingBalance = MoneyUtil.add(openingBalance, p.amount);
      }
    }

    let closingBalance = openingBalance;
    for (const e of entries) {
      closingBalance = MoneyUtil.add(closingBalance, e.amount);
    }

    return {
      accountId: acc.id,
      customerId: acc.customer_id,
      currencyCode: acc.currency_code,
      openingBalance,
      closingBalance,
      entries,
    };
  }

  async getCreditAging(tenantId: string, query: any) {
    const accounts = await this.accountRepo.find({
      where: { tenant_id: tenantId, status: 'ACTIVE' },
    });

    const asOfDate = query.asOf ? new Date(query.asOf) : new Date();

    let totalOutstanding = '0.0000';
    let currentBucket = '0.0000'; // 0-30 days
    let bucket31_60 = '0.0000';   // 31-60 days
    let bucket61_90 = '0.0000';   // 61-90 days
    let bucket90Plus = '0.0000';  // 90+ days

    const customerAgingList: any[] = [];

    for (const acc of accounts) {
      if (MoneyUtil.lessThan(acc.current_balance, '0.0000')) {
        const exposure = MoneyUtil.abs(acc.current_balance);
        totalOutstanding = MoneyUtil.add(totalOutstanding, exposure);

        const entries = await this.entryRepo.find({
          where: { account_id: acc.id, entry_type: 'PURCHASE' },
          order: { posted_at: 'ASC' },
        });

        let accCurrent = '0.0000';
        let acc31_60 = '0.0000';
        let acc61_90 = '0.0000';
        let acc90Plus = '0.0000';

        for (const e of entries) {
          const ageDays = Math.floor((asOfDate.getTime() - new Date(e.posted_at).getTime()) / (1000 * 3600 * 24));
          const entryAmt = MoneyUtil.abs(e.amount);

          if (ageDays <= 30) {
            accCurrent = MoneyUtil.add(accCurrent, entryAmt);
            currentBucket = MoneyUtil.add(currentBucket, entryAmt);
          } else if (ageDays <= 60) {
            acc31_60 = MoneyUtil.add(acc31_60, entryAmt);
            bucket31_60 = MoneyUtil.add(bucket31_60, entryAmt);
          } else if (ageDays <= 90) {
            acc61_90 = MoneyUtil.add(acc61_90, entryAmt);
            bucket61_90 = MoneyUtil.add(bucket61_90, entryAmt);
          } else {
            acc90Plus = MoneyUtil.add(acc90Plus, entryAmt);
            bucket90Plus = MoneyUtil.add(bucket90Plus, entryAmt);
          }
        }

        customerAgingList.push({
          accountId: acc.id,
          customerId: acc.customer_id,
          totalExposure: exposure,
          current: accCurrent,
          days31_60: acc31_60,
          days61_90: acc61_90,
          days90Plus: acc90Plus,
        });
      }
    }

    return {
      asOf: asOfDate.toISOString().slice(0, 10),
      totals: {
        totalOutstanding,
        current: currentBucket,
        days31_60: bucket31_60,
        days61_90: bucket61_90,
        days90Plus: bucket90Plus,
      },
      customers: customerAgingList,
    };
  }

  // Workflow 2: Purchase-based cashback & loyalty wallet
  async awardLoyaltyCashback(
    tenantId: string,
    customerId: string,
    orderId: string,
    paidEligibleSubtotal: string,
    cashbackPct: string,
    currencyCode: string = 'IRR',
    entityManager?: EntityManager,
  ) {
    const runner = async (em: EntityManager) => {
      // Check idempotency: ensure LOYALTY_CASHBACK entry for this order does not already exist
      const existingEntry = await em.findOne(CreditEntry, {
        where: { tenant_id: tenantId, order_id: orderId, entry_type: 'LOYALTY_CASHBACK' as any },
      });
      if (existingEntry) return existingEntry;

      const pctDec = MoneyUtil.divide(cashbackPct, '100', 6);
      const cashbackAmt = MoneyUtil.multiply(paidEligibleSubtotal, pctDec);
      if (MoneyUtil.lessThanOrEqual(cashbackAmt, '0.0000')) return null;

      let acc = await em.findOne(CustomerCreditAccount, {
        where: { tenant_id: tenantId, customer_id: customerId, currency_code: currencyCode },
        lock: { mode: 'pessimistic_write' },
      });

      if (!acc) {
        acc = em.create(CustomerCreditAccount, {
          tenant_id: tenantId,
          customer_id: customerId,
          currency_code: currencyCode,
          mode: 'FINITE',
          credit_limit: '10000000.0000',
          current_balance: '0.0000',
          status: 'ACTIVE',
        });
        acc = await em.save(CustomerCreditAccount, acc);
      }

      const newBalance = MoneyUtil.add(acc.current_balance, cashbackAmt);
      acc.current_balance = newBalance;
      await em.save(CustomerCreditAccount, acc);

      const todayStr = new Date().toISOString().slice(0, 10);
      const entry = em.create(CreditEntry, {
        tenant_id: tenantId,
        account_id: acc.id,
        entry_type: 'LOYALTY_CASHBACK' as any,
        amount: cashbackAmt,
        currency_code: currencyCode,
        order_id: orderId,
        reason_text: `Customer Club Cashback (${cashbackPct}%) on paid subtotal ${paidEligibleSubtotal}`,
        reference: `CASHBACK_${orderId}`,
        business_date: todayStr,
        balance_after: newBalance,
      });

      const savedEntry = await em.save(CreditEntry, entry);

      await this.auditWriter.write({
        tenantId,
        actorType: 'SYSTEM',
        action: 'LOYALTY_CASHBACK_AWARDED',
        entityType: 'CreditEntry',
        entityId: savedEntry.id,
        correlationId: `order_${orderId}`,
        afterData: savedEntry,
        details: { customerId, orderId, cashbackAmt, cashbackPct },
      });

      return savedEntry;
    };

    if (entityManager) {
      return await runner(entityManager);
    } else {
      return await this.dataSource.transaction(async (em) => runner(em));
    }
  }

  async reverseLoyaltyCashback(
    tenantId: string,
    orderId: string,
    refundedSubtotalAmount: string,
    totalOrderSubtotalAmount: string,
    currencyCode: string = 'IRR',
    entityManager?: EntityManager,
  ) {
    const runner = async (em: EntityManager) => {
      const originalEntry = await em.findOne(CreditEntry, {
        where: { tenant_id: tenantId, order_id: orderId, entry_type: 'LOYALTY_CASHBACK' as any },
      });
      if (!originalEntry) return null;

      const originalCashbackAmt = originalEntry.amount;

      // Cumulative reversals check
      const previousReversals = await em.find(CreditEntry, {
        where: { tenant_id: tenantId, order_id: orderId, entry_type: 'LOYALTY_CASHBACK_REVERSAL' as any },
      });
      let alreadyReversedAmt = '0.0000';
      for (const rev of previousReversals) {
        const absVal = MoneyUtil.format(Math.abs(Number(rev.amount)));
        alreadyReversedAmt = MoneyUtil.add(alreadyReversedAmt, absVal);
      }

      const maxReversible = MoneyUtil.subtract(originalCashbackAmt, alreadyReversedAmt);
      if (MoneyUtil.lessThanOrEqual(maxReversible, '0.0000')) return null;

      let targetCumulativeReversal = '0.0000';
      if (MoneyUtil.greaterThanOrEqual(refundedSubtotalAmount, totalOrderSubtotalAmount)) {
        targetCumulativeReversal = originalCashbackAmt;
      } else {
        const ratio = MoneyUtil.divide(refundedSubtotalAmount, totalOrderSubtotalAmount, 6);
        targetCumulativeReversal = MoneyUtil.multiply(originalCashbackAmt, ratio);
      }

      let reversalAmt = MoneyUtil.subtract(targetCumulativeReversal, alreadyReversedAmt);
      if (MoneyUtil.greaterThan(reversalAmt, maxReversible)) {
        reversalAmt = maxReversible;
      }
      if (MoneyUtil.lessThanOrEqual(reversalAmt, '0.0000')) return null;

      const acc = await em.findOne(CustomerCreditAccount, {
        where: { id: originalEntry.account_id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!acc) return null;

      const newBalance = MoneyUtil.subtract(acc.current_balance, reversalAmt);
      acc.current_balance = newBalance;
      await em.save(CustomerCreditAccount, acc);

      const todayStr = new Date().toISOString().slice(0, 10);
      const entry = em.create(CreditEntry, {
        tenant_id: tenantId,
        account_id: acc.id,
        entry_type: 'LOYALTY_CASHBACK_REVERSAL' as any,
        amount: MoneyUtil.negate(reversalAmt),
        currency_code: currencyCode,
        order_id: orderId,
        related_entry_id: originalEntry.id,
        reason_text: `Customer Club Cashback Reversal due to order refund`,
        reference: `REVERSAL_${orderId}`,
        business_date: todayStr,
        balance_after: newBalance,
      });

      const savedEntry = await em.save(CreditEntry, entry);

      await this.auditWriter.write({
        tenantId,
        actorType: 'SYSTEM',
        action: 'LOYALTY_CASHBACK_REVERSED',
        entityType: 'CreditEntry',
        entityId: savedEntry.id,
        correlationId: `refund_${orderId}`,
        afterData: savedEntry,
        details: { orderId, reversalAmt, originalEntryId: originalEntry.id },
      });

      return savedEntry;
    };

    if (entityManager) {
      return await runner(entityManager);
    } else {
      return await this.dataSource.transaction(async (em) => runner(em));
    }
  }
}
