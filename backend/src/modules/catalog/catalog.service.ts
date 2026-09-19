import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { Category } from '../../entities/Category.entity';
import { Product } from '../../entities/Product.entity';
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { ProductOptionGroup } from '../../entities/ProductOptionGroup.entity';
import { Menu } from '../../entities/Menu.entity';
import { MenuCategory } from '../../entities/MenuCategory.entity';
import { MenuProduct } from '../../entities/MenuProduct.entity';
import { ProductAvailability } from '../../entities/ProductAvailability.entity';
import { AvailabilitySchedule } from '../../entities/AvailabilitySchedule.entity';
import { Branch } from '../../entities/Branch.entity';
import { BranchOperatingHour } from '../../entities/BranchOperatingHour.entity';
import { DailyStock } from '../../entities/DailyStock.entity';
import { FileAsset } from '../../entities/FileAsset.entity';
import { assetUrl } from '../../common/utils/asset-url.util';
import { MoneyUtil } from '../../common/utils/money.util';
import { describeWindows, isOnSchedule, isValidTime, localClock, parseDays } from '../../common/utils/availability-schedule.util';
import { BUSINESS_TIME_ZONE, BusinessDateUtil, ORDER_BUSINESS_DATE_EXPR } from '../../common/utils/business-date.util';
import { AuditWriter } from '../audit/audit-writer.service';
import { PaginationQueryDto, createPagedResponse, PagedResponse } from '../../common/dto/pagination.dto';
import { PriceListService } from './price-lists.service';
import { PriceEntry } from '../../entities/PriceEntry.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { pickSettingValue } from '../../common/utils/setting-scope.util';
import { CHANNEL_PRICING_KEY, applyChannelRule, readChannelRule } from '../../common/utils/channel-price.util';
import { inStorePrice } from '../../common/utils/price-list.util';
import { inTreeOrder } from '../../common/utils/category-tree.util';

/** What besides a whole product a stop can be on, and how long it lasts. */
export interface StopTarget {
  variantId?: string;
  optionItemId?: string;
  /** Back on sale when the branch next opens, rather than after a number of hours. */
  untilNextShift?: boolean;
  /**
   * Off on one sales channel only (e.g. SNAPPFOOD: stopped on Snappfood, still sold in
   * store). Empty means off everywhere.
   */
  channel?: string | null;
}

/** The channels an item can be stopped on by itself. */
export const STOP_CHANNELS = ['SNAPPFOOD'];

/** Refusals that are a lost sale: the item was off (86'd, outside its hours or sold out). */
export const REFUSED_SALE_CODES = ['PRODUCT_SUSPENDED', 'PRODUCT_OUT_OF_SCHEDULE', 'PRODUCT_OUT_OF_STOCK'];

/** Which items a bulk stop is on: a category (with its sub-categories), or a list of products. */
export interface BulkStopTargets {
  categoryId?: string | null;
  productIds?: string[] | null;
  /** Each branch to act at; null is the whole chain (head office). */
  branchIds: Array<string | null>;
}

