import { Injectable, NotFoundException, BadRequestException, ConflictException, OnApplicationBootstrap, OnModuleDestroy, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { PriceEntry } from '../../entities/PriceEntry.entity';
import { PriceBulkJob } from '../../entities/PriceBulkJob.entity';
import { PriceGroup } from '../../entities/PriceGroup.entity';
import { Product } from '../../entities/Product.entity';
import { ProductVariant } from '../../entities/ProductVariant.entity';
import { OptionGroup } from '../../entities/OptionGroup.entity';
import { OptionItem } from '../../entities/OptionItem.entity';
import { AuditEvent } from '../../entities/AuditEvent.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { BusinessDateUtil } from '../../common/utils/business-date.util';
import { inStorePrice, isLiveAt, listPricesAt, priceKey } from '../../common/utils/price-list.util';
import { AuditWriter } from '../audit/audit-writer.service';
import { PriceListService } from './price-lists.service';

/** What a price change does: to base prices, one list or add-ons, how much, from when. */
export interface PriceChangeInput {
  /** Menu items (the default) or add-ons. Add-on prices are chain-wide: no list, no category. */
  target?: 'ITEMS' | 'ADDONS' | null;
  /** With add-ons: only this add-on group's; empty for all. */
  option_group_id?: string | null;
  /** The list to change; empty for base prices. */
  price_list_id?: string | null;
  /** Only this category's items; empty for all. */
  category_id?: string | null;
  /** A percentage (10 = +10%) or an amount in Rial added to each price. Negative lowers. */
  adjustment: 'PERCENT' | 'AMOUNT';
  value: string | number;
  /** Round each new price up to this step (e.g. 1000); 0 or empty for none. */
  round_to?: number | null;
  /** The business day the new prices start (YYYY-MM-DD); empty or today for now. */
  effective_date?: string | null;
}

const SWEEP_MS = 60_000;

/** Where a job's entries replaced others: restored if the job is cancelled. */
type ClosedEntry = { id: string; previous_to: string | null };

/** One line of a change: a product, one of its sizes, or an add-on. */
export interface ChangeLine {
  product_id: string | null;
  variant_id: string | null;
  option_item_id: string | null;
  name: string;
  current: string;
  new: string;
}

/** A dated add-on price: a row keyed by the add-on alone, with no product, list, branch, channel or order type. */
const ADDON_ROW = { product_id: IsNull(), variant_id: IsNull(), price_group_id: IsNull(), branch_id: IsNull(), channel: IsNull(), order_type: IsNull() };

/** The add-on price rows live at `at`, by add-on: the later start wins, as for item prices. */
const addonPricesAt = (rows: PriceEntry[], at: Date) => {
  const out = new Map<string, PriceEntry>();
  for (const row of rows.filter((r) => r.modifier_option_id && isLiveAt(r, at))) {
    const held = out.get(row.modifier_option_id);
    if (!held || new Date(row.effective_from) > new Date(held.effective_from)) out.set(row.modifier_option_id, row);
  }
  return new Map([...out].map(([id, row]) => [id, MoneyUtil.format(row.amount)]));
};

/**
 * Dated price changes: "+10% on everything from Saturday", on base prices or on one list,
 * previewed before they are saved. A change writes one `price_entry` per item starting on its
 * date, so the old price stays in the history and a change that has not started can be
 * cancelled. The resolver reads the rows directly; for base prices a sweep also copies the
 * price into the product or size once it starts, so every screen and report that reads
 * `base_price` agrees.
 */
@Injectable()
export class PriceChangeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PriceChangeService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(PriceEntry) private readonly entryRepo: Repository<PriceEntry>,
    @InjectRepository(PriceBulkJob) private readonly jobRepo: Repository<PriceBulkJob>,
    @InjectRepository(PriceGroup) private readonly listRepo: Repository<PriceGroup>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(ProductVariant) private readonly variantRepo: Repository<ProductVariant>,
    @InjectRepository(OptionGroup) private readonly groupRepo: Repository<OptionGroup>,
    @InjectRepository(OptionItem) private readonly optionRepo: Repository<OptionItem>,
    @InjectRepository(AuditEvent) private readonly auditRepo: Repository<AuditEvent>,
    private readonly priceLists: PriceListService,
    private readonly auditWriter: AuditWriter,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.applyDueBaseChanges().catch((err) => this.logger.error(`Applying dated base prices failed: ${err?.message || err}`));
    }, SWEEP_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** The instant a change starts: the start of its business day, or now for today or none. */
  private startOf(date?: string | null): Date {
    const now = new Date();
    if (!date) return now;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('A start date is YYYY-MM-DD');
    if (date < BusinessDateUtil.today(now)) throw new BadRequestException('A price change starts today or later');
    const start = BusinessDateUtil.startOfDay(date);
    return start > now ? start : now;
  }

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
    if (input.target && input.target !== 'ITEMS' && input.target !== 'ADDONS') throw new BadRequestException('Change menu items or add-ons');
    if (input.target === 'ADDONS' && input.price_list_id) {
      throw new BadRequestException({ statusCode: 400, code: 'ADDON_PRICES_CHAIN_WIDE', message: 'Add-on prices are the same everywhere; a change to them takes no price list' });
    }
    if (input.adjustment !== 'PERCENT' && input.adjustment !== 'AMOUNT') throw new BadRequestException('Change by a percentage or an amount');
    if (!MoneyUtil.isValid(String(input.value ?? ''))) throw new BadRequestException('The change is a number');
    if (input.adjustment === 'PERCENT' && Number(input.value) <= -100) throw new BadRequestException('A price cannot drop by 100% or more');
    if (input.round_to !== undefined && input.round_to !== null && (!Number.isFinite(Number(input.round_to)) || Number(input.round_to) < 0)) {
      throw new BadRequestException('Rounding is a step of 0 or more');
    }
  }

  /**
   * Every item the change touches, with the price it would have on the start date without the
   * change and the price it gets. Base changes cover every product, or each size of one sold in
   * sizes. A list change covers the items the list prices; the others follow base.
   */
  async preview(tenantId: string, input: PriceChangeInput) {
    this.validate(input);
    const at = this.startOf(input.effective_date);
    if (input.target === 'ADDONS') return this.previewAddons(tenantId, input, at);
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
          option_item_id: null,
          name: variant ? `${product.name} — ${variant.name}` : product.name,
          current: before,
          new: this.adjust(before, input),
        }];
      });
    });
    return {
      effective_from: at,
      price_list: list ? { id: list.id, name: list.name } : null,
      items,
      changed: items.filter((i) => i.current !== i.new).length,
    };
  }

  /**
   * Every add-on the change touches, with its price on the start date (a dated add-on price in
   * force then, else the add-on's own) and the price it gets. Free add-ons ("no onions") stay
   * free: a change never puts a price on one.
   */
  private async previewAddons(tenantId: string, input: PriceChangeInput, at: Date) {
    const groups = await this.groupRepo.find({ where: { tenant_id: tenantId, ...(input.option_group_id ? { id: input.option_group_id } : {}) } });
    if (input.option_group_id && !groups.length) throw new NotFoundException('Add-on group not found');
    const options = groups.length
      ? await this.optionRepo.find({ where: { tenant_id: tenantId, option_group_id: In(groups.map((g) => g.id)) }, order: { sort_order: 'ASC', code: 'ASC' } })
      : [];
    const dated = addonPricesAt(await this.entryRepo.find({ where: { tenant_id: tenantId, ...ADDON_ROW, modifier_option_id: Not(IsNull()) } }), at);
    const groupName = new Map(groups.map((g) => [g.id, g.name]));
    const items: ChangeLine[] = options.flatMap((option) => {
      const before = dated.get(option.id) ?? MoneyUtil.format(option.price_delta || '0');
      if (MoneyUtil.isZero(before)) return [];
      return [{
        product_id: null,
        variant_id: null,
        option_item_id: option.id,
        name: `${groupName.get(option.option_group_id) || ''} — ${option.name}`,
        current: before,
        new: this.adjust(before, input),
      }];
    });
    return {
      effective_from: at,
      price_list: null as { id: string; name: string } | null,
      items,
      changed: items.filter((i) => i.current !== i.new).length,
    };
  }

  /** Save a previewed change. Items whose price would not move are left out. */
  async commit(tenantId: string, input: PriceChangeInput, userId: string | null, correlationId: string) {
    const preview = await this.preview(tenantId, input);
    const changed = preview.items.filter((i) => i.current !== i.new);
    if (changed.length === 0) throw new BadRequestException('No price would change');
    const at = preview.effective_from;
    const listId = preview.price_list?.id || null;
    const startsLater = at.getTime() > Date.now();

    const job = await this.entryRepo.manager.transaction(async (em) => {
      const saved = await em.save(
        em.create(PriceBulkJob, {
          tenant_id: tenantId,
          status: startsLater ? 'SCHEDULED' : 'APPLIED',
          price_group_id: listId,
          effective_from: at,
          affected_rows: changed.length,
          params: { ...input },
          created_by: userId || null,
        }),
      );
      const closed: ClosedEntry[] = [];
      for (const item of changed) {
        // The row in force on the start date ends there; the change's row takes over.
        const target = item.option_item_id
          ? { ...ADDON_ROW, modifier_option_id: item.option_item_id }
          : {
              product_id: item.product_id!,
              variant_id: item.variant_id || IsNull(),
              price_group_id: listId ?? IsNull(),
              branch_id: IsNull(),
              channel: IsNull(),
              order_type: IsNull(),
              modifier_option_id: IsNull(),
            };
        const replaced = (await em.find(PriceEntry, { where: { tenant_id: tenantId, ...target, effective_from: LessThanOrEqual(at) } })).filter((e) => isLiveAt(e, at) && new Date(e.effective_from).getTime() < at.getTime());
        for (const entry of replaced) {
          closed.push({ id: entry.id, previous_to: entry.effective_to ? new Date(entry.effective_to).toISOString() : null });
          entry.effective_to = at;
          await em.save(PriceEntry, entry);
        }
        await em.save(
          em.create(PriceEntry, {
            tenant_id: tenantId,
            product_id: item.product_id as string,
            variant_id: item.variant_id as string,
            modifier_option_id: item.option_item_id as string,
            price_group_id: listId,
            price_type: item.option_item_id ? 'ADDON' : listId ? 'LIST' : 'BASE',
            currency_code: 'IRR',
            amount: item.new,
            effective_from: at,
            bulk_job_id: saved.id,
            created_by: userId || null,
          }),
        );
      }
      saved.params = { ...saved.params, closed };
      return em.save(saved);
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
    if (!startsLater && !listId) await this.applyDueBaseChanges(tenantId);
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
      target: params.target || 'ITEMS',
      option_group_id: params.option_group_id || null,
      adjustment: params.adjustment,
      value: params.value,
      round_to: params.round_to || 0,
      category_id: params.category_id || null,
      created_at: job.created_at,
      cancelled_at: job.cancelled_at,
      can_cancel: job.status === 'SCHEDULED' && !!job.effective_from && new Date(job.effective_from).getTime() > Date.now(),
    };
  }

  /** Recent price changes, newest first. The pre-dated bulk updates have no start date and are left out. */
  async list(tenantId: string) {
    const jobs = await this.jobRepo.find({ where: { tenant_id: tenantId }, order: { created_at: 'DESC' }, take: 50 });
    const dated = jobs.filter((j) => j.effective_from);
    const listIds = [...new Set(dated.map((j) => j.price_group_id).filter((id): id is string => !!id))];
    const lists = listIds.length ? await this.listRepo.find({ where: { tenant_id: tenantId, id: In(listIds) }, withDeleted: true }) : [];
    return dated.map((j) => this.describe(j, lists.find((l) => l.id === j.price_group_id)?.name || null));
  }

  /** Call off a change that has not started: its prices go and the ones it would have ended stay. */
  async cancel(tenantId: string, jobId: string, userId: string | null, correlationId: string) {
    const job = await this.jobRepo.findOne({ where: { id: jobId, tenant_id: tenantId } });
    if (!job) throw new NotFoundException('Price change not found');
    if (job.status !== 'SCHEDULED' || !job.effective_from || new Date(job.effective_from).getTime() <= Date.now()) {
      throw new ConflictException({ statusCode: 409, code: 'PRICE_CHANGE_STARTED', message: 'This change has started; make a new change to undo it' });
    }
    const closed = ((job.params || {}).closed || []) as ClosedEntry[];
    await this.entryRepo.manager.transaction(async (em) => {
      await em.delete(PriceEntry, { tenant_id: tenantId, bulk_job_id: jobId });
      for (const c of closed) {
        await em.update(PriceEntry, { id: c.id, tenant_id: tenantId }, { effective_to: c.previous_to ? new Date(c.previous_to) : null } as any);
      }
      job.status = 'CANCELLED';
      job.cancelled_at = new Date();
      await em.save(job);
    });
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: userId || undefined,
      action: 'PRICE_CHANGE_CANCELLED',
      entityType: 'PriceBulkJob',
      entityId: jobId,
      correlationId,
    });
    return { id: jobId, status: 'CANCELLED' };
  }

  /**
   * Copy each dated base price that has started into its product or size, so `base_price`
   * (the product page, reports, import/export) says what the register charges, and each dated
   * add-on price into the add-on's `price_delta`, which the register and kiosk charge. Marks
   * the changes that have started as applied. Every tenant when none is given.
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

    updated += await this.applyDueAddonPrices(now, tenantId);

    await this.jobRepo
      .createQueryBuilder()
      .update(PriceBulkJob)
      .set({ status: 'APPLIED' })
      .where('status = :status', { status: 'SCHEDULED' })
      .andWhere('effective_from <= :now', { now })
      .andWhere(tenantId ? 'tenant_id = :tenantId' : '1=1', { tenantId })
      .execute();
    return { updated };
  }

  /** The add-on half of the sweep: a started dated add-on price becomes its `price_delta`. */
  private async applyDueAddonPrices(now: Date, tenantId?: string) {
    const rows = await this.entryRepo.find({
      where: { ...(tenantId ? { tenant_id: tenantId } : {}), ...ADDON_ROW, modifier_option_id: Not(IsNull()), effective_from: LessThanOrEqual(now) },
    });
    const byTenant = new Map<string, PriceEntry[]>();
    for (const row of rows) byTenant.set(row.tenant_id, [...(byTenant.get(row.tenant_id) || []), row]);

    let updated = 0;
    for (const [tenant, entries] of byTenant) {
      const due = addonPricesAt(entries, now);
      if (!due.size) continue;
      const options = await this.optionRepo.find({ where: { tenant_id: tenant, id: In([...due.keys()]) } });
      for (const option of options) {
        const amount = due.get(option.id)!;
        if (MoneyUtil.equals(option.price_delta || '0', amount)) continue;
        const before = option.price_delta;
        await this.optionRepo.update({ id: option.id, tenant_id: tenant }, { price_delta: amount });
        updated++;
        await this.auditWriter.write({
          tenantId: tenant,
          actorType: 'SYSTEM',
          action: 'PRICE_CHANGE_APPLIED',
          entityType: 'OptionItem',
          entityId: option.id,
          details: { optionItemId: option.id, before, after: amount },
        });
      }
    }
    return updated;
  }

  /**
   * A product's price history, newest first: dated prices (base and list, including changes
   * still to come) and base price edits made on the product page.
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
