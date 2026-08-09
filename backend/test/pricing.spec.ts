import { Test, TestingModule } from '@nestjs/testing';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PriceEntry } from '../src/entities/PriceEntry.entity';
import { PriceGroupBranch } from '../src/entities/PriceGroupBranch.entity';
import { PriceBulkJob } from '../src/entities/PriceBulkJob.entity';
import { Product } from '../src/entities/Product.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { DataSource } from 'typeorm';
import { ConflictException, BadRequestException } from '@nestjs/common';

describe('PricingService (Unit - Section 7 Precedence & Effective Boundaries)', () => {
  let service: PricingService;
  let entryRepo: any;
  let pgbRepo: any;
  let bulkJobRepo: any;
  let prodRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    entryRepo = {
      createQueryBuilder: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    pgbRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    bulkJobRepo = { create: jest.fn(), save: jest.fn() };
    prodRepo = { findOne: jest.fn(), find: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingService,
        { provide: getRepositoryToken(PriceEntry), useValue: entryRepo },
        { provide: getRepositoryToken(PriceGroupBranch), useValue: pgbRepo },
        { provide: getRepositoryToken(PriceBulkJob), useValue: bulkJobRepo },
        { provide: getRepositoryToken(Product), useValue: prodRepo },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: DataSource, useValue: {} },
      ],
    }).compile();

    service = module.get<PricingService>(PricingService);
  });

  it('should resolve BRANCH+CHANNEL+ORDER_TYPE price over BRANCH or BASE', async () => {
    const mockEntries: any[] = [
      { id: 'pe-base', branch_id: null, price_group_id: null, price_type: 'BASE', amount: '100.0000', effective_from: new Date('2026-01-01') },
      { id: 'pe-branch', branch_id: 'b-1', price_group_id: null, channel: null, order_type: null, amount: '120.0000', effective_from: new Date('2026-01-01') },
      { id: 'pe-full', branch_id: 'b-1', channel: 'DELIVERY', order_type: 'ONLINE', amount: '150.0000', effective_from: new Date('2026-01-01') },
    ];

    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(mockEntries),
    };
    entryRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.resolvePrice('t-1', {
      productId: 'p-1',
      branchId: 'b-1',
      channel: 'DELIVERY',
      orderType: 'ONLINE',
      evalTime: new Date('2026-06-01'),
    });

    expect(result.amount).toBe('150.0000');
    expect(result.priceEntryId).toBe('pe-full');
    expect(result.resolutionSource).toBe('BRANCH');
  });

  it('should prefer variant-specific price entry over product-level entry at same precedence level', async () => {
    const mockEntries: any[] = [
      { id: 'pe-product', branch_id: 'b-1', variant_id: null, amount: '120.0000', effective_from: new Date('2026-01-01') },
      { id: 'pe-variant', branch_id: 'b-1', variant_id: 'v-99', amount: '140.0000', effective_from: new Date('2026-01-01') },
    ];

    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(mockEntries),
    };
    entryRepo.createQueryBuilder.mockReturnValue(qb);

    const result = await service.resolvePrice('t-1', {
      productId: 'p-1',
      variantId: 'v-99',
      branchId: 'b-1',
    });

    expect(result.amount).toBe('140.0000');
    expect(result.priceEntryId).toBe('pe-variant');
  });

  it('should reject overlapping temporal ranges with HTTP 409 Conflict', async () => {
    const mockOverlapping: any[] = [
      { id: 'pe-1', effective_from: new Date('2026-01-01'), effective_to: new Date('2026-12-31') },
    ];

    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(mockOverlapping),
    };
    entryRepo.createQueryBuilder.mockReturnValue(qb);

    await expect(
      service.createPriceEntry('t-1', {
        product_id: 'p-1',
        amount: '200.0000',
        effective_from: new Date('2026-06-01'),
        effective_to: new Date('2026-08-01'),
      }, 'corr-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('should reject negative price amounts with HTTP 400 Bad Request', async () => {
    await expect(
      service.createPriceEntry('t-1', {
        product_id: 'p-1',
        amount: '-50.0000',
      }, 'corr-1'),
    ).rejects.toThrow(BadRequestException);
  });
});
