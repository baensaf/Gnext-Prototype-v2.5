import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DiscountsService } from '../src/modules/discounts/discounts.service';
import { DiscountEvaluationService } from '../src/modules/discounts/discount-evaluation.service';
import { PersonalDiscountsService } from '../src/modules/discounts/personal-discounts.service';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { CustomerDiscount } from '../src/entities/CustomerDiscount.entity';
import { Customer } from '../src/entities/Customer.entity';
import { ApprovalRequest } from '../src/entities/ApprovalRequest.entity';
import { Product } from '../src/entities/Product.entity';

/**
 * After the automatic item discounts, the engine has two order discount sources, in
 * precedence order — the cashier's manual discount, the person's personal discount group — and applies at
 * most one of them. Discount campaigns (automatic promotions, scopes, stacking) and coupons
 * are not part of the prototype.
 */
describe('Discounts & Evaluation Engine Suite (R11)', () => {
  let service: DiscountsService;
  let evaluationService: DiscountEvaluationService;

  let settingRepo: any;
  let customerDiscountRepo: any;
  let personal: any;
  let auditWriter: any;
  let productRepo: any;

  beforeEach(async () => {
    settingRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() };
    customerDiscountRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn().mockResolvedValue(null), create: jest.fn(), save: jest.fn() };
    auditWriter = { write: jest.fn() };
    productRepo = { find: jest.fn().mockResolvedValue([]) };
    personal = {
      forCustomer: jest.fn().mockResolvedValue(null),
      usage: jest.fn().mockResolvedValue({ uses: 0, covered: '0.0000', monthStart: '2026-09-23' }),
      left: PersonalDiscountsService.prototype.left,
    };

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
        { provide: PersonalDiscountsService, useValue: personal },
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

  describe("The person's personal discount group", () => {
    const item = { productId: 'p-1', unitPrice: '100000.0000', quantity: '1' };
    const drink = { productId: 'p-2', categoryId: 'cat-drinks', unitPrice: '50000.0000', quantity: '1' };
    const drinksExcluded = () =>
      settingRepo.find.mockImplementation(async ({ where }: any) =>
        where?.key === 'DISCOUNT_AUTHORIZATIONS' ? [{ key: 'DISCOUNT_AUTHORIZATIONS', value: { familyExcludedCategoryIds: ['cat-drinks'] } }] : [],
      );
    const group = (fields: Record<string, unknown> = {}) => ({
      id: 'g-1',
      name: 'Branch staff',
      percent: '20.00',
      monthly_cap: null,
      uses_per_month: null,
      per_visit_cap: null,
      any_branch: false,
      is_active: true,
      ...fields,
    });
    const inGroup = (fields: Record<string, unknown> = {}, homeBranch = 'b-1') =>
      personal.forCustomer.mockResolvedValue({ assignment: { customer_id: 'cust-1', branch_id: homeBranch }, group: group(fields) });
    const used = (uses: number, covered: string) => personal.usage.mockResolvedValue({ uses, covered, monthStart: '2026-09-23' });
    const quote = (items: any[] = [item], extra: Record<string, unknown> = {}) =>
      evaluationService.evaluateQuote('t-1', { orderDraft: { customerId: 'cust-1', branchId: 'b-1', items, ...extra } });

    it('applies at the branch the person works at, and names their group', async () => {
      inGroup();

      const result = await quote();

      expect(result.discountTotal).toBe('20000.0000');
      expect(result.consideredDiscounts).toEqual([
        expect.objectContaining({ source: 'CUSTOMER', status: 'APPLIED', percent: '20.00', name: 'Branch staff 20%' }),
      ]);
      expect(personal.forCustomer).toHaveBeenCalledWith('t-1', 'cust-1');
    });

    it('is refused at another branch when the group is for their own branch only', async () => {
      inGroup({}, 'b-2');

      const result = await quote();

      expect(result.discountTotal).toBe('0.0000');
      expect(result.consideredDiscounts[0]).toEqual(
        expect.objectContaining({ status: 'REJECTED', personal: expect.objectContaining({ refusal: 'OTHER_BRANCH' }) }),
      );
    });

    it('works at any branch when the group says so', async () => {
      inGroup({ any_branch: true }, 'b-2');

      expect((await quote()).discountTotal).toBe('20000.0000');
    });

    it('is not looked up without the branch the order is at', async () => {
      const result = await evaluationService.evaluateQuote('t-1', { orderDraft: { customerId: 'cust-1', items: [item] } });

      expect(result.discountTotal).toBe('0.0000');
      expect(personal.forCustomer).not.toHaveBeenCalled();
    });

    it('stays off when the cashier took it off the order', async () => {
      inGroup();

      expect((await quote([item], { skipCustomerDiscount: true })).discountTotal).toBe('0.0000');
    });

    it("leaves head office's excluded categories at full price", async () => {
      drinksExcluded();
      inGroup();

      const result = await quote([item, drink]);

      expect(result.discountTotal).toBe('20000.0000');
      expect(result.items[1].discountTotal).toBe('0.0000');
    });

    it('covers an order only up to the cap per visit; the rest is full price', async () => {
      inGroup({ percent: '25.00', per_visit_cap: '250000.0000' });

      const result = await quote([{ productId: 'p-1', unitPrice: '400000.0000', quantity: '1' }]);

      expect(result.discountTotal).toBe('62500.0000');
      expect(result.consideredDiscounts[0]).toEqual(
        expect.objectContaining({ maxDiscount: '62500.0000', personal: expect.objectContaining({ covered: '250000.0000', partial: true }) }),
      );
    });

    it("covers no more than what is left of the month's cap", async () => {
      inGroup({ percent: '25.00', monthly_cap: '1000000.0000', per_visit_cap: '250000.0000', uses_per_month: 4 });
      used(3, '900000.0000');

      const result = await quote([{ productId: 'p-1', unitPrice: '400000.0000', quantity: '1' }]);

      expect(result.discountTotal).toBe('25000.0000');
      expect(result.consideredDiscounts[0].personal).toEqual(expect.objectContaining({ usesLeft: 0, monthLeft: '0.0000' }));
    });

    it('is refused once the month has had its orders', async () => {
      inGroup({ uses_per_month: 4 });
      used(4, '100000.0000');

      const result = await quote();

      expect(result.discountTotal).toBe('0.0000');
      expect(result.consideredDiscounts[0].personal?.refusal).toBe('USES_SPENT');
    });

    it("is refused once the month's cap is spent", async () => {
      inGroup({ monthly_cap: '500000.0000' });
      used(2, '500000.0000');

      const result = await quote();

      expect(result.discountTotal).toBe('0.0000');
      expect(result.consideredDiscounts[0].personal?.refusal).toBe('MONTH_SPENT');
    });

    it('leaves the order being priced out of what the month has used', async () => {
      inGroup();

      await quote([item], { orderId: 'o-1' });

      expect(personal.usage).toHaveBeenCalledWith('t-1', 'cust-1', 'o-1');
    });

    it('excludes the same categories from a cashier discount given as a personal discount, and only that one', async () => {
      drinksExcluded();
      const family = await evaluationService.evaluateQuote(
        't-1',
        { orderDraft: { items: [item, drink] }, manualDiscount: { calculation_type: 'PERCENTAGE', value: '10', reasonCode: 'FRIENDS_FAMILY' } },
        'CASHIER',
      );
      const other = await evaluationService.evaluateQuote(
        't-1',
        { orderDraft: { items: [item, drink] }, manualDiscount: { calculation_type: 'PERCENTAGE', value: '10', reasonCode: 'CUSTOMER_SATISFACTION' } },
        'CASHIER',
      );

      expect(family.discountTotal).toBe('10000.0000');
      expect(other.discountTotal).toBe('15000.0000');
    });

    it("gives way to the cashier's own discount, and only one of them applies", async () => {
      inGroup();

      const result = await evaluationService.evaluateQuote(
        't-1',
        {
          orderDraft: { customerId: 'cust-1', branchId: 'b-1', items: [item] },
          manualDiscount: { calculation_type: 'PERCENTAGE', value: '5.0000' },
        },
        'CASHIER',
      );

      expect(result.discountTotal).toBe('5000.0000');
      expect(result.consideredDiscounts.filter((d) => d.status === 'APPLIED').map((d) => d.source)).toEqual(['MANUAL']);
      expect(personal.forCustomer).not.toHaveBeenCalled();
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
