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
import { Menu } from '../src/entities/Menu.entity';
import { MenuCategory } from '../src/entities/MenuCategory.entity';
import { MenuProduct } from '../src/entities/MenuProduct.entity';
import { ProductAvailability } from '../src/entities/ProductAvailability.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';

describe('CatalogService (Unit)', () => {
  let service: CatalogService;
  let prodRepo: any;
  let prodGroupRepo: any;
  let priceItemRepo: any;
  let menuRepo: any;
  let menuCatRepo: any;
  let menuProdRepo: any;
  let availRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    prodRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(), softRemove: jest.fn() };
    prodGroupRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    priceItemRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    menuRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(), softRemove: jest.fn() };
    menuCatRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    menuProdRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    availRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
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
        { provide: getRepositoryToken(Menu), useValue: menuRepo },
        { provide: getRepositoryToken(MenuCategory), useValue: menuCatRepo },
        { provide: getRepositoryToken(MenuProduct), useValue: menuProdRepo },
        { provide: getRepositoryToken(ProductAvailability), useValue: availRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<CatalogService>(CatalogService);
  });

  it('should return base_price when no priceGroup or menu override exists', async () => {
    prodRepo.findOne.mockResolvedValue({ id: 'p-1', base_price: '1500000.0000' });
    menuRepo.find.mockResolvedValue([]);
    priceItemRepo.findOne.mockResolvedValue(null);
    availRepo.findOne.mockResolvedValue(null);

    const result = await service.getEffectivePrice('t-1', 'p-1', 'pg-1');
    expect(result.effective_price).toBe('1500000.0000');
    expect(result.is_overridden).toBe(false);
    expect(result.resolution_source).toBe('BASE_PRICE');
  });

  it('should return override_price when priceGroup override exists', async () => {
    prodRepo.findOne.mockResolvedValue({ id: 'p-1', base_price: '1500000.0000' });
    menuRepo.find.mockResolvedValue([]);
    priceItemRepo.findOne.mockResolvedValue({ override_price: '1300000.0000' });
    availRepo.findOne.mockResolvedValue(null);

    const result = await service.getEffectivePrice('t-1', 'p-1', 'pg-vip');
    expect(result.effective_price).toBe('1300000.0000');
    expect(result.is_overridden).toBe(true);
    expect(result.resolution_source).toBe('PRICE_GROUP');
  });

  it('should prioritize menu override over priceGroup override', async () => {
    prodRepo.findOne.mockResolvedValue({ id: 'p-1', base_price: '1500000.0000' });
    menuRepo.find.mockResolvedValue([{ id: 'm-1', branch_id: 'b-1', channel: 'DELIVERY', is_active: true }]);
    menuProdRepo.findOne.mockResolvedValue({ override_price: '1100000.0000' });
    priceItemRepo.findOne.mockResolvedValue({ override_price: '1300000.0000' });
    availRepo.findOne.mockResolvedValue(null);

    const result = await service.getEffectivePrice('t-1', 'p-1', 'pg-vip', 'b-1', 'DELIVERY');
    expect(result.effective_price).toBe('1100000.0000');
    expect(result.is_overridden).toBe(true);
    expect(result.resolution_source).toBe('MENU_OVERRIDE');
  });

  it('should indicate item suspension when ProductAvailability is suspended', async () => {
    prodRepo.findOne.mockResolvedValue({ id: 'p-1', base_price: '1500000.0000' });
    menuRepo.find.mockResolvedValue([]);
    priceItemRepo.findOne.mockResolvedValue(null);
    availRepo.findOne.mockResolvedValue({ is_suspended: true, suspended_until: new Date(Date.now() + 3600000), reason: 'Out of stock' });

    const result = await service.getEffectivePrice('t-1', 'p-1');
    expect(result.is_suspended).toBe(true);
    expect(result.suspension_reason).toBe('Out of stock');
  });

  it('should perform bulk price updates on products', async () => {
    prodRepo.find.mockResolvedValue([
      { id: 'p-1', base_price: '100.0000' },
      { id: 'p-2', base_price: '200.0000' },
    ]);

    const result = await service.bulkUpdatePrices(
      't-1',
      { adjustment_type: 'PERCENTAGE', amount: '10' },
      'corr-1',
    );

    expect(result.success).toBe(true);
    expect(result.updated_count).toBe(2);
    expect(prodRepo.save).toHaveBeenCalledTimes(2);
  });
});

