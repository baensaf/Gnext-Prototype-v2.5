import { Test, TestingModule } from '@nestjs/testing';
import { basePriceLists } from './utils/price-list-fakes';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Category } from '../src/entities/Category.entity';
import { Product } from '../src/entities/Product.entity';
import { ProductVariant } from '../src/entities/ProductVariant.entity';
import { OptionGroup } from '../src/entities/OptionGroup.entity';
import { OptionItem } from '../src/entities/OptionItem.entity';
import { ProductOptionGroup } from '../src/entities/ProductOptionGroup.entity';
import { PriceGroup } from '../src/entities/PriceGroup.entity';
import { Menu } from '../src/entities/Menu.entity';
import { MenuCategory } from '../src/entities/MenuCategory.entity';
import { MenuProduct } from '../src/entities/MenuProduct.entity';
import { ProductAvailability } from '../src/entities/ProductAvailability.entity';
import { AvailabilitySchedule } from '../src/entities/AvailabilitySchedule.entity';
import { Branch } from '../src/entities/Branch.entity';
import { BranchOperatingHour } from '../src/entities/BranchOperatingHour.entity';
import { DailyStock } from '../src/entities/DailyStock.entity';
import { ProductOptionGroup as ProductOptionGroupEntity } from '../src/entities/ProductOptionGroup.entity';
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
  let scheduleRepo: any;
  let auditWriter: any;
  let pricingService: any;
  let hoursRepo: any;
  let stockRepo: any;

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
    availRepo = {
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      save: jest.fn(),
    };
    scheduleRepo = { find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), create: jest.fn((d) => d), save: jest.fn((d) => Promise.resolve(d)), delete: jest.fn() };
    auditWriter = { write: jest.fn() };
    hoursRepo = { find: jest.fn().mockResolvedValue([]) };
    stockRepo = { find: jest.fn().mockResolvedValue([]), manager: { query: jest.fn().mockResolvedValue([{ sold: 0 }]) } };
    pricingService = {
      resolvePrice: jest.fn().mockResolvedValue({ amount: '1500000.0000', resolutionSource: 'BASE_PRICE', isOverridden: false }),
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
        { provide: getRepositoryToken(Menu), useValue: menuRepo },
        { provide: getRepositoryToken(MenuCategory), useValue: menuCatRepo },
        { provide: getRepositoryToken(MenuProduct), useValue: menuProdRepo },
        { provide: getRepositoryToken(ProductAvailability), useValue: availRepo },
        { provide: getRepositoryToken(AvailabilitySchedule), useValue: scheduleRepo },
        { provide: getRepositoryToken(Branch), useValue: { findOne: jest.fn().mockResolvedValue({ id: 'b-1', time_zone: 'Asia/Tehran' }) } },
        { provide: getRepositoryToken(BranchOperatingHour), useValue: hoursRepo },
        { provide: getRepositoryToken(DailyStock), useValue: stockRepo },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: PricingService, useValue: pricingService },
        basePriceLists(),
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
    availRepo.find.mockResolvedValue([
      {
        branch_id: null,
        is_suspended: true,
        suspended_until: new Date(Date.now() + 3600000),
        reason: 'Out of stock',
      },
    ]);

    const result = await service.getEffectivePrice('t-1', 'p-1');
    expect(result.is_suspended).toBe(true);
    expect(result.suspension_reason).toBe('Out of stock');
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

  // HAMI audit gap: time-of-day menus. Tehran is UTC+03:30, so 05:00Z is 08:30 and 09:00Z is 12:30.
  describe('Scheduled availability', () => {
    const breakfast = { is_active: true, branch_id: null, days_of_week: '0,1,2,3,4,5,6', start_time: '07:00', end_time: '11:00' };
    const at = (iso: string) => new Date(iso);

    beforeEach(() => {
      prodRepo.findOne.mockResolvedValue({ id: 'p-omelette', category_id: 'cat-breakfast' });
    });

    it('sells a breakfast item inside its window and not after it', async () => {
      scheduleRepo.find.mockResolvedValue([{ ...breakfast, category_id: 'cat-breakfast' }]);

      const morning = await service.getSuspension('t-1', 'p-omelette', 'b-1', at('2026-09-16T05:00:00Z'));
      const noon = await service.getSuspension('t-1', 'p-omelette', 'b-1', at('2026-09-16T09:00:00Z'));

      expect(morning.isSuspended).toBe(false);
      expect(noon).toEqual(expect.objectContaining({ isSuspended: true, outOfSchedule: true, reason: 'Only on sale 07:00–11:00' }));
    });

    it("lets a product's own window replace its category's", async () => {
      scheduleRepo.find.mockResolvedValue([
        { ...breakfast, category_id: 'cat-breakfast' },
        { ...breakfast, product_id: 'p-omelette', start_time: '00:00', end_time: '00:00' },
      ]);

      const noon = await service.getSuspension('t-1', 'p-omelette', 'b-1', at('2026-09-16T09:00:00Z'));

      expect(noon.isSuspended).toBe(false);
    });

    it('runs a late window past midnight into the next day', async () => {
      // Wednesday only, 22:00–02:00. 21:00Z Wednesday is 00:30 Thursday in Tehran.
      scheduleRepo.find.mockResolvedValue([{ ...breakfast, product_id: 'p-omelette', days_of_week: '3', start_time: '22:00', end_time: '02:00' }]);

      const afterMidnight = await service.getSuspension('t-1', 'p-omelette', 'b-1', at('2026-09-16T21:00:00Z'));
      const nextNight = await service.getSuspension('t-1', 'p-omelette', 'b-1', at('2026-09-17T21:00:00Z'));

      expect(afterMidnight.isSuspended).toBe(false);
      expect(nextNight.isSuspended).toBe(true);
    });

    it("ignores another branch's window", async () => {
      scheduleRepo.find.mockResolvedValue([{ ...breakfast, category_id: 'cat-breakfast', branch_id: 'b-other' }]);

      const noon = await service.getSuspension('t-1', 'p-omelette', 'b-1', at('2026-09-16T09:00:00Z'));

      expect(noon.isSuspended).toBe(false);
    });

    it('lists the items outside their window for the register', async () => {
      scheduleRepo.find.mockResolvedValue([{ ...breakfast, category_id: 'cat-breakfast' }]);
      prodRepo.find.mockResolvedValue([
        { id: 'p-omelette', category_id: 'cat-breakfast' },
        { id: 'p-burger', category_id: 'cat-burgers' },
      ]);

      const off = await service.getOffScheduleProducts('t-1', 'b-1', at('2026-09-16T09:00:00Z'));

      expect(off).toEqual([{ product_id: 'p-omelette', windows: '07:00–11:00' }]);
    });

    it('refuses a window with no target, no day or a bad time', async () => {
      await expect(service.createSchedule('t-1', { daysOfWeek: [1], startTime: '07:00', endTime: '11:00' })).rejects.toThrow('one product or one category');
      await expect(service.createSchedule('t-1', { productId: 'p-omelette', daysOfWeek: [], startTime: '07:00', endTime: '11:00' })).rejects.toThrow('at least one day');
      await expect(service.createSchedule('t-1', { productId: 'p-omelette', daysOfWeek: [1], startTime: '7:00', endTime: '11:00' })).rejects.toThrow('HH:MM');
    });
  });

  describe('Snappfood-style availability', () => {
    const at = (iso: string) => new Date(iso);
    const shift = (day: number, open: string, close: string) => ({ day_of_week: day, open_time: open, close_time: close, is_closed: false });

    it('brings an item back at the next shift, later today or on the next open day', async () => {
      // Wednesday lunch and dinner, Thursday lunch. 10:00Z Wednesday is 13:30 in Tehran.
      hoursRepo.find.mockResolvedValue([shift(3, '12:00:00', '16:00:00'), shift(3, '19:00:00', '23:00:00'), shift(4, '12:00:00', '16:00:00')]);

      expect((await service.nextShiftStart('t-1', 'b-1', at('2026-09-16T10:00:00Z'))).toISOString()).toBe('2026-09-16T15:30:00.000Z');
      expect((await service.nextShiftStart('t-1', 'b-1', at('2026-09-16T20:00:00Z'))).toISOString()).toBe('2026-09-17T08:30:00.000Z');
    });

    it('falls back to the start of tomorrow when the branch has no hours', async () => {
      expect((await service.nextShiftStart('t-1', 'b-1', at('2026-09-16T10:00:00Z'))).toISOString()).toBe('2026-09-16T20:30:00.000Z');
    });

    it('takes one variant off sale and leaves the others', async () => {
      prodRepo.findOne.mockResolvedValue({ id: 'p-sandwich' });
      availRepo.find.mockResolvedValue([{ product_id: 'p-sandwich', variant_id: 'v-cold', is_suspended: true, suspended_until: null }]);

      expect((await service.getSuspension('t-1', 'p-sandwich', 'b-1', new Date(), 'v-cold')).isSuspended).toBe(true);
      expect((await service.getSuspension('t-1', 'p-sandwich', 'b-1', new Date(), 'v-hot')).isSuspended).toBe(false);
    });

    describe('order line checks', () => {
      const order = { id: 'o-1', branch_id: 'b-1' };
      const em = (over: any = {}) => ({
        query: jest.fn().mockResolvedValue([{ sold: '0', n: '0' }]),
        find: jest.fn(async (entity: any) => (entity === DailyStock ? over.stock || [] : entity === ProductOptionGroupEntity ? over.links || [] : [])),
        // lockStockCounts: SELECT … FOR UPDATE on today's counts.
        createQueryBuilder: jest.fn(() => {
          const qb: any = { where: () => qb, orderBy: () => qb, setLock: () => qb, getMany: async () => over.stock || [] };
          return qb;
        }),
      });

      it("refuses more than is left of today's stock", async () => {
        const manager: any = em({ stock: [{ product_id: 'p-1', variant_id: null, quantity: 3 }] });
        manager.query.mockResolvedValue([{ sold: '2' }]);

        await expect(service.assertLineSellable(manager, 't-1', order, { id: 'p-1', name: 'Lasagne' } as any, null, '2', [])).rejects.toThrow('Only 1');
        await expect(service.assertLineSellable(manager, 't-1', order, { id: 'p-1', name: 'Lasagne' } as any, null, '1', [])).resolves.toBeUndefined();
      });

      it('refuses more than the per-order cap', async () => {
        const manager: any = em();
        manager.query.mockResolvedValue([{ n: '9' }]);

        await expect(service.assertLineSellable(manager, 't-1', order, { id: 'p-1', name: 'Soda', max_per_order: 10 } as any, null, '2', [])).rejects.toThrow('At most 10');
      });

      it('refuses an add-on this product leaves out, or one that is off sale', async () => {
        const chili = { id: 'opt-chili', name: 'Chili shot' } as any;
        const leftOut: any = em({ links: [{ excluded_item_ids: ['opt-chili'] }] });
        await expect(service.assertLineSellable(leftOut, 't-1', order, { id: 'p-1', name: 'Sandwich' } as any, null, '1', [chili])).rejects.toThrow('not offered');

        availRepo.find.mockResolvedValue([{ option_item_id: 'opt-chili', is_suspended: true, suspended_until: null, reason: 'Out' }]);
        await expect(service.assertLineSellable(em() as any, 't-1', order, { id: 'p-1', name: 'Sandwich' } as any, null, '1', [chili])).rejects.toThrow('not available');
      });
    });
  });

  describe('whole-basket checks (kiosk)', () => {
    const fries = { id: 'p-fr', name: 'Fries', max_per_order: 3 } as any;
    const line = (quantity: number, variantId: string | null = null) => ({ product: fries, variantId, quantity, optionItems: [] });

    it('adds lines of the same item together against the per-order cap', async () => {
      await expect(service.assertBasketSellable('t-1', 'b-1', [line(2), line(2)])).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PRODUCT_MAX_PER_ORDER' }) });
      await expect(service.assertBasketSellable('t-1', 'b-1', [line(1), line(2)])).resolves.toBeUndefined();
    });

    it("adds lines together against today's stock, less what is already sold", async () => {
      stockRepo.find.mockResolvedValue([{ product_id: 'p-fr', variant_id: null, quantity: 5 }]);
      stockRepo.manager.query.mockResolvedValue([{ sold: 3 }]);
      await expect(service.assertBasketSellable('t-1', 'b-1', [line(1), line(2)])).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PRODUCT_OUT_OF_STOCK', message: 'Only 2 × Fries left today' }) });
    });

    it('refuses a stopped size', async () => {
      availRepo.find.mockResolvedValue([{ product_id: 'p-fr', variant_id: 'v-l', branch_id: 'b-1', is_suspended: true, suspended_until: null, reason: 'No large boxes' }]);
      await expect(service.assertBasketSellable('t-1', 'b-1', [line(1, 'v-l')])).rejects.toMatchObject({ response: expect.objectContaining({ code: 'PRODUCT_SUSPENDED' }) });
      await expect(service.assertBasketSellable('t-1', 'b-1', [line(1, 'v-s')])).resolves.toBeUndefined();
    });
  });

  it("will not let a branch lift head office's chain-wide stop", async () => {
    const chainWide = { product_id: 'p-1', variant_id: null, option_item_id: null, branch_id: null, is_suspended: true, suspended_until: null };
    availRepo.findOne.mockImplementation(({ where }: any) => Promise.resolve(where.branch_id === 'b-1' ? null : chainWide));
    await expect(service.resumeProduct('t-1', 'p-1', 'b-1')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'CHAIN_WIDE_STOP' }) });
  });
});
