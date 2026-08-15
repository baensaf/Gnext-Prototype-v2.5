import { Test, TestingModule } from '@nestjs/testing';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { ProductVariant } from '../src/entities/ProductVariant.entity';
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
import { PricingService } from '../src/modules/pricing/pricing.service';

describe('CatalogService (Unit)', () => {
  let service: CatalogService;
  let prodRepo: any;
  let variantRepo: any;
  let prodGroupRepo: any;
  let priceItemRepo: any;
  let menuRepo: any;
  let menuCatRepo: any;
  let menuProdRepo: any;
  let availRepo: any;
  let auditWriter: any;
  let pricingService: any;

  beforeEach(async () => {
    prodRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(), softRemove: jest.fn() };
    variantRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((dto) => ({ id: 'var-1', ...dto })),
      save: jest.fn((v) => Promise.resolve(v)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      softRemove: jest.fn().mockResolvedValue(true),
    };
    prodGroupRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    priceItemRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    menuRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn(), softRemove: jest.fn() };
    menuCatRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    menuProdRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    availRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    auditWriter = { write: jest.fn() };
    pricingService = {
      resolvePrice: jest.fn().mockResolvedValue({ amount: '1500000.0000', resolutionSource: 'BASE_PRICE', isOverridden: false }),
      bulkCommit: jest.fn().mockResolvedValue({ success: true, updated_count: 2, affected_rows: 2, job_id: 'job-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        { provide: getRepositoryToken(Category), useValue: { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() } },
        { provide: getRepositoryToken(Product), useValue: prodRepo },
        { provide: getRepositoryToken(ProductVariant), useValue: variantRepo },
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
        { provide: PricingService, useValue: pricingService },
      ],
    }).compile();

    service = module.get<CatalogService>(CatalogService);
  });

  it('should return base_price when no priceGroup or menu override exists', async () => {
    prodRepo.findOne.mockResolvedValue({ id: 'p-1', base_price: '1500000.0000' });
    pricingService.resolvePrice.mockResolvedValue({ amount: '1500000.0000', resolutionSource: 'BASE_PRICE', isOverridden: false });

    const result = await service.getEffectivePrice('t-1', 'p-1', 'pg-1');
    expect(result.effective_price).toBe('1500000.0000');
    expect(result.is_overridden).toBe(false);
    expect(result.resolution_source).toBe('BASE_PRICE');
  });

  it('should return override_price when priceGroup override exists', async () => {
    prodRepo.findOne.mockResolvedValue({ id: 'p-1', base_price: '1500000.0000' });
    pricingService.resolvePrice.mockResolvedValue({ amount: '1300000.0000', resolutionSource: 'PRICE_GROUP', isOverridden: true });

    const result = await service.getEffectivePrice('t-1', 'p-1', 'pg-vip');
    expect(result.effective_price).toBe('1300000.0000');
    expect(result.is_overridden).toBe(true);
    expect(result.resolution_source).toBe('PRICE_GROUP');
  });

  it('should prioritize menu override over priceGroup override', async () => {
    prodRepo.findOne.mockResolvedValue({ id: 'p-1', base_price: '1500000.0000' });
    pricingService.resolvePrice.mockResolvedValue({ amount: '1100000.0000', resolutionSource: 'MENU_OVERRIDE', isOverridden: true });

    const result = await service.getEffectivePrice('t-1', 'p-1', 'pg-vip', 'b-1', 'DELIVERY');
    expect(result.effective_price).toBe('1100000.0000');
    expect(result.is_overridden).toBe(true);
    expect(result.resolution_source).toBe('MENU_OVERRIDE');
  });

  it('should indicate item suspension when ProductAvailability is suspended', async () => {
    prodRepo.findOne.mockResolvedValue({ id: 'p-1', base_price: '1500000.0000' });
    pricingService.resolvePrice.mockResolvedValue({ amount: '1500000.0000', resolutionSource: 'BASE_PRICE', isOverridden: false });
    availRepo.findOne.mockResolvedValue({ is_suspended: true, suspended_until: new Date(Date.now() + 3600000), reason: 'Out of stock' });

    const result = await service.getEffectivePrice('t-1', 'p-1');
    expect(result.is_suspended).toBe(true);
    expect(result.suspension_reason).toBe('Out of stock');
  });

  it('should perform bulk price updates on products', async () => {
    const result = await service.bulkUpdatePrices(
      't-1',
      { adjustment_type: 'PERCENTAGE', amount: '10' },
      'corr-1',
    );

    expect(result.success).toBe(true);
    expect(result.updated_count).toBe(2);
  });

  describe('Product Variants', () => {
    it('should create a variant and write audit event', async () => {
      prodRepo.findOne.mockResolvedValue({ id: 'prod-burger', base_price: '150000.0000' });
      variantRepo.findOne.mockResolvedValue(null);
      variantRepo.count.mockResolvedValue(0);

      const created = await service.createProductVariant(
        't-1',
        'prod-burger',
        {
          code: 'VAR-CHB-DBL',
          name: 'Double Patty',
          base_price: '220000.0000',
          sku: 'CHB-DBL',
          is_default: false,
        },
        'corr-v1',
      );

      expect(created.code).toBe('VAR-CHB-DBL');
      expect(created.name).toBe('Double Patty');
      expect(variantRepo.save).toHaveBeenCalled();
      expect(auditWriter.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'PRODUCT_VARIANT_CREATED',
          entityType: 'ProductVariant',
        }),
      );
    });

    it('should list variants for a product', async () => {
      prodRepo.findOne.mockResolvedValue({ id: 'prod-burger' });
      variantRepo.find.mockResolvedValue([
        { id: 'var-1', code: 'VAR-CHB-SGL', name: 'Single Patty', is_default: true },
        { id: 'var-2', code: 'VAR-CHB-DBL', name: 'Double Patty', is_default: false },
      ]);

      const list = await service.getProductVariants('t-1', 'prod-burger');
      expect(list).toHaveLength(2);
      expect(list[0].code).toBe('VAR-CHB-SGL');
    });
  });
});
