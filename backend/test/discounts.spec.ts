import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DiscountsService } from '../src/modules/discounts/discounts.service';
import { DiscountEvaluationService } from '../src/modules/discounts/discount-evaluation.service';
import { Discount } from '../src/entities/Discount.entity';
import { DiscountCampaign } from '../src/entities/DiscountCampaign.entity';
import { DiscountScope } from '../src/entities/DiscountScope.entity';
import { Coupon } from '../src/entities/Coupon.entity';
import { DiscountUsage } from '../src/entities/DiscountUsage.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { CustomerDiscount } from '../src/entities/CustomerDiscount.entity';
import { Customer } from '../src/entities/Customer.entity';
import { ApprovalRequest } from '../src/entities/ApprovalRequest.entity';
import { DiscountType, ScopeType } from '../src/modules/discounts/dtos/discounts.dto';

describe('Discounts & Evaluation Engine Suite (R11)', () => {
  let service: DiscountsService;
  let evaluationService: DiscountEvaluationService;

  let discountRepo: any;
  let campaignRepo: any;
  let scopeRepo: any;
  let couponRepo: any;
  let usageRepo: any;
  let settingRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    discountRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    campaignRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(), softRemove: jest.fn() };
    scopeRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(), remove: jest.fn() };
    couponRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    usageRepo = { count: jest.fn().mockResolvedValue(0), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    settingRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscountsService,
        DiscountEvaluationService,
        { provide: getRepositoryToken(Discount), useValue: discountRepo },
        { provide: getRepositoryToken(DiscountCampaign), useValue: campaignRepo },
        { provide: getRepositoryToken(DiscountScope), useValue: scopeRepo },
        { provide: getRepositoryToken(Coupon), useValue: couponRepo },
        { provide: getRepositoryToken(DiscountUsage), useValue: usageRepo },
        { provide: getRepositoryToken(CustomerDiscount), useValue: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(Customer), useValue: { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() } },
        { provide: getRepositoryToken(ApprovalRequest), useValue: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(TenantSetting), useValue: settingRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<DiscountsService>(DiscountsService);
    evaluationService = module.get<DiscountEvaluationService>(DiscountEvaluationService);
  });

  describe('Section 7.4 Rule 1 & 2 — Candidate Scopes & Product Policies', () => {
    it('should reject campaign if draft matches an exclusion scope (Exclusion scope ALWAYS wins)', async () => {
      const exclusionCampaign: Partial<DiscountCampaign> = {
        id: 'camp-excl',
        code: 'NO_ONLINE_DISCOUNT',
        name: 'No Online Discount',
        discount_type: 'PERCENTAGE',
        percentage: '10.00',
        priority: 30,
        is_active: true,
        scopes: [
          {
            id: 'sc-1',
            tenant_id: 't-1',
            campaign_id: 'camp-excl',
            scope_type: 'CHANNEL' as ScopeType,
            scope_id: 'ONLINE',
            is_exclusion: true,
            created_at: new Date(),
            campaign: null as any,
          },
        ],
      };

      campaignRepo.find.mockResolvedValue([exclusionCampaign]);

      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: {
          items: [{ productId: 'p-1', unitPrice: '100000.0000', quantity: '1' }],
          channel: 'ONLINE',
        },
      });

      expect(result.discountTotal).toBe('0.0000');
      expect(result.consideredDiscounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            campaignCode: 'NO_ONLINE_DISCOUNT',
            status: 'REJECTED',
            rejectionReason: 'EXCLUDED_BY_SCOPE',
          }),
        ]),
      );
    });

    it('should not discount items marked NEVER_DISCOUNT', async () => {
      const campaign: Partial<DiscountCampaign> = {
        id: 'camp-10pct',
        code: 'AUTOSAVE10',
        name: '10% Auto Discount',
        discount_type: 'PERCENTAGE',
        percentage: '10.00',
        priority: 30,
        is_active: true,
        scopes: [],
      };

      campaignRepo.find.mockResolvedValue([campaign]);

      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: {
          items: [
            { productId: 'p-normal', unitPrice: '100000.0000', quantity: '1' },
            { productId: 'p-never', unitPrice: '200000.0000', quantity: '1', neverDiscount: true },
          ],
        },
      });

      // Discount applies only to normal item (10% of 100,000 = 10,000)
      expect(result.subtotal).toBe('300000.0000');
      expect(result.discountTotal).toBe('10000.0000');
      expect(result.grandTotal).toBe('290000.0000');
      expect(result.items[1].discountTotal).toBe('0.0000');
    });
  });

  describe('Section 7.4 Rule 4, 5 & 6 — Sequential Percentage & Proportional Fixed Allocation', () => {
    it('should apply stackable percentage discounts sequentially to remaining line basis', async () => {
      const campaign1: Partial<DiscountCampaign> = {
        id: 'c-10',
        code: 'DISC10',
        name: '10% Discount',
        discount_type: 'PERCENTAGE',
        percentage: '10.00',
        priority: 10,
        is_stackable: true,
        stacking_group: 'DEFAULT',
        is_active: true,
        scopes: [],
      };

      const campaign2: Partial<DiscountCampaign> = {
        id: 'c-20',
        code: 'DISC20',
        name: 'Second 10% Discount',
        discount_type: 'PERCENTAGE',
        percentage: '10.00',
        priority: 20,
        is_stackable: true,
        stacking_group: 'DEFAULT',
        is_active: true,
        scopes: [],
      };

      campaignRepo.find.mockResolvedValue([campaign1, campaign2]);

      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: {
          items: [{ productId: 'p-1', unitPrice: '100000.0000', quantity: '1' }],
        },
      });

      // Item 100,000:
      // First 10% -> 10,000 discount (basis left 90,000)
      // Second 10% -> 9,000 discount (basis left 81,000)
      // Total discount = 19,000 (not 20,000)
      expect(result.discountTotal).toBe('19000.0000');
      expect(result.grandTotal).toBe('81000.0000');
    });

    it('should allocate fixed discount proportionally across eligible remaining line bases with exact sum precision', async () => {
      const fixedCampaign: Partial<DiscountCampaign> = {
        id: 'c-fixed',
        code: 'FIXED30K',
        name: '30,000 IRR Fixed Discount',
        discount_type: 'FIXED_AMOUNT',
        amount: '30000.0000',
        priority: 30,
        is_stackable: true,
        is_active: true,
        scopes: [],
      };

      campaignRepo.find.mockResolvedValue([fixedCampaign]);

      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: {
          items: [
            { productId: 'p-1', unitPrice: '100000.0000', quantity: '1' },
            { productId: 'p-2', unitPrice: '200000.0000', quantity: '1' },
          ],
        },
      });

      // Subtotal = 300,000 IRR
      // p-1 ratio = 100k/300k = 1/3 -> 10,000 IRR discount
      // p-2 ratio = 200k/300k = 2/3 -> 20,000 IRR discount
      // Total line discounts sum = 30,000 IRR
      expect(result.subtotal).toBe('300000.0000');
      expect(result.discountTotal).toBe('30000.0000');
      expect(result.items[0].discountTotal).toBe('10000.0000');
      expect(result.items[1].discountTotal).toBe('20000.0000');
    });
  });

  describe('Section 7.4 Rule 10 — Free Delivery Campaigns', () => {
    it('should discount delivery fee capped to delivery fee amount without affecting items', async () => {
      const freeDelCampaign: Partial<DiscountCampaign> = {
        id: 'c-freedel',
        code: 'FREEDEL',
        name: 'Free Delivery',
        discount_type: 'FREE_DELIVERY',
        priority: 30,
        is_active: true,
        scopes: [],
      };

      campaignRepo.find.mockResolvedValue([freeDelCampaign]);

      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: {
          items: [{ productId: 'p-1', unitPrice: '100000.0000', quantity: '1' }],
          deliveryFee: '25000.0000',
        },
      });

      expect(result.subtotal).toBe('100000.0000');
      expect(result.deliveryFee).toBe('0.0000');
      expect(result.discountTotal).toBe('25000.0000');
      expect(result.grandTotal).toBe('100000.0000');
    });
  });

  describe('Section 7.4 Rule 3 — Coupon Upper-Casing & Validation', () => {
    it('should upper-case coupon code and validate usage limit', async () => {
      couponRepo.findOne.mockResolvedValue({
        id: 'cp-1',
        code: 'SUMMER2026',
        campaign_id: 'camp-summer',
        is_active: true,
        max_uses: 10,
        uses_count: 10, // Exhausted
      });

      campaignRepo.find.mockResolvedValue([]);

      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: { items: [{ productId: 'p-1', unitPrice: '50000.0000', quantity: '1' }] },
        couponCode: ' summer2026 ', // whitespace + lowercase
      });

      expect(couponRepo.findOne).toHaveBeenCalledWith({
        where: { tenant_id: 't-1', code: 'SUMMER2026' },
      });
      expect(result.consideredDiscounts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: 'REJECTED',
            rejectionReason: 'COUPON_MAX_USES_REACHED',
          }),
        ]),
      );
    });
  });

  describe('Section 7.5 — Manual Cashier Discounts & Approvals', () => {
    it('should flag approvalRequired when manual discount percentage exceeds cashier limit', async () => {
      settingRepo.find.mockResolvedValue([
        {
          key: 'DISCOUNTS',
          value: { cashierMaxDiscountPercent: 15 },
        },
      ]);
      campaignRepo.find.mockResolvedValue([]);

      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: { items: [{ productId: 'p-1', unitPrice: '100000.0000', quantity: '1' }] },
        manualDiscount: { calculation_type: 'PERCENTAGE', value: '25.0000' }, // 25% > 15% limit
      });

      expect(result.approvalRequired).toBe(true);
      expect(result.approvalReason).toContain('exceeds CASHIER limit');
      expect(result.discountTotal).toBe('0.0000');
    });
  });

  describe('Tax calculation', () => {
    it('calculates tax from the discounted line total using the snapshotted product rate', async () => {
      campaignRepo.find.mockResolvedValue([]);

      const result = await evaluationService.evaluateQuote('t-1', {
        orderDraft: {
          items: [{
            productId: 'p-1',
            unitPrice: '150000.0000',
            quantity: '1',
            taxRate: '0.0900',
          }],
        },
      });

      expect(result.subtotal).toBe('150000.0000');
      expect(result.taxTotal).toBe('13500.0000');
      expect(result.grandTotal).toBe('163500.0000');
    });
  });

  describe('Transactional Usage Locking', () => {
    it('should lock campaign row and throw ConflictException if usage limit is reached during submission', async () => {
      const mockQb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 'camp-1',
          code: 'LIMIT1',
          usage_limit_total: 5,
          usage_count: 5, // reached
        }),
      };

      const mockEm: any = {
        createQueryBuilder: jest.fn().mockReturnValue(mockQb),
        save: jest.fn(),
      };

      await expect(
        evaluationService.consumeUsage('t-1', 'ord-1', 'cust-1', ['camp-1'], undefined, '10000.0000', mockEm),
      ).rejects.toThrow(ConflictException);
    });
  });
});
