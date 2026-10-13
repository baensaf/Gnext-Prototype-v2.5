import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ChannelItemMap, ChannelEntityType } from '../../entities/ChannelItemMap.entity';
import { Category } from '../../entities/Category.entity';
import { Product } from '../../entities/Product.entity';
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { ProductOptionGroup } from '../../entities/ProductOptionGroup.entity';
import { Branch } from '../../entities/Branch.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { IntegrationLog } from '../../entities/IntegrationLog.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { CatalogService } from '../catalog/catalog.service';

/**
 * The Snappfood menu sync, simulated (2026-10-12): how our menu becomes the vendor's menu on
 * Snappfood and back, as annex 4.3.0 describes it. Nothing leaves the building; every call is
 * written to the integration log with the body a live connection would send, so a developer
 * can see the contract. docs/snappfood-menu-sync.md explains it.
 *
 * - IDs. Snappfood keys menus, products and toppings by OUR integers ("ID in your dataset").
 *   Each record gets one from a single sequence per tenant (toppings may not share a product's
 *   id). A product sold in types is sent as one Snappfood product per type, grouped by
 *   productTitle, so each type has its own id.
 * - Match. Each branch is a Snappfood vendor that already has a menu there. The vendor's
 *   products are read (GET /va/v1.1/product), matched to ours by name, and each match is told
 *   to Snappfood (POST /va/v1/product/sync/productId), which links its productCode to our id.
 * - Send. Categories, products, toppings, which toppings each product offers, stock and prices
 *   are sent with the annex's calls, in that order, after checking Snappfood's limits.
 * - Orders. A Snappfood order names each line and topping by our id; see resolveIncoming.
 */

export const SNAPPFOOD = 'SNAPPFOOD';
const FIRST_EXTERNAL_ID = 1001;
/** Food Partner's limits: a title of 64 characters, a description of 256, a price of 1,000 to 20 million Toman. */
export const SNAPPFOOD_LIMITS = { title: 64, description: 256, minPriceToman: 1000, maxPriceToman: 20_000_000 };
/** The simulated vendor menu on Snappfood's side, one per branch. */
const VENDOR_MENU_KEY = 'SIM_SNAPPFOOD_VENDOR_MENU';
/** "Until further notice" has no end on Snappfood's side; a stop without a date there ends tomorrow. */
const FAR_FUTURE = '2099-12-31 23:59:59';

