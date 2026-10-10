import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DiscountsService } from '../src/modules/discounts/discounts.service';
import { DiscountEvaluationService } from '../src/modules/discounts/discount-evaluation.service';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { CustomerDiscount } from '../src/entities/CustomerDiscount.entity';
import { Customer } from '../src/entities/Customer.entity';
import { ApprovalRequest } from '../src/entities/ApprovalRequest.entity';
import { Product } from '../src/entities/Product.entity';

/**
 * After the automatic item discounts, the engine has two order discount sources, in
 * precedence order — the cashier's manual discount, the customer's own rate — and applies at
 * most one of them. Discount campaigns (automatic promotions, scopes, stacking) and coupons
 * are not part of the prototype.
 */
describe('Discounts & Evaluation Engine Suite (R11)', () => {
  let service: DiscountsService;
  let evaluationService: DiscountEvaluationService;

  let settingRepo: any;
  let customerDiscountRepo: any;
  let auditWriter: any;
  let productRepo: any;

  beforeEach(async () => {
    settingRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() };
    customerDiscountRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null), create: jest.fn(), save: jest.fn() };
    auditWriter = { write: jest.fn() };
    productRepo = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscountsService,
        DiscountEvaluationService,
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

  describe("The customer's own rate", () => {
    const item = { productId: 'p-1', unitPrice: '100000.0000', quantity: '1' };

    it('applies when the cashier gave no discount, and names where it came from', async () => {
      customerDiscountRepo.findOne.mockResolvedValue({ customer_id: 'cust-1', discount_percentage: '20.00', is_active: true });

      const result = await evaluationService.evaluateQuote('t-1', { orderDraft: { customerId: 'cust-1', items: [item] } });

      expect(result.discountTotal).toBe('20000.0000');
      expect(result.consideredDiscounts).toEqual([expect.objectContaining({ source: 'CUSTOMER', status: 'APPLIED' })]);
    });

    it("gives way to the cashier's own discount, and only one of them applies", async () => {
      customerDiscountRepo.findOne.mockResolvedValue({ customer_id: 'cust-1', discount_percentage: '20.00', is_active: true });

      const result = await evaluationService.evaluateQuote(
        't-1',
        {
          orderDraft: { customerId: 'cust-1', items: [item] },
          manualDiscount: { calculation_type: 'PERCENTAGE', value: '5.0000' },
        },
        'CASHIER',
      );

      expect(result.discountTotal).toBe('5000.0000');
      expect(result.consideredDiscounts.filter((d) => d.status === 'APPLIED').map((d) => d.source)).toEqual(['MANUAL']);
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
      }, 'MANAGER');

      expect(result.discountTotal).toBe('75000.0000');
      expect(result.items[0].discountTotal).toBe('75000.0000');
      expect(result.taxTotal).toBe('15750.0000');
      expect(result.grandTotal).toBe('190750.0000');
    });

    // The register read its own copy of these (10% / 50,000 and a 30% / 300,000 ceiling), so a
    // change at head office left the POS and the server disagreeing.
    it("answers the caller's own limit and the ceiling from head office's Discount Authorizations", async () => {
      settingRepo.find.mockResolvedValue([
        { key: 'DISCOUNT_AUTHORIZATIONS', branch_id: null, value: { cashierMaxPct: 5, cashierMaxFixed: 20000, managerMaxPct: 40, managerMaxFixed: 2000000 } },
      ]);

      await expect(evaluationService.getManualDiscountLimits('t-1', 'cashier')).resolves.toEqual({
        role: 'CASHIER',
        own: { pct: '5', maxFixed: '20000' },
        ceiling: { pct: '40', maxFixed: '2000000' },
      });
      await expect(evaluationService.getManualDiscountLimits('t-1', 'MANAGER')).resolves.toMatchObject({ own: { pct: '40', maxFixed: '2000000' } });
      // A system administrator or owner is head office, not a register.
      await expect(evaluationService.getManualDiscountLimits('t-1', 'SUPER_ADMIN')).resolves.toMatchObject({ own: { pct: '100' } });
      await expect(evaluationService.getManualDiscountLimits('t-1', 'OWNER')).resolves.toMatchObject({ own: { pct: '100' } });
    });

    it("holds a discount to the signed-in account's role, not one named in the request", async () => {
      const quote = (role?: string) =>
        evaluationService.evaluateQuote('t-1', {
          orderDraft: { items: [{ productId: 'p-1', unitPrice: '100000.0000', quantity: '1' }] },
          manualDiscount: { calculation_type: 'PERCENTAGE', value: '20.0000' },
        }, role);

      expect((await quote()).approvalRequired).toBe(true);
      expect((await quote('CASHIER')).approvalRequired).toBe(true);
      const manager = await quote('MANAGER');
      expect(manager.approvalRequired).toBe(false);
      expect(manager.discountTotal).toBe('20000.0000');
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
});
