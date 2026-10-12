import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager, In } from 'typeorm';
import { AccountKind, CustomerCreditAccount } from '../../entities/CustomerCreditAccount.entity';
import { CreditEntry } from '../../entities/CreditEntry.entity';
import { Customer } from '../../entities/Customer.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { MoneyUtil } from '../../common/utils/money.util';
import { loadBusinessClock } from '../../common/utils/business-clock';
import {
  CreditAccountCreateDto,
  CreditAccountUpdateDto,
  CreditRepaymentDto,
  CreditPurchaseDto,
} from './dtos/credit.dto';

@Injectable()
export class CreditService {
  constructor(
    @InjectRepository(CustomerCreditAccount)
    private readonly accountRepo: Repository<CustomerCreditAccount>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    private readonly auditWriter: AuditWriter,
    private readonly dataSource: DataSource,
  ) {}

  // What can be spent from the account now: the wallet's balance, or what is left of the
  // credit limit.
  calculateAvailableCredit(account: CustomerCreditAccount): string {
    if (account.kind === 'WALLET') {
      return MoneyUtil.greaterThan(account.current_balance, '0.0000') ? account.current_balance : '0.0000';
    }
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

    // The credit page and the wallet page each list their own kind; credit when not said.
    if (query.kind !== 'ALL') qb.andWhere('a.kind = :kind', { kind: query.kind === 'WALLET' ? 'WALLET' : 'CREDIT' });
    if (query.customer) qb.andWhere('a.customer_id = :customer', { customer: query.customer });
    if (query.currency && query.currency !== 'ALL') qb.andWhere('a.currency_code = :currency', { currency: query.currency });
    if (query.mode && query.mode !== 'ALL') qb.andWhere('a.mode = :mode', { mode: query.mode });

    qb.orderBy('a.created_at', 'DESC');
    const page = parseInt(query.page || '1', 10);
    const limit = parseInt(query.limit || '100', 10);
    qb.skip((page - 1) * limit).take(limit);

    const [accounts, total] = await qb.getManyAndCount();

    const customerIds = accounts.map((a) => a.customer_id).filter(Boolean);
    const customers = customerIds.length > 0 && typeof this.customerRepo?.find === 'function'
      ? await this.customerRepo.find({ where: { tenant_id: tenantId, id: In(customerIds) } })
      : [];
    const customerMap = new Map(customers.map((c) => [c.id, c]));

    const data = accounts.map((acc) => {
      const cust = customerMap.get(acc.customer_id);
      return {
        ...acc,
        customer: cust
          ? {
              id: cust.id,
              code: cust.code,
              first_name: cust.first_name,
              last_name: cust.last_name,
              name: `${cust.first_name} ${cust.last_name}`.trim(),
              mobile: cust.mobile,
              email: cust.email,
            }
          : null,
        availableCredit: this.calculateAvailableCredit(acc),
      };
    });

    return { data, total, page, limit };
  }

  // The account with its transactions, newest first: the one list a credit screen reads.
  async getAccountById(tenantId: string, id: string) {
    const acc = await this.accountRepo.findOne({
      where: { id, tenant_id: tenantId },
      relations: ['entries'],
    });
    if (!acc) throw new NotFoundException(`Credit account ${id} not found`);
    acc.entries = [...(acc.entries || [])].sort(
      (a, b) => new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime(),
    );

    const customer = await this.customerRepo.findOne({
      where: { id: acc.customer_id, tenant_id: tenantId },
    });

    return {
      ...acc,
      customer: customer
        ? {
            id: customer.id,
            code: customer.code,
            first_name: customer.first_name,
            last_name: customer.last_name,
            name: `${customer.first_name} ${customer.last_name}`.trim(),
            mobile: customer.mobile,
            email: customer.email,
          }
        : null,
      availableCredit: this.calculateAvailableCredit(acc),
    };
  }

