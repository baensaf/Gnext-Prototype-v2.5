import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ArrayOverlap, EntityManager, In, Repository } from 'typeorm';
import { ItemDiscount } from '../../entities/ItemDiscount.entity';
import { Product } from '../../entities/Product.entity';
import { PriceGroup } from '../../entities/PriceGroup.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { ActiveItemDiscount, DISCOUNT_APPLIES_TO, activeItemDiscounts, sharesScope } from '../../common/utils/item-discount.util';

export interface ItemDiscountInput {
  /** The products it is for. `product_id` alone is read as one product. */
  product_ids?: string[];
  product_id?: string;
  /** Off pauses it. */
  is_active?: boolean;
  percent: string | number;
  starts_on: string;
  ends_on?: string | null;
  note?: string | null;
  /** Every price group (the default), or only `price_group_ids`. */
  all_groups?: boolean;
  price_group_ids?: string[];
  /** IN_STORE (the default; till and kiosk), SNAPPFOOD, or BOTH. */
  applies_to?: 'IN_STORE' | 'SNAPPFOOD' | 'BOTH';
}

export type { ActiveItemDiscount };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Automatic item discounts (V1, 2026-10-03): a dated percent off chosen products, applied to
 * every line of them at the till and the kiosk, and on the Snappfood menu. Head office sets them up
 * for all price groups or chosen ones, in store, on Snappfood or both (2026-10-12); the quote
 * engine asks `activeFor` which apply on the branch's business day. A product has at most one
 * discount for any group and channel on any day, so overlapping ones are refused rather than
 * resolved.
 */
@Injectable()
export class ItemDiscountsService {
  constructor(
    @InjectRepository(ItemDiscount) private readonly repo: Repository<ItemDiscount>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(PriceGroup) private readonly groupRepo: Repository<PriceGroup>,
    private readonly auditWriter: AuditWriter,
  ) {}

  /** Every item discount with its products' names, newest start first. */
  async list(tenantId: string) {
    const rows = await this.repo.find({ where: { tenant_id: tenantId }, order: { starts_on: 'DESC', created_at: 'DESC' } });
    const ids = [...new Set(rows.flatMap((r) => r.product_ids || []))];
    const products = ids.length ? await this.productRepo.find({ where: { tenant_id: tenantId, id: In(ids) }, withDeleted: true }) : [];
    const nameOf = new Map(products.map((p) => [p.id, p.name]));
    return rows.map((r) => ({ ...r, product_names: (r.product_ids || []).map((id) => nameOf.get(id) || null) }));
  }

  async create(tenantId: string, input: ItemDiscountInput, actorId?: string, correlationId?: string) {
    const data = await this.validate(tenantId, input);
    await this.refuseOverlap(tenantId, data, null);
    const saved = await this.repo.save(this.repo.create({ tenant_id: tenantId, ...data, created_by: actorId || null }));
    await this.auditWriter.write({ tenantId, actorType: 'ADMIN', actorId, action: 'ITEM_DISCOUNT_CREATED', entityType: 'ItemDiscount', entityId: saved.id, correlationId, afterData: saved });
    return saved;
  }

