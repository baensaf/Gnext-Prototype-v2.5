import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { DiscountsService } from '../src/modules/discounts/discounts.service';
import { DiscountEvaluationService } from '../src/modules/discounts/discount-evaluation.service';
import { Coupon } from '../src/entities/Coupon.entity';
import { DiscountUsage } from '../src/entities/DiscountUsage.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { CustomerDiscount } from '../src/entities/CustomerDiscount.entity';
import { Customer } from '../src/entities/Customer.entity';
import { ApprovalRequest } from '../src/entities/ApprovalRequest.entity';
import { Product } from '../src/entities/Product.entity';

/**
 * The engine has three sources, in precedence order — the cashier's manual discount, a
 * one-time coupon, the customer's own rate — and applies at most one of them. Discount
 * campaigns (automatic promotions, scopes, stacking) are not part of the prototype.
 */
describe('Discounts & Evaluation Engine Suite (R11)', () => {
  let service: DiscountsService;
  let evaluationService: DiscountEvaluationService;

  let couponRepo: any;
  let usageRepo: any;
  let settingRepo: any;
  let customerDiscountRepo: any;
  let auditWriter: any;
  let productRepo: any;

  const coupon = (overrides: Partial<Coupon> = {}): Partial<Coupon> => ({
    id: 'cp-1',
    code: 'SAVE10',
    percentage: '10.00',
    minimum_subtotal: null,
    maximum_discount_amount: null,
    is_active: true,
    max_uses: 1,
    uses_count: 0,
    effective_from: null,
    effective_to: null,
    ...overrides,
  });

  beforeEach(async () => {
    couponRepo = { findOne: jest.fn().mockResolvedValue(null), find: jest.fn(), create: jest.fn((v) => v), save: jest.fn((v) => Promise.resolve({ id: 'cp-new', ...v })) };
    usageRepo = { count: jest.fn().mockResolvedValue(0), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    settingRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() };
    customerDiscountRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null), create: jest.fn(), save: jest.fn() };
    auditWriter = { write: jest.fn() };
    productRepo = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscountsService,
        DiscountEvaluationService,
        { provide: getRepositoryToken(Coupon), useValue: couponRepo },
        { provide: getRepositoryToken(DiscountUsage), useValue: usageRepo },
        { provide: getRepositoryToken(CustomerDiscount), useValue: customerDiscountRepo },
        { provide: getRepositoryToken(Customer), useValue: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() } },
        { provide: getRepositoryToken(ApprovalRequest), useValue: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(TenantSetting), useValue: settingRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<DiscountsService>(DiscountsService);
    evaluationService = module.get<DiscountEvaluationService>(DiscountEvaluationService);
  });

  it('applies nothing to an order with no discount source', async () => {
    const result = await evaluationService.evaluateQuote('t-1', {
      orderDraft: { items: [{ productId: 'p-1', unitPrice: '100000.0000', quantity: '1' }] },
    });

    expect(result.discountTotal).toBe('0.0000');
    expect(result.consideredDiscounts).toEqual([]);
  });

  describe('Coupons', () => {
    it("applies the coupon's own percentage and names the coupon it came from", async () => {
      couponRepo.findOne.mockResolvedValue(coupon());

      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: { items: [{ productId: 'p-1', unitPrice: '100000.0000', quantity: '1' }] },
        couponCode: 'SAVE10',
      });

      expect(result.discountTotal).toBe('10000.0000');
      expect(result.consideredDiscounts).toEqual([
        expect.objectContaining({ source: 'COUPON', status: 'APPLIED', couponId: 'cp-1', couponCode: 'SAVE10' }),
      ]);
    });

    it('does not discount items marked NEVER_DISCOUNT', async () => {
      couponRepo.findOne.mockResolvedValue(coupon());

      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: {
          items: [
            { productId: 'p-normal', unitPrice: '100000.0000', quantity: '1' },
            { productId: 'p-never', unitPrice: '200000.0000', quantity: '1', neverDiscount: true },
          ],
        },
        couponCode: 'SAVE10',
      });

      expect(result.subtotal).toBe('300000.0000');
      expect(result.discountTotal).toBe('10000.0000');
      expect(result.grandTotal).toBe('290000.0000');
      expect(result.items[1].discountTotal).toBe('0.0000');
    });

    it('caps the coupon as a whole and keeps the line figures adding up to it', async () => {
      couponRepo.findOne.mockResolvedValue(coupon({ percentage: '50.00', maximum_discount_amount: '30000.0000' }));

      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: {
          items: [
            { productId: 'p-1', unitPrice: '100000.0000', quantity: '1' },
            { productId: 'p-2', unitPrice: '200000.0000', quantity: '1' },
          ],
        },
        couponCode: 'SAVE10',
      });

      // 50% would be 150,000; the cap holds it to 30,000, split 1:2 by line.
      expect(result.discountTotal).toBe('30000.0000');
      expect(result.items[0].discountTotal).toBe('10000.0000');
      expect(result.items[1].discountTotal).toBe('20000.0000');
    });

    it('rejects a coupon below its minimum subtotal', async () => {
      couponRepo.findOne.mockResolvedValue(coupon({ minimum_subtotal: '500000.0000' }));

      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: { items: [{ productId: 'p-1', unitPrice: '100000.0000', quantity: '1' }] },
        couponCode: 'SAVE10',
      });

      expect(result.discountTotal).toBe('0.0000');
      expect(result.consideredDiscounts[0]).toEqual(
        expect.objectContaining({ status: 'REJECTED', rejectionReason: 'COUPON_MINIMUM_NOT_MET' }),
      );
    });

    it('upper-cases the code and rejects a used-up coupon', async () => {
      couponRepo.findOne.mockResolvedValue(coupon({ code: 'SUMMER2026', max_uses: 10, uses_count: 10 }));

      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: { items: [{ productId: 'p-1', unitPrice: '50000.0000', quantity: '1' }] },
        couponCode: ' summer2026 ',
      });

      expect(couponRepo.findOne).toHaveBeenCalledWith({ where: { tenant_id: 't-1', code: 'SUMMER2026' } });
      expect(result.consideredDiscounts).toEqual([
        expect.objectContaining({ status: 'REJECTED', rejectionReason: 'COUPON_MAX_USES_REACHED' }),
      ]);
    });

    it("wins over the customer's own rate, and only one of them applies", async () => {
      couponRepo.findOne.mockResolvedValue(coupon());
      customerDiscountRepo.findOne.mockResolvedValue({ customer_id: 'cust-1', discount_percentage: '20.00', is_active: true });

      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: { customerId: 'cust-1', items: [{ productId: 'p-1', unitPrice: '100000.0000', quantity: '1' }] },
        couponCode: 'SAVE10',
      });

      expect(result.discountTotal).toBe('10000.0000');
      expect(result.consideredDiscounts.filter((d) => d.status === 'APPLIED').map((d) => d.source)).toEqual(['COUPON']);
    });

    it('validates a coupon on the test bench without sending its stand-in line to the database', async () => {
      couponRepo.findOne.mockResolvedValue(coupon({ percentage: '15.00', maximum_discount_amount: '20000.0000' }));

      const result = await service.validateCoupon('t-1', 'SAVE10', '200000');

      // 15% of 200,000 is 30,000; the cap holds it to 20,000.
      expect(result.calculatedAmount).toBe('20000.0000');
      expect(productRepo.find).not.toHaveBeenCalled();
    });

    it('stores the terms on the coupon itself when a one-time coupon is created', async () => {
      await service.createOneTimeCoupon('t-1', { code: 'welcome', percentage: '15', maximum_discount_amount: '50000' });

      expect(couponRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'WELCOME',
          percentage: '15.0000',
          maximum_discount_amount: '50000.0000',
          max_uses: 1,
        }),
      );
      expect(couponRepo.create.mock.calls[0][0]).not.toHaveProperty('campaign_id');
    });
  });

  describe('Section 7.5 — Manual Cashier Discounts & Approvals', () => {
    it('should flag approvalRequired when manual discount percentage exceeds cashier limit', async () => {
      settingRepo.find.mockResolvedValue([{ key: 'DISCOUNTS', value: { cashierMaxDiscountPercent: 15 } }]);

      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: { items: [{ productId: 'p-1', unitPrice: '100000.0000', quantity: '1' }] },
        manualDiscount: { calculation_type: 'PERCENTAGE', value: '25.0000' },
      });

      expect(result.approvalRequired).toBe(true);
      expect(result.approvalReason).toContain('exceeds CASHIER limit');
      expect(result.discountTotal).toBe('0.0000');
    });

    // The audit on 2026-09-16 found an approved 30% discount recorded on the order but never
    // taken off it: the guest was charged 272,500 for a 250,000 burger instead of 190,750.
    it('takes an allowed manual discount off the grand total and taxes the discounted price', async () => {
      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: { items: [{ productId: 'p-1', unitPrice: '250000.0000', quantity: '1', taxRate: '0.0900' }] },
        manualDiscount: { calculation_type: 'PERCENTAGE', value: '30.0000' },
        userRole: 'MANAGER',
      } as any);

      expect(result.discountTotal).toBe('75000.0000');
      expect(result.items[0].discountTotal).toBe('75000.0000');
      expect(result.taxTotal).toBe('15750.0000');
      expect(result.grandTotal).toBe('190750.0000');
    });

    it('spreads a fixed deduction over the discountable lines and leaves NEVER_DISCOUNT lines whole', async () => {
      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: {
          items: [
            { productId: 'p-1', unitPrice: '100000.0000', quantity: '1', taxRate: '0.0900' },
            { productId: 'p-2', unitPrice: '200000.0000', quantity: '1', taxRate: '0.0900' },
            { productId: 'p-never', unitPrice: '50000.0000', quantity: '1', taxRate: '0.0900', neverDiscount: true },
          ],
        },
        manualDiscount: { calculation_type: 'FIXED_AMOUNT', value: '30000.0000' },
      });

      expect(result.discountTotal).toBe('30000.0000');
      expect(result.items.map((i) => i.discountTotal)).toEqual(['10000.0000', '20000.0000', '0.0000']);
      // 350,000 - 30,000 = 320,000, plus 9% VAT on it.
      expect(result.taxTotal).toBe('28800.0000');
      expect(result.grandTotal).toBe('348800.0000');
    });
  });

  describe('Tax calculation', () => {
    it('calculates tax from the discounted line total using the snapshotted product rate', async () => {
      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: {
          items: [{ productId: 'p-1', unitPrice: '150000.0000', quantity: '1', taxRate: '0.0900' }],
        },
      });

      expect(result.subtotal).toBe('150000.0000');
      expect(result.taxTotal).toBe('13500.0000');
      expect(result.grandTotal).toBe('163500.0000');
    });
  });

  describe('Transactional coupon usage', () => {
    const emFor = (row: any) => {
      const qb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(row),
      };
      return {
        qb,
        em: {
          createQueryBuilder: jest.fn().mockReturnValue(qb),
          create: jest.fn((_entity, value) => value),
          save: jest.fn(),
        } as any,
      };
    };

    it('locks the coupon row and refuses the last use twice', async () => {
      const { em, qb } = emFor({ id: 'cp-1', code: 'ONCE', max_uses: 1, uses_count: 1 });

      await expect(evaluationService.consumeUsage('t-1', 'ord-1', 'cust-1', 'cp-1', '10000.0000', em)).rejects.toThrow(
        ConflictException,
      );
      expect(qb.setLock).toHaveBeenCalledWith('pessimistic_write');
    });

    it('counts the use on the coupon and records who redeemed it', async () => {
      const row = { id: 'cp-1', code: 'ONCE', max_uses: 1, uses_count: 0 };
      const { em } = emFor(row);

      await evaluationService.consumeUsage('t-1', 'ord-1', 'cust-1', 'cp-1', '10000', em);

      expect(row.uses_count).toBe(1);
      expect(em.create).toHaveBeenCalledWith(
        DiscountUsage,
        expect.objectContaining({ coupon_id: 'cp-1', customer_id: 'cust-1', order_id: 'ord-1', amount: '10000.0000' }),
      );
    });
  });
});
