import { Injectable, NotFoundException, ConflictException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
import { MoneyUtil } from '../../common/utils/money.util';
import { AuditWriter } from '../audit/audit-writer.service';
import { PaginationQueryDto, createPagedResponse, PagedResponse } from '../../common/dto/pagination.dto';
import { PricingService } from '../pricing/pricing.service';

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
      return await this.prodRepo.find({ where, order: { code: 'ASC' } });
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
        optionGroups.push({ ...group, items });
      }
    }

    const variants = await this.variantRepo.find({
      where: { tenant_id: tenantId, product_id: id, is_active: true },
      order: { sort_order: 'ASC', code: 'ASC' },
    });

    return { ...prod, optionGroups, variants };
  }

  async createProduct(tenantId: string, data: { code: string; name: string; category_id: string; base_price: string; sku?: string; barcode?: string; description?: string; tax_rate?: string; image_asset_id?: string }, correlationId: string) {
    const code = data.code.toUpperCase();
    const existing = await this.prodRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Product code ${code} already exists`);

    const prod = this.prodRepo.create({
      tenant_id: tenantId,
      code,
      name: data.name,
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

    if (data.base_price) {
      data.base_price = MoneyUtil.format(data.base_price);
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

  async createOptionItem(tenantId: string, groupId: string, data: { code: string; name: string; price_delta?: string; is_default?: boolean; sort_order?: number }, correlationId: string) {
    const group = await this.groupRepo.findOne({ where: { id: groupId, tenant_id: tenantId } });
    if (!group) throw new NotFoundException('Option group not found');

    const item = this.itemRepo.create({
      tenant_id: tenantId,
      option_group_id: groupId,
      code: data.code.toUpperCase(),
      name: data.name,
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
  ): Promise<{ isSuspended: boolean; reason: string | null; suspendedUntil: Date | null }> {
    const rows = await this.availRepo.find({ where: { tenant_id: tenantId, product_id: productId } });
    const now = new Date();
    const active = rows.find(
      (row) =>
        (!row.branch_id || !branchId || row.branch_id === branchId) &&
        row.is_suspended &&
        (!row.suspended_until || new Date(row.suspended_until) > now),
    );
    return {
      isSuspended: !!active,
      reason: active?.reason || null,
      suspendedUntil: active?.suspended_until || null,
    };
  }

  async getAvailabilities(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    return await this.availRepo.find({ where });
  }

  /**
   * Take an item off sale. `hours` is how long for: omit it (or pass 0) and the
   * item stays off until somebody puts it back, which is how a branch says it
   * does not carry the item at all. Anything else is today's 86 and expires on
   * its own, because nobody remembers to un-86 the fish at closing time.
   */
  async suspendProduct(tenantId: string, productId: string, branchId?: string, hours?: number, reason?: string, correlationId?: string) {
    let avail = await this.availRepo.findOne({ where: { tenant_id: tenantId, product_id: productId, branch_id: branchId || null } });
    const suspendedUntil = hours && hours > 0 ? new Date(Date.now() + hours * 3600 * 1000) : null;

    if (!avail) {
      avail = this.availRepo.create({
        tenant_id: tenantId,
        product_id: productId,
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
      details: { productId, branchId, hours, reason, suspendedUntil },
    });

    return saved;
  }

  async resumeProduct(tenantId: string, productId: string, branchId?: string, correlationId?: string) {
    const avail = await this.availRepo.findOne({ where: { tenant_id: tenantId, product_id: productId, branch_id: branchId || null } });
    if (avail) {
      avail.is_suspended = false;
      avail.suspended_until = null;
      avail.reason = null;
      await this.availRepo.save(avail);
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRODUCT_RESUMED',
      correlationId: correlationId || '00000000-0000-0000-0000-000000000000',
      details: { productId, branchId },
    });

    return { success: true };
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
