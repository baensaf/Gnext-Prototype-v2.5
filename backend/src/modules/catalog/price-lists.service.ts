import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { PriceGroup } from '../../entities/PriceGroup.entity';
import { PriceGroupBranch } from '../../entities/PriceGroupBranch.entity';
import { PriceEntry } from '../../entities/PriceEntry.entity';
import { Product } from '../../entities/Product.entity';
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { Branch } from '../../entities/Branch.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { inStorePrice, isLiveAt, listPricesAt, priceKey } from '../../common/utils/price-list.util';
import { AuditWriter } from '../audit/audit-writer.service';

/**
 * Branch price lists. A list (a `price_group` row) holds prices for some items; a branch
 * assigned to it (`price_group_branch`) sells those items at those prices and everything
 * else at the base price. A branch with no list sells at base. This is the in-store price:
 * the register, the kiosk and the Snappfood sheet all start from it.
 */
@Injectable()
export class PriceListService {
  constructor(
    @InjectRepository(PriceGroup) private readonly listRepo: Repository<PriceGroup>,
    @InjectRepository(PriceGroupBranch) private readonly assignmentRepo: Repository<PriceGroupBranch>,
    @InjectRepository(PriceEntry) private readonly entryRepo: Repository<PriceEntry>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductVariant) private readonly variantRepo: Repository<ProductVariant>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    private readonly auditWriter: AuditWriter,
  ) {}

  // Prices

  /** The list a branch sells from, when it has one that is in use. */
  async listForBranch(tenantId: string, branchId?: string | null): Promise<PriceGroup | null> {
    if (!branchId) return null;
    const link = await this.assignmentRepo.findOne({ where: { tenant_id: tenantId, branch_id: branchId } });
    if (!link) return null;
    return (await this.listRepo.findOne({ where: { id: link.price_group_id, tenant_id: tenantId, is_active: true } })) || null;
  }

  /**
   * A list's own price rows, or with `listId` null the dated base prices: rows with no list,
   * branch, channel, order type or add-on.
   */
  entriesOf(tenantId: string, listId: string | null, productIds?: string[]) {
    return this.entryRepo.find({
      where: {
        tenant_id: tenantId,
        price_group_id: listId ?? IsNull(),
        branch_id: IsNull(),
        channel: IsNull(),
        order_type: IsNull(),
        modifier_option_id: IsNull(),
        ...(productIds ? { product_id: In(productIds) } : {}),
      },
    });
  }

  /**
   * The dated prices that apply at a branch at `at`, keyed by product and size: base prices
   * dated by a price change, overridden by the branch list's own prices. An item with neither
   * sells at the base price on its product or size (see `inStorePrice`).
   */
  async pricesForBranch(tenantId: string, branchId: string | null | undefined, at = new Date(), productIds?: string[]) {
    const prices = listPricesAt(await this.entriesOf(tenantId, null, productIds), at);
    const list = await this.listForBranch(tenantId, branchId);
    if (list) {
      for (const [key, amount] of listPricesAt(await this.entriesOf(tenantId, list.id, productIds), at)) prices.set(key, amount);
    }
    return prices;
  }

  /** What one product, or one size of it, costs in store at a branch. Add-ons are extra. */
  async resolveInStorePrice(
    tenantId: string,
    branchId: string | null | undefined,
    product: Product,
    variant: ProductVariant | null,
    at = new Date(),
  ): Promise<string> {
    return inStorePrice(await this.pricesForBranch(tenantId, branchId, at, [product.id]), product, variant);
  }

  /**
   * Every item's in-store price at a branch, so a register or kiosk shows the price the order
   * will charge. One row per product (variant_id null) and one per size of it.
   */
  async getBranchPrices(tenantId: string, branchId?: string | null) {
    const list = await this.listForBranch(tenantId, branchId);
    const listed = await this.pricesForBranch(tenantId, branchId);
    const products = await this.productRepo.find({ where: { tenant_id: tenantId, is_active: true } });
    const variants = await this.variantRepo.find({ where: { tenant_id: tenantId, is_active: true } });
    const items = [
      ...products.map((p) => ({ product_id: p.id, variant_id: null as string | null, price: inStorePrice(listed, p, null) })),
      ...variants.flatMap((v) => {
        const product = products.find((p) => p.id === v.product_id);
        return product ? [{ product_id: product.id, variant_id: v.id, price: inStorePrice(listed, product, v) }] : [];
      }),
    ];
    return { branch_id: branchId || null, price_list: list ? { id: list.id, name: list.name } : null, items };
  }

  // Lists

  async getPriceLists(tenantId: string) {
    const lists = await this.listRepo.find({ where: { tenant_id: tenantId }, order: { name: 'ASC' } });
    const links = await this.assignmentRepo.find({ where: { tenant_id: tenantId } });
    const now = new Date();
    const entries = lists.length
      ? await this.entryRepo.find({
          where: { tenant_id: tenantId, price_group_id: In(lists.map((l) => l.id)), branch_id: IsNull(), channel: IsNull(), order_type: IsNull(), modifier_option_id: IsNull() },
        })
      : [];
    return lists.map((list) => ({
      id: list.id,
      code: list.code,
      name: list.name,
      is_active: list.is_active,
      branch_ids: links.filter((l) => l.price_group_id === list.id).map((l) => l.branch_id),
      price_count: listPricesAt(entries.filter((e) => e.price_group_id === list.id), now).size,
    }));
  }

  private async getList(tenantId: string, id: string) {
    const list = await this.listRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!list) throw new NotFoundException('Price list not found');
    return list;
  }

  async createPriceList(tenantId: string, data: { name: string; code?: string }, correlationId: string) {
    const name = (data.name || '').trim();
    if (!name) throw new BadRequestException('A price list needs a name');
    // The code is an internal handle; people see the name.
    const code = (data.code || '').trim().toUpperCase() || `LIST-${Date.now().toString(36).toUpperCase()}`;
    if (code.length > 32) throw new BadRequestException('A price list code is at most 32 characters');
    if (await this.listRepo.findOne({ where: { tenant_id: tenantId, code }, withDeleted: true })) {
      throw new ConflictException(`Price list ${code} already exists`);
    }
    const saved = await this.listRepo.save(this.listRepo.create({ tenant_id: tenantId, code, name, currency_code: 'IRR', is_active: true }));
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRICE_LIST_CREATED',
      entityType: 'PriceGroup',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });
    return saved;
  }

  async updatePriceList(tenantId: string, id: string, data: { name?: string; is_active?: boolean }, correlationId: string) {
    const list = await this.getList(tenantId, id);
    const before = { ...list };
    if (data.name !== undefined) {
      if (!data.name.trim()) throw new BadRequestException('A price list needs a name');
      list.name = data.name.trim();
    }
    if (data.is_active !== undefined) list.is_active = Boolean(data.is_active);
    const saved = await this.listRepo.save(list);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRICE_LIST_UPDATED',
      entityType: 'PriceGroup',
      entityId: id,
      correlationId,
      beforeData: before,
      afterData: saved,
    });
    return saved;
  }

  /** Retire a list. Its branches go back to base prices; its price rows stay for history. */
  async archivePriceList(tenantId: string, id: string, correlationId: string) {
    const list = await this.getList(tenantId, id);
    const branches = await this.assignmentRepo.find({ where: { tenant_id: tenantId, price_group_id: id } });
    await this.assignmentRepo.delete({ tenant_id: tenantId, price_group_id: id });
    await this.listRepo.softDelete({ id, tenant_id: tenantId });
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRICE_LIST_ARCHIVED',
      entityType: 'PriceGroup',
      entityId: id,
      correlationId,
      beforeData: list,
      details: { unassignedBranchIds: branches.map((b) => b.branch_id) },
    });
    return { id, archived: true };
  }

  /** Put a branch on a list, move it to another, or (listId null) back to base prices. */
  async assignBranch(tenantId: string, branchId: string, listId: string | null, correlationId: string) {
    const branch = await this.branchRepo.findOne({ where: { id: branchId, tenant_id: tenantId } });
    if (!branch) throw new NotFoundException('Branch not found');
    if (listId) await this.getList(tenantId, listId);

    const current = await this.assignmentRepo.findOne({ where: { tenant_id: tenantId, branch_id: branchId } });
    if (!listId) {
      if (current) await this.assignmentRepo.delete({ id: current.id });
    } else if (current) {
      current.price_group_id = listId;
      await this.assignmentRepo.save(current);
    } else {
      await this.assignmentRepo.save(this.assignmentRepo.create({ tenant_id: tenantId, branch_id: branchId, price_group_id: listId }));
    }
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRICE_LIST_ASSIGNED',
      entityType: 'Branch',
      entityId: branchId,
      correlationId,
      details: { branchId, from: current?.price_group_id || null, to: listId },
    });
    return { branch_id: branchId, price_list_id: listId };
  }

  /**
   * A list's price sheet: one row per product, or per size of a product sold in sizes, with
   * the base price, the list's own price if it sets one, and the price that applies.
   */
  async getPriceListSheet(tenantId: string, listId: string) {
    const list = await this.getList(tenantId, listId);
    const now = new Date();
    const listed = listPricesAt(await this.entriesOf(tenantId, listId), now);
    const based = listPricesAt(await this.entriesOf(tenantId, null), now);
    const products = await this.productRepo.find({ where: { tenant_id: tenantId, is_active: true }, order: { code: 'ASC' } });
    const variants = await this.variantRepo.find({ where: { tenant_id: tenantId, is_active: true }, order: { sort_order: 'ASC', code: 'ASC' } });
    const row = (product: Product, variant: ProductVariant | null) => {
      const own = listed.get(priceKey(product.id, variant?.id));
      const base = inStorePrice(based, product, variant);
      return {
        product_id: product.id,
        variant_id: variant?.id || null,
        category_id: product.category_id,
        name: variant ? `${product.name} — ${variant.name}` : product.name,
        base_price: base,
        list_price: own ?? null,
        price: own ?? base,
      };
    };
    const items = products.flatMap((p) => {
      const sizes = variants.filter((v) => v.product_id === p.id);
      return sizes.length ? sizes.map((v) => row(p, v)) : [row(p, null)];
    });
    return { price_list: { id: list.id, name: list.name, is_active: list.is_active }, items };
  }

  /**
   * Set one item's price on a list from now on, or clear it (amount null) so the item sells at
   * base on that list. The price in force is closed rather than deleted, so the history stays;
   * prices dated to start later are left alone.
   */
  async setListPrice(
    tenantId: string,
    listId: string,
    productId: string,
    variantId: string | null,
    amount: string | null,
    correlationId: string,
  ) {
    await this.getList(tenantId, listId);
    const product = await this.productRepo.findOne({ where: { id: productId, tenant_id: tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    if (variantId) {
      const variant = await this.variantRepo.findOne({ where: { id: variantId, tenant_id: tenantId, product_id: productId } });
      if (!variant) throw new NotFoundException('That size is not on this product');
    } else if ((await this.variantRepo.count({ where: { tenant_id: tenantId, product_id: productId, is_active: true } })) > 0) {
      // Each size has its own price, so a list prices sizes, not the product.
      throw new BadRequestException({ statusCode: 400, code: 'VARIANT_REQUIRED', message: `Price each size of ${product.name}` });
    }
    if (amount !== null && (!MoneyUtil.isValid(amount) || MoneyUtil.lessThan(amount, '0'))) {
      throw new BadRequestException('A price is a number, 0 or more');
    }

    const now = new Date();
    let before: string | null = null;
    await this.entryRepo.manager.transaction(async (em) => {
      const live = (
        await em.find(PriceEntry, {
          where: {
            tenant_id: tenantId,
            price_group_id: listId,
            product_id: productId,
            variant_id: variantId || IsNull(),
            branch_id: IsNull(),
            channel: IsNull(),
            order_type: IsNull(),
            modifier_option_id: IsNull(),
            effective_from: LessThanOrEqual(now),
          },
        })
      ).filter((e) => isLiveAt(e, now));
      before = listPricesAt(live, now).get(priceKey(productId, variantId)) ?? null;
      for (const entry of live) {
        entry.effective_to = now;
        await em.save(PriceEntry, entry);
      }
      if (amount !== null) {
        await em.save(
          em.create(PriceEntry, {
            tenant_id: tenantId,
            product_id: productId,
            variant_id: variantId || null,
            price_group_id: listId,
            price_type: 'LIST',
            currency_code: 'IRR',
            amount: MoneyUtil.format(amount),
            effective_from: now,
          }),
        );
      }
    });

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRICE_LIST_PRICE_SET',
      entityType: 'Product',
      entityId: productId,
      correlationId,
      details: { priceListId: listId, variantId, before, after: amount === null ? null : MoneyUtil.format(amount) },
    });
    return this.getPriceListSheet(tenantId, listId);
  }
}
