import { Injectable, NotFoundException, ConflictException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { Category } from '../../entities/Category.entity';
import { Product } from '../../entities/Product.entity';
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { ProductOptionGroup } from '../../entities/ProductOptionGroup.entity';
import { PriceGroup } from '../../entities/PriceGroup.entity';
import { PriceGroupItem } from '../../entities/PriceGroupItem.entity';
import { Menu } from '../../entities/Menu.entity';
import { MenuCategory } from '../../entities/MenuCategory.entity';
import { MenuProduct } from '../../entities/MenuProduct.entity';
import { ProductAvailability } from '../../entities/ProductAvailability.entity';
import { AvailabilitySchedule } from '../../entities/AvailabilitySchedule.entity';
import { Branch } from '../../entities/Branch.entity';
import { BranchOperatingHour } from '../../entities/BranchOperatingHour.entity';
import { DailyStock } from '../../entities/DailyStock.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { describeWindows, isOnSchedule, isValidTime, localClock, parseDays } from '../../common/utils/availability-schedule.util';
import { BUSINESS_TIME_ZONE, BusinessDateUtil, ORDER_BUSINESS_DATE_EXPR } from '../../common/utils/business-date.util';
import { AuditWriter } from '../audit/audit-writer.service';
import { PaginationQueryDto, createPagedResponse, PagedResponse } from '../../common/dto/pagination.dto';
import { PricingService } from '../pricing/pricing.service';

/** What besides a whole product a stop can be on, and how long it lasts. */
export interface StopTarget {
  variantId?: string;
  optionItemId?: string;
  /** Back on sale when the branch next opens, rather than after a number of hours. */
  untilNextShift?: boolean;
}

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Category) private readonly catRepo: Repository<Category>,
    @InjectRepository(Product) private readonly prodRepo: Repository<Product>,
    @InjectRepository(ProductVariant) private readonly variantRepo: Repository<ProductVariant>,
    @InjectRepository(OptionGroup) private readonly groupRepo: Repository<OptionGroup>,
    @InjectRepository(OptionItem) private readonly itemRepo: Repository<OptionItem>,
    @InjectRepository(ProductOptionGroup) private readonly prodGroupRepo: Repository<ProductOptionGroup>,
    @InjectRepository(PriceGroup) private readonly priceGroupRepo: Repository<PriceGroup>,
    @InjectRepository(PriceGroupItem) private readonly priceItemRepo: Repository<PriceGroupItem>,
    @InjectRepository(Menu) private readonly menuRepo: Repository<Menu>,
    @InjectRepository(MenuCategory) private readonly menuCatRepo: Repository<MenuCategory>,
    @InjectRepository(MenuProduct) private readonly menuProdRepo: Repository<MenuProduct>,
    @InjectRepository(ProductAvailability) private readonly availRepo: Repository<ProductAvailability>,
    @InjectRepository(AvailabilitySchedule) private readonly scheduleRepo: Repository<AvailabilitySchedule>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    @InjectRepository(BranchOperatingHour) private readonly hoursRepo: Repository<BranchOperatingHour>,
    @InjectRepository(DailyStock) private readonly stockRepo: Repository<DailyStock>,
    private readonly auditWriter: AuditWriter,
    @Inject(forwardRef(() => PricingService)) private readonly pricingService: PricingService,
  ) {}

  // Categories
  async getCategories(tenantId: string, query?: PaginationQueryDto & { search?: string }): Promise<PagedResponse<Category> | Category[]> {
    if (!query || (!query.page && !query.limit && !query.search)) {
      return await this.catRepo.find({ where: { tenant_id: tenantId }, order: { sort_order: 'ASC', code: 'ASC' } });
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const qb = this.catRepo.createQueryBuilder('c').where('c.tenant_id = :tenantId', { tenantId });

    if (query.search) {
      qb.andWhere('(LOWER(c.name) LIKE :search OR LOWER(c.code) LIKE :search)', { search: `%${query.search.toLowerCase()}%` });
    }

    qb.orderBy('c.sort_order', 'ASC').addOrderBy('c.code', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    return createPagedResponse(items, total, page, limit);
  }

  async createCategory(tenantId: string, data: { code: string; name: string; parent_id?: string; sort_order?: number; image_asset_id?: string }, correlationId: string) {
    const code = data.code.toUpperCase();
    const existing = await this.catRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Category code ${code} already exists`);

    const cat = this.catRepo.create({
      tenant_id: tenantId,
      code,
      name: data.name,
      parent_id: data.parent_id || null,
      sort_order: data.sort_order ?? 0,
      image_asset_id: data.image_asset_id || null,
      is_active: true,
    });

    const saved = await this.catRepo.save(cat);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'CATEGORY_CREATED',
      entityType: 'Category',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async updateCategory(tenantId: string, id: string, data: Partial<Category>, correlationId: string) {
    const cat = await this.catRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!cat) throw new NotFoundException('Category not found');
    const before = { ...cat };
    Object.assign(cat, data);
    const saved = await this.catRepo.save(cat);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'CATEGORY_UPDATED',
      entityType: 'Category',
      entityId: id,
      correlationId,
      beforeData: before,
      afterData: saved,
    });

    return saved;
  }

  async archiveCategory(tenantId: string, id: string, correlationId: string) {
    const cat = await this.catRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!cat) throw new NotFoundException('Category not found');
    cat.is_active = false;
    await this.catRepo.softRemove(cat);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'CATEGORY_ARCHIVED',
      entityType: 'Category',
      entityId: id,
      correlationId,
    });

    return { success: true };
  }

  // Products
  async getProducts(tenantId: string, categoryId?: string, query?: PaginationQueryDto & { search?: string }): Promise<PagedResponse<Product> | Product[]> {
    if (!query || (!query.page && !query.limit && !query.search)) {
      const where: any = { tenant_id: tenantId };
      if (categoryId) where.category_id = categoryId;
      const products = await this.prodRepo.find({ where, order: { code: 'ASC' } });
      // Variants ride along so a list can show the hot and the cold sandwich as rows of their own.
      const variants = await this.variantRepo.find({ where: { tenant_id: tenantId, is_active: true }, order: { sort_order: 'ASC', code: 'ASC' } });
      return products.map((p) => Object.assign(p, { variants: (variants || []).filter((v) => v.product_id === p.id) }));
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const qb = this.prodRepo.createQueryBuilder('p').where('p.tenant_id = :tenantId', { tenantId });

    if (categoryId) {
      qb.andWhere('p.category_id = :categoryId', { categoryId });
    }

    if (query.search) {
      qb.andWhere('(LOWER(p.name) LIKE :search OR LOWER(p.code) LIKE :search OR LOWER(p.sku) LIKE :search)', { search: `%${query.search.toLowerCase()}%` });
    }

    qb.orderBy('p.code', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    return createPagedResponse(items, total, page, limit);
  }

  async getProductById(tenantId: string, id: string) {
    const prod = await this.prodRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!prod) throw new NotFoundException('Product not found');

    const optionGroupLinks = (await this.prodGroupRepo.find({
      where: { tenant_id: tenantId, product_id: id },
      order: { sort_order: 'ASC' },
    })) || [];

    const optionGroups = [];
    for (const link of optionGroupLinks) {
      const group = await this.groupRepo.findOne({ where: { id: link.option_group_id, tenant_id: tenantId } });
      if (group) {
        const items = await this.itemRepo.find({ where: { option_group_id: group.id, tenant_id: tenantId }, order: { sort_order: 'ASC' } });
        optionGroups.push({ ...group, items, excluded_item_ids: link.excluded_item_ids || [] });
      }
    }

    const variants = await this.variantRepo.find({
      where: { tenant_id: tenantId, product_id: id, is_active: true },
      order: { sort_order: 'ASC', code: 'ASC' },
    });

    return { ...prod, optionGroups, variants };
  }

  async createProduct(tenantId: string, data: { code: string; name: string; category_id: string; base_price: string; sku?: string; barcode?: string; description?: string; tax_rate?: string; image_asset_id?: string; product_type?: 'STANDARD' | 'COMBO' }, correlationId: string) {
    const code = data.code.toUpperCase();
    const existing = await this.prodRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Product code ${code} already exists`);
    this.assertProductType(data.product_type);

    const prod = this.prodRepo.create({
      tenant_id: tenantId,
      code,
      name: data.name,
      product_type: data.product_type || 'STANDARD',
      category_id: data.category_id,
      base_price: MoneyUtil.format(data.base_price || '0'),
      sku: data.sku || null,
      barcode: data.barcode || null,
      description: data.description || null,
      tax_rate: data.tax_rate || '0.1000',
      image_asset_id: data.image_asset_id || null,
      is_active: true,
    });

    const saved = await this.prodRepo.save(prod);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRODUCT_CREATED',
      entityType: 'Product',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async updateProduct(tenantId: string, id: string, data: Partial<Product>, correlationId: string) {
    const prod = await this.prodRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!prod) throw new NotFoundException('Product not found');
    const before = { ...prod };
    this.assertProductType(data.product_type);

    if (data.base_price) {
      data.base_price = MoneyUtil.format(data.base_price);
    }
    if (data.container_price !== undefined) {
      data.container_price = MoneyUtil.format(data.container_price || '0');
    }
    if (data.max_per_order !== undefined) {
      const cap = data.max_per_order === null || (data.max_per_order as unknown) === '' ? null : Number(data.max_per_order);
      if (cap !== null && (!Number.isInteger(cap) || cap < 1)) {
        throw new BadRequestException('The per-order cap is a whole number, 1 or more, or empty for none');
      }
      data.max_per_order = cap;
    }
    if (data.gallery_asset_ids !== undefined && !Array.isArray(data.gallery_asset_ids)) {
      throw new BadRequestException('gallery_asset_ids is a list of image ids');
    }

    Object.assign(prod, data);
    const saved = await this.prodRepo.save(prod);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRODUCT_UPDATED',
      entityType: 'Product',
      entityId: id,
      correlationId,
      beforeData: before,
      afterData: saved,
    });

    return saved;
  }

  async archiveProduct(tenantId: string, id: string, correlationId: string) {
    const prod = await this.prodRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!prod) throw new NotFoundException('Product not found');
    prod.is_active = false;
    await this.prodRepo.softRemove(prod);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRODUCT_ARCHIVED',
      entityType: 'Product',
      entityId: id,
      correlationId,
    });

    return { success: true };
  }

  // Product Variants
  async getProductVariants(tenantId: string, productId: string) {
    const prod = await this.prodRepo.findOne({ where: { id: productId, tenant_id: tenantId } });
    if (!prod) throw new NotFoundException('Product not found');

    return await this.variantRepo.find({
      where: { tenant_id: tenantId, product_id: productId, is_active: true },
      order: { sort_order: 'ASC', code: 'ASC' },
    });
  }

  async createProductVariant(
    tenantId: string,
    productId: string,
    data: {
      code: string;
      name: string;
      base_price?: string;
      sku?: string;
      barcode?: string;
      is_default?: boolean;
      sort_order?: number;
    },
    correlationId: string,
  ) {
    const prod = await this.prodRepo.findOne({ where: { id: productId, tenant_id: tenantId } });
    if (!prod) throw new NotFoundException('Product not found');

    const code = data.code.toUpperCase().trim();
    const existing = await this.variantRepo.findOne({
      where: { tenant_id: tenantId, product_id: productId, code, is_active: true },
    });
    if (existing) throw new ConflictException(`Variant code ${code} already exists for this product`);

    const count = await this.variantRepo.count({
      where: { tenant_id: tenantId, product_id: productId, is_active: true },
    });

    const isDefault = data.is_default || count === 0;

    if (isDefault) {
      await this.variantRepo.update(
        { tenant_id: tenantId, product_id: productId },
        { is_default: false },
      );
    }

    const variant = this.variantRepo.create({
      tenant_id: tenantId,
      product_id: productId,
      code,
      name: data.name,
      base_price: MoneyUtil.format(data.base_price || prod.base_price || '0'),
      sku: data.sku || null,
      barcode: data.barcode || null,
      is_default: isDefault,
      sort_order: data.sort_order ?? count,
      is_active: true,
    });

    const saved = await this.variantRepo.save(variant);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRODUCT_VARIANT_CREATED',
      entityType: 'ProductVariant',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async updateProductVariant(
    tenantId: string,
    productId: string,
    variantId: string,
    data: Partial<ProductVariant>,
    correlationId: string,
  ) {
    const variant = await this.variantRepo.findOne({
      where: { id: variantId, product_id: productId, tenant_id: tenantId },
    });
    if (!variant) throw new NotFoundException('Product variant not found');

    const before = { ...variant };

    if (data.code) {
      data.code = data.code.toUpperCase().trim();
      const duplicate = await this.variantRepo.findOne({
        where: { tenant_id: tenantId, product_id: productId, code: data.code, is_active: true },
      });
      if (duplicate && duplicate.id !== variantId) {
        throw new ConflictException(`Variant code ${data.code} already exists for this product`);
      }
    }

    if (data.base_price) {
      data.base_price = MoneyUtil.format(data.base_price);
    }

    if (data.is_default === true) {
      await this.variantRepo.update(
        { tenant_id: tenantId, product_id: productId },
        { is_default: false },
      );
    }

    Object.assign(variant, data);
    const saved = await this.variantRepo.save(variant);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRODUCT_VARIANT_UPDATED',
      entityType: 'ProductVariant',
      entityId: variantId,
      correlationId,
      beforeData: before,
      afterData: saved,
    });

    return saved;
  }

  async archiveProductVariant(
    tenantId: string,
    productId: string,
    variantId: string,
    correlationId: string,
  ) {
    const variant = await this.variantRepo.findOne({
      where: { id: variantId, product_id: productId, tenant_id: tenantId },
    });
    if (!variant) throw new NotFoundException('Product variant not found');

    const wasDefault = variant.is_default;
    variant.is_active = false;
    variant.is_default = false;
    await this.variantRepo.softRemove(variant);

    if (wasDefault) {
      const remaining = await this.variantRepo.findOne({
        where: { tenant_id: tenantId, product_id: productId, is_active: true },
        order: { sort_order: 'ASC' },
      });
      if (remaining) {
        remaining.is_default = true;
        await this.variantRepo.save(remaining);
      }
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRODUCT_VARIANT_ARCHIVED',
      entityType: 'ProductVariant',
      entityId: variantId,
      correlationId,
    });

    return { success: true };
  }

  // Option Groups & Items
  async getOptionGroups(tenantId: string, query?: PaginationQueryDto & { search?: string }): Promise<PagedResponse<any> | any[]> {
    if (!query || (!query.page && !query.limit && !query.search)) {
      const groups = await this.groupRepo.find({ where: { tenant_id: tenantId }, order: { code: 'ASC' } });
      const result = [];
      for (const g of groups) {
        const items = await this.itemRepo.find({ where: { option_group_id: g.id, tenant_id: tenantId }, order: { sort_order: 'ASC' } });
        result.push({ ...g, items });
      }
      return result;
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const qb = this.groupRepo.createQueryBuilder('g').where('g.tenant_id = :tenantId', { tenantId });

    if (query.search) {
      qb.andWhere('(LOWER(g.name) LIKE :search OR LOWER(g.code) LIKE :search)', { search: `%${query.search.toLowerCase()}%` });
    }

    qb.orderBy('g.code', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [groups, total] = await qb.getManyAndCount();
    const itemsList = [];
    for (const g of groups) {
      const items = await this.itemRepo.find({ where: { option_group_id: g.id, tenant_id: tenantId }, order: { sort_order: 'ASC' } });
      itemsList.push({ ...g, items });
    }

    return createPagedResponse(itemsList, total, page, limit);
  }

  async createOptionGroup(tenantId: string, data: { code: string; name: string; min_selection?: number; max_selection?: number; is_required?: boolean }, correlationId: string) {
    const code = data.code.toUpperCase();
    const existing = await this.groupRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Option group ${code} already exists`);

    const min = data.min_selection ?? 0;
    const max = data.max_selection ?? 1;

    if (min < 0 || max < min) {
      throw new BadRequestException(`Invalid modifier selections. min_selection (${min}) must be >= 0 and <= max_selection (${max}).`);
    }

    const group = this.groupRepo.create({
      tenant_id: tenantId,
      code,
      name: data.name,
      min_selection: min,
      max_selection: max,
      is_required: data.is_required ?? false,
    });

    const saved = await this.groupRepo.save(group);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'OPTION_GROUP_CREATED',
      entityType: 'OptionGroup',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  private assertProductType(type?: string) {
    if (type !== undefined && type !== 'STANDARD' && type !== 'COMBO') {
      throw new BadRequestException('product_type is STANDARD or COMBO');
    }
  }

  async createOptionItem(tenantId: string, groupId: string, data: { code: string; name?: string; price_delta?: string; is_default?: boolean; sort_order?: number; product_id?: string }, correlationId: string) {
    const group = await this.groupRepo.findOne({ where: { id: groupId, tenant_id: tenantId } });
    if (!group) throw new NotFoundException('Option group not found');
    // A combo slot's choice can be a dish of its own; it takes the dish's name unless given one.
    const component = data.product_id ? await this.getProductById(tenantId, data.product_id) : null;
    if (!data.name && !component) throw new BadRequestException('An option needs a name or a product');

    const item = this.itemRepo.create({
      tenant_id: tenantId,
      option_group_id: groupId,
      product_id: component?.id || null,
      code: data.code.toUpperCase(),
      name: data.name || component!.name,
      price_delta: MoneyUtil.format(data.price_delta || '0'),
      is_default: data.is_default ?? false,
      sort_order: data.sort_order ?? 0,
    });

    const saved = await this.itemRepo.save(item);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'OPTION_ITEM_CREATED',
      entityType: 'OptionItem',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async attachOptionGroupToProduct(tenantId: string, productId: string, optionGroupId: string, sortOrder: number = 0, correlationId: string) {
    let link = await this.prodGroupRepo.findOne({ where: { tenant_id: tenantId, product_id: productId, option_group_id: optionGroupId } });
    if (!link) {
      link = this.prodGroupRepo.create({ tenant_id: tenantId, product_id: productId, option_group_id: optionGroupId, sort_order: sortOrder });
      await this.prodGroupRepo.save(link);
    }
    return link;
  }

  // Price Groups & Overrides
  async getPriceGroups(tenantId: string) {
    return await this.priceGroupRepo.find({ where: { tenant_id: tenantId }, order: { code: 'ASC' } });
  }

  async createPriceGroup(tenantId: string, data: { code: string; name: string; currency_code?: string }, correlationId: string) {
    const code = data.code.toUpperCase();
    const existing = await this.priceGroupRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Price group ${code} already exists`);

    const pg = this.priceGroupRepo.create({
      tenant_id: tenantId,
      code,
      name: data.name,
      currency_code: data.currency_code || 'IRR',
      is_active: true,
    });

    const saved = await this.priceGroupRepo.save(pg);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRICE_GROUP_CREATED',
      entityType: 'PriceGroup',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async setPriceOverride(tenantId: string, priceGroupId: string, productId: string, overridePrice: string, correlationId: string) {
    let item = await this.priceItemRepo.findOne({ where: { tenant_id: tenantId, price_group_id: priceGroupId, product_id: productId } });
    if (!item) {
      item = this.priceItemRepo.create({
        tenant_id: tenantId,
        price_group_id: priceGroupId,
        product_id: productId,
        override_price: MoneyUtil.format(overridePrice),
      });
    } else {
      item.override_price = MoneyUtil.format(overridePrice);
    }

    const saved = await this.priceItemRepo.save(item);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRICE_GROUP_OVERRIDE_SET',
      correlationId,
      details: { priceGroupId, productId, overridePrice },
    });

    return saved;
  }

  // Bulk Price Update
  async bulkUpdatePrices(
    tenantId: string,
    params: { price_group_id?: string; category_id?: string; adjustment_type: 'PERCENTAGE' | 'FIXED'; amount: string },
    correlationId: string,
  ) {
    return await this.pricingService.bulkCommit(tenantId, params as any, correlationId);
  }

  // Menus Management
  async getMenus(tenantId: string, branchId?: string, channel?: string) {
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    if (channel && channel !== 'ALL') where.channel = channel;
    const menus = await this.menuRepo.find({ where, order: { code: 'ASC' } });

    const result = [];
    for (const menu of menus) {
      const categories = await this.menuCatRepo.find({ where: { tenant_id: tenantId, menu_id: menu.id }, order: { sort_order: 'ASC' } });
      const products = await this.menuProdRepo.find({ where: { tenant_id: tenantId, menu_id: menu.id }, order: { sort_order: 'ASC' } });
      result.push({ ...menu, categories, products });
    }
    return result;
  }

  async getMenuById(tenantId: string, id: string) {
    const menu = await this.menuRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!menu) throw new NotFoundException('Menu not found');
    const categories = await this.menuCatRepo.find({ where: { tenant_id: tenantId, menu_id: id }, order: { sort_order: 'ASC' } });
    const products = await this.menuProdRepo.find({ where: { tenant_id: tenantId, menu_id: id }, order: { sort_order: 'ASC' } });
    return { ...menu, categories, products };
  }

  async createMenu(tenantId: string, data: { code: string; name: string; branch_id?: string; channel?: string; valid_from?: Date; valid_to?: Date }, correlationId: string) {
    const code = data.code.toUpperCase();
    const existing = await this.menuRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Menu with code ${code} already exists`);

    const menu = this.menuRepo.create({
      tenant_id: tenantId,
      code,
      name: data.name,
      branch_id: data.branch_id || null,
      channel: data.channel || 'ALL',
      valid_from: data.valid_from || null,
      valid_to: data.valid_to || null,
      is_active: true,
    });

    const saved = await this.menuRepo.save(menu);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'MENU_CREATED',
      entityType: 'Menu',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async updateMenu(tenantId: string, id: string, data: Partial<Menu>, correlationId: string) {
    const menu = await this.menuRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!menu) throw new NotFoundException('Menu not found');
    Object.assign(menu, data);
    const saved = await this.menuRepo.save(menu);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'MENU_UPDATED',
      entityType: 'Menu',
      entityId: id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async deleteMenu(tenantId: string, id: string, correlationId: string) {
    const menu = await this.menuRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!menu) throw new NotFoundException('Menu not found');
    await this.menuRepo.softRemove(menu);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'MENU_DELETED',
      entityType: 'Menu',
      entityId: id,
      correlationId,
    });

    return { success: true };
  }

  async addCategoryToMenu(tenantId: string, menuId: string, categoryId: string, sortOrder: number = 0) {
    let link = await this.menuCatRepo.findOne({ where: { tenant_id: tenantId, menu_id: menuId, category_id: categoryId } });
    if (!link) {
      link = this.menuCatRepo.create({ tenant_id: tenantId, menu_id: menuId, category_id: categoryId, sort_order: sortOrder });
    } else {
      link.sort_order = sortOrder;
    }
    return await this.menuCatRepo.save(link);
  }

  async addProductToMenu(tenantId: string, menuId: string, productId: string, categoryId?: string, sortOrder: number = 0, overridePrice?: string) {
    let link = await this.menuProdRepo.findOne({ where: { tenant_id: tenantId, menu_id: menuId, product_id: productId } });
    if (!link) {
      link = this.menuProdRepo.create({
        tenant_id: tenantId,
        menu_id: menuId,
        product_id: productId,
        category_id: categoryId || null,
        sort_order: sortOrder,
        override_price: overridePrice ? MoneyUtil.format(overridePrice) : null,
      });
    } else {
      link.sort_order = sortOrder;
      if (overridePrice !== undefined) link.override_price = overridePrice ? MoneyUtil.format(overridePrice) : null;
    }
    return await this.menuProdRepo.save(link);
  }

  // Product Availability & Temporary Suspension

  /**
   * Whether a product is 86'd right now, honouring the auto-reactivation timer.
   *
   * A suspension row outlives its window: a `suspended_until` in the past means
   * the item came back on sale by itself and the row is only history. A row with
   * no branch is a tenant-wide stop and applies to every branch. Every caller
   * that gates selling on availability needs those two rules, so they live here
   * rather than being re-derived at each call site.
   */
  async getSuspension(
    tenantId: string,
    productId: string,
    branchId?: string,
    at: Date = new Date(),
    variantId?: string | null,
  ): Promise<{ isSuspended: boolean; outOfSchedule: boolean; reason: string | null; suspendedUntil: Date | null }> {
    const rows = await this.availRepo.find({ where: { tenant_id: tenantId, product_id: productId } });
    // A stop on one variant (the cold sandwich) leaves the others on sale.
    const active = rows.find(
      (row) =>
        (!row.variant_id || row.variant_id === variantId) &&
        this.stopIsLive(row, branchId, at),
    );
    if (active) {
      return { isSuspended: true, outOfSchedule: false, reason: active.reason || null, suspendedUntil: active.suspended_until || null };
    }

    // Outside its selling window (breakfast after 11:00) is off sale too, on the branch's clock.
    const product = await this.prodRepo.findOne({ where: { id: productId, tenant_id: tenantId } });
    const windows = product ? await this.windowsFor(tenantId, product, branchId) : [];
    if (!isOnSchedule(windows, at, await this.branchTimeZone(tenantId, branchId))) {
      return { isSuspended: true, outOfSchedule: true, reason: `Only on sale ${describeWindows(windows)}`, suspendedUntil: null };
    }
    return { isSuspended: false, outOfSchedule: false, reason: null, suspendedUntil: null };
  }

  // Scheduled availability: weekly selling windows

  /** The active windows that govern a product at a branch: its own, else its category's. */
  private async windowsFor(tenantId: string, product: Product, branchId?: string, all?: AvailabilitySchedule[]) {
    const schedules = all ?? (await this.scheduleRepo.find({ where: { tenant_id: tenantId, is_active: true } }));
    const here = schedules.filter((s) => s.is_active && (!s.branch_id || !branchId || s.branch_id === branchId));
    // A window set on the product itself replaces its category's: a breakfast category can
    // still hold one all-day item.
    const own = here.filter((s) => s.product_id === product.id);
    return own.length ? own : here.filter((s) => !!product.category_id && s.category_id === product.category_id);
  }

  private async branchTimeZone(tenantId: string, branchId?: string): Promise<string> {
    const branch = branchId ? await this.branchRepo.findOne({ where: { id: branchId, tenant_id: tenantId } }) : null;
    return branch?.time_zone || 'Asia/Tehran';
  }

  async getSchedules(tenantId: string, branchId?: string) {
    const schedules = await this.scheduleRepo.find({ where: { tenant_id: tenantId }, order: { created_at: 'ASC' } });
    return branchId ? schedules.filter((s) => !s.branch_id || s.branch_id === branchId) : schedules;
  }

  async createSchedule(
    tenantId: string,
    body: { productId?: string; categoryId?: string; branchId?: string; daysOfWeek: number[]; startTime: string; endTime: string; label?: string },
    correlationId?: string,
  ) {
    if (!!body.productId === !!body.categoryId) {
      throw new BadRequestException('A selling window is for one product or one category');
    }
    const days = parseDays((body.daysOfWeek || []).join(','));
    if (!days.length) throw new BadRequestException('Pick at least one day');
    if (!isValidTime(body.startTime) || !isValidTime(body.endTime)) {
      throw new BadRequestException('Times are HH:MM, 00:00 to 23:59');
    }
    if (body.productId) await this.getProductById(tenantId, body.productId);
    if (body.categoryId && !(await this.catRepo.findOne({ where: { id: body.categoryId, tenant_id: tenantId } }))) {
      throw new NotFoundException(`Category ${body.categoryId} not found`);
    }

    const saved = await this.scheduleRepo.save(
      this.scheduleRepo.create({
        tenant_id: tenantId,
        product_id: body.productId || null,
        category_id: body.categoryId || null,
        branch_id: body.branchId || null,
        days_of_week: [...new Set(days)].sort().join(','),
        start_time: body.startTime,
        end_time: body.endTime,
        label: body.label?.trim() || null,
        is_active: true,
      }),
    );
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'AVAILABILITY_SCHEDULE_CREATED',
      correlationId: correlationId || '00000000-0000-0000-0000-000000000000',
      afterData: saved,
    });
    return saved;
  }

  async deleteSchedule(tenantId: string, id: string, correlationId?: string) {
    const schedule = await this.scheduleRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!schedule) throw new NotFoundException('Selling window not found');
    await this.scheduleRepo.delete({ id, tenant_id: tenantId });
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'AVAILABILITY_SCHEDULE_DELETED',
      correlationId: correlationId || '00000000-0000-0000-0000-000000000000',
      beforeData: schedule,
    });
    return { success: true };
  }

  /** Products outside their selling window at a branch right now, for the register to grey out. */
  async getOffScheduleProducts(tenantId: string, branchId?: string, at: Date = new Date()) {
    const schedules = await this.scheduleRepo.find({ where: { tenant_id: tenantId, is_active: true } });
    if (!schedules.length) return [];
    const timeZone = await this.branchTimeZone(tenantId, branchId);
    const products = await this.prodRepo.find({ where: { tenant_id: tenantId } });
    const off: Array<{ product_id: string; windows: string }> = [];
    for (const product of products) {
      const windows = await this.windowsFor(tenantId, product, branchId, schedules);
      if (!isOnSchedule(windows, at, timeZone)) off.push({ product_id: product.id, windows: describeWindows(windows) });
    }
    return off;
  }

  async getAvailabilities(tenantId: string, branchId?: string) {
    // A branch's list includes the chain-wide stops (no branch), which apply to it too.
    const where: any = branchId
      ? [{ tenant_id: tenantId, branch_id: branchId }, { tenant_id: tenantId, branch_id: IsNull() }]
      : { tenant_id: tenantId };
    return await this.availRepo.find({ where });
  }

  /**
   * Take an item off sale. `hours` is how long for: omit it (or pass 0) and the
   * item stays off until somebody puts it back, which is how a branch says it
   * does not carry the item at all. Anything else is today's 86 and expires on
   * its own, because nobody remembers to un-86 the fish at closing time.
   */
  async suspendProduct(
    tenantId: string,
    productId: string | undefined,
    branchId?: string,
    hours?: number,
    reason?: string,
    correlationId?: string,
    target: StopTarget = {},
  ) {
    const key = this.stopKey(productId, target);
    let avail = await this.availRepo.findOne({ where: this.stopWhere(tenantId, key, branchId) });
    // Snappfood's two ways off: "until the next shift" comes back when the branch next
    // opens, "until further notice" (no hours) only when someone puts it back.
    const suspendedUntil = target.untilNextShift
      ? await this.nextShiftStart(tenantId, branchId)
      : hours && hours > 0
        ? new Date(Date.now() + hours * 3600 * 1000)
        : null;

    if (!avail) {
      avail = this.availRepo.create({
        tenant_id: tenantId,
        ...key,
        branch_id: branchId || null,
        is_suspended: true,
        suspended_until: suspendedUntil,
        reason: reason || 'Temporary item suspension',
      });
    } else {
      avail.is_suspended = true;
      avail.suspended_until = suspendedUntil;
      avail.reason = reason || 'Temporary item suspension';
    }

    const saved = await this.availRepo.save(avail);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRODUCT_SUSPENDED',
      correlationId: correlationId || '00000000-0000-0000-0000-000000000000',
      details: { ...key, branchId, hours, untilNextShift: !!target.untilNextShift, reason, suspendedUntil },
    });

    return saved;
  }

  async resumeProduct(tenantId: string, productId: string | undefined, branchId?: string, correlationId?: string, target: StopTarget = {}) {
    const key = this.stopKey(productId, target);
    const avail = await this.availRepo.findOne({ where: this.stopWhere(tenantId, key, branchId) });
    if (avail) {
      avail.is_suspended = false;
      avail.suspended_until = null;
      avail.reason = null;
      await this.availRepo.save(avail);
    }
    // A branch cannot lift a stop head office put on the whole chain; say so rather than
    // answer success while the item stays off.
    if (branchId) {
      const chainWide = await this.availRepo.findOne({ where: this.stopWhere(tenantId, key, undefined) });
      if (chainWide && this.stopIsLive(chainWide, branchId, new Date())) {
        throw new BadRequestException({ statusCode: 400, code: 'CHAIN_WIDE_STOP', message: 'Head office took this off sale at every branch; only head office can put it back' });
      }
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRODUCT_RESUMED',
      correlationId: correlationId || '00000000-0000-0000-0000-000000000000',
      details: { ...key, branchId },
    });

    return { success: true };
  }

  /** What a stop is on: a whole product, one of its variants, or an add-on item. */
  private stopKey(productId: string | undefined, target: StopTarget) {
    if (target.optionItemId) return { product_id: null, variant_id: null, option_item_id: target.optionItemId };
    if (!productId) throw new BadRequestException('Say which product, variant or add-on to take off sale');
    return { product_id: productId, variant_id: target.variantId || null, option_item_id: null };
  }

  // A null in a TypeORM where is ignored, not matched, so each empty key is IsNull() explicitly.
  private stopWhere(tenantId: string, key: ReturnType<CatalogService['stopKey']>, branchId?: string) {
    return {
      tenant_id: tenantId,
      product_id: key.product_id ?? IsNull(),
      variant_id: key.variant_id ?? IsNull(),
      option_item_id: key.option_item_id ?? IsNull(),
      branch_id: branchId || IsNull(),
    };
  }

  private stopIsLive(row: ProductAvailability, branchId: string | undefined, at: Date) {
    return (
      (!row.branch_id || !branchId || row.branch_id === branchId) &&
      row.is_suspended &&
      (!row.suspended_until || new Date(row.suspended_until) > at)
    );
  }

  /** Whether an add-on is off sale at a branch. An add-on stop covers every product it is on. */
  async getOptionItemStop(tenantId: string, optionItemId: string, branchId?: string, at: Date = new Date()) {
    const rows = await this.availRepo.find({ where: { tenant_id: tenantId, option_item_id: optionItemId } });
    const active = rows.find((row) => this.stopIsLive(row, branchId, at));
    return { isSuspended: !!active, reason: active?.reason || null, suspendedUntil: active?.suspended_until || null };
  }

  /**
   * When the branch next opens after `at`: the next shift's start in its weekly hours, on
   * the business clock. A branch with no hours set (or a chain-wide stop) comes back at the
   * start of tomorrow, which is what Snappfood does when no date is given.
   */
  async nextShiftStart(tenantId: string, branchId?: string, at: Date = new Date()): Promise<Date> {
    const today = BusinessDateUtil.today(at);
    const dayStart = (offset: number) => {
      const [y, m, d] = today.split('-').map(Number);
      return BusinessDateUtil.startOfDay(new Date(Date.UTC(y, m - 1, d + offset)).toISOString());
    };
    const hours = branchId ? await this.hoursRepo.find({ where: { tenant_id: tenantId, branch_id: branchId } }) : [];
    const { day } = localClock(at, BUSINESS_TIME_ZONE);
    for (let offset = 0; offset <= 7; offset++) {
      const weekday = (day + offset) % 7;
      const starts = hours
        .filter((h) => h.day_of_week === weekday && !h.is_closed)
        .map((h) => {
          const [hh, mm] = String(h.open_time).split(':').map(Number);
          return new Date(dayStart(offset).getTime() + (hh * 60 + mm) * 60000);
        })
        .filter((start) => start > at)
        .sort((a, b) => a.getTime() - b.getTime());
      if (starts.length) return starts[0];
    }
    return dayStart(1);
  }

  // Add-on groups: editing what the group and its items are

  async updateOptionGroup(tenantId: string, id: string, data: { name?: string; min_selection?: number; max_selection?: number; is_required?: boolean }, correlationId: string) {
    const group = await this.groupRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!group) throw new NotFoundException('Option group not found');
    const min = data.min_selection ?? group.min_selection;
    const max = data.max_selection ?? group.max_selection;
    if (min < 0 || max < min) {
      throw new BadRequestException(`Invalid modifier selections. min_selection (${min}) must be >= 0 and <= max_selection (${max}).`);
    }
    const before = { ...group };
    if (data.name !== undefined) group.name = data.name;
    group.min_selection = min;
    group.max_selection = max;
    // Snappfood has only min/max; a minimum above zero is what "required" means.
    group.is_required = data.is_required ?? min > 0;
    const saved = await this.groupRepo.save(group);
    await this.auditWriter.write({ tenantId, actorType: 'ADMIN', action: 'OPTION_GROUP_UPDATED', entityType: 'OptionGroup', entityId: id, correlationId, beforeData: before, afterData: saved });
    return saved;
  }

  async archiveOptionGroup(tenantId: string, id: string, correlationId: string) {
    const group = await this.groupRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!group) throw new NotFoundException('Option group not found');
    await this.prodGroupRepo.delete({ tenant_id: tenantId, option_group_id: id });
    await this.groupRepo.softRemove(group);
    await this.auditWriter.write({ tenantId, actorType: 'ADMIN', action: 'OPTION_GROUP_ARCHIVED', entityType: 'OptionGroup', entityId: id, correlationId });
    return { success: true };
  }

  async updateOptionItem(tenantId: string, groupId: string, itemId: string, data: { name?: string; price_delta?: string; is_default?: boolean; sort_order?: number }, correlationId: string) {
    const item = await this.itemRepo.findOne({ where: { id: itemId, option_group_id: groupId, tenant_id: tenantId } });
    if (!item) throw new NotFoundException('Option item not found');
    const before = { ...item };
    if (data.name !== undefined) item.name = data.name;
    if (data.price_delta !== undefined) item.price_delta = MoneyUtil.format(data.price_delta || '0');
    if (data.is_default !== undefined) item.is_default = data.is_default;
    if (data.sort_order !== undefined) item.sort_order = data.sort_order;
    const saved = await this.itemRepo.save(item);
    await this.auditWriter.write({ tenantId, actorType: 'ADMIN', action: 'OPTION_ITEM_UPDATED', entityType: 'OptionItem', entityId: itemId, correlationId, beforeData: before, afterData: saved });
    return saved;
  }

  async archiveOptionItem(tenantId: string, groupId: string, itemId: string, correlationId: string) {
    const item = await this.itemRepo.findOne({ where: { id: itemId, option_group_id: groupId, tenant_id: tenantId } });
    if (!item) throw new NotFoundException('Option item not found');
    await this.itemRepo.softRemove(item);
    await this.auditWriter.write({ tenantId, actorType: 'ADMIN', action: 'OPTION_ITEM_ARCHIVED', entityType: 'OptionItem', entityId: itemId, correlationId });
    return { success: true };
  }

  async detachOptionGroupFromProduct(tenantId: string, productId: string, optionGroupId: string, correlationId: string) {
    await this.prodGroupRepo.delete({ tenant_id: tenantId, product_id: productId, option_group_id: optionGroupId });
    await this.auditWriter.write({ tenantId, actorType: 'ADMIN', action: 'OPTION_GROUP_DETACHED', entityType: 'Product', entityId: productId, correlationId, details: { optionGroupId } });
    return { success: true };
  }

  /** Which items of an attached group this product leaves out (Snappfood's per-product topping switch). */
  async setExcludedOptionItems(tenantId: string, productId: string, optionGroupId: string, excludedItemIds: string[], correlationId: string) {
    const link = await this.prodGroupRepo.findOne({ where: { tenant_id: tenantId, product_id: productId, option_group_id: optionGroupId } });
    if (!link) throw new NotFoundException('That add-on group is not on this product');
    const items = await this.itemRepo.find({ where: { tenant_id: tenantId, option_group_id: optionGroupId } });
    const known = new Set(items.map((i) => i.id));
    link.excluded_item_ids = [...new Set(excludedItemIds || [])].filter((id) => known.has(id));
    const saved = await this.prodGroupRepo.save(link);
    await this.auditWriter.write({ tenantId, actorType: 'ADMIN', action: 'PRODUCT_OPTION_ITEMS_SET', entityType: 'Product', entityId: productId, correlationId, details: { optionGroupId, excluded: link.excluded_item_ids } });
    return saved;
  }

  // Today's stock: how many of an item a branch has left to sell

  async getDailyStock(tenantId: string, branchId: string, date: string = BusinessDateUtil.today()) {
    const rows = await this.stockRepo.find({ where: { tenant_id: tenantId, branch_id: branchId, business_date: date } });
    const out = [];
    for (const row of rows) {
      const sold = await this.soldOn(this.stockRepo.manager, tenantId, branchId, date, row.product_id, row.variant_id);
      out.push({ ...row, sold, remaining: Math.max(0, row.quantity - sold) });
    }
    return out;
  }

  /** Set today's counts. A null or empty quantity clears the line: no limit again. */
  async setDailyStock(
    tenantId: string,
    branchId: string,
    entries: Array<{ productId: string; variantId?: string | null; quantity: number | null }>,
    correlationId: string,
  ) {
    if (!branchId) throw new BadRequestException("Stock is a branch's count; pick a branch first");
    const date = BusinessDateUtil.today();
    for (const entry of entries || []) {
      const where = {
        tenant_id: tenantId,
        branch_id: branchId,
        business_date: date,
        product_id: entry.productId,
        variant_id: entry.variantId || IsNull(),
      };
      const existing = await this.stockRepo.findOne({ where });
      const qty = entry.quantity === null || entry.quantity === undefined || (entry.quantity as unknown) === '' ? null : Number(entry.quantity);
      if (qty === null) {
        if (existing) await this.stockRepo.delete({ id: existing.id });
        continue;
      }
      if (!Number.isInteger(qty) || qty < 0) throw new BadRequestException('A stock count is a whole number, 0 or more');
      if (existing) {
        existing.quantity = qty;
        await this.stockRepo.save(existing);
      } else {
        await this.stockRepo.save(
          this.stockRepo.create({ tenant_id: tenantId, branch_id: branchId, business_date: date, product_id: entry.productId, variant_id: entry.variantId || null, quantity: qty }),
        );
      }
    }
    await this.auditWriter.write({ tenantId, actorType: 'ADMIN', action: 'DAILY_STOCK_SET', correlationId, details: { branchId, date, entries } });
    return this.getDailyStock(tenantId, branchId, date);
  }

  /** Units of a product (or one variant of it) on today's live orders at a branch. */
  private async soldOn(em: EntityManager, tenantId: string, branchId: string, date: string, productId: string, variantId?: string | null) {
    const params: unknown[] = [tenantId, branchId, date, productId];
    let variantClause = '';
    if (variantId) {
      params.push(variantId);
      variantClause = `AND i.variant_id = $5`;
    }
    const rows = await em.query(
      `SELECT COALESCE(SUM(i.quantity), 0) AS sold
         FROM order_item i
         JOIN order_header h ON h.id = i.order_id
        WHERE h.tenant_id = $1 AND h.branch_id = $2
          AND ${ORDER_BUSINESS_DATE_EXPR('h')} = $3
          AND h.state NOT IN ('CANCELLED', 'REJECTED')
          AND h.deleted_at IS NULL
          AND i.state = 'ACTIVE' AND i.product_id = $4 ${variantClause}`,
      params,
    );
    return Math.floor(Number(rows[0]?.sold || 0));
  }

  /**
   * Every rule on what may be sold, for a whole basket checked before anything is saved: the
   * kiosk builds its order in one go rather than line by line. Stops on the product, its size
   * or an add-on, selling windows, a combo's chosen dishes, the per-order cap and today's
   * stock, with lines of the same item added together.
   */
  async assertBasketSellable(
    tenantId: string,
    branchId: string | undefined,
    lines: Array<{ product: Product; variantId: string | null; quantity: number; optionItems: OptionItem[] }>,
    at: Date = new Date(),
  ) {
    const refuse = (code: string, message: string) => new BadRequestException({ statusCode: 400, code, message });

    for (const line of lines) {
      const stop = await this.getSuspension(tenantId, line.product.id, branchId, at, line.variantId);
      if (stop.outOfSchedule) throw refuse('PRODUCT_OUT_OF_SCHEDULE', `${line.product.name} is not on sale now. ${stop.reason}`);
      if (stop.isSuspended) throw refuse('PRODUCT_SUSPENDED', `${line.product.name} is not available now${stop.reason ? ` (${stop.reason})` : ''}`);
      for (const item of line.optionItems) {
        const itemStop = await this.getOptionItemStop(tenantId, item.id, branchId, at);
        if (itemStop.isSuspended) throw refuse('OPTION_SUSPENDED', `${item.name} is not available now`);
        if (item.product_id) {
          const dishStop = await this.getSuspension(tenantId, item.product_id, branchId, at);
          if (dishStop.isSuspended) throw refuse('PRODUCT_SUSPENDED', `${item.name} in ${line.product.name} is not available now`);
        }
      }
    }

    const byProduct = new Map<string, { product: Product; quantity: number }>();
    for (const line of lines) {
      const entry = byProduct.get(line.product.id) || { product: line.product, quantity: 0 };
      entry.quantity += line.quantity;
      byProduct.set(line.product.id, entry);
    }
    for (const { product, quantity } of byProduct.values()) {
      if (product.max_per_order && quantity > product.max_per_order) {
        throw refuse('PRODUCT_MAX_PER_ORDER', `At most ${product.max_per_order} × ${product.name} per order`);
      }
    }

    if (!branchId) return;
    const date = BusinessDateUtil.today(at);
    for (const { product } of byProduct.values()) {
      const counts = await this.stockRepo.find({ where: { tenant_id: tenantId, branch_id: branchId, business_date: date, product_id: product.id } });
      for (const count of counts) {
        const wanted = lines
          .filter((l) => l.product.id === product.id && (!count.variant_id || l.variantId === count.variant_id))
          .reduce((sum, l) => sum + l.quantity, 0);
        if (!wanted) continue;
        const left = count.quantity - (await this.soldOn(this.stockRepo.manager, tenantId, branchId, date, product.id, count.variant_id));
        if (wanted > left) {
          throw refuse('PRODUCT_OUT_OF_STOCK', left > 0 ? `Only ${left} × ${product.name} left today` : `${product.name} is sold out today`);
        }
      }
    }
  }

  /**
   * What a self-service menu should not offer right now at a branch: whole products that are
   * stopped, out of their window or sold out, and the sizes and add-ons that are.
   */
  async getUnavailableNow(tenantId: string, branchId?: string, at: Date = new Date()) {
    const live = (await this.getAvailabilities(tenantId, branchId)).filter((row) => this.stopIsLive(row, branchId, at));
    const products = new Set(live.filter((r) => r.product_id && !r.variant_id).map((r) => r.product_id as string));
    const variants = new Set(live.filter((r) => r.variant_id).map((r) => r.variant_id as string));
    const optionItems = new Set(live.filter((r) => r.option_item_id).map((r) => r.option_item_id as string));
    for (const off of await this.getOffScheduleProducts(tenantId, branchId, at)) products.add(off.product_id);
    if (branchId) {
      for (const row of await this.getDailyStock(tenantId, branchId, BusinessDateUtil.today(at))) {
        if (row.remaining > 0) continue;
        if (row.variant_id) variants.add(row.variant_id);
        else products.add(row.product_id);
      }
    }
    return { products, variants, optionItems };
  }

  /**
   * The checks on one order line that come from how the item is sold rather than what it
   * is: the per-order cap, today's stock count, and whether each add-on is offered on this
   * product and on sale. Run before the line is saved, inside the order's transaction, so
   * earlier lines of the same order already count against the stock.
   */
  async assertLineSellable(
    em: EntityManager,
    tenantId: string,
    order: { id: string; branch_id: string },
    product: Product,
    variantId: string | null,
    quantity: string,
    optionItems: OptionItem[],
  ) {
    const qty = Number(quantity);
    if (product.max_per_order) {
      const onOrder = await em.query(
        `SELECT COALESCE(SUM(quantity), 0) AS n FROM order_item WHERE order_id = $1 AND product_id = $2 AND state = 'ACTIVE'`,
        [order.id, product.id],
      );
      if (Number(onOrder[0]?.n || 0) + qty > product.max_per_order) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'PRODUCT_MAX_PER_ORDER',
          message: `At most ${product.max_per_order} × ${product.name} per order`,
        });
      }
    }

    if (order.branch_id) {
      const date = BusinessDateUtil.today();
      const counts = await em.find(DailyStock, { where: { tenant_id: tenantId, branch_id: order.branch_id, business_date: date, product_id: product.id } });
      for (const count of counts.filter((c) => !c.variant_id || c.variant_id === variantId)) {
        const left = count.quantity - (await this.soldOn(em, tenantId, order.branch_id, date, product.id, count.variant_id));
        if (qty > left) {
          throw new BadRequestException({
            statusCode: 400,
            code: 'PRODUCT_OUT_OF_STOCK',
            message: left > 0 ? `Only ${left} × ${product.name} left today` : `${product.name} is sold out today`,
          });
        }
      }
    }

    if (optionItems.length) {
      const links = await em.find(ProductOptionGroup, { where: { tenant_id: tenantId, product_id: product.id } });
      const excluded = new Set(links.flatMap((l) => l.excluded_item_ids || []));
      for (const item of optionItems) {
        if (excluded.has(item.id)) {
          throw new BadRequestException({ statusCode: 400, code: 'OPTION_NOT_OFFERED', message: `${item.name} is not offered on ${product.name}` });
        }
        const stop = await this.getOptionItemStop(tenantId, item.id, order.branch_id);
        if (stop.isSuspended) {
          throw new BadRequestException({ statusCode: 400, code: 'OPTION_SUSPENDED', message: `${item.name} is not available now${stop.reason ? ` (${stop.reason})` : ''}` });
        }
      }
    }
  }

  // Enhanced Price Resolution via PricingService
  async getEffectivePrice(tenantId: string, productId: string, priceGroupId?: string, branchId?: string, channel?: string) {
    const resolved = await this.pricingService.resolvePrice(tenantId, {
      productId,
      priceGroupId,
      branchId,
      channel,
    });

    const product = await this.getProductById(tenantId, productId);
    const suspension = await this.getSuspension(tenantId, productId, branchId);

    return {
      product_id: productId,
      base_price: product.base_price,
      effective_price: resolved.amount,
      resolution_source: resolved.resolutionSource,
      is_overridden: resolved.isOverridden,
      price_group_id: priceGroupId || null,
      branch_id: branchId || null,
      channel: channel || null,
      is_suspended: suspension.isSuspended,
      suspension_reason: suspension.reason,
    };
  }
}
