import { Test, TestingModule } from '@nestjs/testing';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { OptionGroup } from '../src/entities/OptionGroup.entity';
import { OptionItem } from '../src/entities/OptionItem.entity';
import { ProductOptionGroup } from '../src/entities/ProductOptionGroup.entity';
import { PriceGroup } from '../src/entities/PriceGroup.entity';
import { PriceGroupItem } from '../src/entities/PriceGroupItem.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';

describe('CatalogService (Unit)', () => {
  let service: CatalogService;
  let prodRepo: any;
  let prodGroupRepo: any;
  let priceItemRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    prodRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(), softRemove: jest.fn() };
    prodGroupRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    priceItemRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: getRepositoryToken(Category), useValue: { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(Product), useValue: prodRepo },
        { provide: getRepositoryToken(OptionGroup), useValue: { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(OptionItem), useValue: { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(ProductOptionGroup), useValue: prodGroupRepo },
        { provide: getRepositoryToken(PriceGroup), useValue: { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(PriceGroupItem), useValue: priceItemRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<CatalogService>(CatalogService);
  });

  it('should return base_price when no priceGroup override exists', async () => {
    prodRepo.findOne.mockResolvedValue({ id: 'p-1', base_price: '1500000.0000' });
    priceItemRepo.findOne.mockResolvedValue(null);

    const result = await service.getEffectivePrice('t-1', 'p-1', 'pg-1');
    expect(result.effective_price).toBe('1500000.0000');
    expect(result.is_overridden).toBe(false);
  });

  it('should return override_price when priceGroup override exists', async () => {
    prodRepo.findOne.mockResolvedValue({ id: 'p-1', base_price: '1500000.0000' });
    priceItemRepo.findOne.mockResolvedValue({ override_price: '1300000.0000' });

    const result = await service.getEffectivePrice('t-1', 'p-1', 'pg-vip');
    expect(result.effective_price).toBe('1300000.0000');
    expect(result.is_overridden).toBe(true);
  });
});