const toman = (rial: string | number) => Number(MoneyUtil.divide(MoneyUtil.format(rial || 0), '10', 0));
const code = (length = 10) => crypto.randomBytes(16).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, length);
/** Names as people type them: Arabic ي/ك as Persian, no half-spaces, one space, lower case. */
export const normalizeName = (s: string) =>
  (s || '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/‌/g, ' ')
    .replace(/[()\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const sfDate = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);

/** One thing our menu sells to Snappfood: a product, or one type of a product sold in types. */
interface Sellable {
  type: 'PRODUCT' | 'VARIANT';
  entityId: string;
  product: Product;
  variant: ProductVariant | null;
  /** As Snappfood lists it: the product's name and the type's. */
  title: string;
}

/** A Snappfood product as GET /va/v1.1/product returns it (the annex's sample shape). */
export interface VendorProduct {
  productId: number | null;
  productCode: string;
  title: string;
  description: string;
  price: number;
  vat: number;
  isActive: boolean;
  isReviewed: boolean;
  capacity: number | null;
  stock: null;
  productType: [];
  containerPrice: number;
  disabled: boolean;
  disabledUntil: string | null;
  schedules: [];
  images: [];
  toppings: Array<{ vmsFoodId: number; title: string; price: number; toppingGroupId: number | null; active: boolean; disabled: boolean; disabledUntil: null; description: null }>;
  menuCategory: { vmsCategoryId: number | null; categoryCode: string; title: string; isActive: boolean; isDeleted: boolean; isReviewed: boolean; visibility: boolean };
}

@Injectable()
export class SnappfoodCatalogService {
  constructor(
    @InjectRepository(ChannelItemMap) private readonly mapRepo: Repository<ChannelItemMap>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    @InjectRepository(TenantSetting) private readonly settingRepo: Repository<TenantSetting>,
    @InjectRepository(IntegrationLog) private readonly logRepo: Repository<IntegrationLog>,
    private readonly catalog: CatalogService,
  ) {}

  private get em(): EntityManager {
    return this.mapRepo.manager;
  }

  // ---------------------------------------------------------------- IDs

  /**
   * Our integer for every live category, product (or type), add-on group and add-on, made the
   * first time it is asked for and never changed after: Snappfood keeps it.
   */
  async ids(tenantId: string): Promise<Map<string, ChannelItemMap>> {
    const [categories, products, variants, groups, items] = await Promise.all([
      this.em.find(Category, { where: { tenant_id: tenantId }, order: { sort_order: 'ASC', name: 'ASC' } }),
      this.em.find(Product, { where: { tenant_id: tenantId }, order: { sort_order: 'ASC', name: 'ASC' } }),
      this.em.find(ProductVariant, { where: { tenant_id: tenantId }, order: { sort_order: 'ASC', code: 'ASC' } }),
      this.em.find(OptionGroup, { where: { tenant_id: tenantId }, order: { created_at: 'ASC' } }),
      this.em.find(OptionItem, { where: { tenant_id: tenantId }, order: { sort_order: 'ASC', created_at: 'ASC' } }),
    ]);
    const wanted: Array<[ChannelEntityType, string]> = [
      ...categories.map((c) => ['CATEGORY', c.id] as [ChannelEntityType, string]),
      ...products.flatMap((p) => {
        const own = variants.filter((v) => v.product_id === p.id);
        return own.length ? own.map((v) => ['VARIANT', v.id] as [ChannelEntityType, string]) : [['PRODUCT', p.id] as [ChannelEntityType, string]];
      }),
      ...groups.map((g) => ['OPTION_GROUP', g.id] as [ChannelEntityType, string]),
      ...items.map((i) => ['OPTION_ITEM', i.id] as [ChannelEntityType, string]),
    ];
    const rows = await this.mapRepo.find({ where: { tenant_id: tenantId, channel: SNAPPFOOD } });
    const byKey = new Map(rows.map((r) => [`${r.entity_type}:${r.entity_id}`, r]));
    let next = rows.reduce((top, r) => Math.max(top, r.external_id + 1), FIRST_EXTERNAL_ID);
    const fresh = wanted
      .filter(([type, id]) => !byKey.has(`${type}:${id}`))
      .map(([type, id]) =>
        this.mapRepo.create({ tenant_id: tenantId, channel: SNAPPFOOD, entity_type: type, entity_id: id, external_id: next++, channel_codes: {}, synced_at: {} }),
      );
    if (fresh.length) for (const row of await this.mapRepo.save(fresh)) byKey.set(`${row.entity_type}:${row.entity_id}`, row);
    return byKey;
  }

  /** What our integer stands for, for a Snappfood order line or topping. */
  async byExternalId(tenantId: string, externalIds: number[]): Promise<Map<number, ChannelItemMap>> {
    const wanted = [...new Set(externalIds.filter((n) => Number.isInteger(n)))];
    if (!wanted.length) return new Map();
    const rows = await this.mapRepo.find({ where: { tenant_id: tenantId, channel: SNAPPFOOD, external_id: In(wanted) } });
    return new Map(rows.map((r) => [r.external_id, r]));
  }

  // ---------------------------------------------------------------- the vendor (branch)

  private async branch(tenantId: string, branchId: string): Promise<Branch> {
    const branch = await this.branchRepo.findOne({ where: { id: branchId, tenant_id: tenantId } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  /** The branch's vendor code on Snappfood. A live connection keeps the one Snappfood gives out. */
  vendorCode(branch: Branch): string {
    return `sf${(branch.code || branch.id).toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(0, 12);
  }

  async branchForVendor(tenantId: string, vendorCode?: string): Promise<Branch | null> {
    if (!vendorCode) return null;
    const branches = await this.branchRepo.find({ where: { tenant_id: tenantId } });
    return branches.find((b) => this.vendorCode(b) === vendorCode) || null;
  }

  /** What our menu sells, product by product and type by type, live products only. */
  private async sellables(tenantId: string): Promise<Sellable[]> {
    const categories = await this.em.find(Category, { where: { tenant_id: tenantId, is_active: true } });
    const live = new Set(categories.map((c) => c.id));
    const products = (await this.em.find(Product, { where: { tenant_id: tenantId, is_active: true }, order: { sort_order: 'ASC', name: 'ASC' } }))
      .filter((p) => live.has(p.category_id));
    const variants = await this.em.find(ProductVariant, { where: { tenant_id: tenantId, is_active: true }, order: { sort_order: 'ASC', code: 'ASC' } });
    return products.flatMap((p): Sellable[] => {
      const own = variants.filter((v) => v.product_id === p.id);
      return own.length
        ? own.map((v) => ({ type: 'VARIANT' as const, entityId: v.id, product: p, variant: v, title: `${p.name} ${v.name}` }))
        : [{ type: 'PRODUCT' as const, entityId: p.id, product: p, variant: null, title: p.name }];
    });
  }

  // ---------------------------------------------------------------- Snappfood's side (simulated)

  /**
   * The vendor's menu as Snappfood has it, which the simulator keeps per branch. The first time
   * it is made from our menu the way a restaurant typed it into Food Partner: mostly the same
   * dishes, spelled a little differently, one of ours missing and two of Snappfood's own.
   */
  async vendorMenu(tenantId: string, branchId: string): Promise<{ vendorCode: string; products: VendorProduct[] }> {
    const branch = await this.branch(tenantId, branchId);
    const stored = await this.settingRepo.findOne({ where: { tenant_id: tenantId, branch_id: branchId, key: VENDOR_MENU_KEY } });
    if (stored?.value?.products) return { vendorCode: this.vendorCode(branch), products: stored.value.products };

    const sheet = await this.catalog.getChannelPriceSheet(tenantId, SNAPPFOOD, branchId);
    const priceOf = (s: Sellable) => sheet.items.find((i) => i.product_id === s.product.id && (i.variant_id || null) === (s.variant?.id || null))?.price || '0';
    const categories = await this.em.find(Category, { where: { tenant_id: tenantId, is_active: true }, order: { sort_order: 'ASC' } });
    const categoryCode = new Map(categories.map((c) => [c.id, code(11)]));
    const ours = await this.sellables(tenantId);
    const products: VendorProduct[] = ours
      // A dish the restaurant never put on Snappfood.
      .filter((_, index) => index !== 2)
      .map((s, index) => ({
        productId: null,
        productCode: code(),
        // Typed by hand in Food Partner: a half-space here, an Arabic ی there.
        title: index % 3 === 1 ? s.title.replace(/ی/g, 'ي').replace(/ /g, ' ') : s.title.replace(/ /, '‌'),
        description: s.product.description || '',
        price: toman(priceOf(s)),
        vat: Math.round(Number(s.product.tax_rate || 0) * 100),
        isActive: true,
        isReviewed: true,
        capacity: s.product.max_per_order ?? null,
        stock: null,
        productType: [],
        containerPrice: 0,
        disabled: false,
        disabledUntil: null,
        schedules: [],
        images: [],
        toppings: [],
        menuCategory: {
          vmsCategoryId: null,
          categoryCode: categoryCode.get(s.product.category_id) || code(11),
          title: categories.find((c) => c.id === s.product.category_id)?.name || '',
          isActive: true,
          isDeleted: false,
          isReviewed: true,
          visibility: true,
        },
      }));
    const extrasCategory = { vmsCategoryId: null, categoryCode: code(11), title: 'فقط اسنپ‌فود', isActive: true, isDeleted: false, isReviewed: true, visibility: true };
    for (const [title, price] of [['نوشابه قوطی اسنپ‌فود', 45000], ['ظرف یکبار مصرف', 10000]] as Array<[string, number]>) {
      products.push({
        productId: null, productCode: code(), title, description: '', price, vat: 10, isActive: true, isReviewed: true, capacity: null, stock: null,
        productType: [], containerPrice: 0, disabled: false, disabledUntil: null, schedules: [], images: [], toppings: [], menuCategory: extrasCategory,
      });
    }
    await this.saveVendorMenu(tenantId, branchId, products);
    return { vendorCode: this.vendorCode(branch), products };
  }

  private async saveVendorMenu(tenantId: string, branchId: string, products: VendorProduct[]) {
    const row =
      (await this.settingRepo.findOne({ where: { tenant_id: tenantId, branch_id: branchId, key: VENDOR_MENU_KEY } })) ||
      this.settingRepo.create({ tenant_id: tenantId, branch_id: branchId, key: VENDOR_MENU_KEY, value: {} });
    row.value = { products };
    await this.settingRepo.save(row);
  }

  /** Start the simulated vendor menu again, and forget what this branch matched and sent. */
  async resetVendorMenu(tenantId: string, branchId: string) {
    await this.settingRepo.delete({ tenant_id: tenantId, branch_id: branchId, key: VENDOR_MENU_KEY });
    const rows = await this.mapRepo.find({ where: { tenant_id: tenantId, channel: SNAPPFOOD } });
    for (const row of rows.filter((r) => r.channel_codes[branchId] || r.synced_at[branchId])) {
      delete row.channel_codes[branchId];
      delete row.synced_at[branchId];
      await this.mapRepo.save(row);
    }
    return this.matchPreview(tenantId, branchId);
  }

  private async log(tenantId: string, eventType: string, request: any, response: any, status = 'SUCCESS') {
    await this.logRepo.save(
      this.logRepo.create({ tenant_id: tenantId, provider: SNAPPFOOD, event_type: eventType, is_duplicate: false, status, request_payload: request, response_payload: response }),
    );
  }

  // ---------------------------------------------------------------- match

  /**
   * Snappfood's products for the branch beside ours: the ones already matched, a suggestion
   * by name for the rest, and our products Snappfood doesn't have yet (sending the menu
   * creates those there, and Snappfood reviews them).
   */
  async matchPreview(tenantId: string, branchId: string) {
    const menu = await this.vendorMenu(tenantId, branchId);
    const ids = await this.ids(tenantId);
    const ours = await this.sellables(tenantId);
    const keyOf = (s: Sellable) => `${s.type}:${s.entityId}`;
    const matchedCode = (s: Sellable) => ids.get(keyOf(s))?.channel_codes[branchId] || null;
    const ourRow = (s: Sellable) => ({
      entity_type: s.type,
      entity_id: s.entityId,
      product_id: s.product.id,
      variant_id: s.variant?.id || null,
      name: s.variant ? `${s.product.name} — ${s.variant.name}` : s.product.name,
      external_id: ids.get(keyOf(s))?.external_id ?? null,
    });

    const taken = new Set<string>();
    const rows = menu.products.map((p) => {
      const matched = ours.find((s) => matchedCode(s) === p.productCode);
      if (matched) taken.add(keyOf(matched));
      return { snappfood: p, matched, suggestion: undefined as Sellable | undefined };
    });
    for (const row of rows.filter((r) => !r.matched)) {
      const wanted = normalizeName(row.snappfood.title);
      const hit = ours.find((s) => !taken.has(keyOf(s)) && !matchedCode(s) && normalizeName(s.title) === wanted);
      if (hit) {
        taken.add(keyOf(hit));
        row.suggestion = hit;
      }
    }
    return {
      branch_id: branchId,
      vendor_code: menu.vendorCode,
      snappfood_products: rows.map((r) => ({
        product_code: r.snappfood.productCode,
        title: r.snappfood.title,
        category: r.snappfood.menuCategory.title,
        price_toman: r.snappfood.price,
        product_id: r.snappfood.productId,
        is_reviewed: r.snappfood.isReviewed,
        status: r.matched ? 'MATCHED' : r.suggestion ? 'SUGGESTED' : 'UNMATCHED',
        match: r.matched ? ourRow(r.matched) : r.suggestion ? ourRow(r.suggestion) : null,
      })),
      not_on_snappfood: ours.filter((s) => !taken.has(keyOf(s)) && !matchedCode(s)).map(ourRow),
      ours: ours.map(ourRow),
    };
  }

  /**
   * Save the matches: each Snappfood product to one of ours (or to none), told to Snappfood
   * with product/sync/productId; categories follow by name with category/sync/categoryId.
   */
  async saveMatches(
    tenantId: string,
    branchId: string,
    matches: Array<{ product_code: string; entity_type?: 'PRODUCT' | 'VARIANT' | null; entity_id?: string | null }>,
  ) {
    const menu = await this.vendorMenu(tenantId, branchId);
    const ids = await this.ids(tenantId);
    const rows = [...ids.values()];
    const products = menu.products;
    const syncProducts: Array<{ productId: number; productCode: string }> = [];

    for (const match of matches || []) {
      const sf = products.find((p) => p.productCode === match.product_code);
      if (!sf) throw new BadRequestException(`Snappfood has no product ${match.product_code} for this branch`);
      // The code leaves whatever it was matched to before.
      for (const row of rows.filter((r) => r.channel_codes[branchId] === sf.productCode)) {
        delete row.channel_codes[branchId];
        await this.mapRepo.save(row);
      }
      sf.productId = null;
      if (!match.entity_type || !match.entity_id) continue;
      const row = ids.get(`${match.entity_type}:${match.entity_id}`);
      if (!row) throw new BadRequestException('That is not one of our products');
      for (const other of rows.filter((r) => r !== row && r.channel_codes[branchId] && r.entity_id === row.entity_id)) delete other.channel_codes[branchId];
      row.channel_codes = { ...row.channel_codes, [branchId]: sf.productCode };
      await this.mapRepo.save(row);
      sf.productId = row.external_id;
      syncProducts.push({ productId: row.external_id, productCode: sf.productCode });
    }

    // Categories: Snappfood's, by name, to ours.
    const categories = await this.em.find(Category, { where: { tenant_id: tenantId, is_active: true } });
    const syncCategories: Array<{ categoryId: number; categoryCode: string }> = [];
    for (const category of categories) {
      const sf = products.find((p) => normalizeName(p.menuCategory.title) === normalizeName(category.name));
      const row = ids.get(`CATEGORY:${category.id}`);
      if (!sf || !row) continue;
      row.channel_codes = { ...row.channel_codes, [branchId]: sf.menuCategory.categoryCode };
      await this.mapRepo.save(row);
      for (const p of products.filter((x) => x.menuCategory.categoryCode === sf.menuCategory.categoryCode)) p.menuCategory.vmsCategoryId = row.external_id;
      syncCategories.push({ categoryId: row.external_id, categoryCode: sf.menuCategory.categoryCode });
    }
    await this.saveVendorMenu(tenantId, branchId, products);

    if (syncCategories.length) {
      await this.log(tenantId, 'CATALOG_SYNC_CATEGORY_IDS', { method: 'POST', path: '/va/v1/category/sync/categoryId', body: { vendorCode: menu.vendorCode, categories: syncCategories } }, { status: 200 });
    }
    if (syncProducts.length) {
      await this.log(tenantId, 'CATALOG_SYNC_PRODUCT_IDS', { method: 'POST', path: '/va/v1/product/sync/productId', body: { vendorCode: menu.vendorCode, products: syncProducts } }, { status: 200 });
    }
    return this.matchPreview(tenantId, branchId);
  }

  // ---------------------------------------------------------------- send

  /** Every call a menu send makes, with its body, and what Snappfood would refuse. */
  async buildMenu(tenantId: string, branchId: string) {
    const branch = await this.branch(tenantId, branchId);
    const vendorCode = this.vendorCode(branch);
    const ids = await this.ids(tenantId);
    const idOf = (type: ChannelEntityType, id: string) => ids.get(`${type}:${id}`)!.external_id;
    const sheet = await this.catalog.getChannelPriceSheet(tenantId, SNAPPFOOD, branchId);
    const categories = await this.em.find(Category, { where: { tenant_id: tenantId }, order: { sort_order: 'ASC', name: 'ASC' } });
    const liveCategories = categories.filter((c) => c.is_active);
    const ours = await this.sellables(tenantId);
    const allProducts = await this.em.find(Product, { where: { tenant_id: tenantId } });
    const variants = await this.em.find(ProductVariant, { where: { tenant_id: tenantId } });
    const warnings: Array<{ item: string; problem: string }> = [];
    const sheetRow = (s: Sellable) => sheet.items.find((i) => i.product_id === s.product.id && (i.variant_id || null) === (s.variant?.id || null));

    const menus = liveCategories.map((c, index) => ({ id: idOf('CATEGORY', c.id), orderIndex: index + 1, title: c.name }));
    for (const c of liveCategories) if (c.name.length > SNAPPFOOD_LIMITS.title) warnings.push({ item: c.name, problem: `title over ${SNAPPFOOD_LIMITS.title} characters` });

    const position = new Map<string, number>();
    const products = ours.map((s) => {
      const at = (position.get(s.product.category_id) || 0) + 1;
      position.set(s.product.category_id, at);
      const price = toman(sheetRow(s)?.price || '0');
      // A running Snappfood item discount: the price above is the discounted one, and the full
      // price goes along as the struck-through one.
      const before = sheetRow(s)?.before_price ? toman(sheetRow(s)!.before_price!) : null;
      const title = s.variant ? s.variant.name : s.product.name;
      if (s.product.name.length > SNAPPFOOD_LIMITS.title || title.length > SNAPPFOOD_LIMITS.title) warnings.push({ item: s.title, problem: `title over ${SNAPPFOOD_LIMITS.title} characters` });
      if ((s.product.description || '').length > SNAPPFOOD_LIMITS.description) warnings.push({ item: s.title, problem: `description over ${SNAPPFOOD_LIMITS.description} characters` });
      if (price < SNAPPFOOD_LIMITS.minPriceToman || price > SNAPPFOOD_LIMITS.maxPriceToman) {
        warnings.push({ item: s.title, problem: `price ${price.toLocaleString('en-US')} Toman is outside ${SNAPPFOOD_LIMITS.minPriceToman.toLocaleString('en-US')}–${SNAPPFOOD_LIMITS.maxPriceToman.toLocaleString('en-US')}` });
      }
      return {
        ...(s.variant ? { productTitle: s.product.name } : {}),
        title,
        menuCategoryId: idOf('CATEGORY', s.product.category_id),
        productId: idOf(s.type, s.entityId),
        position: at,
        description: s.product.description || '',
        price,
        ...(before ? { priceBeforeDiscount: before } : {}),
        vat: Math.round(Number(s.product.tax_rate || 0) * 100),
        containerPrice: 0,
        schedules: [] as unknown[],
      };
    });

    // Toppings: every group a live product offers, each sent as its own call, as the annex has it.
    const links = await this.em.find(ProductOptionGroup, { where: { tenant_id: tenantId } });
    const groups = await this.em.find(OptionGroup, { where: { tenant_id: tenantId }, order: { created_at: 'ASC' } });
    const items = await this.em.find(OptionItem, { where: { tenant_id: tenantId }, order: { sort_order: 'ASC', created_at: 'ASC' } });
    const liveProductIds = new Set(ours.map((s) => s.product.id));
    const usedGroups = groups.filter((g) => links.some((l) => l.option_group_id === g.id && liveProductIds.has(l.product_id)));
    const toppingPrice = (item: OptionItem) => toman(sheet.add_ons.find((a) => a.option_item_id === item.id)?.price || item.price_delta || '0');
    const toppingGroups = usedGroups.map((g, index) => {
      const known = ids.get(`OPTION_GROUP:${g.id}`)!.channel_codes[branchId];
      return {
        vendorCode,
        ...(known ? { toppingGroupId: Number(known) } : {}),
        toppingGroup: { title: g.name, min: g.min_selection, max: g.max_selection, position: index + 1 },
        toppings: items
          .filter((i) => i.option_group_id === g.id)
          .map((i) => ({ id: idOf('OPTION_ITEM', i.id), title: i.name, price: toppingPrice(i), containerPrice: 0 })),
      };
    });
    for (const g of usedGroups) if (g.name.length > SNAPPFOOD_LIMITS.title) warnings.push({ item: g.name, problem: `topping group title over ${SNAPPFOOD_LIMITS.title} characters` });

    // Which toppings each product offers: every switched-on add-on, for each type of the product.
    const productToppings = ours.flatMap((s) =>
      links
        .filter((l) => l.product_id === s.product.id && usedGroups.some((g) => g.id === l.option_group_id))
        .flatMap((l) =>
          items
            .filter((i) => i.option_group_id === l.option_group_id && !(l.excluded_item_ids || []).includes(i.id))
            .map((i) => ({ productId: idOf(s.type, s.entityId), toppingId: idOf('OPTION_ITEM', i.id) })),
        ),
    );

    // Stock, as Snappfood's two kinds of unavailable. A product off our menu is inactive there.
    const toggles = ours.map((s) => {
      const off = sheetRow(s)?.off;
      const id = idOf(s.type, s.entityId);
      if (!off) return { id, active: true, disable: false };
      return { id, active: true, disable: true, disableUntil: off.until ? sfDate(new Date(off.until)) : FAR_FUTURE };
    });
    const sentBefore = [...ids.values()].filter((r) => (r.entity_type === 'PRODUCT' || r.entity_type === 'VARIANT') && r.synced_at[branchId]);
    for (const row of sentBefore) {
      const gone = !ours.some((s) => s.entityId === row.entity_id);
      const exists = row.entity_type === 'PRODUCT' ? allProducts.some((p) => p.id === row.entity_id) : variants.some((v) => v.id === row.entity_id);
      if (gone && exists) toggles.push({ id: row.external_id, active: false, disable: false });
    }
    // Add-ons are never stopped in Gnext, so every topping is sent as on sale. The annex has no
    // topping toggle; Snappfood treats toppings as products, so they go through the same call.
    const toppingToggles = items
      .filter((i) => usedGroups.some((g) => g.id === i.option_group_id))
      .map((i) => ({ id: idOf('OPTION_ITEM', i.id), active: true, disable: false }));

    const menuToggles = categories
      .filter((c) => !c.is_active && ids.get(`CATEGORY:${c.id}`)?.synced_at[branchId])
      .map((c) => ({ id: idOf('CATEGORY', c.id), active: false }));

    const details = ours
      .filter((s) => s.product.max_per_order)
      .map((s) => ({ id: idOf(s.type, s.entityId), price: products.find((p) => p.productId === idOf(s.type, s.entityId))!.price, capacity: s.product.max_per_order }));

    const unmatched = ours.filter((s) => !ids.get(`${s.type}:${s.entityId}`)!.channel_codes[branchId]).map((s) => s.title);

    const calls = [
      { method: 'POST', path: '/va/v1/menu/', body: { vendorCode, menus } },
      { method: 'POST', path: '/va/v1.1/product/', body: { vendorCode, products } },
      ...toppingGroups.map((body) => ({ method: 'POST', path: '/va/v1/topping/', body })),
      ...(productToppings.length ? [{ method: 'POST', path: '/va/v1/topping/add-to-product', body: { vendorCode, toppings: productToppings } }] : []),
      { method: 'PUT', path: '/va/v1/product/', body: { vendorCode, products: [...toggles, ...toppingToggles] } },
      ...(menuToggles.length ? [{ method: 'PUT', path: '/va/v1/menu/', body: { vendorCode, menus: menuToggles } }] : []),
      ...(details.length ? [{ method: 'POST', path: '/va/v1/product/productDetails', body: { vendorCode, products: details } }] : []),
    ];
    return {
      branch_id: branchId,
      vendor_code: vendorCode,
      counts: {
        menus: menus.length,
        products: products.length,
        topping_groups: toppingGroups.length,
        toppings: toppingGroups.reduce((n, g) => n + g.toppings.length, 0),
        product_toppings: productToppings.length,
        unavailable: toggles.filter((t) => t.disable).length + toppingToggles.filter((t) => t.disable).length,
      },
      new_on_snappfood: unmatched,
      /** Our add-on groups, in the order of the topping calls. */
      sent_groups: usedGroups.map((g) => g.id),
      warnings,
      calls,
    };
  }

  /**
   * Send the branch's menu: each call of buildMenu, logged as sent. A record sent for the first
   * time appears on the simulated vendor menu waiting for Snappfood's review, as a new product
   * made in Food Partner does.
   */
  async pushMenu(tenantId: string, branchId: string) {
    const plan = await this.buildMenu(tenantId, branchId);
    const now = new Date().toISOString();
    for (const call of plan.calls) {
      await this.log(tenantId, `MENU_SYNC ${call.method} ${call.path}`, call, { status: call.path.includes('productDetails') ? 200 : 204 });
    }

    const ids = await this.ids(tenantId);
    const menu = await this.vendorMenu(tenantId, branchId);
    const products = menu.products;
    const body = (path: string) => plan.calls.filter((c) => c.path === path).map((c) => c.body as any);
    const sentProducts: any[] = body('/va/v1.1/product/')[0]?.products || [];
    const sentMenus: any[] = body('/va/v1/menu/')[0]?.menus || [];
    const toggles: any[] = body('/va/v1/product/')[0]?.products || [];

    for (const row of ids.values()) {
      const sentProduct = sentProducts.find((p) => p.productId === row.external_id);
      const sentMenu = row.entity_type === 'CATEGORY' && sentMenus.find((m) => m.id === row.external_id);
      const sentGroup = row.entity_type === 'OPTION_GROUP' && plan.sent_groups.includes(row.entity_id);
      if (!sentProduct && !sentMenu && !sentGroup) continue;
      row.synced_at = { ...row.synced_at, [branchId]: now };
      if (sentProduct) {
        let sf = products.find((p) => p.productCode === row.channel_codes[branchId]);
        if (!sf) {
          // New on Snappfood: it gets a code there and waits for review.
          sf = {
            productId: row.external_id, productCode: code(), title: '', description: '', price: 0, vat: 0, isActive: true, isReviewed: false, capacity: null,
            stock: null, productType: [], containerPrice: 0, disabled: false, disabledUntil: null, schedules: [], images: [], toppings: [],
            menuCategory: { vmsCategoryId: sentProduct.menuCategoryId, categoryCode: '', title: '', isActive: true, isDeleted: false, isReviewed: false, visibility: true },
          };
          products.push(sf);
          row.channel_codes = { ...row.channel_codes, [branchId]: sf.productCode };
        }
        const toggle = toggles.find((t) => t.id === row.external_id);
        sf.productId = row.external_id;
        sf.title = sentProduct.productTitle ? `${sentProduct.productTitle} ${sentProduct.title}` : sentProduct.title;
        sf.description = sentProduct.description;
        sf.price = sentProduct.price;
        sf.vat = sentProduct.vat;
        sf.isActive = toggle ? toggle.active : true;
        sf.disabled = !!toggle?.disable;
        sf.disabledUntil = toggle?.disableUntil || null;
        const menuRow = sentMenus.find((m) => m.id === sentProduct.menuCategoryId);
        sf.menuCategory = { ...sf.menuCategory, vmsCategoryId: sentProduct.menuCategoryId, title: menuRow?.title || sf.menuCategory.title };
      }
      if (sentGroup && !row.channel_codes[branchId]) {
        // Snappfood answers a new topping group with its id; later sends update that group.
        row.channel_codes = { ...row.channel_codes, [branchId]: String(200000 + row.external_id) };
      }
      await this.mapRepo.save(row);
    }
    await this.saveVendorMenu(tenantId, branchId, products);
    return { ...plan, sent_at: now };
  }

  // ---------------------------------------------------------------- orders

  /**
   * A Snappfood order's lines as our menu: each product's id (and topping ids) back to the
   * product, type and add-ons it stands for. A line whose id we never sent stays a line by its
   * title alone, marked, so the kitchen still sees it.
   */
  async resolveIncoming(
    tenantId: string,
    lines: Array<{ external_id?: number | null; toppings?: Array<{ id?: number; vmsFoodId?: number; title?: string; price?: number; quantity?: number }> }>,
  ) {
    const all = lines.flatMap((l) => [Number(l.external_id), ...(l.toppings || []).map((t) => Number(t.id ?? t.vmsFoodId))]);
    const rows = await this.byExternalId(tenantId, all);
    const variantIds = [...rows.values()].filter((r) => r.entity_type === 'VARIANT').map((r) => r.entity_id);
    const variants = variantIds.length ? await this.em.find(ProductVariant, { where: { tenant_id: tenantId, id: In(variantIds) }, withDeleted: true }) : [];
    const itemIds = [...rows.values()].filter((r) => r.entity_type === 'OPTION_ITEM').map((r) => r.entity_id);
    const items = itemIds.length ? await this.em.find(OptionItem, { where: { tenant_id: tenantId, id: In(itemIds) }, withDeleted: true }) : [];
    const groupIds = [...new Set(items.map((i) => i.option_group_id))];
    const groups = groupIds.length ? await this.em.find(OptionGroup, { where: { tenant_id: tenantId, id: In(groupIds) }, withDeleted: true }) : [];

    return lines.map((line) => {
      const row = rows.get(Number(line.external_id));
      const variant = row?.entity_type === 'VARIANT' ? variants.find((v) => v.id === row.entity_id) || null : null;
      const productId = row?.entity_type === 'PRODUCT' ? row.entity_id : variant?.product_id || null;
      const toppings = (line.toppings || []).map((t) => {
        const tr = rows.get(Number(t.id ?? t.vmsFoodId));
        const item = tr?.entity_type === 'OPTION_ITEM' ? items.find((i) => i.id === tr.entity_id) : undefined;
        return {
          option_item_id: item?.id || null,
          option_group_name: item ? groups.find((g) => g.id === item.option_group_id)?.name || '' : '',
          option_item_name: item?.name || t.title || '',
          quantity: Number(t.quantity || 1),
          price_toman: Number(t.price || 0),
        };
      });
      return { product_id: productId, variant_id: variant?.id || null, variant_name: variant?.name || null, matched: !!productId, toppings };
    });
  }

  /**
   * One to three things this branch sells, as Snappfood order lines: our id, the Snappfood
   * price in Toman, and now and then a topping the product offers.
   */
  async orderBasket(tenantId: string, branchId: string | null) {
    const ids = await this.ids(tenantId);
    const ours = await this.sellables(tenantId);
    if (!ours.length) return null;
    const sheet = await this.catalog.getChannelPriceSheet(tenantId, SNAPPFOOD, branchId);
    const onSale = ours.filter((s) => {
      const row = sheet.items.find((i) => i.product_id === s.product.id && (i.variant_id || null) === (s.variant?.id || null));
      return row && !row.off && MoneyUtil.greaterThan(row.price, '0');
    });
    if (!onSale.length) return null;
    const links = await this.em.find(ProductOptionGroup, { where: { tenant_id: tenantId } });
    const items = await this.em.find(OptionItem, { where: { tenant_id: tenantId } });
    const groups = await this.em.find(OptionGroup, { where: { tenant_id: tenantId } });
    const picks = [...onSale].sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 3));

    return picks.map((s, index) => {
      const row = sheet.items.find((i) => i.product_id === s.product.id && (i.variant_id || null) === (s.variant?.id || null))!;
      const price = toman(row.price);
      const offered = links
        .filter((l) => l.product_id === s.product.id)
        .flatMap((l) => items.filter((i) => i.option_group_id === l.option_group_id && !(l.excluded_item_ids || []).includes(i.id)));
      // A required group must be filled, as Snappfood's app makes the guest do; otherwise a topping now and then.
      const required = groups.filter((g) => g.min_selection > 0 && links.some((l) => l.product_id === s.product.id && l.option_group_id === g.id));
      const chosen = [
        ...required.flatMap((g) => offered.filter((i) => i.option_group_id === g.id).slice(0, g.min_selection)),
        ...(offered.length && Math.random() < 0.6 ? [offered[Math.floor(Math.random() * offered.length)]] : []),
      ].filter((item, i, list) => list.indexOf(item) === i);
      const toppings = chosen.map((i) => ({
        id: ids.get(`OPTION_ITEM:${i.id}`)!.external_id,
        vmsFoodId: ids.get(`OPTION_ITEM:${i.id}`)!.external_id,
        title: i.name,
        price: toman(sheet.add_ons.find((a) => a.option_item_id === i.id)?.price || i.price_delta || '0'),
        quantity: 1,
      }));
      const toppingPrice = toppings.reduce((sum, t) => sum + t.price, 0);
      const quantity = 1 + (index === 0 && Math.random() < 0.3 ? 1 : 0);
      const external = ids.get(`${s.type}:${s.entityId}`)!.external_id;
      return {
        id: external,
        vmsFoodId: external,
        title: s.variant ? `${s.product.name} ${s.variant.name}` : s.product.name,
        quantity,
        price,
        toppingPrice,
        totalPrice: (price + toppingPrice) * quantity,
        originPrice: price,
        originprice: price,
        productDiscountSFShare: 0,
        productDiscountVendorShare: 0,
        discount: 0,
        vat: Number(s.product.tax_rate || 0),
        barcode: s.product.barcode || '',
        toppings,
      };
    });
  }

}
