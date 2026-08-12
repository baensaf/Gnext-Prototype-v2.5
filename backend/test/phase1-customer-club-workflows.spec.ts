import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';

import { DiscountsService } from '../src/modules/discounts/discounts.service';
import { DiscountEvaluationService } from '../src/modules/discounts/discount-evaluation.service';
import { CreditService } from '../src/modules/customer/credit.service';

import { Discount } from '../src/entities/Discount.entity';
import { DiscountCampaign } from '../src/entities/DiscountCampaign.entity';
import { DiscountScope } from '../src/entities/DiscountScope.entity';
import { Coupon } from '../src/entities/Coupon.entity';
import { DiscountUsage } from '../src/entities/DiscountUsage.entity';
import { CustomerDiscount } from '../src/entities/CustomerDiscount.entity';
import { Customer } from '../src/entities/Customer.entity';
import { CustomerCreditAccount } from '../src/entities/CustomerCreditAccount.entity';
import { CreditEntry } from '../src/entities/CreditEntry.entity';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { ApprovalRequest } from '../src/entities/ApprovalRequest.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';

describe('Phase 1 Customer Club, Discounts & Coupons Workflows (Spec)', () => {
  let discountsService: DiscountsService;
  let evaluationService: DiscountEvaluationService;
  let creditService: CreditService;

  let customerDiscountRepo: any;
  let customerRepo: any;
  let couponRepo: any;
  let campaignRepo: any;
  let discountRepo: any;
  let scopeRepo: any;
  let usageRepo: any;
  let settingRepo: any;
  let approvalRequestRepo: any;
  let creditAccountRepo: any;
  let creditEntryRepo: any;
  let auditWriter: any;
  let dataSourceMock: any;

  const tenantId = '00000000-0000-0000-0000-000000000001';
  const customerA = '11111111-1111-1111-1111-111111111111';

  beforeEach(async () => {
    customerDiscountRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'cd-1', ...entity, created_at: new Date() })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    customerRepo = {
      findOne: jest.fn().mockResolvedValue({ id: customerA, first_name: 'Alice', last_name: 'Smith' }),
    };

    couponRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'coup-1', ...entity })),
    };

    campaignRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entity) => Promise.resolve({ id: 'camp-1', ...entity })),
    };

    discountRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null) };
    scopeRepo = { find: jest.fn().mockResolvedValue([]) };
    usageRepo = { find: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) };
    settingRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null) };
    approvalRequestRepo = { findOne: jest.fn().mockResolvedValue(null) };

    creditAccountRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'acc-1', customer_id: customerA, current_balance: '0.0000', currency_code: 'IRR', status: 'ACTIVE' }),
      save: jest.fn().mockImplementation((acc) => Promise.resolve(acc)),
    };

    creditEntryRepo = {
      create: jest.fn().mockImplementation((dto) => dto),
      save: jest.fn().mockImplementation((entry) => Promise.resolve({ id: 'entry-1', ...entry })),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
    };

    dataSourceMock = {
      transaction: jest.fn().mockImplementation(async (cb) => {
        const mockEntityManager = {
          findOne: jest.fn().mockImplementation((entityClass, options) => {
            if (entityClass === CustomerCreditAccount) return creditAccountRepo.findOne(options);
            if (entityClass === CreditEntry) return creditEntryRepo.findOne(options);
            if (entityClass === Customer) return customerRepo.findOne(options);
            return null;
          }),
          find: jest.fn().mockImplementation((entityClass, options) => {
            if (entityClass === CreditEntry) return creditEntryRepo.find(options);
            return [];
          }),
          save: jest.fn().mockImplementation((entityClassOrObj, obj) => {
            const target = obj !== undefined ? obj : entityClassOrObj;
            if (target?.customer_id) return creditAccountRepo.save(target);
            return creditEntryRepo.save(target);
          }),
          create: jest.fn().mockImplementation((entityClass, dto) => creditEntryRepo.create(dto)),
        };
        return await cb(mockEntityManager);
      }),
    };

    auditWriter = { write: jest.fn().mockResolvedValue(true) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        DiscountsService,
        DiscountEvaluationService,
        CreditService,
        { provide: getRepositoryToken(CustomerDiscount), useValue: customerDiscountRepo },
        { provide: getRepositoryToken(Customer), useValue: customerRepo },
        { provide: getRepositoryToken(Coupon), useValue: couponRepo },
        { provide: getRepositoryToken(DiscountCampaign), useValue: campaignRepo },
        { provide: getRepositoryToken(Discount), useValue: discountRepo },
        { provide: getRepositoryToken(DiscountScope), useValue: scopeRepo },
        { provide: getRepositoryToken(DiscountUsage), useValue: usageRepo },
        { provide: getRepositoryToken(TenantSetting), useValue: settingRepo },
        { provide: getRepositoryToken(ApprovalRequest), useValue: approvalRequestRepo },
        { provide: getRepositoryToken(CustomerCreditAccount), useValue: creditAccountRepo },
        { provide: getRepositoryToken(CreditEntry), useValue: creditEntryRepo },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: DataSource, useValue: dataSourceMock },
      ],
    }).compile();

    discountsService = moduleRef.get<DiscountsService>(DiscountsService);
    evaluationService = moduleRef.get<DiscountEvaluationService>(DiscountEvaluationService);
    creditService = moduleRef.get<CreditService>(CreditService);
  });

  describe('Workflow 1: Customer-Specific Discounts', () => {
    it('creates customer-specific discount assignment', async () => {
      const assign = await discountsService.createCustomerDiscount(tenantId, {
        customer_id: customerA,
        discount_percentage: '10.00',
        note: 'Loyalty tier 1',
      }, 'user-admin-1');

      expect(assign).toBeDefined();
      expect(assign.discount_percentage).toBe('10.0000');
      expect(assign.created_by).toBe('user-admin-1');
    });

    it('rejects percentage > 100 or <= 0', async () => {
      await expect(
        discountsService.createCustomerDiscount(tenantId, { customer_id: customerA, discount_percentage: '150.00' }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        discountsService.createCustomerDiscount(tenantId, { customer_id: customerA, discount_percentage: '0.00' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects effective_from > effective_to', async () => {
      await expect(
        discountsService.createCustomerDiscount(tenantId, {
          customer_id: customerA,
          discount_percentage: '15.00',
          effective_from: '2026-12-31T00:00:00Z',
          effective_to: '2026-01-01T00:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('evaluates customer-specific discount entitlement on order quote', async () => {
      customerDiscountRepo.findOne.mockResolvedValueOnce({
        id: 'cd-1',
        customer_id: customerA,
        discount_percentage: '10.00',
        is_active: true,
      });

      const quote = await evaluationService.evaluateQuote(tenantId, {
        orderDraft: {
          customerId: customerA,
          items: [{ productId: 'item-1', unitPrice: '100000.0000', quantity: '1' }],
        },
      });

      expect(quote.discountTotal).toBe('10000.0000');
      expect(quote.grandTotal).toBe('90000.0000');
      const applied = quote.consideredDiscounts.find((d) => d.status === 'APPLIED');
      expect(applied?.discountType).toBe('CUSTOMER_DISCOUNT');
    });
  });

  describe('Workflow 2: Purchase-Based Cashback & Wallet', () => {
    it('calculates and posts 5% cashback on completed paid subtotal', async () => {
      const entry = await creditService.awardLoyaltyCashback(
        tenantId,
        customerA,
        'order-101',
        '90000.0000',
        '5.00',
        'IRR',
      );

      expect(entry).toBeDefined();
      expect(entry?.entry_type).toBe('LOYALTY_CASHBACK');
      expect(entry?.amount).toBe('4500.0000');
    });

    it('reverses cashback proportionally on partial order refund', async () => {
      creditEntryRepo.findOne.mockResolvedValueOnce({
        id: 'entry-1',
        account_id: 'acc-1',
        order_id: 'order-101',
        entry_type: 'LOYALTY_CASHBACK',
        amount: '4500.0000',
      });

      // Partial refund of 50% of subtotal (45000 out of 90000)
      const revEntry = await creditService.reverseLoyaltyCashback(
        tenantId,
        'order-101',
        '45000.0000',
        '90000.0000',
        'IRR',
      );

      expect(revEntry).toBeDefined();
      expect(revEntry?.entry_type).toBe('LOYALTY_CASHBACK_REVERSAL');
      expect(revEntry?.amount).toBe('-2250.0000');
    });
  });

  describe('Workflow 3: Role-Based Cashier Manual Discounts', () => {
    it('allows Cashier manual discount up to 10%', async () => {
      const quote = await evaluationService.evaluateQuote(tenantId, {
        orderDraft: {
          items: [{ productId: 'prod-1', unitPrice: '100000.0000', quantity: '1' }],
        },
        manualDiscount: { calculation_type: 'PERCENTAGE', value: '10' },
      });

      expect(quote.approvalRequired).toBeFalsy();
      expect(quote.discountTotal).toBe('10000.0000');
    });

    it('requires Manager PIN approval for discount exceeding Cashier limit (e.g. 15%)', async () => {
      const quote = await evaluationService.evaluateQuote(tenantId, {
        orderDraft: {
          items: [{ productId: 'prod-1', unitPrice: '100000.0000', quantity: '1' }],
        },
        manualDiscount: { calculation_type: 'PERCENTAGE', value: '15' },
      });

      expect(quote.approvalRequired).toBe(true);
      expect(quote.approvalReason).toContain('exceeds CASHIER limit');
    });

    it('rejects fake / unapproved approvalRequestId for escalation', async () => {
      approvalRequestRepo.findOne.mockResolvedValueOnce(null);

      const quote = await evaluationService.evaluateQuote(tenantId, {
        orderDraft: {
          items: [{ productId: 'prod-1', unitPrice: '100000.0000', quantity: '1' }],
        },
        manualDiscount: { calculation_type: 'PERCENTAGE', value: '15', approvalRequestId: 'fake-uuid-123' },
      });

      const rejected = quote.consideredDiscounts.find((d) => d.status === 'REJECTED');
      expect(rejected).toBeDefined();
      expect(rejected?.rejectionReason).toContain('Invalid or unapproved escalation approval request');
    });

    it('accepts valid APPROVED approvalRequestId for escalation', async () => {
      approvalRequestRepo.findOne.mockResolvedValueOnce({
        id: 'real-app-1',
        tenant_id: tenantId,
        status: 'APPROVED',
        expires_at: new Date(Date.now() + 3600000),
      });

      const quote = await evaluationService.evaluateQuote(tenantId, {
        orderDraft: {
          items: [{ productId: 'prod-1', unitPrice: '100000.0000', quantity: '1' }],
        },
        manualDiscount: { calculation_type: 'PERCENTAGE', value: '15', approvalRequestId: 'real-app-1' },
      });

      expect(quote.discountTotal).toBe('15000.0000');
      const applied = quote.consideredDiscounts.find((d) => d.status === 'APPLIED');
      expect(applied).toBeDefined();
    });

    it('rejects manual discount exceeding maximum permitted manager limit (30%)', async () => {
      const quote = await evaluationService.evaluateQuote(tenantId, {
        orderDraft: {
          items: [{ productId: 'prod-1', unitPrice: '100000.0000', quantity: '1' }],
        },
        manualDiscount: { calculation_type: 'PERCENTAGE', value: '50' },
      });

      const rejected = quote.consideredDiscounts.find((d) => d.status === 'REJECTED');
      expect(rejected).toBeDefined();
      expect(rejected?.rejectionReason).toContain('Exceeds maximum permitted policy limit');
    });
  });

  describe('Workflow 4: One-Time Percentage Coupon Codes', () => {
    it('creates a unique one-time percentage coupon code', async () => {
      const coupon = await discountsService.createOneTimeCoupon(tenantId, {
        code: 'ONE15',
        percentage: '15.00',
        minimum_subtotal: '50000.0000',
      });

      expect(coupon).toBeDefined();
      expect(coupon.code).toBe('ONE15');
      expect(coupon.max_uses).toBe(1);
    });
  });
});
