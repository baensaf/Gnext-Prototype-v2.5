import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { PriceEntry } from '../../entities/PriceEntry.entity';
import { PriceBulkJob } from '../../entities/PriceBulkJob.entity';
import { PriceGroup } from '../../entities/PriceGroup.entity';
import { Product } from '../../entities/Product.entity';
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { AuditEvent } from '../../entities/AuditEvent.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { inStorePrice, isLiveAt, listPricesAt, priceKey } from '../../common/utils/price-list.util';
import { AuditWriter } from '../audit/audit-writer.service';
import { PriceListService } from './price-lists.service';

/**
 * What a price change does: to base prices or one list, and how much. It applies at once.
 * Add-on prices are edited in their group, as on Snappfood.
 */
export interface PriceChangeInput {
  /** The list to change; empty for base prices. */
  price_list_id?: string | null;
  /** Only this category's items; empty for all. */
  category_id?: string | null;
  /** A percentage (10 = +10%) or an amount in Rial added to each price. Negative lowers. */
  adjustment: 'PERCENT' | 'AMOUNT';
  value: string | number;
  /** Round each new price up to this step (e.g. 1000); 0 or empty for none. */
  round_to?: number | null;
}

/** One line of a change: a product, or one of its sizes. */
export interface ChangeLine {
  product_id: string;
  variant_id: string | null;
  name: string;
  current: string;
  new: string;
}

/**
 * Price changes: "+10% on all drinks", on base prices, on one list or on add-ons, previewed
 * before they are saved and applied at once. A change writes one `price_entry` per item, so
 * the old price stays in the history. The resolver reads the rows directly; for base prices
 * the change also copies the price into the product or size, so every screen and report
 * that reads `base_price` agrees.
 */
