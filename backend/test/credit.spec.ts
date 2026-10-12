import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreditService } from '../src/modules/customer/credit.service';
import { CustomerCreditAccount } from '../src/entities/CustomerCreditAccount.entity';
import { CreditEntry } from '../src/entities/CreditEntry.entity';
import { Customer } from '../src/entities/Customer.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';

describe('Customer Credit Subledger Suite (R14)', () => {
  let service: CreditService;
  let accountRepo: any;
  let entryRepo: any;
  let customerRepo: any;
  let auditWriter: any;
  let dataSource: any;

  beforeEach(async () => {
    accountRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), find: jest.fn().mockResolvedValue([]), createQueryBuilder: jest.fn() };
    entryRepo = { find: jest.fn().mockResolvedValue([]) };
    customerRepo = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };
    auditWriter = { write: jest.fn() };

    const mockEntityManager: any = {
      create: jest.fn((entityClass, data) => ({ ...data })),
      save: jest.fn((entityClass, data) => Promise.resolve(data || entityClass)),
      findOne: jest.fn((entityClass, options) => {
        if (entityClass === Customer) return customerRepo.findOne(options);
        if (entityClass === CustomerCreditAccount) return accountRepo.findOne(options);
        return null;
      }),
      find: jest.fn((entityClass, options) => {
        if (entityClass === CreditEntry) return entryRepo.find(options);
        return [];
      }),
    };

    dataSource = {
      transaction: jest.fn(async (cb) => await cb(mockEntityManager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CreditService,
        { provide: getRepositoryToken(CustomerCreditAccount), useValue: accountRepo },
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<CreditService>(CreditService);
  });

  describe('Credit Account Creation & Available Credit Calculation (R14)', () => {
    it('should calculate available credit as max(0, limit + balance) for FINITE mode', () => {
      const acc: any = {
        mode: 'FINITE',
        credit_limit: '100000.0000',
        current_balance: '-30000.0000',
      };
      // 100,000 + (-30,000) = 70,000 available
      expect(service.calculateAvailableCredit(acc)).toBe('70000.0000');
    });

    it('should throw ConflictException if customer already has a credit account for currency', async () => {
      customerRepo.findOne.mockResolvedValue({ id: 'c-1' });
      accountRepo.findOne.mockResolvedValue({ id: 'acc-1', currency_code: 'IRR' });

      await expect(
        service.createAccount('t-1', 'c-1', { currencyCode: 'IRR', mode: 'FINITE', creditLimit: '100000.0000' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Signed Postings & Credit Limit Enforcement (R14)', () => {
    it('should post purchase as a negative signed CreditEntry and update running balance', async () => {
      const acc = { id: 'acc-1', tenant_id: 't-1', currency_code: 'IRR', mode: 'FINITE', credit_limit: '100000.0000', current_balance: '0.0000' };
      accountRepo.findOne.mockResolvedValue(acc);

      const entry = await service.postPurchase('t-1', 'acc-1', { orderId: 'ord-1', amount: '40000.0000' });
      expect(entry.amount).toBe('-40000.0000');
      expect(entry.balance_after).toBe('-40000.0000');
      expect(acc.current_balance).toBe('-40000.0000');
    });

    it('should throw ForbiddenException CREDIT_LIMIT_EXCEEDED if purchase exceeds available credit', async () => {
      const acc = { id: 'acc-1', tenant_id: 't-1', currency_code: 'IRR', mode: 'FINITE', credit_limit: '50000.0000', current_balance: '-20000.0000' };
      accountRepo.findOne.mockResolvedValue(acc);

      // Available = 30,000. Attempting purchase of 40,000
      await expect(
        service.postPurchase('t-1', 'acc-1', { orderId: 'ord-1', amount: '40000.0000' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should post repayment as positive signed CreditEntry and increase running balance', async () => {
      const acc = { id: 'acc-1', tenant_id: 't-1', currency_code: 'IRR', mode: 'FINITE', credit_limit: '100000.0000', current_balance: '-40000.0000' };
      accountRepo.findOne.mockResolvedValue(acc);

      const res = await service.postRepayment('t-1', 'acc-1', { amount: '40000.0000' });
      expect(res.entry.amount).toBe('40000.0000');
      expect(res.newBalance).toBe('0.0000');
    });
  });

  describe('Repayments', () => {
    it('should refuse a repayment bigger than what the customer owes', async () => {
      const acc = { id: 'acc-1', tenant_id: 't-1', currency_code: 'IRR', mode: 'FINITE', credit_limit: '100000.0000', current_balance: '-40000.0000' };
      accountRepo.findOne.mockResolvedValue(acc);

      await expect(service.postRepayment('t-1', 'acc-1', { amount: '50000.0000' })).rejects.toThrow(BadRequestException);
      expect(acc.current_balance).toBe('-40000.0000');
    });

    it('should refuse a repayment on an account that owes nothing', async () => {
      const acc = { id: 'acc-1', tenant_id: 't-1', currency_code: 'IRR', mode: 'FINITE', credit_limit: '100000.0000', current_balance: '0.0000' };
      accountRepo.findOne.mockResolvedValue(acc);

      await expect(service.postRepayment('t-1', 'acc-1', { amount: '10000.0000' })).rejects.toThrow(BadRequestException);
    });
  });

  // Cashback is the customer's money, credit is theirs to repay: two accounts since 2026-10-12.
  describe('The wallet, apart from credit', () => {
    it('opens a wallet with no credit limit on the first cashback, never a credit line', async () => {
      accountRepo.findOne.mockResolvedValue(null);

      const entry = await service.awardLoyaltyCashback('t-1', 'c-1', 'ord-1', '100000.0000', '5.00');

      expect(accountRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ kind: 'WALLET' }) }));
      expect(entry?.amount).toBe('5000.0000');
      expect(entry?.balance_after).toBe('5000.0000');
    });

    it('spends no more than the wallet holds', async () => {
      const wallet = { id: 'w-1', tenant_id: 't-1', currency_code: 'IRR', kind: 'WALLET', mode: 'FINITE', credit_limit: null, current_balance: '30000.0000' };
      accountRepo.findOne.mockResolvedValue(wallet);

      await expect(service.postPurchase('t-1', 'w-1', { orderId: 'ord-1', amount: '40000.0000' })).rejects.toThrow(ForbiddenException);
      const entry = await service.postPurchase('t-1', 'w-1', { orderId: 'ord-1', amount: '30000.0000' });
      expect(entry.balance_after).toBe('0.0000');
    });

    it('is not repaid and has no limit to set', async () => {
      const wallet = { id: 'w-1', tenant_id: 't-1', currency_code: 'IRR', kind: 'WALLET', mode: 'FINITE', credit_limit: null, current_balance: '-10000.0000' };
      accountRepo.findOne.mockResolvedValue(wallet);

      await expect(service.postRepayment('t-1', 'w-1', { amount: '10000.0000' })).rejects.toThrow(BadRequestException);
      await expect(service.updateAccount('t-1', 'w-1', { creditLimit: '50000' })).rejects.toThrow(BadRequestException);
    });

    it('takes back only the cashback still in the wallet when the order is refunded', async () => {
      const wallet = { id: 'w-1', tenant_id: 't-1', currency_code: 'IRR', kind: 'WALLET', mode: 'FINITE', credit_limit: null, current_balance: '1000.0000' };
      accountRepo.findOne.mockResolvedValue(wallet);
      dataSource.transaction.mockImplementationOnce(async (cb: any) =>
        cb({
          findOne: jest.fn((entityClass: any) =>
            entityClass === CreditEntry
              ? { id: 'e-1', account_id: 'w-1', order_id: 'ord-1', entry_type: 'LOYALTY_CASHBACK', amount: '5000.0000' }
              : wallet,
          ),
          find: jest.fn().mockResolvedValue([]),
          create: jest.fn((_: any, data: any) => ({ ...data })),
          save: jest.fn((_: any, data: any) => Promise.resolve(data)),
          query: jest.fn().mockResolvedValue([]),
        }),
      );

      const reversal = await service.reverseLoyaltyCashback('t-1', 'ord-1', '100000.0000', '100000.0000');

      expect(reversal?.amount).toBe('-1000.0000');
      expect(wallet.current_balance).toBe('0.0000');
    });
  });

  describe('Account with its transactions', () => {
    it('should list the transactions newest first', async () => {
      accountRepo.findOne.mockResolvedValue({
        id: 'acc-1',
        customer_id: 'c-1',
        mode: 'FINITE',
        credit_limit: '100000.0000',
        current_balance: '-30000.0000',
        entries: [
          { id: 'e-1', posted_at: new Date('2026-10-01T10:00:00Z') },
          { id: 'e-2', posted_at: new Date('2026-10-02T10:00:00Z') },
        ],
      });
      customerRepo.findOne.mockResolvedValue({ id: 'c-1', code: 'C1', first_name: 'Ali', last_name: 'Rezai' });

      const acc = await service.getAccountById('t-1', 'acc-1');
      expect(acc.entries.map((e: any) => e.id)).toEqual(['e-2', 'e-1']);
      expect(acc.availableCredit).toBe('70000.0000');
    });
  });
});
