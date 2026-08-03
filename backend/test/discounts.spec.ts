import { Test, TestingModule } from '@nestjs/testing';
import { DiscountsService } from '../src/modules/discounts/discounts.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Discount } from '../src/entities/Discount.entity';
import { Coupon } from '../src/entities/Coupon.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { BadRequestException } from '@nestjs/common';

describe('DiscountsService (Unit)', () => {
  let service: DiscountsService;
  let discountRepo: any;
  let couponRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    discountRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    couponRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscountsService,
        { provide: getRepositoryToken(Discount), useValue: discountRepo },
        { provide: getRepositoryToken(Coupon), useValue: couponRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<DiscountsService>(DiscountsService);
  });

  it('should validate active coupon and calculate fixed amount discount', async () => {
    couponRepo.findOne.mockResolvedValue({
      id: 'c-1',
      code: 'WELCOME500K',
      discount_id: 'd-1',
      is_active: true,
      current_redemptions: 0,
      max_redemptions: 100,
    });

    discountRepo.findOne.mockResolvedValue({
      id: 'd-1',
      code: 'DISC-COUPON-500K',
      calculation_type: 'FIXED_AMOUNT',
      value: '500000.0000',
      min_order_total: '1000000.0000',
      is_active: true,
    });

    const result = await service.validateCoupon('t-1', 'WELCOME500K', '1500000.0000');
    expect(result.isValid).toBe(true);
    expect(result.calculatedAmount).toBe('500000.0000');
  });

  it('should throw BadRequestException when order total is less than min_order_total', async () => {
    couponRepo.findOne.mockResolvedValue({
      id: 'c-1',
      code: 'WELCOME500K',
      discount_id: 'd-1',
      is_active: true,
    });

    discountRepo.findOne.mockResolvedValue({
      id: 'd-1',
      code: 'DISC-COUPON-500K',
      calculation_type: 'FIXED_AMOUNT',
      value: '500000.0000',
      min_order_total: '1000000.0000',
      is_active: true,
    });

    await expect(service.validateCoupon('t-1', 'WELCOME500K', '800000.0000')).rejects.toThrow(BadRequestException);
  });
});