  async update(tenantId: string, id: string, input: Partial<ItemDiscountInput>, actorId?: string, correlationId?: string) {
    const row = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!row) throw new NotFoundException('Item discount not found');
    const before = { ...row };
    const data = await this.validate(tenantId, {
      product_ids: input.product_ids ?? (input.product_id ? [input.product_id] : row.product_ids),
      is_active: input.is_active ?? row.is_active,
      percent: input.percent ?? row.percent,
      starts_on: input.starts_on ?? row.starts_on,
      ends_on: input.ends_on !== undefined ? input.ends_on : row.ends_on,
      note: input.note !== undefined ? input.note : row.note,
      all_groups: input.all_groups ?? row.all_groups,
      price_group_ids: input.price_group_ids ?? row.price_group_ids,
      applies_to: input.applies_to ?? row.applies_to,
    });
    await this.refuseOverlap(tenantId, data, id);
    Object.assign(row, data);
    const saved = await this.repo.save(row);
    await this.auditWriter.write({ tenantId, actorType: 'ADMIN', actorId, action: 'ITEM_DISCOUNT_UPDATED', entityType: 'ItemDiscount', entityId: id, correlationId, beforeData: before, afterData: saved });
    return saved;
  }

  /** Removes a discount. Orders already priced keep the percent their lines were given. */
  async remove(tenantId: string, id: string, actorId?: string, correlationId?: string) {
    const row = await this.repo.findOne({ where: { id, tenant_id: tenantId } });
    if (!row) throw new NotFoundException('Item discount not found');
    await this.repo.delete({ id, tenant_id: tenantId });
    await this.auditWriter.write({ tenantId, actorType: 'ADMIN', actorId, action: 'ITEM_DISCOUNT_DELETED', entityType: 'ItemDiscount', entityId: id, correlationId, beforeData: row });
    return { success: true };
  }

  /**
   * The discount each product gets at a branch on the branch's business day, in store by
   * default or on Snappfood. Products with none are absent. See `activeItemDiscounts`.
   */
  async activeFor(
    tenantId: string,
    branchId: string | null | undefined,
    productIds: string[],
    em?: EntityManager,
    channel: 'IN_STORE' | 'SNAPPFOOD' = 'IN_STORE',
  ) {
    return activeItemDiscounts(em || this.repo.manager, tenantId, branchId, channel, productIds);
  }

  private async validate(tenantId: string, input: ItemDiscountInput) {
    const refuse = (code: string, message: string) => new BadRequestException({ statusCode: 400, code, message });
    const wanted = [...new Set((input.product_ids?.length ? input.product_ids : input.product_id ? [input.product_id] : []).map(String))];
    const products = wanted.length ? await this.productRepo.find({ where: { tenant_id: tenantId, id: In(wanted) } }) : [];
    if (!wanted.length || products.length !== wanted.length) throw refuse('ITEM_DISCOUNT_PRODUCT', 'Pick the items the discount is for');
    const percent = Number(input.percent);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) throw refuse('ITEM_DISCOUNT_PERCENT', 'A discount is more than 0% and at most 100%');
    const startsOn = String(input.starts_on || '').slice(0, 10);
    if (!DATE.test(startsOn)) throw refuse('ITEM_DISCOUNT_DATES', 'Pick the first day of the discount');
    const endsOn = input.ends_on ? String(input.ends_on).slice(0, 10) : null;
    if (endsOn && (!DATE.test(endsOn) || endsOn < startsOn)) throw refuse('ITEM_DISCOUNT_DATES', 'The last day is on or after the first day');
    const appliesTo = input.applies_to ?? 'IN_STORE';
    if (!(DISCOUNT_APPLIES_TO as readonly string[]).includes(appliesTo)) {
      throw refuse('ITEM_DISCOUNT_CHANNEL', 'The discount is in store, on Snappfood or both');
    }
    const allGroups = input.all_groups ?? true;
    const groupIds = allGroups ? [] : [...new Set((input.price_group_ids || []).map(String))];
    if (!allGroups) {
      const found = groupIds.length ? await this.groupRepo.count({ where: { tenant_id: tenantId, id: In(groupIds) } }) : 0;
      if (!groupIds.length || found !== groupIds.length) throw refuse('ITEM_DISCOUNT_GROUPS', 'Pick the price groups the discount is for');
    }
    return {
      product_ids: wanted,
      is_active: input.is_active ?? true,
      percent: percent.toFixed(2),
      starts_on: startsOn,
      ends_on: endsOn,
      note: String(input.note || '').trim().slice(0, 160) || null,
      all_groups: allGroups,
      price_group_ids: groupIds,
      applies_to: appliesTo,
    };
  }

  /**
   * A product has at most one discount for any group and channel on any day. A paused discount
   * is checked too, so switching it back on can never make two apply.
   */
  private async refuseOverlap(
    tenantId: string,
    next: Pick<ItemDiscount, 'product_ids' | 'starts_on' | 'ends_on' | 'all_groups' | 'price_group_ids' | 'applies_to'>,
    exceptId: string | null,
  ) {
    const others = (await this.repo.find({ where: { tenant_id: tenantId, product_ids: ArrayOverlap(next.product_ids) } })).filter((r) => r.id !== exceptId);
    const clash = others.find(
      (r) => (r.ends_on === null || r.ends_on >= next.starts_on) && (next.ends_on === null || r.starts_on <= next.ends_on) && sharesScope(r, next),
    );
    if (clash) {
      const shared = (clash.product_ids || []).filter((id) => next.product_ids.includes(id));
      const names = shared.length ? (await this.productRepo.find({ where: { tenant_id: tenantId, id: In(shared) } })).map((p) => p.name) : [];
      throw new ConflictException({
        statusCode: 409,
        code: 'ITEM_DISCOUNT_OVERLAP',
        message: `${names.join(', ') || 'An item'} already ${names.length > 1 ? 'have' : 'has'} a ${Number(clash.percent)}% discount from ${clash.starts_on}${clash.ends_on ? ` to ${clash.ends_on}` : ''} for the same price groups and channel`,
        discountId: clash.id,
      });
    }
  }
}