@Injectable()
export class PriceChangeService {
  constructor(
    @InjectRepository(PriceEntry) private readonly entryRepo: Repository<PriceEntry>,
    @InjectRepository(PriceGroup) private readonly listRepo: Repository<PriceGroup>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductVariant) private readonly variantRepo: Repository<ProductVariant>,
    @InjectRepository(AuditEvent) private readonly auditRepo: Repository<AuditEvent>,
    private readonly priceLists: PriceListService,
    private readonly auditWriter: AuditWriter,
  ) {}

  private adjust(price: string, input: PriceChangeInput): string {
    const value = new Decimal(input.value || 0);
    let next = input.adjustment === 'PERCENT'
      ? new Decimal(price).mul(new Decimal(100).plus(value)).div(100)
      : new Decimal(price).plus(value);
    const step = Number(input.round_to) || 0;
    if (step > 0) next = next.div(step).ceil().mul(step);
    return Decimal.max(next, 0).toFixed(4);
  }

  private validate(input: PriceChangeInput) {
    if (input.adjustment !== 'PERCENT' && input.adjustment !== 'AMOUNT') throw new BadRequestException('Change by a percentage or an amount');
    if (!MoneyUtil.isValid(String(input.value ?? ''))) throw new BadRequestException('The change is a number');
    if (input.adjustment === 'PERCENT' && Number(input.value) <= -100) throw new BadRequestException('A price cannot drop by 100% or more');
    if (input.round_to !== undefined && input.round_to !== null && (!Number.isFinite(Number(input.round_to)) || Number(input.round_to) < 0)) {
      throw new BadRequestException('Rounding is a step of 0 or more');
    }
  }

  /**
   * Every item the change touches, with the price it has now and the price it gets. Base changes cover every product, or each size of one sold in
   * sizes. A list change covers the items the list prices; the others follow base.
   */
  async preview(tenantId: string, input: PriceChangeInput) {
    this.validate(input);
    const at = new Date();
    const listId = input.price_list_id || null;
    const list = listId ? await this.listRepo.findOne({ where: { id: listId, tenant_id: tenantId } }) : null;
    if (listId && !list) throw new NotFoundException('Price list not found');

    const products = await this.productRepo.find({
      where: { tenant_id: tenantId, is_active: true, ...(input.category_id ? { category_id: input.category_id } : {}) },
      order: { code: 'ASC' },
    });
    const variants = products.length
      ? await this.variantRepo.find({ where: { tenant_id: tenantId, is_active: true, product_id: In(products.map((p) => p.id)) }, order: { sort_order: 'ASC', code: 'ASC' } })
      : [];
    const current = listPricesAt(await this.priceLists.entriesOf(tenantId, listId), at);

    const items: ChangeLine[] = products.flatMap((product) => {
      const sizes = variants.filter((v) => v.product_id === product.id);
      return (sizes.length ? sizes : [null]).flatMap((variant) => {
        const key = priceKey(product.id, variant?.id);
        if (list && !current.has(key)) return [];
        const before = list ? current.get(key)! : inStorePrice(current, product, variant);
        return [{
          product_id: product.id,
          variant_id: variant?.id || null,
          name: variant ? `${product.name} — ${variant.name}` : product.name,
          current: before,
          new: this.adjust(before, input),
        }];
      });
    });
    return {
      price_list: list ? { id: list.id, name: list.name } : null,
      items,
      changed: items.filter((i) => i.current !== i.new).length,
    };
  }

  /** Save a previewed change. Items whose price would not move are left out. */
  async commit(tenantId: string, input: PriceChangeInput, userId: string | null, correlationId: string) {
    const preview = await this.preview(tenantId, input);
    const changed = preview.items.filter((i) => i.current !== i.new);
    if (changed.length === 0) throw new BadRequestException('No price would change');
    const at = new Date();
    const listId = preview.price_list?.id || null;

    const job = await this.entryRepo.manager.transaction(async (em) => {
      const saved = await em.save(
        em.create(PriceBulkJob, {
          tenant_id: tenantId,
          status: 'APPLIED',
          price_group_id: listId,
          effective_from: at,
          affected_rows: changed.length,
          params: { ...input },
          created_by: userId || null,
        }),
      );
      for (const item of changed) {
        // The row in force now ends here; the change's row takes over.
        const target = {
          product_id: item.product_id,
          variant_id: item.variant_id || IsNull(),
          price_group_id: listId ?? IsNull(),
          branch_id: IsNull(),
          channel: IsNull(),
          order_type: IsNull(),
          modifier_option_id: IsNull(),
        };
        const replaced = (await em.find(PriceEntry, { where: { tenant_id: tenantId, ...target, effective_from: LessThanOrEqual(at) } })).filter((e) => isLiveAt(e, at) && new Date(e.effective_from).getTime() < at.getTime());
        for (const entry of replaced) {
          entry.effective_to = at;
          await em.save(PriceEntry, entry);
        }
        await em.save(
          em.create(PriceEntry, {
            tenant_id: tenantId,
            product_id: item.product_id,
            variant_id: item.variant_id as string,
            price_group_id: listId,
            price_type: listId ? 'LIST' : 'BASE',
            currency_code: 'IRR',
            amount: item.new,
            effective_from: at,
            bulk_job_id: saved.id,
            created_by: userId || null,
          }),
        );
      }
      return saved;
    });

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: userId || undefined,
      action: 'PRICE_CHANGE_SAVED',
      entityType: 'PriceBulkJob',
      entityId: job.id,
      correlationId,
      details: { priceListId: listId, effectiveFrom: at, items: changed.length, input },
    });
    if (!listId) await this.applyDueBaseChanges(tenantId);
    return this.describe(job, preview.price_list?.name || null);
  }

  private describe(job: PriceBulkJob, listName: string | null) {
    const params = (job.params || {}) as PriceChangeInput;
    return {
      id: job.id,
      status: job.status,
      price_list: job.price_group_id ? { id: job.price_group_id, name: listName } : null,
      effective_from: job.effective_from,
      items: job.affected_rows,
      adjustment: params.adjustment,
      value: params.value,
      round_to: params.round_to || 0,
      category_id: params.category_id || null,
      created_at: job.created_at,
    };
  }

  /**
   * Copy each dated base price in force into its product or size, so `base_price` (the
   * product page, reports, import/export) says what the register charges. Every tenant when
   * none is given.
   */
  async applyDueBaseChanges(tenantId?: string) {
    const now = new Date();
    const rows = await this.entryRepo.find({
      where: {
        ...(tenantId ? { tenant_id: tenantId } : {}),
        price_group_id: IsNull(),
        branch_id: IsNull(),
        channel: IsNull(),
        order_type: IsNull(),
        modifier_option_id: IsNull(),
        effective_from: LessThanOrEqual(now),
      },
    });
    const byTenant = new Map<string, PriceEntry[]>();
    for (const row of rows.filter((r) => isLiveAt(r, now))) byTenant.set(row.tenant_id, [...(byTenant.get(row.tenant_id) || []), row]);

    let updated = 0;
    for (const [tenant, entries] of byTenant) {
      const due = listPricesAt(entries, now);
      const productIds = [...new Set(entries.map((e) => e.product_id))];
      const products = await this.productRepo.find({ where: { tenant_id: tenant, id: In(productIds) } });
      const variants = await this.variantRepo.find({ where: { tenant_id: tenant, product_id: In(productIds) } });
      for (const [key, amount] of due) {
        const [productId, variantId] = key.split(':');
        const target = variantId ? variants.find((v) => v.id === variantId) : products.find((p) => p.id === productId);
        if (!target || MoneyUtil.equals(target.base_price, amount)) continue;
        const before = target.base_price;
        target.base_price = amount;
        if (variantId) await this.variantRepo.update({ id: variantId, tenant_id: tenant }, { base_price: amount });
        else await this.productRepo.update({ id: productId, tenant_id: tenant }, { base_price: amount });
        updated++;
        await this.auditWriter.write({
          tenantId: tenant,
          actorType: 'SYSTEM',
          action: 'PRICE_CHANGE_APPLIED',
          entityType: variantId ? 'ProductVariant' : 'Product',
          entityId: variantId || productId,
          details: { productId, variantId: variantId || null, before, after: amount },
        });
      }
    }

    return { updated };
  }

  /**
   * A product's price history, newest first: dated prices (base and list) and base price
   * edits made on the product page.
   */
  async getPriceHistory(tenantId: string, productId: string) {
    const product = await this.productRepo.findOne({ where: { id: productId, tenant_id: tenantId } });
    if (!product) throw new NotFoundException('Product not found');
    const variants = await this.variantRepo.find({ where: { tenant_id: tenantId, product_id: productId } });
    const sizeName = (id: string | null) => (id ? variants.find((v) => v.id === id)?.name || null : null);

    const entries = await this.entryRepo.find({
      where: { tenant_id: tenantId, product_id: productId, branch_id: IsNull(), channel: IsNull(), order_type: IsNull(), modifier_option_id: IsNull() },
    });
    const listIds = [...new Set(entries.map((e) => e.price_group_id).filter((id): id is string => !!id))];
    const lists = listIds.length ? await this.listRepo.find({ where: { tenant_id: tenantId, id: In(listIds) }, withDeleted: true }) : [];
    const now = new Date();

    const dated = entries.map((e) => ({
      at: e.effective_from,
      until: e.effective_to,
      kind: e.bulk_job_id ? 'CHANGE' : e.price_group_id ? 'LIST_PRICE' : 'BASE',
      price_list: e.price_group_id ? lists.find((l) => l.id === e.price_group_id)?.name || null : null,
      size: sizeName(e.variant_id),
      from: null as string | null,
      to: MoneyUtil.format(e.amount),
      status: (new Date(e.effective_from) > now ? 'UPCOMING' : isLiveAt(e, now) ? 'CURRENT' : 'ENDED') as string | null,
    }));

    const edits = await this.auditRepo.find({
      where: {
        tenant_id: tenantId,
        entity_id: In([productId, ...variants.map((v) => v.id)]),
        action: In(['PRODUCT_CREATED', 'PRODUCT_UPDATED', 'PRODUCT_VARIANT_CREATED', 'PRODUCT_VARIANT_UPDATED']),
      },
      order: { occurred_at: 'DESC' },
      take: 200,
    });
    const edited = edits.flatMap((ev) => {
      const before = ev.before_data?.base_price ?? null;
      const after = ev.after_data?.base_price ?? null;
      if (after === null || (before !== null && MoneyUtil.equals(before, after))) return [];
      return [{
        at: ev.occurred_at,
        until: null,
        kind: 'EDIT',
        price_list: null,
        size: ev.entity_id === productId ? null : sizeName(ev.entity_id),
        from: before === null ? null : MoneyUtil.format(before),
        to: MoneyUtil.format(after),
        status: null,
      }];
    });

    return [...dated, ...edited].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }
}