/** Who stopped or resumed an item, for the log: the signed-in user and whoever's pin released it. */
export interface StopActor {
  userId?: string | null;
  approverId?: string | null;
  /** Where it was done, e.g. POS for the register's tile. */
  source?: string;
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
    @InjectRepository(Menu) private readonly menuRepo: Repository<Menu>,
    @InjectRepository(MenuCategory) private readonly menuCatRepo: Repository<MenuCategory>,
    @InjectRepository(MenuProduct) private readonly menuProdRepo: Repository<MenuProduct>,
    @InjectRepository(ProductAvailability) private readonly availRepo: Repository<ProductAvailability>,
    @InjectRepository(AvailabilitySchedule) private readonly scheduleRepo: Repository<AvailabilitySchedule>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    @InjectRepository(BranchOperatingHour) private readonly hoursRepo: Repository<BranchOperatingHour>,
    @InjectRepository(DailyStock) private readonly stockRepo: Repository<DailyStock>,
    private readonly auditWriter: AuditWriter,
    private readonly priceLists: PriceListService,
  ) {}

  // Categories
  /**
   * The unpaged list is what menus read: tree order (each category followed by its
   * sub-categories), each with how many products it holds.
   */
  async getCategories(tenantId: string, query?: PaginationQueryDto & { search?: string }): Promise<PagedResponse<Category> | Category[]> {
    if (!query || (!query.page && !query.limit && !query.search)) {
      const rows = await this.catRepo.find({ where: { tenant_id: tenantId }, order: { sort_order: 'ASC', code: 'ASC' } });
      const counts: Array<{ category_id: string; n: string }> = await this.prodRepo
        .createQueryBuilder('p')
        .select('p.category_id', 'category_id')
        .addSelect('COUNT(*)', 'n')
        .where('p.tenant_id = :tenantId', { tenantId })
        .groupBy('p.category_id')
        .getRawMany();
      const countOf = new Map(counts.map((c) => [c.category_id, Number(c.n)]));
      return inTreeOrder(rows).map((c) => Object.assign(c, { product_count: countOf.get(c.id) || 0 }));
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

  /**
   * Where a category may sit. Categories nest one level, so the parent must be a top-level
   * category, and a category that holds sub-categories cannot itself go under another.
   */
  private async checkParent(tenantId: string, parentId: string | null, selfId?: string) {
    if (!parentId) return;
    const refuse = (code: string, message: string) => new BadRequestException({ statusCode: 400, code, message });
    if (parentId === selfId) throw refuse('CATEGORY_PARENT_INVALID', 'A category cannot sit under itself');
    const parent = await this.catRepo.findOne({ where: { id: parentId, tenant_id: tenantId } });
    if (!parent) throw new NotFoundException('Parent category not found');
    if (parent.parent_id) throw refuse('CATEGORY_TOO_DEEP', `${parent.name} is itself a sub-category; categories nest one level`);
    if (selfId && (await this.catRepo.count({ where: { tenant_id: tenantId, parent_id: selfId } })) > 0) {
      throw refuse('CATEGORY_HAS_SUBCATEGORIES', 'A category with sub-categories cannot go under another');
    }
  }

  /** The next place at the end of a category's siblings. */
  private async nextSortOrder(tenantId: string, parentId: string | null) {
    const siblings = await this.catRepo.find({ where: { tenant_id: tenantId, parent_id: parentId || IsNull() } });
    return siblings.reduce((max, c) => Math.max(max, c.sort_order || 0), 0) + 1;
  }

  async createCategory(tenantId: string, data: { code: string; name: string; parent_id?: string; sort_order?: number; image_asset_id?: string }, correlationId: string) {
    const code = (data.code || '').trim().toUpperCase();
    const name = (data.name || '').trim();
    if (!code || !name) throw new BadRequestException('A category needs a code and a name');
    const existing = await this.catRepo.findOne({ where: { tenant_id: tenantId, code }, withDeleted: true });
    if (existing) throw new ConflictException(`Category code ${code} already exists`);
    const parentId = data.parent_id || null;
    await this.checkParent(tenantId, parentId);

    const cat = this.catRepo.create({
      tenant_id: tenantId,
      code,
      name,
      parent_id: parentId,
      sort_order: data.sort_order ?? (await this.nextSortOrder(tenantId, parentId)),
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

  /** Rename a category or move it under another (or back to the top). Its code stays: other records refer to it. */
  async updateCategory(tenantId: string, id: string, data: Partial<Category>, correlationId: string) {
    const cat = await this.catRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!cat) throw new NotFoundException('Category not found');
    const before = { ...cat };

    if (data.name !== undefined) {
      const name = String(data.name || '').trim();
      if (!name) throw new BadRequestException('A category needs a name');
      cat.name = name;
    }
    if (data.parent_id !== undefined && (data.parent_id || null) !== (cat.parent_id || null)) {
      const parentId = data.parent_id || null;
      await this.checkParent(tenantId, parentId, id);
      cat.parent_id = parentId as string;
      cat.sort_order = await this.nextSortOrder(tenantId, parentId);
    } else if (data.sort_order !== undefined) {
      cat.sort_order = Number(data.sort_order) || 0;
    }
    if (data.image_asset_id !== undefined) cat.image_asset_id = (data.image_asset_id || null) as string;
    if (data.is_active !== undefined) cat.is_active = !!data.is_active;
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

  /** Put sibling categories (all top level, or all under one parent) in the order given. */
  async reorderCategories(tenantId: string, ids: string[], correlationId: string) {
    const unique = [...new Set(ids || [])];
    if (!unique.length) throw new BadRequestException('No categories to order');
    const rows = await this.catRepo.find({ where: { tenant_id: tenantId, id: In(unique) } });
    if (rows.length !== unique.length) throw new NotFoundException('Category not found');
    if (new Set(rows.map((r) => r.parent_id || '')).size > 1) {
      throw new BadRequestException({ statusCode: 400, code: 'CATEGORY_NOT_SIBLINGS', message: 'Only categories under the same parent can be ordered together' });
    }
    await this.catRepo.manager.transaction(async (em) => {
      for (const [index, id] of unique.entries()) {
        await em.update(Category, { id, tenant_id: tenantId }, { sort_order: index + 1 });
      }
    });
    await this.auditWriter.write({ tenantId, actorType: 'ADMIN', action: 'CATEGORIES_REORDERED', entityType: 'Category', correlationId, details: { ids: unique } });
    return this.getCategories(tenantId);
  }

  /**
   * Archive a category. One that still holds products is refused unless they move to another
   * category in the same step (audit C12: they used to lose their POS tab but stay orderable
   * elsewhere). One with sub-categories is refused until those move or go.
   */
  async archiveCategory(tenantId: string, id: string, correlationId: string, moveTo?: string) {
    const cat = await this.catRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!cat) throw new NotFoundException('Category not found');
    const refuse = (code: string, message: string, count: number) => new BadRequestException({ statusCode: 400, code, message, count });

    const children = await this.catRepo.count({ where: { tenant_id: tenantId, parent_id: id } });
    if (children) throw refuse('CATEGORY_HAS_SUBCATEGORIES', `${cat.name} has ${children} sub-categories; move or archive them first`, children);

    const products = await this.prodRepo.count({ where: { tenant_id: tenantId, category_id: id } });
    let target: Category | null = null;
    if (products) {
      if (!moveTo) throw refuse('CATEGORY_NOT_EMPTY', `${cat.name} still has ${products} products; move them to another category first`, products);
      if (moveTo === id) throw new BadRequestException('Pick a different category to move the products to');
      target = await this.catRepo.findOne({ where: { id: moveTo, tenant_id: tenantId } });
      if (!target) throw new NotFoundException('Category to move the products to not found');
    }

    await this.catRepo.manager.transaction(async (em) => {
      if (target) await em.update(Product, { tenant_id: tenantId, category_id: id }, { category_id: target.id });
      cat.is_active = false;
      await em.save(cat);
      await em.softRemove(cat);
    });

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'CATEGORY_ARCHIVED',
      entityType: 'Category',
      entityId: id,
      correlationId,
      details: target ? { movedProducts: products, movedTo: target.id } : undefined,
    });

    return { success: true, movedProducts: target ? products : 0 };
  }

  // Products
  async getProducts(tenantId: string, categoryId?: string, query?: PaginationQueryDto & { search?: string }): Promise<PagedResponse<Product> | Product[]> {
    if (!query || (!query.page && !query.limit && !query.search)) {
      const where: any = { tenant_id: tenantId };
      if (categoryId) where.category_id = categoryId;
      const products = await this.prodRepo.find({ where, order: { code: 'ASC' } });
      // Variants ride along so a list can show the hot and the cold sandwich as rows of their own.
      const variants = await this.variantRepo.find({ where: { tenant_id: tenantId, is_active: true }, order: { sort_order: 'ASC', code: 'ASC' } });
      // The main photo's address, so a list can show a thumbnail without a request per product.
      const imageIds = [...new Set(products.map((p) => p.image_asset_id).filter(Boolean))];
      const images = imageIds.length ? await this.prodRepo.manager.find(FileAsset, { where: { tenant_id: tenantId, id: In(imageIds) } }) : [];
      const urlOf = new Map(images.map((a) => [a.id, assetUrl(a.file_path)]));
      return products.map((p) =>
        Object.assign(p, {
          variants: (variants || []).filter((v) => v.product_id === p.id),
          image_url: (p.image_asset_id && urlOf.get(p.image_asset_id)) || null,
        }),
      );
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
    if (data.base_price && !MoneyUtil.equals(before.base_price, saved.base_price)) await this.endDatedBasePrice(tenantId, id, null);

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

  /**
   * A base price typed on the product page is the price from now on, so a dated base price in
   * force (from a price change) ends here; otherwise it would keep winning, and the sweep that
   * copies it into the product would put the old figure back. Changes dated later still apply.
   */
  private async endDatedBasePrice(tenantId: string, productId: string, variantId: string | null) {
    const now = new Date();
    await this.prodRepo.manager
      .createQueryBuilder()
      .update(PriceEntry)
      .set({ effective_to: now })
      .where('tenant_id = :tenantId AND product_id = :productId', { tenantId, productId })
      .andWhere(variantId ? 'variant_id = :variantId' : 'variant_id IS NULL', { variantId })
      .andWhere('price_group_id IS NULL AND branch_id IS NULL AND channel IS NULL AND order_type IS NULL AND modifier_option_id IS NULL')
      .andWhere('effective_from <= :now AND (effective_to IS NULL OR effective_to > :now)', { now })
      .execute();
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
    if (data.base_price && !MoneyUtil.equals(before.base_price, saved.base_price)) await this.endDatedBasePrice(tenantId, productId, variantId);

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
    by: StopActor = {},
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
      actorId: by.userId || undefined,
      action: 'PRODUCT_SUSPENDED',
      branchId,
      correlationId: correlationId || '00000000-0000-0000-0000-000000000000',
      details: { ...key, branchId, hours, untilNextShift: !!target.untilNextShift, reason, suspendedUntil, approverId: by.approverId || null, source: by.source || 'ADMIN' },
    });

    return saved;
  }

  async resumeProduct(tenantId: string, productId: string | undefined, branchId?: string, correlationId?: string, target: StopTarget = {}, by: StopActor = {}) {
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
      if (chainWide && this.stopIsLive(chainWide, branchId, new Date(), key.channel || undefined)) {
        throw new BadRequestException({ statusCode: 400, code: 'CHAIN_WIDE_STOP', message: 'Head office took this off sale at every branch; only head office can put it back' });
      }
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: by.userId || undefined,
      action: 'PRODUCT_RESUMED',
      branchId,
      correlationId: correlationId || '00000000-0000-0000-0000-000000000000',
      details: { ...key, branchId, approverId: by.approverId || null, source: by.source || 'ADMIN' },
    });

    return { success: true };
  }

  /** The products a bulk stop covers: a category's (and its sub-categories'), or the ones named. */
  private async bulkProducts(tenantId: string, targets: BulkStopTargets) {
    let products: Product[];
    if (targets.categoryId) {
      const category = await this.catRepo.findOne({ where: { id: targets.categoryId, tenant_id: tenantId } });
      if (!category) throw new NotFoundException('Category not found');
      const children = await this.catRepo.find({ where: { tenant_id: tenantId, parent_id: category.id } });
      products = await this.prodRepo.find({ where: { tenant_id: tenantId, is_active: true, category_id: In([category.id, ...children.map((c) => c.id)]) } });
    } else {
      const ids = [...new Set(targets.productIds || [])];
      products = ids.length ? await this.prodRepo.find({ where: { tenant_id: tenantId, id: In(ids) } }) : [];
      if (products.length !== ids.length) throw new NotFoundException('Product not found');
    }
    if (!products.length) throw new BadRequestException({ statusCode: 400, code: 'NOTHING_TO_STOP', message: 'Pick a category with products in it, or the products to stop' });
    const branchIds = [...new Set(targets.branchIds)];
    const named = branchIds.filter((b): b is string => !!b);
    if (named.length && (await this.branchRepo.count({ where: { tenant_id: tenantId, id: In(named) } })) !== named.length) {
      throw new NotFoundException('Branch not found');
    }
    return { products, branchIds: branchIds.length ? branchIds : [null] };
  }

  /**
   * One stop on many items or branches: a whole category ("the grill is down"), or one item at
   * several branches. Each item gets a stop of its own, logged as usual, so each can be put
   * back by itself.
   */
  async bulkStop(
    tenantId: string,
    targets: BulkStopTargets,
    stop: { hours?: number; untilNextShift?: boolean; reason: string; channel?: string | null },
    correlationId: string,
    by: StopActor = {},
  ) {
    const { products, branchIds } = await this.bulkProducts(tenantId, targets);
    for (const branchId of branchIds) {
      for (const product of products) {
        await this.suspendProduct(tenantId, product.id, branchId || undefined, stop.hours, stop.reason, correlationId, { untilNextShift: stop.untilNextShift, channel: stop.channel || null }, by);
      }
    }
    return { products: products.length, branches: branchIds.length, stopped: products.length * branchIds.length };
  }

  /** Put the items of a bulk stop back. A branch can't lift head office's chain-wide stops; those are counted, not failed. */
  async bulkResume(tenantId: string, targets: BulkStopTargets, channel: string | null, correlationId: string, by: StopActor = {}) {
    const { products, branchIds } = await this.bulkProducts(tenantId, targets);
    let resumed = 0;
    let chainWide = 0;
    for (const branchId of branchIds) {
      for (const product of products) {
        try {
          await this.resumeProduct(tenantId, product.id, branchId || undefined, correlationId, { channel }, by);
          resumed++;
        } catch (err: any) {
          if (err?.response?.code !== 'CHAIN_WIDE_STOP') throw err;
          chainWide++;
        }
      }
    }
    return { resumed, chain_wide: chainWide };
  }

  /**
   * A sale refused because the item was off: the register or kiosk tried to sell it while it
   * was stopped, outside its hours or sold out. The stop report counts these as lost sales.
   */
  async recordRefusedSale(
    tenantId: string,
    sale: { branchId?: string | null; productId: string; variantId?: string | null; quantity: number; code: string; channel?: string | null },
  ) {
    await this.auditWriter.write({
      tenantId,
      actorType: 'SYSTEM',
      action: 'SALE_REFUSED',
      entityType: 'Product',
      entityId: sale.productId,
      branchId: sale.branchId || undefined,
      details: { productId: sale.productId, variantId: sale.variantId || null, quantity: sale.quantity, code: sale.code, channel: sale.channel || null },
    });
  }

  /** What a stop is on: a whole product, one of its variants, or an add-on item; everywhere or on one channel. */
  private stopKey(productId: string | undefined, target: StopTarget) {
    const channel = target.channel ? String(target.channel).toUpperCase() : null;
    if (channel && !STOP_CHANNELS.includes(channel)) {
      throw new BadRequestException(`An item can be stopped everywhere or on ${STOP_CHANNELS.join(', ')} only`);
    }
    if (target.optionItemId) return { product_id: null, variant_id: null, option_item_id: target.optionItemId, channel };
    if (!productId) throw new BadRequestException('Say which product, variant or add-on to take off sale');
    return { product_id: productId, variant_id: target.variantId || null, option_item_id: null, channel };
  }

  // A null in a TypeORM where is ignored, not matched, so each empty key is IsNull() explicitly.
  private stopWhere(tenantId: string, key: ReturnType<CatalogService['stopKey']>, branchId?: string) {
    return {
      tenant_id: tenantId,
      product_id: key.product_id ?? IsNull(),
      variant_id: key.variant_id ?? IsNull(),
      option_item_id: key.option_item_id ?? IsNull(),
      branch_id: branchId || IsNull(),
      channel: key.channel ?? IsNull(),
    };
  }

  /**
   * Whether a stop row takes the item off sale for a sale at `branchId` on `channel`. A stop on
   * one channel (Snappfood) does not reach any other: the register and the kiosk pass no channel,
   * so a Snappfood-only stop never stops a sale in store.
   */
  private stopIsLive(row: ProductAvailability, branchId: string | undefined, at: Date, channel?: string) {
    return (
      (!row.channel || row.channel === channel) &&
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
    // As for a product's price: a price typed here is the price from now on, so a dated add-on
    // price in force (from a price change) ends, or the sweep would put its figure back.
    if (data.price_delta !== undefined && !MoneyUtil.equals(before.price_delta || '0', saved.price_delta || '0')) {
      await this.prodRepo.manager
        .createQueryBuilder()
        .update(PriceEntry)
        .set({ effective_to: new Date() })
        .where('tenant_id = :tenantId AND modifier_option_id = :itemId AND product_id IS NULL', { tenantId, itemId })
        .andWhere('price_group_id IS NULL AND branch_id IS NULL AND channel IS NULL AND order_type IS NULL')
        .andWhere('effective_from <= :now AND (effective_to IS NULL OR effective_to > :now)', { now: new Date() })
        .execute();
    }
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

  /**
   * Today's counts for some products at a branch, locked until the caller's transaction ends.
   * Two registers selling the last unit both read "1 left" without it; with it the second
   * waits for the first to commit, and then counts the first one's line as sold. Rows are
   * locked in id order so two baskets of the same items cannot deadlock.
   */
  async lockStockCounts(em: EntityManager, tenantId: string, branchId: string, date: string, productIds: string[]): Promise<DailyStock[]> {
    const ids = [...new Set(productIds)];
    if (!ids.length) return [];
    return em
      .createQueryBuilder(DailyStock, 's')
      .where('s.tenant_id = :tenantId AND s.branch_id = :branchId AND s.business_date = :date AND s.product_id IN (:...ids)', { tenantId, branchId, date, ids })
      .orderBy('s.id')
      .setLock('pessimistic_write')
      .getMany();
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
   * stock, with lines of the same item added together. Given the transaction that will save
   * the order, the stock counts stay locked until it commits (see `lockStockCounts`).
   */
  async assertBasketSellable(
    tenantId: string,
    branchId: string | undefined,
    lines: Array<{ product: Product; variantId: string | null; quantity: number; optionItems: OptionItem[] }>,
    at: Date = new Date(),
    em?: EntityManager,
  ) {
    const refuse = (code: string, message: string, productId?: string) => new BadRequestException({ statusCode: 400, code, message, productId });

    for (const line of lines) {
      const stop = await this.getSuspension(tenantId, line.product.id, branchId, at, line.variantId);
      if (stop.outOfSchedule) throw refuse('PRODUCT_OUT_OF_SCHEDULE', `${line.product.name} is not on sale now. ${stop.reason}`, line.product.id);
      if (stop.isSuspended) throw refuse('PRODUCT_SUSPENDED', `${line.product.name} is not available now${stop.reason ? ` (${stop.reason})` : ''}`, line.product.id);
      for (const item of line.optionItems) {
        const itemStop = await this.getOptionItemStop(tenantId, item.id, branchId, at);
        if (itemStop.isSuspended) throw refuse('OPTION_SUSPENDED', `${item.name} is not available now`);
        if (item.product_id) {
          const dishStop = await this.getSuspension(tenantId, item.product_id, branchId, at);
          if (dishStop.isSuspended) throw refuse('PRODUCT_SUSPENDED', `${item.name} in ${line.product.name} is not available now`, line.product.id);
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
    const reader = em || this.stockRepo.manager;
    const allCounts = em
      ? await this.lockStockCounts(em, tenantId, branchId, date, [...byProduct.keys()])
      : await this.stockRepo.find({ where: { tenant_id: tenantId, branch_id: branchId, business_date: date, product_id: In([...byProduct.keys()]) } });
    for (const { product } of byProduct.values()) {
      const counts = allCounts.filter((c) => c.product_id === product.id);
      for (const count of counts) {
        const wanted = lines
          .filter((l) => l.product.id === product.id && (!count.variant_id || l.variantId === count.variant_id))
          .reduce((sum, l) => sum + l.quantity, 0);
        if (!wanted) continue;
        const left = count.quantity - (await this.soldOn(reader, tenantId, branchId, date, product.id, count.variant_id));
        if (wanted > left) {
          throw refuse('PRODUCT_OUT_OF_STOCK', left > 0 ? `Only ${left} × ${product.name} left today` : `${product.name} is sold out today`, product.id);
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
      // Locked until the order's transaction commits, so a second register selling the same
      // item waits here and then sees this line as sold (audit C11).
      const counts = await this.lockStockCounts(em, tenantId, order.branch_id, date, [product.id]);
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

  // Aggregator price sheet: what each item costs on a delivery channel (Snappfood). The
  // prototype does not push a menu to Snappfood, so this is the list someone types into the
  // vendor panel; the real product syncs the same prices. Orders from the channel keep the
  // prices the channel charged.

  private async channelRule(tenantId: string, channel: string) {
    const rows = await this.prodRepo.manager.find(TenantSetting, { where: { tenant_id: tenantId, key: CHANNEL_PRICING_KEY } });
    return readChannelRule(pickSettingValue(rows, null), channel);
  }

  /**
   * One row per product, or per size of a product sold in sizes, and one per add-on: the
   * in-store price, what the channel's markup rule makes of it, any fixed price set for the
   * item on the channel, and the price that applies. Add-ons follow the rule only. With a
   * branch, the in-store price is that branch's (its price list's, else base); a fixed
   * channel price is the same at every branch.
   */
  async getChannelPriceSheet(tenantId: string, channel: string, branchId: string | null = null) {
    const rule = await this.channelRule(tenantId, channel);
    const products = await this.prodRepo.find({ where: { tenant_id: tenantId, is_active: true }, order: { code: 'ASC' } });
    const variants = await this.variantRepo.find({ where: { tenant_id: tenantId, is_active: true }, order: { sort_order: 'ASC', code: 'ASC' } });
    const now = new Date();
    const list = await this.priceLists.listForBranch(tenantId, branchId);
    const listed = await this.priceLists.pricesForBranch(tenantId, branchId, now);
    const fixed = (await this.prodRepo.manager.find(PriceEntry, { where: { tenant_id: tenantId, channel } })).filter(
      (e) => !e.branch_id && !e.price_group_id && !e.modifier_option_id && new Date(e.effective_from) <= now && (!e.effective_to || new Date(e.effective_to) > now),
    );
    // What is off on the channel: stops on it and stops everywhere. With no branch, only the
    // chain-wide ones, since a branch's own stop says nothing about the others.
    const stops = (await this.getAvailabilities(tenantId, branchId || undefined)).filter(
      (s) => s.product_id && !s.option_item_id && (branchId || !s.branch_id) && this.stopIsLive(s, branchId || undefined, now, channel),
    );
    const offOf = (product: Product, variant: ProductVariant | null) => {
      const stop = stops.find((s) => s.product_id === product.id && (!s.variant_id || s.variant_id === variant?.id));
      return stop ? { reason: stop.reason || null, until: stop.suspended_until || null, everywhere: !stop.channel, chain_wide: !stop.branch_id } : null;
    };
    const row = (product: Product, variant: ProductVariant | null) => {
      const base = inStorePrice(listed, product, variant);
      const rulePrice = applyChannelRule(base, rule);
      const own = fixed.find((e) => e.product_id === product.id && (e.variant_id || null) === (variant?.id || null));
      return {
        product_id: product.id,
        variant_id: variant?.id || null,
        category_id: product.category_id,
        name: variant ? `${product.name} — ${variant.name}` : product.name,
        base_price: MoneyUtil.format(base),
        rule_price: rulePrice,
        fixed_price: own ? MoneyUtil.format(own.amount) : null,
        price: own ? MoneyUtil.format(own.amount) : rulePrice,
        off: offOf(product, variant),
      };
    };
    const items = products.flatMap((p) => {
      const sizes = variants.filter((v) => v.product_id === p.id);
      return sizes.length ? sizes.map((v) => row(p, v)) : [row(p, null)];
    });
    const addOns = (await this.itemRepo.find({ where: { tenant_id: tenantId }, order: { name: 'ASC' } }))
      .filter((i) => MoneyUtil.greaterThan(i.price_delta || '0', '0'))
      .map((i) => ({ option_item_id: i.id, name: i.name, base_price: MoneyUtil.format(i.price_delta), price: applyChannelRule(i.price_delta, rule) }));
    return { channel, rule, branch_id: branchId, price_list: list ? { id: list.id, name: list.name } : null, items, add_ons: addOns };
  }

  /** Fix one item's price on a channel, or clear it (amount null) so it follows the rule again. */
  async setChannelFixedPrice(
    tenantId: string,
    channel: string,
    productId: string,
    variantId: string | null,
    amount: string | null,
    correlationId: string,
    branchId: string | null = null,
  ) {
    const product = await this.prodRepo.findOne({ where: { id: productId, tenant_id: tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    if (amount !== null && (!MoneyUtil.isValid(amount) || MoneyUtil.lessThan(amount, '0'))) {
      throw new BadRequestException('A price is a number, 0 or more');
    }
    const em = this.prodRepo.manager;
    await em.delete(PriceEntry, {
      tenant_id: tenantId,
      channel,
      product_id: productId,
      variant_id: variantId || IsNull(),
      branch_id: IsNull(),
      price_group_id: IsNull(),
      modifier_option_id: IsNull(),
    });
    if (amount !== null) {
      await em.save(
        em.create(PriceEntry, {
          tenant_id: tenantId,
          product_id: productId,
          variant_id: variantId || null,
          channel,
          price_type: 'CHANNEL',
          currency_code: 'IRR',
          amount: MoneyUtil.format(amount),
        }),
      );
    }
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'CHANNEL_PRICE_SET',
      entityType: 'Product',
      entityId: productId,
      correlationId,
      details: { channel, variantId, amount },
    });
    return this.getChannelPriceSheet(tenantId, channel, branchId);
  }
}
