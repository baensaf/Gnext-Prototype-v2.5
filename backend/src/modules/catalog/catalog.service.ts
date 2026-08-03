import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from '../../entities/Category.entity';
import { Product } from '../../entities/Product.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { ProductOptionGroup } from '../../entities/ProductOptionGroup.entity';
import { PriceGroup } from '../../entities/PriceGroup.entity';
import { PriceGroupItem } from '../../entities/PriceGroupItem.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Category) private readonly catRepo: Repository<Category>,
    @InjectRepository(Product) private readonly prodRepo: Repository<Product>,
    @InjectRepository(OptionGroup) private readonly groupRepo: Repository<OptionGroup>,
    @InjectRepository(OptionItem) private readonly itemRepo: Repository<OptionItem>,
    @InjectRepository(ProductOptionGroup) private readonly prodGroupRepo: Repository<ProductOptionGroup>,
    @InjectRepository(PriceGroup) private readonly priceGroupRepo: Repository<PriceGroup>,
    @InjectRepository(PriceGroupItem) private readonly priceItemRepo: Repository<PriceGroupItem>,
    private readonly auditWriter: AuditWriter,
  ) {}

  // Categories
  async getCategories(tenantId: string) {
    return await this.catRepo.find({ where: { tenant_id: tenantId }, order: { sort_order: 'ASC', code: 'ASC' } });
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
  async getProducts(tenantId: string, categoryId?: string) {
    const where: any = { tenant_id: tenantId };
    if (categoryId) where.category_id = categoryId;
    return await this.prodRepo.find({ where, order: { code: 'ASC' } });
  }

  async getProductById(tenantId: string, id: string) {
    const prod = await this.prodRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!prod) throw new NotFoundException('Product not found');

    // Fetch attached option groups
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

    return { ...prod, optionGroups };
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
      tax_rate: data.tax_rate || '0.1000', // Default 10% VAT
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

  // Option Groups & Items
  async getOptionGroups(tenantId: string) {
    const groups = await this.groupRepo.find({ where: { tenant_id: tenantId }, order: { code: 'ASC' } });
    const result = [];
    for (const g of groups) {
      const items = await this.itemRepo.find({ where: { option_group_id: g.id, tenant_id: tenantId }, order: { sort_order: 'ASC' } });
      result.push({ ...g, items });
    }
    return result;
  }

  async createOptionGroup(tenantId: string, data: { code: string; name: string; min_selection?: number; max_selection?: number; is_required?: boolean }, correlationId: string) {
    const code = data.code.toUpperCase();
    const existing = await this.groupRepo.findOne({ where: { tenant_id: tenantId, code } });
    if (existing) throw new ConflictException(`Option group ${code} already exists`);

    const group = this.groupRepo.create({
      tenant_id: tenantId,
      code,
      name: data.name,
      min_selection: data.min_selection ?? 0,
      max_selection: data.max_selection ?? 1,
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

  async getEffectivePrice(tenantId: string, productId: string, priceGroupId?: string) {
    const product = await this.getProductById(tenantId, productId);
    let effectivePrice = product.base_price;
    let isOverridden = false;

    if (priceGroupId) {
      const override = await this.priceItemRepo.findOne({ where: { tenant_id: tenantId, price_group_id: priceGroupId, product_id: productId } });
      if (override) {
        effectivePrice = override.override_price;
        isOverridden = true;
      }
    }

    return {
      product_id: productId,
      base_price: product.base_price,
      effective_price: MoneyUtil.format(effectivePrice),
      is_overridden: isOverridden,
      price_group_id: priceGroupId || null,
    };
  }
}
