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
    entryRepo = { find: jest.fn().mockResolvedValue([]), create: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() };
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
        { provide: getRepositoryToken(CreditEntry), useValue: entryRepo },
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
      const acc = { id: 'acc-1', tenant_id: 't-1', currency_code: 'IRR', mode: 'FINITE', credit_limit: '100000.0000', current_balance: '0.0000', status: 'ACTIVE', is_blocked: false };
      accountRepo.findOne.mockResolvedValue(acc);

      const entry = await service.postPurchase('t-1', 'acc-1', { orderId: 'ord-1', amount: '40000.0000' });
      expect(entry.amount).toBe('-40000.0000');
      expect(entry.balance_after).toBe('-40000.0000');
      expect(acc.current_balance).toBe('-40000.0000');
    });

    it('should throw ForbiddenException CREDIT_LIMIT_EXCEEDED if purchase exceeds available credit without approval', async () => {
      const acc = { id: 'acc-1', tenant_id: 't-1', currency_code: 'IRR', mode: 'FINITE', credit_limit: '50000.0000', current_balance: '-20000.0000', status: 'ACTIVE', is_blocked: false };
      accountRepo.findOne.mockResolvedValue(acc);

      // Available = 30,000. Attempting purchase of 40,000
      await expect(
        service.postPurchase('t-1', 'acc-1', { orderId: 'ord-1', amount: '40000.0000' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should post repayment as positive signed CreditEntry and increase running balance', async () => {
      const acc = { id: 'acc-1', tenant_id: 't-1', currency_code: 'IRR', mode: 'FINITE', credit_limit: '100000.0000', current_balance: '-40000.0000', status: 'ACTIVE' };
      accountRepo.findOne.mockResolvedValue(acc);

      const res = await service.postRepayment('t-1', 'acc-1', { amount: '40000.0000' });
      expect(res.entry.amount).toBe('40000.0000');
      expect(res.newBalance).toBe('0.0000');
    });
  });

  describe('FIFO Aging & Account Statements (R14)', () => {
    it('should calculate FIFO aging buckets for active credit accounts', async () => {
      accountRepo.find.mockResolvedValue([
        { id: 'acc-1', customer_id: 'cust-1', current_balance: '-50000.0000', status: 'ACTIVE' },
      ]);
      entryRepo.find.mockResolvedValue([
        { id: 'e-1', amount: '-50000.0000', posted_at: new Date() },
      ]);

      const aging = await service.getCreditAging('t-1', {});
      expect(aging.totals.totalOutstanding).toBe('50000.0000');
      expect(aging.totals.current).toBe('50000.0000');
      expect(aging.customers.length).toBe(1);
    });
  });

  describe('BUG-02: Customer Credit Ledger Popup (postCreditTransaction)', () => {
    it('should post CHARGE transaction as positive adjustment to credit account', async () => {
      const acc = { id: 'acc-1', tenant_id: 't-1', customer_id: 'c-1', currency_code: 'IRR', mode: 'FINITE', credit_limit: '100000.0000', current_balance: '10000.0000', status: 'ACTIVE' };
      accountRepo.findOne.mockResolvedValue(acc);

      const res = await service.postCreditTransaction('t-1', 'c-1', {
        transaction_type: 'CHARGE',
        amount: '50000.0000',
        note: 'Wallet top-up',
      });

      expect(res.transaction).toBeDefined();
      expect(res.transaction.amount).toBe('50000.0000');
      expect(res.newBalance).toBe('60000.0000');
      expect(res.transaction.transaction_type).toBe('CHARGE');
    });

    it('should post DEBIT transaction as negative adjustment to credit account', async () => {
      const acc = { id: 'acc-1', tenant_id: 't-1', customer_id: 'c-1', currency_code: 'IRR', mode: 'FINITE', credit_limit: '100000.0000', current_balance: '60000.0000', status: 'ACTIVE' };
      accountRepo.findOne.mockResolvedValue(acc);

      const res = await service.postCreditTransaction('t-1', 'c-1', {
        transaction_type: 'DEBIT',
        amount: '20000.0000',
        note: 'Manual debit',
      });

      expect(res.transaction).toBeDefined();
      expect(res.transaction.amount).toBe('-20000.0000');
      expect(res.newBalance).toBe('40000.0000');
    });

    it('should auto-create credit account if customer exists and account does not exist yet', async () => {
      accountRepo.findOne.mockResolvedValue(null);
      customerRepo.findOne.mockResolvedValue({ id: 'c-new', tenant_id: 't-1', credit_limit: '50000.0000' });

      const res = await service.postCreditTransaction('t-1', 'c-new', {
        transaction_type: 'CHARGE',
        amount: '15000.0000',
      });

      expect(res.account).toBeDefined();
      expect(res.newBalance).toBe('15000.0000');
    });
  });
});