  async getAccountByCustomer(
    tenantId: string,
    customerId: string,
    currencyCode: string = 'IRR',
    entityManager?: EntityManager,
    kind: AccountKind = 'CREDIT',
  ) {
    const repo = entityManager ? entityManager.getRepository(CustomerCreditAccount) : this.accountRepo;
    const acc = await repo.findOne({
      where: { tenant_id: tenantId, customer_id: customerId, currency_code: currencyCode, kind },
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
        where: { tenant_id: tenantId, customer_id: customerId, currency_code: currencyCode, kind: 'CREDIT' },
      });
      if (existing) {
        throw new ConflictException(`Customer already has a credit account for currency ${currencyCode}`);
      }

      const limit = mode === 'UNLIMITED' ? null : MoneyUtil.format(dto.creditLimit || '0.0000');

      const acc = em.create(CustomerCreditAccount, {
        tenant_id: tenantId,
        customer_id: customerId,
        currency_code: currencyCode,
        kind: 'CREDIT',
        mode,
        credit_limit: limit,
        current_balance: '0.0000',
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

  // The limit, and the mode it works in. Lowering a limit below what is already owed is fine:
  // it only stops the next sale on credit.
  async updateAccount(tenantId: string, id: string, dto: CreditAccountUpdateDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      const acc = await em.findOne(CustomerCreditAccount, { where: { id, tenant_id: tenantId } });
      if (!acc) throw new NotFoundException(`Credit account ${id} not found`);
      if (acc.kind === 'WALLET') throw new BadRequestException('A wallet has no credit limit');

      if (dto.mode !== undefined) acc.mode = dto.mode;
      if (dto.policyNote !== undefined) acc.policy_note = dto.policyNote;
      if (dto.creditLimit !== undefined && acc.mode !== 'UNLIMITED') {
        acc.credit_limit = MoneyUtil.format(dto.creditLimit);
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

  // The rule a purchase has to satisfy, on an account the caller already loaded: a positive
  // amount that fits inside the available credit. Throws rather than returning a verdict so
  // both callers fail the same way; it reads no state of its own, which is what lets the
  // payment layer run it as a precheck.
  assertPurchaseAllowed(acc: CustomerCreditAccount, amount: string) {
    const purchaseAmount = MoneyUtil.format(amount);
    if (MoneyUtil.lessThanOrEqual(purchaseAmount, '0.0000')) {
      throw new BadRequestException('Purchase amount must be greater than zero');
    }

    const available = this.calculateAvailableCredit(acc);
    if (acc.kind === 'WALLET' && MoneyUtil.greaterThan(purchaseAmount, available)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'WALLET_BALANCE_SHORT',
        code: 'WALLET_BALANCE_SHORT',
        message: `Payment (${purchaseAmount}) is more than the wallet holds (${available})`,
      });
    }
    if (acc.kind !== 'WALLET' && acc.mode !== 'UNLIMITED' && MoneyUtil.greaterThan(purchaseAmount, available)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'CREDIT_LIMIT_EXCEEDED',
        code: 'CREDIT_LIMIT_EXCEEDED',
        message: `Purchase amount (${purchaseAmount}) exceeds available credit (${available})`,
      });
    }
  }

  // Same guard, resolved from the customer instead of a known account id. Used to vet a
  // credit tender before anything is written; deliberately skips the entries relation and
  // the row lock that postPurchase takes, since nothing is mutated.
  async assertCustomerPurchaseAllowed(
    tenantId: string,
    customerId: string,
    currencyCode: string,
    amount: string,
    entityManager?: EntityManager,
    kind: AccountKind = 'CREDIT',
  ) {
    const repo = entityManager
      ? entityManager.getRepository(CustomerCreditAccount)
      : this.accountRepo;
    const acc = await repo.findOne({
      where: { tenant_id: tenantId, customer_id: customerId, currency_code: currencyCode, kind },
    });
    if (!acc) {
      throw new NotFoundException(
        kind === 'WALLET' ? `Customer ${customerId} has no wallet` : `No credit account found for customer ${customerId}`,
      );
    }

    this.assertPurchaseAllowed(acc, amount);
    return acc;
  }

  async postPurchase(tenantId: string, accountId: string, dto: CreditPurchaseDto, userId?: string, entityManager?: EntityManager) {
    const execute = async (em: EntityManager) => {
      const acc = await em.findOne(CustomerCreditAccount, {
        where: { id: accountId, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!acc) throw new NotFoundException(`Credit account ${accountId} not found`);

      // Re-checked under the row lock: the precheck at intent time is advisory, and the
      // balance can move between the two.
      this.assertPurchaseAllowed(acc, dto.amount);
      const purchaseAmount = MoneyUtil.format(dto.amount);

      const signedAmount = `-${purchaseAmount}`;
      const newBalance = MoneyUtil.add(acc.current_balance, signedAmount);

      const dateStr = dto.businessDate || (await loadBusinessClock(em, tenantId)).today();

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

  // Unwinds the PURCHASE entry a CUSTOMER_CREDIT payment posted, so reversing the payment
  // also gives the customer their credit back. Distinct from postRepayment: the customer
  // paid nothing here, so this must not show up in the transactions as a settlement.
  async reversePurchase(
    tenantId: string,
    paymentId: string,
    reason?: string,
    userId?: string,
    correlationId?: string,
    entityManager?: EntityManager,
  ) {
    const execute = async (em: EntityManager) => {
      const originalEntry = await em.findOne(CreditEntry, {
        where: { tenant_id: tenantId, payment_id: paymentId, entry_type: 'PURCHASE' as any },
      });
      if (!originalEntry) return null;

      // Idempotent: a payment can only be reversed once, but the caller may retry.
      const existingReversal = await em.findOne(CreditEntry, {
        where: { tenant_id: tenantId, payment_id: paymentId, entry_type: 'REVERSAL' as any },
      });
      if (existingReversal) return existingReversal;

      const acc = await em.findOne(CustomerCreditAccount, {
        where: { id: originalEntry.account_id, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!acc) return null;

      // The PURCHASE was stored negative, so the reversal is its positive counterpart.
      const reversalAmount = MoneyUtil.abs(originalEntry.amount);
      const newBalance = MoneyUtil.add(acc.current_balance, reversalAmount);

      const entry = em.create(CreditEntry, {
        tenant_id: tenantId,
        account_id: acc.id,
        entry_type: 'REVERSAL' as any,
        amount: reversalAmount,
        currency_code: originalEntry.currency_code,
        order_id: originalEntry.order_id,
        payment_id: paymentId,
        related_entry_id: originalEntry.id,
        reason_text: reason || 'Customer credit payment reversed',
        reference: `REVERSAL_${paymentId}`,
        business_date: (await loadBusinessClock(em, tenantId)).today(),
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
        action: 'CREDIT_PURCHASE_REVERSED',
        entityType: 'CreditEntry',
        entityId: savedEntry.id,
        correlationId: correlationId || 'system',
        afterData: savedEntry,
        details: { paymentId, originalEntryId: originalEntry.id, reversalAmount },
      });

      return savedEntry;
    };

    if (entityManager) return await execute(entityManager);
    return await this.dataSource.transaction(execute);
  }

  // A repayment brings the balance back toward zero; it never takes it past zero, so an
  // account does not turn into a prepaid wallet by being over-paid.
  async postRepayment(
    tenantId: string,
    accountId: string,
    dto: CreditRepaymentDto,
    userId?: string,
    correlationId?: string,
    entityManager?: EntityManager,
  ) {
    const execute = async (em: EntityManager) => {
      const acc = await em.findOne(CustomerCreditAccount, {
        where: { id: accountId, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!acc) throw new NotFoundException(`Credit account ${accountId} not found`);
      if (acc.kind === 'WALLET') throw new BadRequestException('A wallet is not repaid; it is spent at the till');

      const repaymentAmount = MoneyUtil.format(dto.amount);
      if (MoneyUtil.lessThanOrEqual(repaymentAmount, '0.0000')) {
        throw new BadRequestException('Repayment amount must be greater than zero');
      }

      const signedAmount = repaymentAmount;
      const newBalance = MoneyUtil.add(acc.current_balance, signedAmount);

      if (MoneyUtil.greaterThan(newBalance, '0.0000')) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'REPAYMENT_EXCEEDS_BALANCE_OWED',
          message: 'A repayment cannot be more than the customer owes',
        });
      }

      const dateStr = (await loadBusinessClock(em, tenantId)).today();

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
    };

    if (entityManager) return await execute(entityManager);
    return await this.dataSource.transaction(execute);
  }

  // Cashback goes to the customer's wallet, opened on the first award. Never to the credit
  // account: earning cashback must not pay off a debt or open a credit line.
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
        where: { tenant_id: tenantId, customer_id: customerId, currency_code: currencyCode, kind: 'WALLET' },
        lock: { mode: 'pessimistic_write' },
      });

      if (!acc) {
        acc = em.create(CustomerCreditAccount, {
          tenant_id: tenantId,
          customer_id: customerId,
          currency_code: currencyCode,
          kind: 'WALLET',
          mode: 'FINITE',
          credit_limit: null as any,
          current_balance: '0.0000',
        });
        acc = await em.save(CustomerCreditAccount, acc);
      }

      const newBalance = MoneyUtil.add(acc.current_balance, cashbackAmt);
      acc.current_balance = newBalance;
      await em.save(CustomerCreditAccount, acc);

      const todayStr = (await loadBusinessClock(em, tenantId)).today();
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
        const absVal = MoneyUtil.abs(rev.amount);
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

      // Cashback already spent stays spent: the wallet never goes below zero.
      if (acc.kind === 'WALLET' && MoneyUtil.greaterThan(reversalAmt, acc.current_balance)) {
        reversalAmt = MoneyUtil.greaterThan(acc.current_balance, '0.0000') ? acc.current_balance : '0.0000';
      }
      if (MoneyUtil.lessThanOrEqual(reversalAmt, '0.0000')) return null;

      const newBalance = MoneyUtil.subtract(acc.current_balance, reversalAmt);
      acc.current_balance = newBalance;
      await em.save(CustomerCreditAccount, acc);

      const todayStr = (await loadBusinessClock(em, tenantId)).today();
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